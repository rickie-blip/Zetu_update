# Shopify Inventory Updater (NestJS)

Production-ready NestJS backend that updates Shopify inventory levels from an uploaded spreadsheet using Shopify GraphQL Admin API.

## Requirements

- Node.js 18+
- Shopify Admin API access token with inventory scopes

## Configuration

Configuration is currently hardcoded in `src/config/shopify.config.ts`.

## Install and Run

```bash
npm install
npm run start:dev
```

## API

### `POST /inventory/upload`

- `multipart/form-data`
- field name: `file`
- supported: `.xlsx`, `.xls`, `.csv`

Shopify Inventory CSV template supported (recommended):

- `Handle`
- `SKU`
- `Location`
- `On hand (new)`

Other accepted identifiers/quantity aliases:

- `SKU` or `Variant SKU` (preferred identifier)
- `Variant Barcode` (fallback identifier)
- `Handle` (fallback identifier)
- `Title` / `Item Name` (fallback identifier)
- `On hand (new)`, `Available (not editable)`, `On hand (current)`, `Quantity`, or `Variant Inventory Qty`
- `ShopifyLocationName` or `Location` (optional)

At least one identifier column value must exist per row (`SKU`, `Variant Barcode`, `Handle`, or `Title`).

Available quantity decision logic:

1. Use `Closing Stock` (or `On hand (new)`) when present.
2. Else use `Opening Stock + Stock Movement` when both are present.
3. Else use `Opening Stock` fallback.
4. Else skip row as missing stock fields.

Response format:

```json
{
  "updated": [],
  "failed": [],
  "skipped": []
}
```

## Production Features Implemented

- Modular NestJS architecture (module/service/controller)
- Excel/CSV parsing with validation
- Shopify GraphQL location mapping (name -> location ID)
- SKU validation and variant lookup
- Inventory replace using GraphQL `inventorySetQuantities`
- Fetch current inventory and skip unchanged rows
- Duplicate row handling (same SKU/location uses latest row)
- Prevent duplicate SKU lookup calls
- Batched API operations with delay between batches
- Retry on Shopify 429 rate-limit responses
- Progress and completion logging
