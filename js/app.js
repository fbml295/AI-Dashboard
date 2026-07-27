/**
 * app.js
 * -----------------------------------------------------------------------
 * Điểm khởi động ứng dụng: nối các module (auth, drive, parser, chart,
 * gemini, settings, status) với DOM. Không chứa logic nghiệp vụ phức tạp -
 * chỉ điều phối (orchestration).
 */

let state = {
  dataset: null,        // { timestamps, series, rowCount }
  selectedKeys: [],      // các tag numeric đang bật
  normalize: false,
  currentFile: null,
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
  document.getElementById('btnAnalyzeAI').disabled = state.selectedKeys.length === 0;
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
 * ts = null  -> hiển thị giá trị dòng dữ liệu MỚI NHẤT trong file đang mở.
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

/* --------------------------- AUTO-REFRESH (chu kỳ tự tải lại từ Drive) --------------------------- */

let autoRefreshTimer = null;

function getRefreshIntervalMinutes() {
  const raw = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.REFRESH_INTERVAL_MIN);
  const parsed = raw == null ? APP_CONFIG.DEFAULT_REFRESH_INTERVAL_MIN : parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : APP_CONFIG.DEFAULT_REFRESH_INTERVAL_MIN;
}

/**
 * (Re)khởi động bộ đếm tự động tải lại dữ liệu.
 * Điều kiện chạy: có người đang đăng nhập Google VÀ đang có 1 file được mở.
 * Nếu không thoả, timer sẽ tự bỏ qua ở mỗi lần tick (không gọi API tốn quota).
 */
function scheduleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const minutes = getRefreshIntervalMinutes();
  if (minutes <= 0) return;

  autoRefreshTimer = setInterval(async () => {
    if (!AuthModule.isSignedIn() || !state.currentFile) return; // không ai dùng -> bỏ qua, không tốn quota
    await loadFile(state.currentFile, { silent: true });
  }, minutes * 60 * 1000);
}

/* --------------------------- FILE LIST (DRIVE) --------------------------- */

async function refreshFileList() {
  const listEl = document.getElementById('fileListContainer');
  listEl.innerHTML = '<div class="empty-hint">Đang tải danh sách file...</div>';
  try {
    const files = await DriveModule.listFilesInFolder();
    if (!files.length) {
      listEl.innerHTML = '<div class="empty-hint">Không tìm thấy file CSV/Excel nào trong folder "refiner_AI".</div>';
      return;
    }
    listEl.innerHTML = '';
    files.forEach((file) => {
      const item = document.createElement('button');
      item.className = 'file-item';
      item.type = 'button';
      const sizeKb = file.size ? (file.size / 1024).toFixed(1) + ' KB' : '';
      item.innerHTML = `
        <div class="file-item__name">${file.name}</div>
        <div class="file-item__meta">${new Date(file.modifiedTime).toLocaleString('vi-VN')} · ${sizeKb}</div>
      `;
      item.addEventListener('click', () => loadFile(file));
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="empty-hint empty-hint--error">Lỗi tải danh sách file: ${err.message}</div>`;
    showToast('Không thể tải danh sách file từ Drive.', 'error');
  }
}

/**
 * options.silent = true  -> dùng cho auto-refresh: không reset tag đang chọn,
 * không hiện overlay toàn màn hình (chỉ toast nhỏ), giữ nguyên trải nghiệm
 * đang xem của người dùng.
 */
async function loadFile(file, options = {}) {
  const silent = !!options.silent;
  if (!silent) setLoading(true, `Đang tải "${file.name}"...`);

  try {
    const content = await DriveModule.downloadFileContent(file);
    if (!silent) setLoading(true, 'Đang phân tích dữ liệu CSV/Excel...');
    const dataset = await CsvParserModule.parseFile(content);

    if (!dataset.rowCount) {
      throw new Error('File không có dòng dữ liệu hợp lệ (kiểm tra lại cột Ngày/Giờ).');
    }

    state.dataset = dataset;
    state.currentFile = file;

    if (!silent) {
      state.selectedKeys = [];
      document.querySelectorAll('.tag-checkbox').forEach(cb => { cb.checked = false; });
      setTagPanelEnabled(true);
      ChartModule.renderEmpty();
    } else {
      // Giữ nguyên tag đang chọn, chỉ vẽ lại với dữ liệu mới
      rerenderChart();
    }

    document.getElementById('activeFileName').textContent = file.name;
    document.getElementById('activeFileRows').textContent = `${dataset.rowCount.toLocaleString('vi-VN')} dòng`;
    updateKpiCards(null);

    showToast(
      silent
        ? `Đã tự động cập nhật "${file.name}" - ${dataset.rowCount.toLocaleString('vi-VN')} dòng.`
        : `Đã tải "${file.name}" - ${dataset.rowCount.toLocaleString('vi-VN')} dòng dữ liệu.`,
      'success'
    );
  } catch (err) {
    console.error(err);
    showToast(`Lỗi đọc file: ${err.message}`, 'error');
  } finally {
    if (!silent) setLoading(false);
  }
}

/* --------------------------- AI ANALYSIS --------------------------- */

async function handleAnalyzeAI() {
  if (!GeminiModule.hasApiKey()) {
    showToast('Vui lòng nhập Gemini API Key ở Cài đặt trước.', 'warn');
    document.getElementById('settingsModal').classList.add('is-open');
    return;
  }
  if (!state.dataset || state.selectedKeys.length === 0) {
    showToast('Chọn ít nhất 1 tín hiệu trước khi phân tích.', 'warn');
    return;
  }

  const resultPanel = document.getElementById('aiResultPanel');
  const resultContent = document.getElementById('aiResultContent');
  resultPanel.classList.add('is-open');
  resultContent.textContent = '';
  setLoading(true, 'Gemini đang phân tích dữ liệu vận hành...');

  try {
    const summary = ChartModule.getSummaryForAI(state.selectedKeys, state.dataset);
    const { timestamps } = state.dataset;
    const timeRangeLabel = timestamps.length
      ? `${new Date(timestamps[0]).toLocaleString('vi-VN')} → ${new Date(timestamps[timestamps.length - 1]).toLocaleString('vi-VN')}`
      : '';
    const analysisText = await GeminiModule.analyze(summary, { timeRangeLabel });
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
  document.getElementById('btnSignIn').addEventListener('click', () => AuthModule.signIn());
  document.getElementById('btnSignOut').addEventListener('click', () => AuthModule.signOut());
  document.getElementById('btnRefreshFiles').addEventListener('click', refreshFileList);
  document.getElementById('btnAnalyzeAI').addEventListener('click', handleAnalyzeAI);
  document.getElementById('btnCloseAiResult').addEventListener('click', () => {
    document.getElementById('aiResultPanel').classList.remove('is-open');
  });
  document.getElementById('chkNormalize').addEventListener('change', (e) => {
    state.normalize = e.target.checked;
    rerenderChart();
  });
}

function onAuthStatusChange({ signedIn }) {
  StatusIndicatorsModule.setDriveStatus(signedIn);
  document.getElementById('btnSignIn').classList.toggle('is-hidden', signedIn);
  document.getElementById('btnSignOut').classList.toggle('is-hidden', !signedIn);
  document.getElementById('driveSection').classList.toggle('is-disabled', !signedIn);

  if (signedIn) {
    refreshFileList();
    scheduleAutoRefresh();
  } else {
    document.getElementById('fileListContainer').innerHTML =
      '<div class="empty-hint">Đăng nhập Google để xem danh sách file trong folder "AI-Dashboard".</div>';
    state.dataset = null;
    state.currentFile = null;
    setTagPanelEnabled(false);
    ChartModule.renderEmpty();
    updateKpiCards(null);
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  }
}

/**
 * Thư viện Google Identity Services (accounts.google.com/gsi/client) đôi khi
 * tải chậm hơn app.js do phụ thuộc mạng. Hàm này đợi cho tới khi window.google
 * sẵn sàng trước khi khởi tạo AuthModule, tránh lỗi "google is not defined"
 * xảy ra âm thầm (không hiển thị gì cho người dùng, chỉ thấy trong Console).
 */
function waitForGoogleIdentityServices(callback, attemptsLeft = 50) {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    callback();
    return;
  }
  if (attemptsLeft <= 0) {
    showToast('Không thể tải thư viện đăng nhập Google. Kiểm tra kết nối mạng và tải lại trang.', 'error');
    console.error('Google Identity Services (gsi/client) không tải được sau nhiều lần thử.');
    return;
  }
  setTimeout(() => waitForGoogleIdentityServices(callback, attemptsLeft - 1), 100);
}

window.addEventListener('DOMContentLoaded', () => {
  buildTagPanel();
  setTagPanelEnabled(false);
  wireUiEvents();

  StatusIndicatorsModule.initClock();
  StatusIndicatorsModule.initNetworkWatcher();
  StatusIndicatorsModule.setGeminiStatus(GeminiModule.hasApiKey());

  SettingsModule.init((hasKey) => StatusIndicatorsModule.setGeminiStatus(hasKey));

  ChartModule.init('mainChart', (ts) => updateKpiCards(ts));

  StatusIndicatorsModule.setDriveStatus(false);
  waitForGoogleIdentityServices(() => {
    AuthModule.init(onAuthStatusChange);
  });
});
