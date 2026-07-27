/**
 * drive.js
 * -----------------------------------------------------------------------
 * Gọi trực tiếp Google Drive REST API v3 bằng fetch() + Access Token.
 * Không dùng gapi client library để giảm phụ thuộc, tránh vấn đề tương
 * thích khi build tĩnh trên GitHub Pages.
 */

const DriveModule = (() => {
  const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

  /**
   * Liệt kê các file CSV/Excel trong folder đã cấu hình (DRIVE_FOLDER_ID,
   * mặc định trỏ tới folder "AI-Dashboard" trên Google Drive của người dùng).
   */
  async function listFilesInFolder() {
    const token = await AuthModule.ensureValidToken();

    const mimeQuery = [
      "mimeType='text/csv'",
      "mimeType='application/vnd.ms-excel'",
      "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
      "mimeType='application/vnd.google-apps.spreadsheet'",
    ].join(' or ');

    const q = encodeURIComponent(
      `'${APP_CONFIG.DRIVE_FOLDER_ID}' in parents and (${mimeQuery}) and trashed = false`
    );

    const url = `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Drive API list files thất bại (${res.status}): ${errBody}`);
    }

    const json = await res.json();
    return json.files || [];
  }

  /**
   * Tải nội dung raw của 1 file (dạng text). Dùng cho CSV.
   * Với Google Sheets (mimeType application/vnd.google-apps.spreadsheet) cần
   * dùng endpoint export sang CSV thay vì alt=media trực tiếp.
   */
  async function downloadFileContent(file) {
    const token = await AuthModule.ensureValidToken();
    let url;

    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      url = `${DRIVE_API_BASE}/files/${file.id}/export?mimeType=text/csv`;
    } else {
      url = `${DRIVE_API_BASE}/files/${file.id}?alt=media`;
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Drive API tải file "${file.name}" thất bại (${res.status}): ${errBody}`);
    }

    // File Excel nhị phân (.xlsx/.xls) cần đọc dạng arrayBuffer để SheetJS xử lý ở csvParser.js
    const isBinaryExcel =
      file.mimeType === 'application/vnd.ms-excel' ||
      file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (isBinaryExcel) {
      return { type: 'binary', data: await res.arrayBuffer() };
    }
    return { type: 'text', data: await res.text() };
  }

  return { listFilesInFolder, downloadFileContent };
})();

window.DriveModule = DriveModule;
