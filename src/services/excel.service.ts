import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ParsedInventoryRow, ResultRow } from '../inventory/inventory.types';

@Injectable()
export class ExcelService {
  private readonly skuColumns = ['SKU', 'sku', 'Variant SKU', 'variant sku'];
  private readonly itemCodeColumns = ['Item Code', 'item code', 'Item Code_New', 'item code_new'];
  private readonly handleColumns = ['Handle', 'handle'];
  private readonly titleColumns = ['Title', 'title', 'Item Name', 'item name'];
  private readonly barcodeColumns = [
    'Variant Barcode',
    'variant barcode',
    'Barcode',
    'barcode',
    'Barcode Value',
    'barcode value',
    'Ean Code',
    'ean code',
  ];
  private readonly optionValueColumns = [
    'Option1 Value',
    'option1 value',
    'Option2 Value',
    'option2 value',
    'Option3 Value',
    'option3 value',
    'Size',
    'size',
    'Colour',
    'colour',
    'Color',
    'color',
  ];
  private readonly closingStockColumns = [
    'Closing Stock',
    'closing stock',
    'Closing Stock On Qty',
    'closing stock on qty',
    'On hand (new)',
    'on hand (new)',
    'Available (not editable)',
    'available (not editable)',
    'Quantity',
    'quantity',
    'Variant Inventory Qty',
    'variant inventory qty',
  ];
  private readonly openingStockColumns = [
    'Opening Stock',
    'opening stock',
    'Opening Stock Qty',
    'opening stock qty',
    'On hand (current)',
    'on hand (current)',
    'Available',
    'available',
  ];
  private readonly stockMovementColumns = [
    'Stock Movement',
    'stock movement',
    'Movement',
    'movement',
    'Net Movement',
    'net movement',
    'Adjustment',
    'adjustment',
  ];
  private readonly inwardColumns = ['Inward Stock', 'inward stock', 'Received Qty', 'received qty'];
  private readonly outwardColumns = ['Out Qty', 'out qty', 'Sold Qty', 'sold qty'];
  private readonly locationColumns = [
    'ShopifyLocationName',
    'shopifyLocationName',
    'Location',
    'location',
    'Location Name',
    'location name',
    'Inventory Location',
    'inventory location',
  ];
  private readonly binColumns = ['Bin name', 'bin name', 'Bin', 'bin'];

  parseInventoryRows(buffer: Buffer): {
    parsedRows: ParsedInventoryRow[];
    skippedRows: ResultRow[];
  } {
    // Parse only the first worksheet as requested.
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (!workbook.SheetNames.length) {
      return {
        parsedRows: [],
        skippedRows: [
          {
            rowNumber: 0,
            sku: '',
            itemName: '',
            locationName: '',
            quantity: 0,
            reason: 'Workbook has no sheets',
          },
        ],
      };
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
      defval: '',
      raw: true,
    });

    const parsedRows: ParsedInventoryRow[] = [];
    const skippedRows: ResultRow[] = [];

    rows.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      // Support common header casing variants.
      const sku = this.getString(rawRow, this.skuColumns).trim();
      const itemCode = this.getString(rawRow, this.itemCodeColumns).trim();
      const handle = this.getString(rawRow, this.handleColumns).trim();
      const title = this.getString(rawRow, this.titleColumns).trim();
      const variantBarcode = this.getString(rawRow, this.barcodeColumns).trim();
      const optionValues = this.optionValueColumns
        .map((column) => this.getString(rawRow, [column]).trim())
        .filter((value) => value !== '');
      const locationName = this.getString(rawRow, this.locationColumns).trim();
      const binName = this.getString(rawRow, this.binColumns).trim();
      const quantityDecision = this.resolveQuantity(rawRow);
      const quantityMissing = quantityDecision.quantity == null;
      const quantity = quantityDecision.quantity ?? 0;

      if (!sku && !itemCode && !handle && !variantBarcode && !title) {
        skippedRows.push({
          rowNumber,
          sku,
          itemName: title,
          locationName,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          reason: 'Missing identifiers: provide SKU, Item Code, Handle, Variant Barcode, or Title',
        });
        return;
      }

      if (quantityMissing) {
        skippedRows.push({
          rowNumber,
          sku,
          itemName: title,
          locationName,
          quantity: 0,
          reason: quantityDecision.reason || 'Missing quantity values',
          calculationSource: quantityDecision.source,
        });
        return;
      }

      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        skippedRows.push({
          rowNumber,
          sku,
          itemName: title,
          locationName,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          reason: 'Quantity must be a non-negative integer',
          calculationSource: quantityDecision.source,
        });
        return;
      }

      parsedRows.push({
        rowNumber,
        sku,
        itemCode,
        handle,
        variantBarcode,
        title,
        optionValues,
        quantity,
        calculationSource: quantityDecision.source,
        shopifyLocationName: locationName,
        binName,
      });
    });

    return { parsedRows, skippedRows };
  }

  private getValue(
    row: Record<string, unknown>,
    keys: string[],
  ): unknown {
    const normalized = new Map<string, unknown>();

    Object.entries(row).forEach(([key, value]) => {
      normalized.set(key.trim().toLowerCase(), value);
    });

    for (const key of keys) {
      const value = normalized.get(key.trim().toLowerCase());
      if (value !== undefined) {
        return value;
      }
    }

    return '';
  }

  private getString(
    row: Record<string, unknown>,
    keys: string[],
  ): string {
    const value = this.getValue(row, keys);
    return value == null ? '' : String(value);
  }

  private parseQuantity(value: unknown): number | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const raw = String(value).trim();
    if (!raw) {
      return null;
    }

    const normalized = raw.toLowerCase();
    if (
      normalized === 'not stocked' ||
      normalized === 'n/a' ||
      normalized === 'na' ||
      normalized === 'none' ||
      normalized === 'null' ||
      normalized === '-'
    ) {
      return 0;
    }

    const numericText = raw.replace(/,/g, '');
    const parsed = Number(numericText);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private resolveQuantity(row: Record<string, unknown>): {
    quantity: number | null;
    source: string;
    reason?: string;
  } {
    const closing = this.parseQuantity(this.getValue(row, this.closingStockColumns));
    if (closing != null) {
      return {
        quantity: Math.max(0, Math.round(closing)),
        source: 'closing_stock_direct',
      };
    }

    const opening = this.parseQuantity(this.getValue(row, this.openingStockColumns));
    const movement = this.parseQuantity(this.getValue(row, this.stockMovementColumns));
    if (opening != null && movement != null) {
      return {
        quantity: Math.max(0, Math.round(opening + movement)),
        source: 'opening_plus_movement',
      };
    }

    const inward = this.parseQuantity(this.getValue(row, this.inwardColumns));
    const outward = this.parseQuantity(this.getValue(row, this.outwardColumns));
    if (opening != null && (inward != null || outward != null)) {
      const inwardValue = inward ?? 0;
      const outwardValue = outward ?? 0;
      return {
        quantity: Math.max(0, Math.round(opening + inwardValue - outwardValue)),
        source: 'opening_plus_inward_minus_outward',
      };
    }

    if (opening != null) {
      return {
        quantity: Math.max(0, Math.round(opening)),
        source: 'opening_stock_fallback',
      };
    }

    return {
      quantity: null,
      source: 'missing_stock_fields',
      reason:
        'Missing stock values. Provide Closing Stock/On hand (new), or Opening Stock (+ Movement)',
    };
  }
}
