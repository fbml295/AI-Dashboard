/**
 * model.js
 * -----------------------------------------------------------------------
 * "Học" mối quan hệ giữa các tag quá trình (input) và Phân loại/Chất lượng
 * (output) bằng hồi quy tuyến tính có chuẩn hoá (Ridge Regression) — chạy
 * HOÀN TOÀN CLIENT-SIDE, không gửi dữ liệu ra ngoài, không tốn phí API.
 *
 * Vì sao dùng Ridge thay vì Linear Regression thường:
 *  - Nhiều tag quá trình có tương quan cao với nhau (vd acacia+pine+mixwood
 *    thường cộng lại ~100%), gây ma trận gần suy biến (singular) nếu dùng
 *    OLS thường -> hệ số có thể "nổ" (rất lớn, vô nghĩa). Ridge thêm số hạng
 *    điều chuẩn (λ) giúp ổn định số học và hệ số dễ diễn giải hơn.
 *
 * Mô hình là TUYẾN TÍNH nên có thể GIẢI NGƯỢC (closed-form): cho trước mục
 * tiêu chất lượng, tính ra chính xác khe hở đĩa (plategap) cần thiết mà
 * không cần dò thử (trial-and-error).
 */

const ModelModule = (() => {
  const MIN_ROWS = 30; // số dòng tối thiểu để huấn luyện có ý nghĩa thống kê
  const RIDGE_LAMBDA = 1.0; // hệ số điều chuẩn (áp dụng trên dữ liệu đã chuẩn hoá z-score)

  /**
   * Giải hệ phương trình tuyến tính A·x = b bằng khử Gauss-Jordan có chọn
   * điểm trục (partial pivoting). A là ma trận vuông n x n.
   */
  function solveLinearSystem(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];

      if (Math.abs(M[col][col]) < 1e-10) M[col][col] = 1e-10; // tránh chia 0 (hiếm khi xảy ra nhờ ridge)

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /**
   * Huấn luyện 1 mô hình Ridge Regression cho 1 target (class1 hoặc quality)
   * dựa trên toàn bộ dòng có đầy đủ giá trị hợp lệ (cả feature lẫn target).
   */
  function trainModel(dataset, featureKeys, targetKey) {
    const { series } = dataset;
    const targetValues = series[targetKey];
    if (!targetValues) return { ok: false, reason: `Không tìm thấy cột "${targetKey}".`, n: 0 };

    // Gom các dòng có đủ dữ liệu (feature + target đều là số hữu hạn)
    const rows = [];
    const n = targetValues.length;
    for (let i = 0; i < n; i++) {
      const y = targetValues[i];
      if (!Number.isFinite(y)) continue;
      const x = featureKeys.map(k => (series[k] ? series[k][i] : NaN));
      if (x.some(v => !Number.isFinite(v))) continue;
      rows.push({ x, y });
    }

    if (rows.length < MIN_ROWS) {
      return { ok: false, reason: `Chưa đủ dữ liệu (${rows.length}/${MIN_ROWS} dòng hợp lệ tối thiểu).`, n: rows.length };
    }

    const p = featureKeys.length;
    const nRows = rows.length;

    // Chuẩn hoá z-score từng feature (để hệ số có thể so sánh được & ổn định số học)
    const means = new Array(p).fill(0);
    const stds = new Array(p).fill(1);
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let i = 0; i < nRows; i++) sum += rows[i].x[j];
      means[j] = sum / nRows;
    }
    for (let j = 0; j < p; j++) {
      let sumSq = 0;
      for (let i = 0; i < nRows; i++) sumSq += (rows[i].x[j] - means[j]) ** 2;
      const std = Math.sqrt(sumSq / nRows);
      stds[j] = std > 1e-9 ? std : 1; // feature gần như hằng số -> giữ std=1, hệ số sẽ tự động ~0
    }

    const yMean = rows.reduce((a, r) => a + r.y, 0) / nRows;

    const Xstd = rows.map(r => r.x.map((v, j) => (v - means[j]) / stds[j]));
    const yCentered = rows.map(r => r.y - yMean);

    // Ma trận chuẩn: (X^T X + λI) β = X^T y
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let i = 0; i < nRows; i++) {
      const xi = Xstd[i];
      const yi = yCentered[i];
      for (let a = 0; a < p; a++) {
        Xty[a] += xi[a] * yi;
        for (let b = 0; b < p; b++) XtX[a][b] += xi[a] * xi[b];
      }
    }
    for (let a = 0; a < p; a++) XtX[a][a] += RIDGE_LAMBDA;

    const beta = solveLinearSystem(XtX, Xty);
    const intercept = yMean;

    // R² trên chính tập huấn luyện (in-sample) — chỉ mang tính tham khảo độ khớp,
    // không phải đánh giá ngoài mẫu, nhưng đủ để cảnh báo mô hình yếu/mạnh.
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < nRows; i++) {
      const yhat = intercept + Xstd[i].reduce((acc, v, j) => acc + v * beta[j], 0);
      ssRes += (rows[i].y - yhat) ** 2;
      ssTot += (rows[i].y - yMean) ** 2;
    }
    const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : 0;

    return { ok: true, featureKeys, means, stds, beta, intercept, r2, n: nRows };
  }

  /**
   * Dự đoán target từ 1 vector feature thô (object key -> value).
   * Nếu thiếu key nào, dùng giá trị trung bình lịch sử của feature đó thay thế.
   */
  function predict(model, rawFeatureObj) {
    if (!model || !model.ok) return NaN;
    let z = model.intercept;
    model.featureKeys.forEach((k, i) => {
      const std = model.stds[i] || 1;
      const mean = model.means[i];
      const raw = rawFeatureObj[k];
      const val = Number.isFinite(raw) ? raw : mean;
      z += model.beta[i] * ((val - mean) / std);
    });
    return z;
  }

  /**
   * Giải ngược: cho trước target mong muốn (vd chất lượng = 5), giữ nguyên
   * mọi feature khác ở baseFeatureObj, tính ra giá trị cần thiết của
   * `solveKey` (vd plategap) để đạt target đó. Trả về null nếu hệ số của
   * feature đó ~ 0 (mô hình cho thấy feature này gần như không ảnh hưởng).
   */
  function solveForFeature(model, baseFeatureObj, solveKey, desiredTarget) {
    if (!model || !model.ok) return null;
    const idx = model.featureKeys.indexOf(solveKey);
    if (idx < 0) return null;

    const betaSolve = model.beta[idx];
    if (Math.abs(betaSolve) < 1e-6) return null;

    let sumOthers = model.intercept;
    model.featureKeys.forEach((k, i) => {
      if (i === idx) return;
      const std = model.stds[i] || 1;
      const mean = model.means[i];
      const raw = baseFeatureObj[k];
      const val = Number.isFinite(raw) ? raw : mean;
      sumOthers += model.beta[i] * ((val - mean) / std);
    });

    const stdzSolve = (desiredTarget - sumOthers) / betaSolve;
    return stdzSolve * (model.stds[idx] || 1) + model.means[idx];
  }

  return { trainModel, predict, solveForFeature, MIN_ROWS };
})();

window.ModelModule = ModelModule;

/**
 * =========================================================================
 * PRODUCT MODEL MODULE - học theo khoảng thời gian, đóng gói thành file,
 * gộp thống kê để "học thêm" mà KHÔNG cần giữ lại dữ liệu thô cũ.
 * -------------------------------------------------------------------------
 * Nguyên lý: hồi quy tuyến tính (kể cả Ridge) chỉ cần vài con số CỘNG DỒN
 * (n, Σx, Σx·x', Σy, Σy², Σx·y) là ĐỦ để tính ra chính xác cùng 1 kết quả
 * như khi có toàn bộ dữ liệu thô - đã kiểm chứng bằng số học. Nhờ vậy:
 *   - File lưu ra rất nhẹ (vài KB, không phụ thuộc số dòng đã học)
 *   - Gộp thống kê của lần học mới vào file cũ = học thêm CHÍNH XÁC TUYỆT ĐỐI,
 *     không phải xấp xỉ, không cần tải lại dữ liệu thô đã dùng trước đó.
 * =========================================================================
 */
const ProductModelModule = (() => {
  const RIDGE_LAMBDA = 1.0;

  /**
   * Giải hệ phương trình tuyến tính (giống hệt logic trong ModelModule,
   * tách riêng để 2 module độc lập, không phụ thuộc hàm nội bộ của nhau).
   */
  function solveLinearSystem(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      if (Math.abs(M[col][col]) < 1e-10) M[col][col] = 1e-10;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  function emptyTargetStats(p) {
    return {
      n: 0,
      sumX: new Array(p).fill(0),
      sumX2: Array.from({ length: p }, () => new Array(p).fill(0)),
      sumY: 0,
      sumY2: 0,
      sumXY: new Array(p).fill(0),
    };
  }

  /**
   * Tính thống kê cộng dồn từ các dòng trong dataset nằm trong khoảng
   * [fromMs, toMs], cho cả 2 target (class1, quality) cùng lúc.
   */
  function computeStatsFromRange(dataset, featureKeys, fromMs, toMs) {
    const { timestamps, series } = dataset;
    const p = featureKeys.length;
    const targets = { class1: emptyTargetStats(p), quality: emptyTargetStats(p) };
    let rowsInRange = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (ts < fromMs || ts > toMs) continue;

      const x = featureKeys.map(k => (series[k] ? series[k][i] : NaN));
      if (x.some(v => !Number.isFinite(v))) continue;
      rowsInRange++;

      ['class1', 'quality'].forEach((targetKey) => {
        const y = series[targetKey] ? series[targetKey][i] : NaN;
        if (!Number.isFinite(y)) return;
        const s = targets[targetKey];
        s.n++;
        s.sumY += y;
        s.sumY2 += y * y;
        for (let j = 0; j < p; j++) {
          s.sumX[j] += x[j];
          s.sumXY[j] += x[j] * y;
          for (let k = 0; k < p; k++) s.sumX2[j][k] += x[j] * x[k];
        }
      });
    }

    return { featureKeys, targets, rowsInRange };
  }

  /**
   * Gộp 2 bộ thống kê cùng featureKeys - CHÍNH XÁC TUYỆT ĐỐI (không xấp xỉ),
   * tương đương với việc có toàn bộ dữ liệu thô của cả 2 lần rồi học lại từ đầu.
   */
  function mergeStats(statsA, statsB) {
    if (statsA.featureKeys.length !== statsB.featureKeys.length ||
        statsA.featureKeys.some((k, i) => k !== statsB.featureKeys[i])) {
      throw new Error('Không thể gộp: bộ tag (featureKeys) của 2 mô hình không khớp nhau.');
    }
    const p = statsA.featureKeys.length;
    const targets = {};
    ['class1', 'quality'].forEach((targetKey) => {
      const a = statsA.targets[targetKey], b = statsB.targets[targetKey];
      targets[targetKey] = {
        n: a.n + b.n,
        sumX: a.sumX.map((v, i) => v + b.sumX[i]),
        sumX2: a.sumX2.map((row, i) => row.map((v, j) => v + b.sumX2[i][j])),
        sumY: a.sumY + b.sumY,
        sumY2: a.sumY2 + b.sumY2,
        sumXY: a.sumXY.map((v, i) => v + b.sumXY[i]),
      };
    });
    return { featureKeys: statsA.featureKeys, targets };
  }

  /**
   * Tái tạo mô hình Ridge Regression đầy đủ (means, stds, beta, intercept, R²)
   * từ bộ thống kê cộng dồn - dùng công thức đại số, không cần dữ liệu thô.
   */
  function deriveModel(targetStats, featureKeys) {
    const { n, sumX, sumX2, sumY, sumY2, sumXY } = targetStats;
    if (n < ModelModule.MIN_ROWS) {
      return { ok: false, reason: `Chưa đủ dữ liệu (${n}/${ModelModule.MIN_ROWS} dòng hợp lệ tối thiểu).`, n };
    }
    const p = featureKeys.length;
    const means = sumX.map(s => s / n);
    const stds = [];
    for (let j = 0; j < p; j++) {
      const varJ = sumX2[j][j] / n - means[j] * means[j];
      stds.push(Math.sqrt(Math.max(varJ, 1e-12)) || 1);
    }
    const meanY = sumY / n;

    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
      Xty[j] = ((sumXY[j] / n - means[j] * meanY) * n) / stds[j];
      for (let k = 0; k < p; k++) {
        const cov = sumX2[j][k] / n - means[j] * means[k];
        XtX[j][k] = (cov * n) / (stds[j] * stds[k]);
      }
    }
    const XtXRidge = XtX.map((row, j) => row.map((v, k) => (j === k ? v + RIDGE_LAMBDA : v)));
    const beta = solveLinearSystem(XtXRidge, Xty);

    const SStot = sumY2 - n * meanY * meanY;
    let betaXty = 0;
    for (let j = 0; j < p; j++) betaXty += beta[j] * Xty[j];
    let betaXtXbeta = 0;
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) betaXtXbeta += beta[j] * XtX[j][k] * beta[k];
    const SSres = SStot - 2 * betaXty + betaXtXbeta;
    const r2 = SStot > 1e-9 ? 1 - SSres / SStot : 0;

    return { ok: true, featureKeys, means, stds, beta, intercept: meanY, r2, n };
  }

  return { computeStatsFromRange, mergeStats, deriveModel };
})();

window.ProductModelModule = ProductModelModule;
