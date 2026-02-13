export interface ParsedInventoryRow {
  rowNumber: number;
  sku: string;
  itemCode: string;
  handle: string;
  variantBarcode: string;
  title: string;
  optionValues: string[];
  quantity: number;
  calculationSource: string;
  shopifyLocationName: string;
  binName: string;
}

export interface ResultRow {
  rowNumber: number;
  sku: string;
  itemName: string;
  locationName: string;
  quantity: number;
  reason: string;
  calculationSource?: string;
}

export interface InventorySyncSummary {
  updated: ResultRow[];
  failed: ResultRow[];
  skipped: ResultRow[];
}
