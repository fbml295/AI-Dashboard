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
  models: null,          // { class1: {...}, quality: {...} } - mô hình hồi quy đã huấn luyện

  // --- Điều khiển khung thời gian hiển thị trên biểu đồ ---
  chartMode: 'live',        // 'live' (tự trượt theo preset) | 'history' (đã đóng băng do user tự zoom/kéo)
  chartPresetMs: 15 * 60 * 1000, // độ dài cửa sổ khi ở chế độ live; null = "Toàn bộ"
  chartFrozenRange: null,   // [minMs, maxMs] khi ở chế độ history

  // --- Mô hình theo dòng sản phẩm (học theo khoảng thời gian, lưu/gộp file) ---
  productModel: null,       // { productName, featureKeys, targets: {class1:{...stats}, quality:{...stats}}, sessions: [...] }
  useProductModelInPanel: false, // true = Section 1-3 dùng productModel thay vì mô hình tự động toàn bộ lịch sử
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
        <span class="tag-value" id="tagValue_${tag.key}" style="color:${tag.color || '#8fa3b8'}">—</span>
        <span class="tag-unit" style="color:${tag.color || '#8fa3b8'}">${tag.unit || ''}</span>
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

/**
 * Cập nhật giá trị "mới nhất" hiển thị trên danh sách tag bên trái, cho TẤT CẢ
 * tag (kể cả tag chưa tick chọn hiển thị trên chart) - gọi lại mỗi khi Firebase
 * đẩy dữ liệu mới về, để danh sách tag luôn phản ánh realtime.
 */
function updateTagPanelValues() {
  if (!state.dataset || !state.dataset.timestamps.length) {
    TAG_DEFINITIONS.forEach((tag) => {
      const el = document.getElementById(`tagValue_${tag.key}`);
      if (el) el.textContent = '—';
    });
    return;
  }
  const lastIdx = state.dataset.timestamps.length - 1;
  TAG_DEFINITIONS.forEach((tag) => {
    const el = document.getElementById(`tagValue_${tag.key}`);
    if (!el) return;
    const raw = state.dataset.series[tag.key] ? state.dataset.series[tag.key][lastIdx] : undefined;
    if (tag.type === 'numeric') {
      el.textContent = Number.isFinite(raw) ? raw.toFixed(1) : '—';
    } else if (tag.type === 'categorical') {
      el.textContent = raw != null && raw !== '' ? String(raw) : '—';
    }
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

  let xMin, xMax;
  const timestamps = state.dataset.timestamps;
  const latestTs = timestamps.length ? timestamps[timestamps.length - 1] : Date.now();

  if (state.chartMode === 'history' && state.chartFrozenRange) {
    [xMin, xMax] = state.chartFrozenRange;
  } else if (state.chartMode === 'live' && state.chartPresetMs != null) {
    xMax = latestTs;
    xMin = latestTs - state.chartPresetMs;
  }
  // Nếu chartPresetMs === null ("Toàn bộ") -> để xMin/xMax undefined, ECharts tự canh full data

  ChartModule.render(state.selectedKeys, state.dataset, { xMin, xMax });
}

function updateLiveStatusBadge() {
  const badge = document.getElementById('liveStatusBadge');
  const text = document.getElementById('liveStatusText');
  if (!badge || !text) return;
  badge.dataset.mode = state.chartMode;
  text.textContent = state.chartMode === 'live' ? 'LIVE' : 'ĐANG XEM LỊCH SỬ';
}

function setActivePresetButton(ms) {
  document.querySelectorAll('.range-btn[data-ms]').forEach((btn) => {
    const btnMs = btn.dataset.ms === 'all' ? null : Number(btn.dataset.ms);
    btn.classList.toggle('is-active', state.chartMode === 'live' && btnMs === state.chartPresetMs);
  });
}

/**
 * Chuyển sang chế độ LIVE với 1 độ dài cửa sổ cho trước (ms), hoặc null = Toàn bộ.
 */
function applyLivePreset(ms) {
  state.chartMode = 'live';
  state.chartPresetMs = ms;
  state.chartFrozenRange = null;
  setActivePresetButton(ms);
  updateLiveStatusBadge();
  rerenderChart();
}

/**
 * Được gọi khi người dùng TỰ kéo/scroll để zoom trên biểu đồ -> đóng băng đúng
 * vùng đang xem, không tính lại theo dữ liệu mới cho tới khi bấm preset/LIVE khác.
 */
function handleManualZoom(rangeMinMs, rangeMaxMs) {
  state.chartMode = 'history';
  state.chartFrozenRange = [rangeMinMs, rangeMaxMs];
  setActivePresetButton(NaN); // bỏ highlight mọi preset vì đang ở chế độ tự do
  updateLiveStatusBadge();
}

function zoomByFactor(factor) {
  if (!state.dataset || !state.dataset.timestamps.length) return;
  const timestamps = state.dataset.timestamps;
  const latestTs = timestamps[timestamps.length - 1];

  let curMin, curMax;
  if (state.chartMode === 'history' && state.chartFrozenRange) {
    [curMin, curMax] = state.chartFrozenRange;
  } else if (state.chartPresetMs != null) {
    curMax = latestTs;
    curMin = latestTs - state.chartPresetMs;
  } else {
    curMin = timestamps[0];
    curMax = latestTs;
  }

  const center = (curMin + curMax) / 2;
  const halfWidth = ((curMax - curMin) / 2) * factor;
  const newMin = center - halfWidth;
  const newMax = center + halfWidth;

  state.chartMode = 'history';
  state.chartFrozenRange = [newMin, newMax];
  setActivePresetButton(NaN);
  updateLiveStatusBadge();
  rerenderChart();
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

  // QUAN TRỌNG: nếu panel Dự đoán đang mở, KHÔNG tự vẽ lại toàn bộ nội dung -
  // sẽ làm mất các tick/giá trị người dùng đang nhập để mô phỏng dở tay.
  // Chỉ hiện 1 banner nhỏ báo có bản cập nhật mới, để họ tự bấm làm mới khi sẵn sàng.
  const panel = document.getElementById('predictionPanel');
  if (panel.classList.contains('is-open')) {
    const banner = document.getElementById('predictionUpdateBanner');
    if (banner) banner.classList.add('is-visible');
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
 * Trả về bộ mô hình đang ĐƯỢC DÙNG cho Section 1-3: hoặc mô hình sản phẩm đã
 * tải/học (nếu bật toggle), hoặc mô hình tự động huấn luyện trên toàn bộ
 * lịch sử hiện có (mặc định).
 */
function getActiveModels() {
  if (state.useProductModelInPanel && state.productModel) {
    const featureKeys = getProcessTagKeys();
    try {
      return {
        class1: ProductModelModule.deriveModel(state.productModel.targets.class1, featureKeys),
        quality: ProductModelModule.deriveModel(state.productModel.targets.quality, featureKeys),
        source: 'product',
      };
    } catch (e) {
      console.error(e);
      showToast(e.message, 'error');
    }
  }
  return {
    class1: state.models ? state.models.class1 : { ok: false, reason: 'Chưa có mô hình tự động.' },
    quality: state.models ? state.models.quality : { ok: false, reason: 'Chưa có mô hình tự động.' },
    source: 'auto',
  };
}

function msToDatetimeLocalStr(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Tính & hiển thị khuyến nghị đóng/nhả đĩa dựa trên mục tiêu Chất lượng.
 * Được gọi tự động khi mở panel (mục tiêu mặc định = 5) và mỗi khi bấm "Tính lại".
 */
function computeAndRenderRecommendation(latest, activeModels) {
  const recEl = document.getElementById('recommendationResult');
  const targetInput = document.getElementById('targetQualityInput');
  const targetQuality = parseFloat(targetInput.value);

  if (!Number.isFinite(targetQuality)) {
    recEl.innerHTML = '<div class="pred-warning">Mục tiêu không hợp lệ.</div>';
    return;
  }

  const currentGap = latest['plategap'];
  const recommendedGap = ModelModule.solveForFeature(activeModels.quality, latest, 'plategap', targetQuality);

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

  const predClass1AtRec = ModelModule.predict(activeModels.class1, { ...latest, plategap: recommendedGap });
  const range = getFeatureRange('plategap');
  const outOfRange = recommendedGap < range.min || recommendedGap > range.max;

  recEl.innerHTML = `
    <div class="pred-action ${actionClass}">➜ ${actionText}</div>
    <div class="pred-delta">Khe hở hiện tại: <b>${fmtVal(currentGap)} mm</b> → Đề xuất: <b>${fmtVal(recommendedGap)} mm</b> (${fmtDelta(delta)} mm)</div>
    <div class="pred-delta">Phân loại dự đoán tại mức đề xuất: <b>${fmtVal(predClass1AtRec)}%</b></div>
    ${outOfRange ? '<div class="pred-warning">⚠ Giá trị đề xuất nằm ngoài phạm vi khe hở đã ghi nhận trong lịch sử — cần thận trọng, đối chiếu giới hạn cơ khí thiết bị trước khi áp dụng.</div>' : ''}
    <div class="pred-hint">*Khuyến nghị dựa trên mô hình hồi quy tuyến tính, giữ nguyên các thông số khác ở giá trị mới nhất.</div>
  `;
}

/**
 * Vẽ hộp trạng thái mô hình sản phẩm hiện tại (tên, R² từng target, lịch sử các lần học).
 */
function renderProductModelStatusBox() {
  const box = document.getElementById('productStatusBox');
  if (!box) return;

  if (!state.productModel) {
    box.innerHTML = '<div class="pred-hint">Chưa có mô hình sản phẩm nào được tạo/tải lên.</div>';
    return;
  }

  const pm = state.productModel;
  const featureKeys = getProcessTagKeys();
  let class1Derived, qualityDerived;
  try {
    class1Derived = ProductModelModule.deriveModel(pm.targets.class1, featureKeys);
    qualityDerived = ProductModelModule.deriveModel(pm.targets.quality, featureKeys);
  } catch (e) {
    box.innerHTML = `<div class="pred-warning">${e.message}</div>`;
    return;
  }

  const sessionsHtml = (pm.sessions || []).slice().reverse().map(s =>
    `<li>${s.from.replace('T', ' ')} → ${s.to.replace('T', ' ')} <span class="pred-session-rows">(+${s.rows.toLocaleString('vi-VN')} dòng)</span></li>`
  ).join('');

  box.innerHTML = `
    <div class="pred-delta">📦 <b>${pm.productName}</b></div>
    <div class="pred-reliability">
      R² Phân loại: ${class1Derived.ok ? `<span class="pred-r2--${r2Class(class1Derived.r2)}">${(class1Derived.r2 * 100).toFixed(0)}%</span> (n=${class1Derived.n.toLocaleString('vi-VN')})` : `<span class="pred-r2--bad">${class1Derived.reason}</span>`}<br/>
      R² Chất lượng: ${qualityDerived.ok ? `<span class="pred-r2--${r2Class(qualityDerived.r2)}">${(qualityDerived.r2 * 100).toFixed(0)}%</span> (n=${qualityDerived.n.toLocaleString('vi-VN')})` : `<span class="pred-r2--bad">${qualityDerived.reason}</span>`}
    </div>
    ${sessionsHtml ? `<div class="pred-hint">Lịch sử ${pm.sessions.length} lần học:</div><ul class="pred-session-log">${sessionsHtml}</ul>` : ''}
  `;
}

function handleTrainProductRange() {
  const nameInput = document.getElementById('productNameInput');
  const fromInput = document.getElementById('productFromInput');
  const toInput = document.getElementById('productToInput');
  const resultEl = document.getElementById('productTrainResult');

  const productName = nameInput.value.trim();
  if (!productName) { resultEl.innerHTML = '<div class="pred-warning">Vui lòng nhập tên sản phẩm.</div>'; return; }

  const fromMs = fromInput.value ? new Date(fromInput.value).getTime() : NaN;
  const toMs = toInput.value ? new Date(toInput.value).getTime() : NaN;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    resultEl.innerHTML = '<div class="pred-warning">Khoảng thời gian không hợp lệ ("Từ" phải nhỏ hơn "Đến").</div>';
    return;
  }
  if (!state.dataset) { resultEl.innerHTML = '<div class="pred-warning">Chưa có dữ liệu.</div>'; return; }

  const featureKeys = getProcessTagKeys();
  const newStats = ProductModelModule.computeStatsFromRange(state.dataset, featureKeys, fromMs, toMs);

  if (newStats.rowsInRange === 0) {
    resultEl.innerHTML = '<div class="pred-warning">Không có dòng dữ liệu hợp lệ nào trong khoảng đã chọn.</div>';
    return;
  }

  try {
    if (state.productModel && state.productModel.productName === productName) {
      // Cùng tên sản phẩm -> GỘP thêm vào mô hình đã có (học thêm, chính xác tuyệt đối)
      const merged = ProductModelModule.mergeStats(
        { featureKeys: state.productModel.featureKeys, targets: state.productModel.targets },
        newStats
      );
      state.productModel.targets = merged.targets;
    } else {
      // Tên khác hoặc chưa có mô hình nào -> bắt đầu mô hình mới
      state.productModel = { productName, featureKeys, targets: newStats.targets, sessions: [] };
    }
    state.productModel.sessions.push({
      from: fromInput.value, to: toInput.value,
      rows: newStats.rowsInRange, trainedAt: new Date().toISOString(),
    });
  } catch (e) {
    resultEl.innerHTML = `<div class="pred-warning">${e.message}</div>`;
    return;
  }

  resultEl.innerHTML = `<div class="pred-delta">✅ Đã học thêm <b>${newStats.rowsInRange.toLocaleString('vi-VN')}</b> dòng vào mô hình "<b>${productName}</b>".</div>`;
  renderProductModelStatusBox();
  document.getElementById('btnSaveProductModel').disabled = false;
  document.getElementById('btnResetProductModel').disabled = false;
}

function handleSaveProductModel() {
  if (!state.productModel) { showToast('Chưa có mô hình sản phẩm nào để lưu.', 'warn'); return; }
  const payload = {
    formatVersion: 1,
    productName: state.productModel.productName,
    featureKeys: state.productModel.featureKeys,
    targets: state.productModel.targets,
    sessions: state.productModel.sessions,
    savedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = state.productModel.productName.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'model';
  a.href = url;
  a.download = `model_${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Đã lưu file mô hình.', 'success');
}

function handleLoadProductModelFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const featureKeys = getProcessTagKeys();
      const fileKeys = data.featureKeys || [];
      if (fileKeys.length !== featureKeys.length || fileKeys.some((k, i) => k !== featureKeys[i])) {
        showToast('File không khớp bộ tag hiện tại của hệ thống — không thể tải.', 'error');
        return;
      }
      state.productModel = {
        productName: data.productName || 'Không tên',
        featureKeys: fileKeys,
        targets: data.targets,
        sessions: data.sessions || [],
      };
      showToast(`Đã tải mô hình "${state.productModel.productName}" (${(data.sessions || []).length} lần học trước đó).`, 'success');
      renderPredictionPanel();
    } catch (e) {
      console.error(e);
      showToast('File không hợp lệ hoặc bị lỗi khi đọc.', 'error');
    }
  };
  reader.readAsText(file);
}

function handleResetProductModel() {
  state.productModel = null;
  state.useProductModelInPanel = false;
  renderPredictionPanel();
}

/**
 * Dựng toàn bộ nội dung panel Dự đoán & Mô phỏng.
 */
function renderPredictionPanel() {
  const body = document.getElementById('predictionPanelBody');
  const activeModels = getActiveModels();
  const hasDataset = !!state.dataset;

  // --- Section 0: Mô hình theo dòng sản phẩm (luôn hiển thị nếu có dataset, kể cả khi mô hình tự động chưa đủ dữ liệu) ---
  const productSectionHtml = `
    <div class="pred-section">
      <div class="pred-section__title">📦 Mô hình theo dòng sản phẩm</div>
      <div class="pred-hint">Chỉ định khoảng thời gian hợp lệ (tránh đoạn xấu như lúc khởi động) để AI học riêng cho 1 dòng sản phẩm — có thể lưu ra file, tải lên học tiếp sau này.</div>
      <div class="pred-row">
        <label class="pred-label">Tên sản phẩm:</label>
        <input type="text" id="productNameInput" class="pred-input pred-input--wide" placeholder="vd: Bột giấy Acacia lô A"
               value="${state.productModel ? state.productModel.productName.replace(/"/g, '&quot;') : ''}" />
      </div>
      <div class="pred-row">
        <label class="pred-label">Từ:</label>
        <input type="datetime-local" id="productFromInput" class="pred-input" />
        <label class="pred-label">Đến:</label>
        <input type="datetime-local" id="productToInput" class="pred-input" />
      </div>
      <button class="btn btn--primary" id="btnTrainProductRange" style="width:100%;" ${hasDataset ? '' : 'disabled'}>Học từ khoảng này</button>
      <div id="productTrainResult" class="pred-result"></div>

      <div class="pred-product-status" id="productStatusBox"></div>

      <div class="pred-row" style="margin-top:10px;">
        <button class="btn btn--ghost" id="btnSaveProductModel" ${state.productModel ? '' : 'disabled'}>💾 Lưu file</button>
        <label class="btn btn--ghost pred-file-label" for="productFileInput">📂 Tải file lên</label>
        <input type="file" id="productFileInput" accept=".json" style="display:none;" />
        <button class="btn btn--ghost" id="btnResetProductModel" ${state.productModel ? '' : 'disabled'}>🗑 Xoá</button>
      </div>

      <label class="pred-toggle-row">
        <input type="checkbox" id="useProductModelCheck" ${state.useProductModelInPanel ? 'checked' : ''} ${state.productModel ? '' : 'disabled'} />
        Dùng mô hình sản phẩm này cho phần Dự đoán/Mô phỏng/Khuyến nghị bên dưới (thay vì mô hình tự động toàn bộ lịch sử)
      </label>
    </div>
  `;

  if (!hasDataset || !activeModels.class1.ok || !activeModels.quality.ok) {
    const reason = !hasDataset
      ? 'Chưa có dữ liệu.'
      : (!activeModels.quality.ok ? activeModels.quality.reason : activeModels.class1.reason);
    const sourceNote = activeModels.source === 'product' ? ' (đang dùng mô hình sản phẩm)' : '';
    body.innerHTML = productSectionHtml + `<div class="empty-hint">Chưa thể dự đoán${sourceNote}: ${reason}</div>`;
    wireProductModelSection(body);
    return;
  }

  const latest = getLatestFeatureVector();
  const predClass1 = ModelModule.predict(activeModels.class1, latest);
  const predQuality = ModelModule.predict(activeModels.quality, latest);
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

  body.innerHTML = productSectionHtml + `
    <div class="pred-section">
      <div class="pred-section__title">1. Dự đoán tại thông số hiện tại ${activeModels.source === 'product' ? '<span class="pred-source-tag">MÔ HÌNH SẢN PHẨM</span>' : ''}</div>
      <div class="pred-reliability">
        Độ tin cậy mô hình (R²) — Phân loại:
        <span class="pred-r2--${r2Class(activeModels.class1.r2)}">${(activeModels.class1.r2 * 100).toFixed(0)}% (${r2Label(activeModels.class1.r2)})</span>,
        Chất lượng:
        <span class="pred-r2--${r2Class(activeModels.quality.r2)}">${(activeModels.quality.r2 * 100).toFixed(0)}% (${r2Label(activeModels.quality.r2)})</span>
        <span class="pred-reliability__n">— học từ ${activeModels.quality.n.toLocaleString('vi-VN')} bản ghi</span>
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

  wireProductModelSection(body);

  // --- Wiring: checkbox bật/tắt input tương ứng (mô phỏng) ---
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
    const newClass1 = ModelModule.predict(activeModels.class1, scenario);
    const newQuality = ModelModule.predict(activeModels.quality, scenario);

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
  document.getElementById('btnRunRecommendation').addEventListener('click', () => computeAndRenderRecommendation(latest, activeModels));

  // --- Tự động tính khuyến nghị ngay khi mở panel (mục tiêu mặc định = 5) ---
  computeAndRenderRecommendation(latest, activeModels);
}

/**
 * Wire các nút/ô trong Section 0 (Mô hình sản phẩm) - tách riêng vì section
 * này được render cả trong trường hợp chưa đủ dữ liệu để dự đoán.
 */
function wireProductModelSection(body) {
  const fromInput = document.getElementById('productFromInput');
  const toInput = document.getElementById('productToInput');
  if (state.dataset && state.dataset.timestamps.length && !fromInput.value) {
    // Gợi ý mặc định: khung thời gian đang xem trên biểu đồ (nếu đã đóng băng), tránh
    // mặc định "toàn bộ lịch sử" (dễ dính luôn đoạn khởi động xấu ở đầu file).
    if (state.chartMode === 'history' && state.chartFrozenRange) {
      fromInput.value = msToDatetimeLocalStr(state.chartFrozenRange[0]);
      toInput.value = msToDatetimeLocalStr(state.chartFrozenRange[1]);
    }
  }

  renderProductModelStatusBox();

  document.getElementById('btnTrainProductRange').addEventListener('click', handleTrainProductRange);
  document.getElementById('btnSaveProductModel').addEventListener('click', handleSaveProductModel);
  document.getElementById('btnResetProductModel').addEventListener('click', () => {
    if (confirm('Xoá mô hình sản phẩm hiện tại? (File đã lưu trước đó trên máy bạn không bị ảnh hưởng)')) {
      handleResetProductModel();
    }
  });
  document.getElementById('productFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleLoadProductModelFile(file);
    e.target.value = '';
  });
  document.getElementById('useProductModelCheck').addEventListener('change', (e) => {
    state.useProductModelInPanel = e.target.checked;
    renderPredictionPanel();
  });
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

/**
 * Phân loại chi tiết 7 mức theo điểm số làm tròn (1-10), dùng cho tooltip
 * khi hover vào ô Chất lượng - đúng thang do người vận hành quy định:
 *   1-2: Quá thô   3: Thô   4: Hơi thô   5: Đạt   6: Hơi mịn   7: Mịn   8-10: Quá mịn
 */
function getQualityCategoryLabel(roundedValue) {
  if (roundedValue <= 2) return 'Quá thô';
  if (roundedValue === 3) return 'Thô';
  if (roundedValue === 4) return 'Hơi thô';
  if (roundedValue === 5) return 'Đạt';
  if (roundedValue === 6) return 'Hơi mịn';
  if (roundedValue === 7) return 'Mịn';
  return 'Quá mịn'; // 8-10
}

/**
 * Màu cho vạch thứ i (1-10): dải NÓNG -> LẠNH theo đúng yêu cầu (Thô = nóng/đỏ,
 * Mịn = lạnh/lam), đi qua cam -> vàng -> XANH LÁ ở giữa (đạt chuẩn) -> lam.
 * Dùng nội suy Hue trong hệ màu HSL cho chuyển màu mượt tự nhiên như cầu vồng.
 */
function computeQualitySegmentColor(i) {
  const hue = ((i - 1) / 9) * 220; // 0° = đỏ (thô nhất) -> 220° = lam (mịn nhất)
  return `hsl(${hue.toFixed(0)}, 85%, 55%)`;
}

/**
 * Sinh 10 vạch màu cho thanh Chất lượng - chỉ cần chạy 1 lần lúc khởi động
 * vì màu sắc cố định, không đổi theo dữ liệu.
 */
function initQualityBarZones() {
  const container = document.getElementById('qualitySegments');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const seg = document.createElement('div');
    seg.className = 'quality-segment';
    seg.dataset.index = String(i);
    seg.style.background = computeQualitySegmentColor(i);
    container.appendChild(seg);
  }
}

/**
 * Cập nhật 2 ô KPI "Phân loại" và "Chất lượng".
 * ts = null  -> hiển thị giá trị dòng dữ liệu MỚI NHẤT hiện có.
 * ts = số ms -> hiển thị giá trị tại điểm gần nhất với thời điểm đang hover trên chart.
 */
function updateKpiCards(ts) {
  const class1ValEl = document.getElementById('kpiClass1Value');
  const secValEl = document.getElementById('kpiSecValue');
  const qualitySegments = document.querySelectorAll('.quality-segment');
  const qualityCardEl = document.getElementById('kpiQualityCard');

  if (!state.dataset || !state.dataset.timestamps.length) {
    class1ValEl.textContent = '—';
    secValEl.textContent = '—';
    qualitySegments.forEach((el) => { el.classList.remove('is-active'); el.textContent = ''; });
    qualityCardEl.title = 'Di chuột lên từng vạch để xem đánh giá';
    return;
  }

  const { timestamps, series } = state.dataset;
  const idx = (ts == null) ? timestamps.length - 1 : findNearestIndex(timestamps, ts);

  const class1Val = series['class1'] ? series['class1'][idx] : NaN;
  const qualityVal = series['quality'] ? series['quality'][idx] : NaN;
  const pkwhVal = series['pkwh'] ? series['pkwh'][idx] : NaN;
  const dsfflowVal = series['dsfflow'] ? series['dsfflow'][idx] : NaN;

  class1ValEl.textContent = Number.isFinite(class1Val) ? class1Val.toFixed(1) : '—';

  // SEC (Specific Energy Consumption) = công suất tiêu thụ / lưu lượng DSF
  const secVal = (Number.isFinite(pkwhVal) && Number.isFinite(dsfflowVal) && dsfflowVal !== 0)
    ? pkwhVal / dsfflowVal
    : NaN;
  secValEl.textContent = Number.isFinite(secVal) ? secVal.toFixed(2) : '—';

  if (Number.isFinite(qualityVal)) {
    const activeIdx = Math.min(10, Math.max(1, Math.round(qualityVal)));
    qualitySegments.forEach((el) => {
      const isActive = Number(el.dataset.index) === activeIdx;
      el.classList.toggle('is-active', isActive);
      el.textContent = isActive ? qualityVal.toFixed(1) : '';
    });
    const categoryLabel = getQualityCategoryLabel(activeIdx);
    qualityCardEl.title = `Điểm hiện tại: ${qualityVal.toFixed(1)}/10 - ${categoryLabel}`;
  } else {
    qualitySegments.forEach((el) => {
      el.classList.remove('is-active');
      el.textContent = '';
    });
    qualityCardEl.title = 'Chưa có dữ liệu Chất lượng';
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
  updateTagPanelValues();
  updateAnalyzeButtonState();
  trainModelsForDataset();

  document.getElementById('streamHeaderMeta').textContent =
    `${dataset.rowCount.toLocaleString('vi-VN')} bản ghi · Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  document.getElementById('streamSection').classList.remove('is-disabled');

  const containerEl = document.getElementById('streamStatusContainer');
  if (containerEl) {
    // Khi đã có dữ liệu, không cần thông báo "Đang lắng nghe..." nữa - số bản ghi
    // + thời gian cập nhật ở header đã đủ nói lên điều đó. Chỉ giữ thông báo khi
    // kết nối thành công nhưng node "scada_data" vẫn trống.
    containerEl.innerHTML = dataset.rowCount
      ? ''
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
    document.getElementById('predictionUpdateBanner').classList.remove('is-visible');
    renderPredictionPanel();
    document.getElementById('predictionPanel').classList.add('is-open');
  });
  document.getElementById('btnRefreshPredictionPanel').addEventListener('click', () => {
    document.getElementById('predictionUpdateBanner').classList.remove('is-visible');
    renderPredictionPanel();
  });
  document.getElementById('btnClosePrediction').addEventListener('click', () => {
    document.getElementById('predictionPanel').classList.remove('is-open');
    document.getElementById('predictionUpdateBanner').classList.remove('is-visible');
  });
  // --- Nút preset thời gian ---
  document.querySelectorAll('.range-btn[data-ms]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('customRangePopover').classList.remove('is-open');
      const ms = btn.dataset.ms === 'all' ? null : Number(btn.dataset.ms);
      applyLivePreset(ms);
    });
  });

  // --- Popover "Tuỳ chỉnh" ---
  const customPopover = document.getElementById('customRangePopover');
  document.getElementById('btnCustomRange').addEventListener('click', (e) => {
    e.stopPropagation();
    customPopover.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!customPopover.contains(e.target) && e.target.id !== 'btnCustomRange') {
      customPopover.classList.remove('is-open');
    }
  });
  document.getElementById('btnApplyCustomRange').addEventListener('click', () => {
    const value = parseFloat(document.getElementById('customRangeValue').value);
    const unitMs = Number(document.getElementById('customRangeUnit').value);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('Vui lòng nhập số hợp lệ (> 0).', 'warn');
      return;
    }
    customPopover.classList.remove('is-open');
    applyLivePreset(value * unitMs);
  });

  // --- Zoom in/out & quay lại LIVE ---
  document.getElementById('btnZoomIn').addEventListener('click', () => zoomByFactor(0.5));
  document.getElementById('btnZoomOut').addEventListener('click', () => zoomByFactor(2));
  document.getElementById('btnLiveReset').addEventListener('click', () => applyLivePreset(state.chartPresetMs));
}

function onFirebaseAuthStatusChange({ signedIn, user }) {
  document.getElementById('btnSignIn').classList.toggle('is-hidden', signedIn);
  document.getElementById('btnSignOut').classList.toggle('is-hidden', !signedIn);

  const userBadge = document.getElementById('userBadge');
  userBadge.textContent = (signedIn && user) ? (user.displayName || user.email || '') : '';

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
    document.getElementById('streamHeaderMeta').textContent = '0 bản ghi · Chưa có dữ liệu';

    state.dataset = null;
    state.models = null;
    setTagPanelEnabled(false);
    ChartModule.renderEmpty();
    updateKpiCards(null);
    updateTagPanelValues();
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
  initQualityBarZones();

  StatusIndicatorsModule.initClock();
  StatusIndicatorsModule.initNetworkWatcher();
  StatusIndicatorsModule.setGeminiStatus(GeminiModule.hasApiKey());
  StatusIndicatorsModule.setFirebaseStatus('signedOut');

  SettingsModule.init((hasKey) => StatusIndicatorsModule.setGeminiStatus(hasKey));

  ChartModule.init('mainChart', (ts) => updateKpiCards(ts), (rangeMinMs, rangeMaxMs) => handleManualZoom(rangeMinMs, rangeMaxMs));
  setActivePresetButton(state.chartPresetMs);
  updateLiveStatusBadge();

  FirebaseAuthModule.init(onFirebaseAuthStatusChange);
});
