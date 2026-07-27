/**
 * csvParser.js
 * -----------------------------------------------------------------------
 * Chuẩn hoá nội dung file (CSV text hoặc Excel binary) về cấu trúc:
 *   {
 *     timestamps: [ms1, ms2, ...],          // trục X dùng chung, đã sort tăng dần
 *     series: {
 *        pkwh: [v1, v2, ...],
 *        vibration: [v1, v2, ...],
 *        ...
 *     },
 *     rowCount: N
 *   }
 *
 * Việc parse chạy hoàn toàn client-side bằng PapaParse (CSV) hoặc
 * SheetJS/xlsx (Excel binary), không gửi dữ liệu ra ngoài.
 */

const CsvParserModule = (() => {
  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  /**
   * Ghép cột Ngày + Giờ thành timestamp (ms).
   * Hỗ trợ vài định dạng ngày phổ biến ở VN: dd/mm/yyyy, yyyy-mm-dd.
   */
  function parseTimestamp(ngay, gio) {
    if (ngay == null) return NaN;
    const ngayStr = String(ngay).trim();
    const gioStr = gio != null ? String(gio).trim() : '00:00:00';

    let isoDate = null;

    // yyyy-mm-dd hoặc yyyy/mm/dd
    let m = ngayStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      isoDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    } else {
      // dd/mm/yyyy hoặc dd-mm-yyyy
      m = ngayStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (m) {
        isoDate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
    }

    if (!isoDate) {
      // Fallback: để Date tự parse, có thể không chính xác 100% nhưng không chặn luồng
      const fallback = new Date(`${ngayStr} ${gioStr}`);
      return isNaN(fallback.getTime()) ? NaN : fallback.getTime();
    }

    // Chuẩn hoá giờ về HH:mm:ss
    let hh = gioStr;
    if (/^\d{1,2}$/.test(gioStr)) hh = `${gioStr.padStart(2, '0')}:00:00`;
    else if (/^\d{1,2}:\d{1,2}$/.test(gioStr)) hh = `${gioStr}:00`;

    const dt = new Date(`${isoDate}T${hh}`);
    return isNaN(dt.getTime()) ? NaN : dt.getTime();
  }

  function buildFromRows(rows) {
    // rows: mảng object, key đã lowercase (từ PapaParse header transform hoặc SheetJS)
    const numericKeys = TAG_DEFINITIONS.filter(t => t.type === 'numeric').map(t => t.key);
    const categoricalKeys = TAG_DEFINITIONS.filter(t => t.type === 'categorical').map(t => t.key);

    const combined = [];

    for (const row of rows) {
      const ts = parseTimestamp(row['ngay'], row['gio']);
      if (isNaN(ts)) continue; // bỏ qua dòng lỗi thời gian

      const entry = { ts, values: {} };
      for (const key of numericKeys) {
        const raw = row[key];
        const num = raw === '' || raw == null ? NaN : parseFloat(String(raw).replace(',', '.'));
        entry.values[key] = num;
      }
      for (const key of categoricalKeys) {
        entry.values[key] = row[key] != null ? String(row[key]).trim() : '';
      }
      combined.push(entry);
    }

    // Sắp xếp theo thời gian tăng dần (dữ liệu SCADA thường đã sort sẵn, nhưng đề phòng)
    combined.sort((a, b) => a.ts - b.ts);

    const timestamps = combined.map(e => e.ts);
    const series = {};
    for (const key of [...numericKeys, ...categoricalKeys]) {
      series[key] = combined.map(e => e.values[key]);
    }

    return { timestamps, series, rowCount: combined.length };
  }

  /**
   * file: object trả về từ DriveModule.downloadFileContent()
   *   { type: 'text', data: string }  -> CSV
   *   { type: 'binary', data: ArrayBuffer } -> Excel (.xlsx/.xls)
   */
  function parseFile(fileContent) {
    return new Promise((resolve, reject) => {
      try {
        if (fileContent.type === 'text') {
          Papa.parse(fileContent.data, {
            header: true,
            skipEmptyLines: true,
            transformHeader: normalizeHeader,
            complete: (result) => {
              if (result.errors && result.errors.length) {
                console.warn('PapaParse cảnh báo:', result.errors.slice(0, 5));
              }
              resolve(buildFromRows(result.data));
            },
            error: (err) => reject(err),
          });
        } else if (fileContent.type === 'binary') {
          const workbook = XLSX.read(fileContent.data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          // Chuẩn hoá key về lowercase giống PapaParse
          const normRows = rawRows.map((row) => {
            const out = {};
            for (const k of Object.keys(row)) {
              out[normalizeHeader(k)] = row[k];
            }
            return out;
          });
          resolve(buildFromRows(normRows));
        } else {
          reject(new Error('Định dạng file không được hỗ trợ.'));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  return { parseFile };
})();

window.CsvParserModule = CsvParserModule;
