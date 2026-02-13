import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('upload-ui')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUploadUi(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Inventory Upload</title>
  <style>
    :root { font-family: "Segoe UI", Tahoma, sans-serif; color-scheme: light; }
    body { margin: 0; background: #f6f8fb; color: #1f2937; }
    .wrap { max-width: 1080px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border: 1px solid #dbe3ef; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    button { background: #1165d8; color: #fff; border: 0; border-radius: 8px; padding: 10px 14px; cursor: pointer; }
    button[disabled] { opacity: .5; cursor: not-allowed; }
    .muted { color: #5f6f82; font-size: 14px; }
    .status { font-weight: 600; }
    .ok { color: #0f766e; }
    .err { color: #b91c1c; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .pill { border-radius: 10px; padding: 10px 12px; border: 1px solid #dbe3ef; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; border-bottom: 1px solid #e9eef6; padding: 8px 6px; }
    th { background: #f7f9fc; }
    @media (max-width: 840px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Shopify Inventory Upload</h1>
      <div class="row">
        <input id="fileInput" type="file" accept=".csv,.xlsx,.xls" />
        <button id="uploadBtn">Upload</button>
        <span id="status" class="status muted">Select a file to begin</span>
      </div>
      <p class="muted">Reference template: Shopify Inventory CSV (Handle, SKU, Location, On hand (new)). Required: quantity plus one identifier (SKU, Variant Barcode, Handle, or Title). Location is optional and resolved from Shopify when omitted.</p>
    </div>

    <div class="card">
      <div class="grid">
        <div class="pill">Updated: <strong id="countUpdated">0</strong></div>
        <div class="pill">Failed: <strong id="countFailed">0</strong></div>
        <div class="pill">Skipped: <strong id="countSkipped">0</strong></div>
      </div>
    </div>

    <div class="card">
      <h3>Updated Rows</h3>
      <div id="updatedWrap" class="muted">No updated rows yet.</div>
    </div>

    <div class="card">
      <h3>Failed Rows</h3>
      <div id="failedWrap" class="muted">No failed rows yet.</div>
    </div>

    <div class="card">
      <h3>Skipped Rows</h3>
      <div id="skippedWrap" class="muted">No skipped rows yet.</div>
    </div>
  </div>

  <script>
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const statusEl = document.getElementById('status');
    const countUpdated = document.getElementById('countUpdated');
    const countFailed = document.getElementById('countFailed');
    const countSkipped = document.getElementById('countSkipped');
    const updatedWrap = document.getElementById('updatedWrap');
    const failedWrap = document.getElementById('failedWrap');
    const skippedWrap = document.getElementById('skippedWrap');

    const tableHtml = (rows) => {
      if (!rows || rows.length === 0) return '<span class="muted">None</span>';
      const body = rows.map((r) => '<tr>' +
        '<td>' + (r.rowNumber ?? '') + '</td>' +
        '<td>' + (r.itemName ?? '') + '</td>' +
        '<td>' + (r.sku ?? '') + '</td>' +
        '<td>' + (r.locationName ?? '') + '</td>' +
        '<td>' + (r.quantity ?? '') + '</td>' +
        '<td>' + (r.reason ?? '') + '</td>' +
      '</tr>').join('');
      return '<table><thead><tr><th>Row</th><th>Item Name</th><th>SKU</th><th>Location</th><th>Qty</th><th>Reason</th></tr></thead><tbody>' + body + '</tbody></table>';
    };

    uploadBtn.addEventListener('click', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        statusEl.textContent = 'Please choose a file first.';
        statusEl.className = 'status err';
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      uploadBtn.disabled = true;
      statusEl.textContent = 'Uploading and processing...';
      statusEl.className = 'status muted';

      try {
        const res = await fetch('/inventory/upload', { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const message = data.message || 'Upload failed.';
          statusEl.textContent = message;
          statusEl.className = 'status err';
          return;
        }

        const updated = Array.isArray(data.updated) ? data.updated : [];
        const failed = Array.isArray(data.failed) ? data.failed : [];
        const skipped = Array.isArray(data.skipped) ? data.skipped : [];

        countUpdated.textContent = String(updated.length);
        countFailed.textContent = String(failed.length);
        countSkipped.textContent = String(skipped.length);
        updatedWrap.innerHTML = tableHtml(updated);
        failedWrap.innerHTML = tableHtml(failed);
        skippedWrap.innerHTML = tableHtml(skipped);

        statusEl.textContent = 'Completed. Check failed/skipped sections for issues.';
        statusEl.className = failed.length > 0 ? 'status err' : 'status ok';
      } catch (error) {
        statusEl.textContent = 'Network/server error during upload.';
        statusEl.className = 'status err';
      } finally {
        uploadBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        const allowed =
          file.originalname.toLowerCase().endsWith('.xlsx') ||
          file.originalname.toLowerCase().endsWith('.xls') ||
          file.originalname.toLowerCase().endsWith('.csv');

        callback(
          allowed
            ? null
            : new BadRequestException('Only .xlsx, .xls, or .csv files are supported'),
          allowed,
        );
      },
    }),
  )
  async uploadInventoryFile(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<unknown> {
    if (!file?.buffer) {
      throw new BadRequestException('No input file uploaded');
    }

    return this.inventoryService.processUpload(file.buffer);
  }
}
