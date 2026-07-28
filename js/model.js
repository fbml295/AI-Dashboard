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
