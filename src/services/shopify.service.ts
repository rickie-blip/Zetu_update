import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/shopify.config';

export interface ShopifyVariant {
  sku: string;
  inventoryItemId: string;
  title?: string;
  barcode?: string;
  selectedOptionValues?: string[];
}

export interface ShopifyLocation {
  id: string;
  name: string;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface InventorySetQuantitiesPayload {
  inventorySetQuantities: {
    userErrors: Array<{ message: string }>;
  };
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly shopName: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;

  constructor() {
    this.maxRetries = APP_CONFIG.maxRetries;
    this.retryBaseDelayMs = APP_CONFIG.retryBaseDelayMs;
    this.shopName = APP_CONFIG.shopify.shopName;
    this.accessToken = APP_CONFIG.shopify.accessToken;
    this.apiVersion = APP_CONFIG.shopify.apiVersion;

    if (!this.shopName || !this.accessToken) {
      throw new BadRequestException(
        'Missing hardcoded Shopify config values (shopName/accessToken)',
      );
    }
  }

  async getLocations(): Promise<ShopifyLocation[]> {
    const query = `
      query GetLocations {
        locations(first: 250) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const payload = await this.withRetry('locations query', async () =>
      this.graphql<{
        locations: { edges: Array<{ node: ShopifyLocation }> };
      }>(query),
    );

    return payload.locations.edges.map((edge) => edge.node);
  }

  async getLocationsMap(): Promise<Map<string, string>> {
    const locations = await this.getLocations();
    const map = new Map<string, string>();
    locations.forEach((location) => {
      map.set(location.name.trim().toLowerCase(), location.id);
    });

    return map;
  }

  async getVariantBySku(sku: string): Promise<ShopifyVariant | null> {
    const query = `
      query VariantBySku($search: String!) {
        productVariants(first: 1, query: $search) {
          edges {
            node {
              sku
              inventoryItem {
                id
              }
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(`variant query sku=${sku}`, async () =>
      this.graphql<{
        productVariants: {
          edges: Array<{ node: { sku: string; inventoryItem: { id: string } | null } }>;
        };
      }>(query, { search: `sku:${sku}` }),
    );

    const node = payload.productVariants.edges[0]?.node;
    if (!node?.inventoryItem?.id) {
      return null;
    }

    return {
      sku: node.sku,
      inventoryItemId: node.inventoryItem.id,
      barcode: undefined,
      title: undefined,
      selectedOptionValues: [],
    };
  }

  async getVariantByBarcode(barcode: string): Promise<ShopifyVariant | null> {
    const query = `
      query VariantByBarcode($search: String!) {
        productVariants(first: 1, query: $search) {
          edges {
            node {
              sku
              title
              barcode
              selectedOptions {
                value
              }
              inventoryItem {
                id
              }
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(`variant query barcode=${barcode}`, async () =>
      this.graphql<{
        productVariants: {
          edges: Array<
            {
              node: {
                sku: string;
                title: string;
                barcode: string | null;
                selectedOptions: Array<{ value: string }>;
                inventoryItem: { id: string } | null;
              };
            }
          >;
        };
      }>(query, { search: `barcode:${barcode}` }),
    );

    const node = payload.productVariants.edges[0]?.node;
    if (!node?.inventoryItem?.id) {
      return null;
    }

    return {
      sku: node.sku || '',
      inventoryItemId: node.inventoryItem.id,
      barcode: node.barcode || undefined,
      title: node.title || undefined,
      selectedOptionValues: node.selectedOptions.map((option) => option.value),
    };
  }

  async getVariantsByHandle(handle: string): Promise<ShopifyVariant[]> {
    const query = `
      query VariantsByHandle($search: String!) {
        products(first: 1, query: $search) {
          edges {
            node {
              variants(first: 100) {
                edges {
                  node {
                    sku
                    title
                    barcode
                    selectedOptions {
                      value
                    }
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(`product query handle=${handle}`, async () =>
      this.graphql<{
        products: {
          edges: Array<
            {
              node: {
                variants: {
                  edges: Array<
                    {
                      node: {
                        sku: string;
                        title: string;
                        barcode: string | null;
                        selectedOptions: Array<{ value: string }>;
                        inventoryItem: { id: string } | null;
                      };
                    }
                  >;
                };
              };
            }
          >;
        };
      }>(query, { search: `handle:${handle}` }),
    );

    const product = payload.products.edges[0]?.node;
    if (!product) {
      return [];
    }

    return product.variants.edges
      .map((edge) => edge.node)
      .filter((variant) => Boolean(variant.inventoryItem?.id))
      .map((variant) => ({
        sku: variant.sku || '',
        inventoryItemId: variant.inventoryItem!.id,
        barcode: variant.barcode || undefined,
        title: variant.title || undefined,
        selectedOptionValues: variant.selectedOptions.map((option) => option.value),
      }));
  }

  async getVariantsByTitle(title: string): Promise<ShopifyVariant[]> {
    const query = `
      query VariantsByTitle($search: String!) {
        products(first: 10, query: $search) {
          edges {
            node {
              title
              variants(first: 100) {
                edges {
                  node {
                    sku
                    title
                    barcode
                    selectedOptions {
                      value
                    }
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(`product query title=${title}`, async () =>
      this.graphql<{
        products: {
          edges: Array<
            {
              node: {
                title: string;
                variants: {
                  edges: Array<
                    {
                      node: {
                        sku: string;
                        title: string;
                        barcode: string | null;
                        selectedOptions: Array<{ value: string }>;
                        inventoryItem: { id: string } | null;
                      };
                    }
                  >;
                };
              };
            }
          >;
        };
      }>(query, { search: `title:${title}` }),
    );

    const rankedProducts = payload.products.edges
      .map((edge) => ({
        product: edge.node,
        score: this.computeTitleSimilarity(title, edge.node.title),
      }))
      .sort((a, b) => b.score - a.score);

    if (!rankedProducts.length) {
      return [];
    }

    const best = rankedProducts[0];
    const secondBest = rankedProducts[1];
    const minimumConfidence = 0.58;
    const minimumGap = 0.08;

    if (best.score < minimumConfidence) {
      return [];
    }

    if (secondBest && best.score - secondBest.score < minimumGap) {
      // Ambiguous fuzzy match between product titles: require stronger identifier.
      return [];
    }

    return best.product.variants.edges
      .map((variantEdge) => variantEdge.node)
      .filter((variant) => Boolean(variant.inventoryItem?.id))
      .map((variant) => ({
        sku: variant.sku || '',
        inventoryItemId: variant.inventoryItem!.id,
        barcode: variant.barcode || undefined,
        title: variant.title || undefined,
        selectedOptionValues: variant.selectedOptions.map((option) => option.value),
      }));
  }

  private computeTitleSimilarity(inputTitle: string, shopifyTitle: string): number {
    const left = this.normalizeTitle(inputTitle);
    const right = this.normalizeTitle(shopifyTitle);

    if (!left || !right) {
      return 0;
    }

    if (left === right) {
      return 1;
    }

    let score = this.jaccardTokenSimilarity(left, right);

    if (left.includes(right) || right.includes(left)) {
      score += 0.22;
    }

    // Lightweight prefix hint for names that start similarly.
    const leftPrefix = left.slice(0, Math.min(10, left.length));
    const rightPrefix = right.slice(0, Math.min(10, right.length));
    if (leftPrefix === rightPrefix) {
      score += 0.08;
    }

    return Math.min(1, score);
  }

  private jaccardTokenSimilarity(a: string, b: string): number {
    const aTokens = new Set(a.split(' ').filter((token) => token));
    const bTokens = new Set(b.split(' ').filter((token) => token));

    if (!aTokens.size || !bTokens.size) {
      return 0;
    }

    let intersection = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) {
        intersection += 1;
      }
    }

    const union = aTokens.size + bTokens.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getCurrentInventory(
    inventoryItemId: string,
    locationId: string,
  ): Promise<number | null> {
    const query = `
      query CurrentInventory($inventoryItemId: ID!, $locationId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(
      `inventory level query item=${inventoryItemId} location=${locationId}`,
      async () =>
        this.graphql<{
          inventoryItem: {
            inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
          } | null;
        }>(query, { inventoryItemId, locationId }),
    );

    const quantity = payload.inventoryItem?.inventoryLevel?.quantities[0]?.quantity;
    return typeof quantity === 'number' ? quantity : null;
  }

  async setInventory(
    inventoryItemId: string,
    locationId: string,
    available: number,
  ): Promise<void> {
    const mutation = `
      mutation SetInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors {
            message
          }
        }
      }
    `;

    const payload = await this.withRetry(
      `inventory set mutation item=${inventoryItemId} location=${locationId}`,
      async () =>
        this.graphql<InventorySetQuantitiesPayload>(mutation, {
          input: {
            name: 'available',
            reason: 'correction',
            ignoreCompareQuantity: true,
            quantities: [
              {
                inventoryItemId,
                locationId,
                quantity: available,
              },
            ],
          },
        }),
    );

    const userError = payload.inventorySetQuantities.userErrors[0];
    if (userError) {
      throw new Error(userError.message);
    }
  }

  async getInventoryItemLocationIds(inventoryItemId: string): Promise<string[]> {
    const query = `
      query ItemLocations($inventoryItemId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          inventoryLevels(first: 250) {
            edges {
              node {
                location {
                  id
                }
              }
            }
          }
        }
      }
    `;

    const payload = await this.withRetry(
      `inventory locations query item=${inventoryItemId}`,
      async () =>
        this.graphql<{
          inventoryItem: {
            inventoryLevels: { edges: Array<{ node: { location: { id: string } | null } }> };
          } | null;
        }>(query, { inventoryItemId }),
    );

    if (!payload.inventoryItem) {
      return [];
    }

    return payload.inventoryItem.inventoryLevels.edges
      .map((edge) => edge.node.location?.id || '')
      .filter((id) => id !== '');
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(this.getGraphqlUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new HttpLikeError(
        `Shopify GraphQL HTTP ${response.status}: ${message}`,
        response.status,
      );
    }

    const payload = (await response.json()) as GraphqlResponse<T>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join('; '));
    }

    if (!payload.data) {
      throw new Error('Shopify GraphQL response missing data');
    }

    return payload.data;
  }

  private async withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt += 1;

      try {
        return await operation();
      } catch (error: unknown) {
        const statusCode = this.extractStatusCode(error);
        const shouldRetry = statusCode === 429 && attempt <= this.maxRetries;

        if (!shouldRetry) {
          throw error;
        }

        const delayMs = this.retryBaseDelayMs * attempt;
        this.logger.warn(
          `Rate limit hit for ${label}. Retry ${attempt}/${this.maxRetries} in ${delayMs}ms`,
        );
        await this.delay(delayMs);
      }
    }
  }

  private getGraphqlUrl(): string {
    const domain = this.shopName.includes('.myshopify.com')
      ? this.shopName
      : `${this.shopName}.myshopify.com`;

    return `https://${domain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error instanceof HttpLikeError) {
      return error.statusCode;
    }

    if (typeof error !== 'object' || error == null) {
      return undefined;
    }

    const maybeStatus = (error as { statusCode?: number }).statusCode;
    return typeof maybeStatus === 'number' ? maybeStatus : undefined;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class HttpLikeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpLikeError';
  }
}
