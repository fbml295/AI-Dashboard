/**
 * firebaseData.js
 * -----------------------------------------------------------------------
 * Thay thế drive.js + csvParser.js: lắng nghe REALTIME node `scada_data`
 * trên Firebase Realtime Database (không polling, không cần nút refresh -
 * Firebase tự đẩy dữ liệu mới về ngay khi gateway PowerShell ghi lên).
 *
 * Toàn bộ logic parse Ngày/Giờ/số được giữ NGUYÊN VẸN từ csvParser.js cũ
 * (đã kiểm chứng hoạt động đúng với dữ liệu thật của bạn), chỉ khác nguồn
 * input là 1 object JS (từ Firebase) thay vì text CSV.
 *
 * LƯU Ý QUAN TRỌNG: key của mỗi bản ghi trên Firebase (vd "1753..._781")
 * là thời điểm GATEWAY GHI LÊN, KHÔNG PHẢI thời điểm cảm biến đo (cột
 * Ngay/Gio mới là thời gian thật) - nên luôn sắp xếp lại theo Ngay/Gio đã
 * parse, không dựa vào thứ tự key trả về từ Firebase.
 */

const FirebaseDataModule = (() => {
  let dbRef = null;
  let currentCallback = null;

  function normalizeKey(k) {
    return String(k || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, '');
  }

  function normalizeTimeString(gioStr) {
    if (!gioStr) return null;
    const s = gioStr.trim();

    const ampmMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/);
    if (ampmMatch) {
      let hh = parseInt(ampmMatch[1], 10);
      const mm = ampmMatch[2];
      const ss = ampmMatch[3] || '00';
      const meridiem = ampmMatch[4].toUpperCase();
      if (meridiem === 'AM') { if (hh === 12) hh = 0; }
      else { if (hh !== 12) hh += 12; }
      return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
    }

    if (/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(s)) {
      const [h, m, sec] = s.split(':');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')}`;
    }
    if (/^\d{1,2}:\d{1,2}$/.test(s)) {
      const [h, m] = s.split(':');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
    }
    if (/^\d{1,2}$/.test(s)) {
      return `${s.padStart(2, '0')}:00:00`;
    }
    return null;
  }

  function excelSerialToMs(serial) {
    return Math.round((serial - 25569) * 86400 * 1000);
  }

  function parseTimestamp(ngay, gio) {
    if (ngay == null || String(ngay).trim() === '') return NaN;
    const ngayStr = String(ngay).trim();
    const gioStr = gio != null ? String(gio).trim() : '';

    const ngayIsPureNumber = /^\d+(\.\d+)?$/.test(ngayStr);
    const gioIsPureNumber = gioStr !== '' && /^\d+(\.\d+)?$/.test(gioStr);

    if (ngayIsPureNumber) {
      const serial = parseFloat(ngayStr);
      const dayPart = Math.floor(serial);
      let dayFraction = serial - dayPart;

      if (gioIsPureNumber) {
        const gioNum = parseFloat(gioStr);
        dayFraction = gioNum <= 1 ? gioNum : gioNum / 24;
      } else if (gioStr) {
        const normalizedTime = normalizeTimeString(gioStr);
        if (normalizedTime) {
          const [hh, mm, ss] = normalizedTime.split(':').map(Number);
          dayFraction = (hh * 3600 + mm * 60 + ss) / 86400;
        }
      }

      return excelSerialToMs(dayPart) + Math.round(dayFraction * 86400 * 1000);
    }

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

    const normalizedTime = normalizeTimeString(gioStr) || '00:00:00';

    if (!isoDate) {
      const fallback = new Date(`${ngayStr} ${normalizedTime}`);
      return isNaN(fallback.getTime()) ? NaN : fallback.getTime();
    }

    const dt = new Date(`${isoDate}T${normalizedTime}`);
    return isNaN(dt.getTime()) ? NaN : dt.getTime();
  }

  /**
   * snapshotVal: object trả về từ snapshot.val() của Firebase, dạng
   * { "<key1>": { Ngay: "...", Gio: "...", Pkwh: "...", ... }, "<key2>": {...} }
   */
  function buildDatasetFromSnapshot(snapshotVal) {
    if (!snapshotVal) return { timestamps: [], series: {}, rowCount: 0 };

    const numericKeys = TAG_DEFINITIONS.filter(t => t.type === 'numeric').map(t => t.key);
    const categoricalKeys = TAG_DEFINITIONS.filter(t => t.type === 'categorical').map(t => t.key);

    const combined = [];

    Object.values(snapshotVal).forEach((rec) => {
      if (!rec || typeof rec !== 'object') return;

      // Chuẩn hoá tên field của bản ghi này về lowercase không dấu (Ngay -> ngay, Pkwh -> pkwh...)
      const norm = {};
      Object.keys(rec).forEach((k) => { norm[normalizeKey(k)] = rec[k]; });

      const ts = parseTimestamp(norm['ngay'], norm['gio']);
      if (isNaN(ts)) return;

      const entry = { ts, values: {} };
      numericKeys.forEach((key) => {
        const raw = norm[key];
        entry.values[key] = (raw === '' || raw == null) ? NaN : parseFloat(String(raw).replace(',', '.'));
      });
      categoricalKeys.forEach((key) => {
        entry.values[key] = norm[key] != null ? String(norm[key]).trim() : '';
      });
      combined.push(entry);
    });

    // QUAN TRỌNG: sắp xếp theo thời gian cảm biến thực (Ngay/Gio đã parse),
    // KHÔNG theo thứ tự key Firebase trả về (key = thời điểm gateway ghi lên).
    combined.sort((a, b) => a.ts - b.ts);

    const timestamps = combined.map(e => e.ts);
    const series = {};
    [...numericKeys, ...categoricalKeys].forEach((key) => {
      series[key] = combined.map(e => e.values[key]);
    });

    return { timestamps, series, rowCount: combined.length };
  }

  /**
   * Bắt đầu lắng nghe realtime node scada_data.
   * onUpdate({ dataset, error }) được gọi:
   *  - Ngay lập tức 1 lần với dữ liệu hiện có (nếu có)
   *  - Mỗi khi có bản ghi mới được gateway ghi thêm lên Firebase
   *  - Với error != null nếu bị từ chối quyền đọc (permission-denied) hoặc lỗi mạng
   */
  function listen(onUpdate) {
    stop();
    dbRef = firebase.database().ref(APP_CONFIG.FIREBASE_DATA_PATH);

    currentCallback = dbRef.on(
      'value',
      (snapshot) => {
        try {
          const dataset = buildDatasetFromSnapshot(snapshot.val());
          onUpdate({ dataset, error: null });
        } catch (e) {
          console.error('Lỗi xử lý dữ liệu Firebase:', e);
          onUpdate({ dataset: null, error: e });
        }
      },
      (error) => {
        console.error('Lỗi đọc Firebase Realtime Database:', error);
        onUpdate({ dataset: null, error });
      }
    );
  }

  function stop() {
    if (dbRef && currentCallback) {
      dbRef.off('value', currentCallback);
    }
    dbRef = null;
    currentCallback = null;
  }

  return { listen, stop, buildDatasetFromSnapshot, parseTimestamp };
})();

window.FirebaseDataModule = FirebaseDataModule;
