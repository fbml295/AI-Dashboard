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

async function loadFile(file) {
  setLoading(true, `Đang tải "${file.name}"...`);
  try {
    const content = await DriveModule.downloadFileContent(file);
    setLoading(true, 'Đang phân tích dữ liệu CSV/Excel...');
    const dataset = await CsvParserModule.parseFile(content);

    if (!dataset.rowCount) {
      throw new Error('File không có dòng dữ liệu hợp lệ (kiểm tra lại cột Ngày/Giờ).');
    }

    state.dataset = dataset;
    state.currentFile = file;
    state.selectedKeys = [];

    document.querySelectorAll('.tag-checkbox').forEach(cb => { cb.checked = false; });
    setTagPanelEnabled(true);

    document.getElementById('activeFileName').textContent = file.name;
    document.getElementById('activeFileRows').textContent = `${dataset.rowCount.toLocaleString('vi-VN')} dòng`;

    ChartModule.renderEmpty();
    showToast(`Đã tải "${file.name}" - ${dataset.rowCount.toLocaleString('vi-VN')} dòng dữ liệu.`, 'success');
  } catch (err) {
    console.error(err);
    showToast(`Lỗi đọc file: ${err.message}`, 'error');
  } finally {
    setLoading(false);
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
  } else {
    document.getElementById('fileListContainer').innerHTML =
      '<div class="empty-hint">Đăng nhập Google để xem danh sách file trong folder "refiner_AI".</div>';
    state.dataset = null;
    setTagPanelEnabled(false);
    ChartModule.renderEmpty();
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

  ChartModule.init('mainChart');

  StatusIndicatorsModule.setDriveStatus(false);
  waitForGoogleIdentityServices(() => {
    AuthModule.init(onAuthStatusChange);
  });
});
