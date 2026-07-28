/**
 * app.js
 * -----------------------------------------------------------------------
 * Điểm khởi động ứng dụng: nối các module (firebaseAuth, firebaseData,
 * chart, model, gemini, settings, status) với DOM. Không chứa logic
 * nghiệp vụ phức tạp - chỉ điều phối (orchestration).
 */

let state = {
  dataset: null,        // { timestamps, series, rowCount } - cập nhật realtime từ Firebase
  selectedKeys: [],      // các tag numeric đang bật trên chart
  normalize: false,
  models: null,          // { class1: {...}, quality: {...} } - mô hình hồi quy đã huấn luyện
};

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function setLoading(isLoading, message) {
  const overlay = document.getElementById('loadingOverlay');
  const msgEl = document.getElementById('loadingMessage');
  if (message) msgEl.textContent = message;
  overlay.classList.toggle('is-visible', isLoading);
}

/* --------------------------- TAG PANEL --------------------------- */

function buildTagPanel() {
  const container = document.getElementById('tagListContainer');
  container.innerHTML = '';

  TAG_GROUP_ORDER.forEach((groupName) => {
    const tagsInGroup = TAG_DEFINITIONS.filter(t => t.group === groupName);
    if (!tagsInGroup.length) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'tag-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'tag-group__title';
    groupTitle.textContent = groupName;
    groupEl.appendChild(groupTitle);

    tagsInGroup.forEach((tag) => {
      const row = document.createElement('label');
      row.className = 'tag-row';
      row.innerHTML = `
        <input type="checkbox" class="tag-checkbox" data-key="${tag.key}" ${tag.type === 'categorical' ? 'disabled' : ''} />
        <span class="tag-swatch" style="background:${tag.color || '#666'}"></span>
        <span class="tag-name">${tag.label}</span>
        <span class="tag-unit">${tag.unit || ''}</span>
      `;
      groupEl.appendChild(row);
    });

    container.appendChild(groupEl);
  });

  container.addEventListener('change', (e) => {
    if (!e.target.classList.contains('tag-checkbox')) return;
    const key = e.target.dataset.key;
    if (e.target.checked) {
      if (!state.selectedKeys.includes(key)) state.selectedKeys.push(key);
    } else {
      state.selectedKeys = state.selectedKeys.filter(k => k !== key);
    }
    rerenderChart();
  });
}

function setTagPanelEnabled(enabled) {
  document.querySelectorAll('.tag-checkbox').forEach((cb) => {
    const def = TAG_DEFINITIONS.find(t => t.key === cb.dataset.key);
    cb.disabled = !enabled || (def && def.type === 'categorical');
  });
}

function rerenderChart() {
  if (!state.dataset) return;
  ChartModule.render(state.selectedKeys, state.dataset, { normalize: state.normalize });
}

/**
 * Toàn bộ tag quá trình phục vụ AI phân tích — LOẠI TRỪ "Phân loại" (class1)
 * và "Chỉ số chất lượng" (quality), vì 2 tag này là mục tiêu/tham chiếu,
 * không phải căn cứ kỹ thuật để suy luận đóng/nhả đĩa.
 */
function getProcessTagKeys() {
  return TAG_DEFINITIONS
    .filter(t => t.type === 'numeric' && t.group !== 'Chất lượng')
    .map(t => t.key);
}

function updateAnalyzeButtonState() {
  document.getElementById('btnAnalyzeAI').disabled = !state.dataset;
}

/* --------------------------- MÔ HÌNH DỰ ĐOÁN (Ridge Regression, tự học) --------------------------- */

/**
 * Huấn luyện lại 2 mô hình (Phân loại, Chất lượng) từ TOÀN BỘ dữ liệu hiện có
 * trong state.dataset. Được gọi lại MỖI KHI Firebase đẩy dữ liệu mới về, nên
 * mô hình luôn "học" theo dữ liệu mới nhất - đúng yêu cầu tự học liên tục.
 */
function trainModelsForDataset() {
  const btn = document.getElementById('btnOpenPrediction');
  if (!state.dataset) {
    state.models = null;
    btn.disabled = true;
    return;
  }
  const featureKeys = getProcessTagKeys();
  const class1Model = ModelModule.trainModel(state.dataset, featureKeys, 'class1');
  const qualityModel = ModelModule.trainModel(state.dataset, featureKeys, 'quality');
  state.models = { class1: class1Model, quality: qualityModel };
  btn.disabled = !(class1Model.ok && qualityModel.ok);

  // Nếu panel đang mở, làm mới ngay theo mô hình vừa huấn luyện lại
  if (document.getElementById('predictionPanel').classList.contains('is-open')) {
    renderPredictionPanel();
  }
}

function getLatestFeatureVector() {
  if (!state.dataset) return null;
  const { series, timestamps } = state.dataset;
  const idx = timestamps.length - 1;
  const vec = {};
  getProcessTagKeys().forEach(k => { vec[k] = series[k] ? series[k][idx] : NaN; });
  return vec;
}

function getFeatureRange(key) {
  const values = (state.dataset.series[key] || []).filter(Number.isFinite);
  if (!values.length) return { min: NaN, max: NaN };
  return { min: Math.min(...values), max: Math.max(...values) };
}

function fmtVal(x, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}
function fmtDelta(x, digits = 2) {
  if (!Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
}
function r2Class(r2) {
  if (r2 >= 0.6) return 'good';
  if (r2 >= 0.3) return 'warn';
  return 'bad';
}
function r2Label(r2) {
  if (r2 >= 0.6) return 'TỐT';
  if (r2 >= 0.3) return 'TRUNG BÌNH';
  return 'THẤP';
}

/**
 * Tính & hiển thị khuyến nghị đóng/nhả đĩa dựa trên mục tiêu Chất lượng.
 * Được gọi tự động khi mở panel (mục tiêu mặc định = 5) và mỗi khi bấm "Tính lại".
 */
function computeAndRenderRecommendation(latest) {
  const recEl = document.getElementById('recommendationResult');
  const targetInput = document.getElementById('targetQualityInput');
  const targetQuality = parseFloat(targetInput.value);

  if (!Number.isFinite(targetQuality)) {
    recEl.innerHTML = '<div class="pred-warning">Mục tiêu không hợp lệ.</div>';
    return;
  }

  const currentGap = latest['plategap'];
  const recommendedGap = ModelModule.solveForFeature(state.models.quality, latest, 'plategap', targetQuality);

  if (recommendedGap == null || !Number.isFinite(recommendedGap)) {
    recEl.innerHTML = `<div class="pred-warning">Không thể tính khuyến nghị — mô hình cho thấy "plategap" gần như không ảnh hưởng tới Chất lượng theo dữ liệu hiện có.</div>`;
    return;
  }

  const delta = recommendedGap - currentGap;
  let actionClass = 'pred-action--hold', actionText = 'GIỮ NGUYÊN';
  if (Math.abs(delta) >= 0.02) {
    if (delta < 0) { actionClass = 'pred-action--close'; actionText = 'ĐÓNG ĐĨA (giảm khe hở)'; }
    else { actionClass = 'pred-action--open'; actionText = 'NHẢ ĐĨA (tăng khe hở)'; }
  }

  const predClass1AtRec = ModelModule.predict(state.models.class1, { ...latest, plategap: recommendedGap });
  const range = getFeatureRange('plategap');
  const outOfRange = recommendedGap < range.min || recommendedGap > range.max;

  recEl.innerHTML = `
    <div class="pred-action ${actionClass}">➜ ${actionText}</div>
    <div class="pred-delta">Khe hở hiện tại: <b>${fmtVal(currentGap)} mm</b> → Đề xuất: <b>${fmtVal(recommendedGap)} mm</b> (${fmtDelta(delta)} mm)</div>
    <div class="pred-delta">Phân loại dự đoán tại mức đề xuất: <b>${fmtVal(predClass1AtRec)}%</b></div>
    ${outOfRange ? '<div class="pred-warning">⚠ Giá trị đề xuất nằm ngoài phạm vi khe hở đã ghi nhận trong lịch sử — cần thận trọng, đối chiếu giới hạn cơ khí thiết bị trước khi áp dụng.</div>' : ''}
    <div class="pred-hint">*Khuyến nghị dựa trên mô hình hồi quy tuyến tính tự học từ dữ liệu lịch sử, giữ nguyên các thông số khác ở giá trị mới nhất.</div>
  `;
}

/**
 * Dựng toàn bộ nội dung panel Dự đoán & Mô phỏng.
 */
function renderPredictionPanel() {
  const body = document.getElementById('predictionPanelBody');

  if (!state.dataset || !state.models || !state.models.class1.ok || !state.models.quality.ok) {
    const reason = state.models
      ? (!state.models.quality.ok ? state.models.quality.reason : state.models.class1.reason)
      : 'Chưa có dữ liệu.';
    body.innerHTML = `<div class="empty-hint">Chưa thể huấn luyện mô hình dự đoán: ${reason}</div>`;
    return;
  }

  const latest = getLatestFeatureVector();
  const predClass1 = ModelModule.predict(state.models.class1, latest);
  const predQuality = ModelModule.predict(state.models.quality, latest);
  const lastIdx = state.dataset.timestamps.length - 1;
  const actualClass1 = state.dataset.series.class1[lastIdx];
  const actualQuality = state.dataset.series.quality[lastIdx];

  const processKeys = getProcessTagKeys();
  const simRows = processKeys.map((k) => {
    const def = TAG_DEFINITIONS.find(t => t.key === k);
    const current = latest[k];
    return `
      <div class="pred-sim-row">
        <input type="checkbox" class="sim-check" data-key="${k}" id="simCheck_${k}" />
        <span class="pred-sim-row__name">${def.label}</span>
        <span class="pred-sim-row__unit">${def.unit || ''}</span>
        <input type="number" step="any" class="sim-value" data-key="${k}" id="simValue_${k}"
               value="${Number.isFinite(current) ? current.toFixed(2) : ''}" disabled />
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="pred-section">
      <div class="pred-section__title">1. Dự đoán tại thông số hiện tại</div>
      <div class="pred-reliability">
        Độ tin cậy mô hình (R²) — Phân loại:
        <span class="pred-r2--${r2Class(state.models.class1.r2)}">${(state.models.class1.r2 * 100).toFixed(0)}% (${r2Label(state.models.class1.r2)})</span>,
        Chất lượng:
        <span class="pred-r2--${r2Class(state.models.quality.r2)}">${(state.models.quality.r2 * 100).toFixed(0)}% (${r2Label(state.models.quality.r2)})</span>
        <span class="pred-reliability__n">— học từ ${state.models.quality.n.toLocaleString('vi-VN')} bản ghi</span>
      </div>
      <table class="pred-table">
        <tr><th></th><th>Thực tế (mới nhất)</th><th>Mô hình dự đoán</th></tr>
        <tr><td>Phân loại</td><td>${fmtVal(actualClass1)}%</td><td>${fmtVal(predClass1)}%</td></tr>
        <tr><td>Chất lượng</td><td>${fmtVal(actualQuality)}/10</td><td>${fmtVal(predQuality)}/10</td></tr>
      </table>
    </div>

    <div class="pred-section">
      <div class="pred-section__title">2. Mô phỏng thay đổi (chọn nhiều thông số)</div>
      <div class="pred-hint">Tick chọn 1 hoặc nhiều tag, sửa giá trị giả định, các tag không chọn giữ nguyên giá trị mới nhất.</div>
      <div class="pred-sim-list">${simRows}</div>
      <button class="btn btn--primary" id="btnRunSimulation" style="width:100%;">Mô phỏng</button>
      <div id="simResult" class="pred-result"></div>
    </div>

    <div class="pred-section">
      <div class="pred-section__title">3. Khuyến nghị đóng/nhả đĩa theo mục tiêu chất lượng</div>
      <div class="pred-row">
        <label class="pred-label">Mục tiêu Chất lượng (0-10):</label>
        <input type="number" id="targetQualityInput" class="pred-input" min="0" max="10" step="0.1" value="5" />
        <button class="btn btn--ghost" id="btnRunRecommendation">Tính lại</button>
      </div>
      <div id="recommendationResult" class="pred-result"></div>
    </div>
  `;

  // --- Wiring: checkbox bật/tắt input tương ứng ---
  body.querySelectorAll('.sim-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const valueInput = document.getElementById(`simValue_${cb.dataset.key}`);
      valueInput.disabled = !cb.checked;
    });
  });

  // --- Wiring: nút Mô phỏng (đa tag) ---
  document.getElementById('btnRunSimulation').addEventListener('click', () => {
    const overrides = {};
    let anySelected = false;
    body.querySelectorAll('.sim-check:checked').forEach((cb) => {
      const key = cb.dataset.key;
      const val = parseFloat(document.getElementById(`simValue_${key}`).value);
      if (Number.isFinite(val)) { overrides[key] = val; anySelected = true; }
    });

    const resultEl = document.getElementById('simResult');
    if (!anySelected) {
      resultEl.innerHTML = '<div class="pred-warning">Chưa chọn tag nào để mô phỏng.</div>';
      return;
    }

    const scenario = { ...latest, ...overrides };
    const newClass1 = ModelModule.predict(state.models.class1, scenario);
    const newQuality = ModelModule.predict(state.models.quality, scenario);

    const outOfRangeWarnings = Object.keys(overrides).map((key) => {
      const range = getFeatureRange(key);
      const val = overrides[key];
      if (val < range.min || val > range.max) {
        const def = TAG_DEFINITIONS.find(t => t.key === key);
        return `"${def.label}" (${val}) nằm ngoài phạm vi lịch sử [${fmtVal(range.min)} – ${fmtVal(range.max)}]`;
      }
      return null;
    }).filter(Boolean);

    resultEl.innerHTML = `
      <div class="pred-delta">Phân loại dự đoán: <b>${fmtVal(newClass1)}%</b> (hiện tại: ${fmtVal(predClass1)}%, Δ ${fmtDelta(newClass1 - predClass1)})</div>
      <div class="pred-delta">Chất lượng dự đoán: <b>${fmtVal(newQuality)}/10</b> (hiện tại: ${fmtVal(predQuality)}/10, Δ ${fmtDelta(newQuality - predQuality)})</div>
      ${outOfRangeWarnings.length ? `<div class="pred-warning">⚠ ${outOfRangeWarnings.join('; ')} — độ tin cậy dự đoán giảm khi ngoại suy ngoài dữ liệu lịch sử.</div>` : ''}
    `;
  });

  // --- Wiring: nút Tính lại khuyến nghị ---
  document.getElementById('btnRunRecommendation').addEventListener('click', () => computeAndRenderRecommendation(latest));

  // --- Tự động tính khuyến nghị ngay khi mở panel (mục tiêu mặc định = 5) ---
  computeAndRenderRecommendation(latest);
}

/* --------------------------- KPI CARDS (Class1 / Quality) --------------------------- */

/**
 * Tìm index có timestamp gần nhất với `target` trong mảng đã sắp xếp tăng dần.
 * Dùng binary search vì mảng timestamps có thể lên tới hàng trăm nghìn phần tử.
 */
function findNearestIndex(sortedTimestamps, target) {
  const n = sortedTimestamps.length;
  if (n === 0) return -1;
  if (target <= sortedTimestamps[0]) return 0;
  if (target >= sortedTimestamps[n - 1]) return n - 1;

  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimestamps[mid] === target) return mid;
    if (sortedTimestamps[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const before = lo - 1;
  if (before < 0) return lo;
  return (target - sortedTimestamps[before] <= sortedTimestamps[lo] - target) ? before : lo;
}

function getQualityBand(value) {
  const { low, high } = APP_CONFIG.QUALITY_BANDS;
  if (value < low) return { label: 'QUÁ THÔ', cssClass: 'bad' };
  if (value > high) return { label: 'QUÁ MỊN', cssClass: 'warn' };
  return { label: 'ĐẠT', cssClass: 'good' };
}

/**
 * Cập nhật 2 ô KPI "Phân loại" và "Chất lượng".
 * ts = null  -> hiển thị giá trị dòng dữ liệu MỚI NHẤT hiện có.
 * ts = số ms -> hiển thị giá trị tại điểm gần nhất với thời điểm đang hover trên chart.
 */
function updateKpiCards(ts) {
  const class1ValEl = document.getElementById('kpiClass1Value');
  const qualityValEl = document.getElementById('kpiQualityValue');
  const qualityStatusEl = document.getElementById('kpiQualityStatus');

  if (!state.dataset || !state.dataset.timestamps.length) {
    class1ValEl.textContent = '—';
    qualityValEl.textContent = '—';
    qualityStatusEl.textContent = '—';
    qualityStatusEl.className = 'kpi-card__status';
    return;
  }

  const { timestamps, series } = state.dataset;
  const idx = (ts == null) ? timestamps.length - 1 : findNearestIndex(timestamps, ts);

  const class1Val = series['class1'] ? series['class1'][idx] : NaN;
  const qualityVal = series['quality'] ? series['quality'][idx] : NaN;

  class1ValEl.textContent = Number.isFinite(class1Val) ? `${class1Val.toFixed(1)}%` : '—';

  if (Number.isFinite(qualityVal)) {
    qualityValEl.textContent = `${qualityVal.toFixed(1)} / 10`;
    const band = getQualityBand(qualityVal);
    qualityStatusEl.textContent = band.label;
    qualityStatusEl.className = `kpi-card__status kpi-card__status--${band.cssClass}`;
  } else {
    qualityValEl.textContent = '—';
    qualityStatusEl.textContent = '—';
    qualityStatusEl.className = 'kpi-card__status';
  }
}

/* --------------------------- FIREBASE REALTIME DATA --------------------------- */

/**
 * Được FirebaseDataModule gọi lại MỖI KHI có dữ liệu mới (hoặc lỗi quyền truy cập).
 * Đây là điểm thay thế hoàn toàn cơ chế "chọn file + auto-refresh theo chu kỳ" cũ:
 * không còn polling, Firebase tự đẩy dữ liệu về ngay khi gateway ghi thêm bản ghi.
 */
function handleFirebaseUpdate({ dataset, error }) {
  if (error) {
    console.error(error);
    const isPermissionDenied = error.code === 'PERMISSION_DENIED' || /permission/i.test(error.message || '');
    StatusIndicatorsModule.setFirebaseStatus(isPermissionDenied ? 'denied' : 'signedOut');

    const containerEl = document.getElementById('streamStatusContainer');
    if (containerEl) {
      containerEl.innerHTML = isPermissionDenied
        ? '<div class="empty-hint empty-hint--error">🚫 Tài khoản này CHƯA được cấp quyền xem dữ liệu. Liên hệ quản trị viên để thêm email vào danh sách cho phép trên Firebase.</div>'
        : `<div class="empty-hint empty-hint--error">Lỗi kết nối Firebase: ${error.message || error}</div>`;
    }

    showToast(
      isPermissionDenied
        ? 'Tài khoản của bạn chưa được cấp quyền truy cập dữ liệu.'
        : `Lỗi kết nối Firebase: ${error.message || error}`,
      'error'
    );
    return;
  }

  const isFirstLoad = !state.dataset;

  StatusIndicatorsModule.setFirebaseStatus('connected');

  state.dataset = dataset;
  setTagPanelEnabled(true);
  rerenderChart();
  updateKpiCards(null);
  updateAnalyzeButtonState();
  trainModelsForDataset();

  document.getElementById('streamRowCount').textContent = `${dataset.rowCount.toLocaleString('vi-VN')} bản ghi`;
  document.getElementById('streamLastUpdate').textContent = `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  document.getElementById('streamSection').classList.remove('is-disabled');

  const containerEl = document.getElementById('streamStatusContainer');
  if (containerEl) {
    containerEl.innerHTML = dataset.rowCount
      ? '<div class="empty-hint">✅ Đang lắng nghe dữ liệu realtime từ Firebase.</div>'
      : '<div class="empty-hint">Đã kết nối nhưng "scada_data" hiện chưa có bản ghi nào.</div>';
  }

  if (isFirstLoad && dataset.rowCount > 0) {
    showToast(`Đã kết nối Firebase - nhận ${dataset.rowCount.toLocaleString('vi-VN')} bản ghi.`, 'success');
  }
}

/* --------------------------- AI ANALYSIS --------------------------- */

async function handleAnalyzeAI() {
  if (!GeminiModule.hasApiKey()) {
    showToast('Vui lòng nhập Gemini API Key ở Cài đặt trước.', 'warn');
    document.getElementById('settingsModal').classList.add('is-open');
    return;
  }
  if (!state.dataset) {
    showToast('Chưa có dữ liệu từ Firebase. Vui lòng đăng nhập và đợi dữ liệu realtime.', 'warn');
    return;
  }

  const resultPanel = document.getElementById('aiResultPanel');
  const resultContent = document.getElementById('aiResultContent');
  document.getElementById('predictionPanel').classList.remove('is-open');
  resultPanel.classList.add('is-open');
  resultContent.textContent = '';
  setLoading(true, 'Gemini đang phân tích toàn bộ thông số vận hành và đề xuất đóng/nhả đĩa...');

  try {
    const processKeys = getProcessTagKeys(); // toàn bộ tag quá trình, KHÔNG phụ thuộc tag đang tick chọn trên chart
    const referenceKeys = ['class1', 'quality'];

    const processSummary = ChartModule.getSummaryForAI(processKeys, state.dataset, 120);
    const referenceSummary = ChartModule.getSummaryForAI(referenceKeys, state.dataset, 100);

    const { timestamps } = state.dataset;
    const timeRangeLabel = timestamps.length
      ? `${new Date(timestamps[0]).toLocaleString('vi-VN')} → ${new Date(timestamps[timestamps.length - 1]).toLocaleString('vi-VN')}`
      : '';

    const analysisText = await GeminiModule.analyzeOperational(processSummary, referenceSummary, { timeRangeLabel });
    resultContent.textContent = analysisText;
  } catch (err) {
    console.error(err);
    resultContent.textContent = `⚠ Lỗi phân tích: ${err.message}`;
    showToast('Gemini phân tích thất bại.', 'error');
  } finally {
    setLoading(false);
  }
}

/* --------------------------- BOOTSTRAP --------------------------- */

function wireUiEvents() {
  document.getElementById('btnSignIn').addEventListener('click', () => FirebaseAuthModule.signIn());
  document.getElementById('btnSignOut').addEventListener('click', () => FirebaseAuthModule.signOut());
  document.getElementById('btnAnalyzeAI').addEventListener('click', handleAnalyzeAI);
  document.getElementById('btnCloseAiResult').addEventListener('click', () => {
    document.getElementById('aiResultPanel').classList.remove('is-open');
  });
  document.getElementById('btnOpenPrediction').addEventListener('click', () => {
    document.getElementById('aiResultPanel').classList.remove('is-open');
    renderPredictionPanel();
    document.getElementById('predictionPanel').classList.add('is-open');
  });
  document.getElementById('btnClosePrediction').addEventListener('click', () => {
    document.getElementById('predictionPanel').classList.remove('is-open');
  });
  document.getElementById('chkNormalize').addEventListener('change', (e) => {
    state.normalize = e.target.checked;
    rerenderChart();
  });
}

function onFirebaseAuthStatusChange({ signedIn }) {
  document.getElementById('btnSignIn').classList.toggle('is-hidden', signedIn);
  document.getElementById('btnSignOut').classList.toggle('is-hidden', !signedIn);

  if (signedIn) {
    StatusIndicatorsModule.setFirebaseStatus('connecting');
    document.getElementById('streamSection').classList.remove('is-disabled');
    FirebaseDataModule.listen(handleFirebaseUpdate);
  } else {
    FirebaseDataModule.stop();
    StatusIndicatorsModule.setFirebaseStatus('signedOut');

    document.getElementById('streamSection').classList.add('is-disabled');
    document.getElementById('streamStatusContainer').innerHTML =
      '<div class="empty-hint">Đăng nhập Google để bắt đầu nhận dữ liệu realtime từ Firebase.</div>';
    document.getElementById('streamRowCount').textContent = '0 bản ghi';
    document.getElementById('streamLastUpdate').textContent = 'Chưa có dữ liệu';

    state.dataset = null;
    state.models = null;
    setTagPanelEnabled(false);
    ChartModule.renderEmpty();
    updateKpiCards(null);
    updateAnalyzeButtonState();
    document.getElementById('btnOpenPrediction').disabled = true;
    document.getElementById('predictionPanel').classList.remove('is-open');
    document.getElementById('aiResultPanel').classList.remove('is-open');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  buildTagPanel();
  setTagPanelEnabled(false);
  wireUiEvents();

  StatusIndicatorsModule.initClock();
  StatusIndicatorsModule.initNetworkWatcher();
  StatusIndicatorsModule.setGeminiStatus(GeminiModule.hasApiKey());
  StatusIndicatorsModule.setFirebaseStatus('signedOut');

  SettingsModule.init((hasKey) => StatusIndicatorsModule.setGeminiStatus(hasKey));

  ChartModule.init('mainChart', (ts) => updateKpiCards(ts));

  FirebaseAuthModule.init(onFirebaseAuthStatusChange);
});
