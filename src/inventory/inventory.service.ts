import { Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/shopify.config';
import { ExcelService } from '../services/excel.service';
import {
  ShopifyLocation,
  ShopifyService,
  ShopifyVariant,
} from '../services/shopify.service';
import {
  InventorySyncSummary,
  ParsedInventoryRow,
  ResultRow,
} from './inventory.types';

interface VariantCacheValue {
  inventoryItemId: string;
  sku: string;
}

interface VariantResolution {
  variant: VariantCacheValue | null;
  reason?: string;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private readonly batchSize: number;
  private readonly batchDelayMs: number;

  constructor(
    private readonly excelService: ExcelService,
    private readonly shopifyService: ShopifyService,
  ) {
    this.batchSize = APP_CONFIG.batchSize;
    this.batchDelayMs = APP_CONFIG.batchDelayMs;
  }

  async processUpload(buffer: Buffer): Promise<InventorySyncSummary> {
    const summary: InventorySyncSummary = {
      updated: [],
      failed: [],
      skipped: [],
    };

    const { parsedRows, skippedRows } = this.excelService.parseInventoryRows(buffer);
    summary.skipped.push(...skippedRows);

    if (!parsedRows.length) {
      this.logger.warn('No valid rows found in uploaded file');
      return summary;
    }

    // Keep latest row per SKU/location to avoid redundant updates.
    const dedupedRows = this.deduplicateRows(parsedRows, summary);
    const locations = await this.shopifyService.getLocations();
    const locationsMap = this.buildLocationMap(locations);

    const variantByIdentifier = await this.prefetchVariantsByIdentifier(dedupedRows);

    const totalRows = dedupedRows.length;
    let processed = 0;

    // Process in batches to reduce Shopify burst pressure.
    for (const batch of this.chunk(dedupedRows, this.batchSize)) {
      await Promise.all(
        batch.map(async (row) => {
          const result = await this.processRow(
            row,
            locations,
            locationsMap,
            variantByIdentifier,
          );

          if (result.bucket === 'updated') {
            summary.updated.push(result.payload);
          } else if (result.bucket === 'failed') {
            summary.failed.push(result.payload);
          } else {
            summary.skipped.push(result.payload);
          }

          processed += 1;
        }),
      );

      this.logger.log(`Progress: ${processed}/${totalRows} rows processed`);

      if (processed < totalRows && this.batchDelayMs > 0) {
        await this.delay(this.batchDelayMs);
      }
    }

    this.logger.log(
      `Sync complete. Updated=${summary.updated.length}, Failed=${summary.failed.length}, Skipped=${summary.skipped.length}`,
    );

    return summary;
  }

  private async prefetchVariantsByIdentifier(
    rows: ParsedInventoryRow[],
  ): Promise<Map<string, VariantResolution>> {
    const representativeByKey = new Map<string, ParsedInventoryRow>();
    rows.forEach((row) => {
      representativeByKey.set(this.buildIdentifierKey(row), row);
    });

    const variantByIdentifier = new Map<string, VariantResolution>();
    const uniqueRows = [...representativeByKey.values()];

    for (const batch of this.chunk(uniqueRows, this.batchSize)) {
      await Promise.all(
        batch.map(async (row) => {
          const key = this.buildIdentifierKey(row);
          try {
            const resolution = await this.resolveVariant(row);
            variantByIdentifier.set(key, resolution);
          } catch (error: unknown) {
            this.logger.error(
              `Failed to resolve variant for ${key}: ${this.getErrorMessage(error)}`,
            );
            variantByIdentifier.set(key, {
              variant: null,
              reason: `Lookup error: ${this.getErrorMessage(error)}`,
            });
          }
        }),
      );

      if (this.batchDelayMs > 0) {
        await this.delay(this.batchDelayMs);
      }
    }

    return variantByIdentifier;
  }

  private async processRow(
    row: ParsedInventoryRow,
    locations: ShopifyLocation[],
    locationsMap: Map<string, string>,
    variantByIdentifier: Map<string, VariantResolution>,
  ): Promise<{ bucket: keyof InventorySyncSummary; payload: ResultRow }> {
    const variantResolution = variantByIdentifier.get(this.buildIdentifierKey(row));
    const variant = variantResolution?.variant;

    if (!variant) {
      return {
        bucket: 'failed',
        payload: {
          rowNumber: row.rowNumber,
          sku: row.sku,
          itemName: row.title,
          locationName: row.shopifyLocationName,
          quantity: row.quantity,
          reason: variantResolution?.reason || 'Could not resolve variant in Shopify',
          calculationSource: row.calculationSource,
        },
      };
    }

    try {
      const resolvedSku = row.sku || variant.sku;
      const resolvedLocation = await this.resolveLocationForRow(
        row,
        variant.inventoryItemId,
        locations,
        locationsMap,
      );
      if (!resolvedLocation) {
        return {
          bucket: 'failed',
          payload: {
            rowNumber: row.rowNumber,
            sku: row.sku,
            itemName: row.title,
            locationName: row.shopifyLocationName,
            quantity: row.quantity,
            reason:
              'Location is ambiguous. Add location in file or set defaultLocationName in config',
            calculationSource: row.calculationSource,
          },
        };
      }

      const current = await this.shopifyService.getCurrentInventory(
        variant.inventoryItemId,
        resolvedLocation.id,
      );

      if (current === row.quantity) {
        return {
          bucket: 'skipped',
          payload: {
            rowNumber: row.rowNumber,
            sku: resolvedSku,
            itemName: row.title,
            locationName: resolvedLocation.name,
            quantity: row.quantity,
            reason: 'Inventory already matches target quantity',
            calculationSource: row.calculationSource,
          },
        };
      }

      await this.shopifyService.setInventory(
        variant.inventoryItemId,
        resolvedLocation.id,
        row.quantity,
      );

      return {
        bucket: 'updated',
        payload: {
          rowNumber: row.rowNumber,
          sku: resolvedSku,
          itemName: row.title,
          locationName: resolvedLocation.name,
          quantity: row.quantity,
          reason: current == null ? 'Inventory created/initialized' : `Updated from ${current}`,
          calculationSource: row.calculationSource,
        },
      };
    } catch (error: unknown) {
      return {
        bucket: 'failed',
        payload: {
          rowNumber: row.rowNumber,
          sku: row.sku || variant.sku,
          itemName: row.title,
          locationName: row.shopifyLocationName,
          quantity: row.quantity,
          reason: `Shopify API error: ${this.getErrorMessage(error)}`,
          calculationSource: row.calculationSource,
        },
      };
    }
  }

  private deduplicateRows(
    rows: ParsedInventoryRow[],
    summary: InventorySyncSummary,
  ): ParsedInventoryRow[] {
    const groupedByIdentifierAndLocation = new Map<string, ParsedInventoryRow[]>();

    rows.forEach((row) => {
      const locationKey = row.shopifyLocationName
        ? row.shopifyLocationName.toLowerCase()
        : '__auto__';
      const key = `${this.buildIdentifierKey(row)}::${locationKey}`;
      const existing = groupedByIdentifierAndLocation.get(key) || [];
      existing.push(row);
      groupedByIdentifierAndLocation.set(key, existing);
    });

    const uniqueRows: ParsedInventoryRow[] = [];

    groupedByIdentifierAndLocation.forEach((groupRows) => {
      if (groupRows.length === 1) {
        uniqueRows.push(groupRows[0]);
        return;
      }

      const normalizedBins = groupRows
        .map((row) => row.binName.trim().toLowerCase())
        .filter((bin) => bin !== '');
      const uniqueBins = new Set(normalizedBins);
      const allRowsHaveBin = normalizedBins.length === groupRows.length;
      const binsAreUnique = uniqueBins.size === groupRows.length;

      // Inventory template can list the same item/location across multiple bins.
      // In that case, aggregate to one location-level quantity before Shopify update.
      if (allRowsHaveBin && binsAreUnique) {
        const representative = groupRows[0];
        const totalQuantity = groupRows.reduce((sum, row) => sum + row.quantity, 0);
        uniqueRows.push({
          ...representative,
          quantity: totalQuantity,
          calculationSource: 'aggregated_from_bins',
        });

        for (let i = 1; i < groupRows.length; i += 1) {
          const row = groupRows[i];
          summary.skipped.push({
            rowNumber: row.rowNumber,
            sku: row.sku,
            itemName: row.title,
            locationName: row.shopifyLocationName,
            quantity: row.quantity,
            reason: `Aggregated with other bins for same item/location`,
            calculationSource: row.calculationSource,
          });
        }

        return;
      }

      const rowNumbers = groupRows.map((row) => row.rowNumber).join(', ');
      groupRows.forEach((row) => {
        summary.failed.push({
          rowNumber: row.rowNumber,
          sku: row.sku,
          itemName: row.title,
          locationName: row.shopifyLocationName,
          quantity: row.quantity,
          reason: `Duplicate item/location in file. Conflicting rows: ${rowNumbers}`,
          calculationSource: row.calculationSource,
        });
      });
    });

    return uniqueRows;
  }

  private async resolveVariant(row: ParsedInventoryRow): Promise<VariantResolution> {
    if (row.sku) {
      const variant = await this.shopifyService.getVariantBySku(row.sku);
      if (variant) {
        return {
          variant: {
            sku: variant.sku || row.sku,
            inventoryItemId: variant.inventoryItemId,
          },
        };
      }
    }

    if (row.itemCode) {
      const variant = await this.shopifyService.getVariantBySku(row.itemCode);
      if (variant) {
        return {
          variant: {
            sku: variant.sku || row.sku || row.itemCode,
            inventoryItemId: variant.inventoryItemId,
          },
        };
      }
    }

    if (row.variantBarcode) {
      const variant = await this.shopifyService.getVariantByBarcode(row.variantBarcode);
      if (variant) {
        return {
          variant: {
            sku: variant.sku || row.sku,
            inventoryItemId: variant.inventoryItemId,
          },
        };
      }
    }

    if (row.handle) {
      const variants = await this.shopifyService.getVariantsByHandle(row.handle);
      if (!variants.length) {
        return { variant: null, reason: `No product found for handle "${row.handle}"` };
      }

      const matchedByOptions = this.matchVariantsByOptions(variants, row.optionValues);
      if (matchedByOptions.length === 1) {
        return {
          variant: {
            sku: matchedByOptions[0].sku || row.sku,
            inventoryItemId: matchedByOptions[0].inventoryItemId,
          },
        };
      }

      if (matchedByOptions.length > 1) {
        const matchedByTitle = row.title
          ? matchedByOptions.filter(
              (variant) =>
                (variant.title || '').trim().toLowerCase() === row.title.trim().toLowerCase(),
            )
          : [];

        if (matchedByTitle.length === 1) {
          return {
            variant: {
              sku: matchedByTitle[0].sku || row.sku,
              inventoryItemId: matchedByTitle[0].inventoryItemId,
            },
          };
        }

        return {
          variant: null,
          reason: `Handle "${row.handle}" matched multiple variants; provide SKU or barcode`,
        };
      }
    }

    if (row.title) {
      const variants = await this.shopifyService.getVariantsByTitle(row.title);
      if (!variants.length) {
        return { variant: null, reason: `No product found for title "${row.title}"` };
      }

      const matchedByOptions = this.matchVariantsByOptions(variants, row.optionValues);
      if (matchedByOptions.length === 1) {
        return {
          variant: {
            sku: matchedByOptions[0].sku || row.sku,
            inventoryItemId: matchedByOptions[0].inventoryItemId,
          },
        };
      }

      if (matchedByOptions.length > 1) {
        return {
          variant: null,
          reason: `Title "${row.title}" matched multiple variants; provide SKU, barcode, or handle`,
        };
      }
    }

    return {
      variant: null,
      reason: 'No matching variant by SKU, barcode, handle, or title',
    };
  }

  private matchVariantsByOptions(
    variants: ShopifyVariant[],
    optionValues: string[],
  ): ShopifyVariant[] {
    if (!optionValues.length) {
      return variants;
    }

    const normalizedOptions = optionValues.map((value) => value.trim().toLowerCase());
    return variants.filter((variant) => {
      const selected = (variant.selectedOptionValues || []).map((value) =>
        value.trim().toLowerCase(),
      );
      return normalizedOptions.every((option) => selected.includes(option));
    });
  }

  private buildIdentifierKey(row: ParsedInventoryRow): string {
    const optionsKey = row.optionValues.map((value) => value.trim().toLowerCase()).join('|');
    return `sku:${row.sku.trim().toLowerCase()}|itemcode:${row.itemCode
      .trim()
      .toLowerCase()}|barcode:${row.variantBarcode
      .trim()
      .toLowerCase()}|handle:${row.handle.trim().toLowerCase()}|title:${row.title
      .trim()
      .toLowerCase()}|opts:${optionsKey}`;
  }

  private buildLocationMap(locations: ShopifyLocation[]): Map<string, string> {
    const map = new Map<string, string>();
    locations.forEach((location) => {
      map.set(location.name.trim().toLowerCase(), location.id);
    });
    return map;
  }

  private async resolveLocationForRow(
    row: ParsedInventoryRow,
    inventoryItemId: string,
    locations: ShopifyLocation[],
    locationsMap: Map<string, string>,
  ): Promise<ShopifyLocation | null> {
    const requestedName = row.shopifyLocationName.trim();
    if (requestedName) {
      const locationId = locationsMap.get(requestedName.toLowerCase());
      if (!locationId) {
        return null;
      }

      return locations.find((location) => location.id === locationId) || null;
    }

    if (locations.length === 1) {
      return locations[0];
    }

    const itemLocationIds = await this.shopifyService.getInventoryItemLocationIds(
      inventoryItemId,
    );
    const uniqueItemLocationIds = [...new Set(itemLocationIds)];
    if (uniqueItemLocationIds.length === 1) {
      const match = locations.find((location) => location.id === uniqueItemLocationIds[0]);
      if (match) {
        return match;
      }
    }

    const defaultLocationName = APP_CONFIG.shopify.defaultLocationName.trim().toLowerCase();
    if (defaultLocationName) {
      const defaultLocationId = locationsMap.get(defaultLocationName);
      if (!defaultLocationId) {
        return null;
      }

      return locations.find((location) => location.id === defaultLocationId) || null;
    }

    return null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    const safeSize = Math.max(1, size);

    for (let i = 0; i < items.length; i += safeSize) {
      result.push(items.slice(i, i + safeSize));
    }

    return result;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
