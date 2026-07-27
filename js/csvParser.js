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
    return String(h || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')                    // tách chữ cái khỏi dấu (ví dụ: à -> a + dấu huyền)
      .replace(/[\u0300-\u036f]/g, '')       // xoá các dấu (combining diacritical marks)
      .replace(/đ/g, 'd')                    // 'đ' không tách được bằng NFD nên xử lý riêng
      .replace(/\s+/g, '');
  }

  /**
   * Chuyển đổi Excel serial date (số ngày tính từ 1899-12-30) sang mốc thời
   * gian mili giây. Excel hay lưu ngày/giờ dưới dạng số này khi cột không
   * được định dạng tường minh là Date/Time lúc xuất ra CSV.
   * VD: 45678 -> một ngày cụ thể; 0.5 -> 12:00 trưa (nửa ngày).
   */
  function excelSerialToMs(serial) {
    return Math.round((serial - 25569) * 86400 * 1000);
  }

  /**
   * Ghép cột Ngày + Giờ thành timestamp (ms).
   * Hỗ trợ:
   *  - Chuỗi ngày: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, yyyy/mm/dd
   *  - Chuỗi giờ: HH:mm:ss, HH:mm, hoặc chỉ số giờ nguyên (vd "14")
   *  - Số serial kiểu Excel (khi cột Ngày/Giờ bị xuất ra dạng số thuần,
   *    thường gặp khi copy dữ liệu Excel không định dạng Date/Time sang CSV)
   */
  function parseTimestamp(ngay, gio) {
    if (ngay == null || String(ngay).trim() === '') return NaN;
    const ngayStr = String(ngay).trim();
    const gioStr = gio != null ? String(gio).trim() : '';

    const ngayIsPureNumber = /^\d+(\.\d+)?$/.test(ngayStr);
    const gioIsPureNumber = gioStr !== '' && /^\d+(\.\d+)?$/.test(gioStr);

    // --- Trường hợp Excel serial number (Ngay là số nguyên/thập phân thuần) ---
    if (ngayIsPureNumber) {
      const serial = parseFloat(ngayStr);
      const dayPart = Math.floor(serial);
      let dayFraction = serial - dayPart; // nếu Ngay tự chứa cả giờ (vd 45678.5)

      if (gioIsPureNumber) {
        const gioNum = parseFloat(gioStr);
        // Nếu Gio <= 1 -> coi là phân số của ngày (kiểu Excel time serial: 0.5 = 12:00)
        // Nếu Gio > 1 -> coi là số giờ (vd "14" = 14:00, "14.5" = 14:30)
        dayFraction = gioNum <= 1 ? gioNum : gioNum / 24;
      } else if (gioStr) {
        const timeMatch = gioStr.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
        if (timeMatch) {
          const hh = parseInt(timeMatch[1], 10);
          const mm = parseInt(timeMatch[2], 10);
          const ss = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
          dayFraction = (hh * 3600 + mm * 60 + ss) / 86400;
        }
      }

      return excelSerialToMs(dayPart) + Math.round(dayFraction * 86400 * 1000);
    }

    // --- Trường hợp chuỗi ngày dạng text ---
    let isoDate = null;
    let m = ngayStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      isoDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    } else {
      m = ngayStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (m) {
        isoDate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
    }

    const finalGioStr = gioStr || '00:00:00';

    if (!isoDate) {
      // Fallback: để Date tự parse, có thể không chính xác 100% nhưng không chặn luồng
      const fallback = new Date(`${ngayStr} ${finalGioStr}`);
      return isNaN(fallback.getTime()) ? NaN : fallback.getTime();
    }

    // Chuẩn hoá giờ về HH:mm:ss
    let hh = finalGioStr;
    if (/^\d{1,2}$/.test(finalGioStr)) hh = `${finalGioStr.padStart(2, '0')}:00:00`;
    else if (/^\d{1,2}:\d{1,2}$/.test(finalGioStr)) hh = `${finalGioStr}:00`;

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

    if (combined.length === 0 && rows.length > 0) {
      const detectedHeaders = Object.keys(rows[0] || {});
      console.error(
        'Không có dòng nào parse được timestamp hợp lệ.\n' +
        'Header phát hiện được (đã chuẩn hoá) trong file:', detectedHeaders, '\n' +
        'Cần có ít nhất 2 cột chuẩn hoá thành "ngay" và "gio".\n' +
        'Ví dụ dòng dữ liệu đầu tiên (raw):', rows[0]
      );
    }

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
