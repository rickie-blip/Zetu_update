export const UPLOAD_UI_CLIENT_JS = `const fileInput = document.getElementById('fileInput');
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

    statusEl.textContent = 'Completed. Check updated/failed/skipped sections.';
    statusEl.className = failed.length > 0 ? 'status err' : 'status ok';
  } catch (error) {
    statusEl.textContent = 'Network/server error during upload.';
    statusEl.className = 'status err';
  } finally {
    uploadBtn.disabled = false;
  }
});
`;
