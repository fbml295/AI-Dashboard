/**
 * settings.js
 * -----------------------------------------------------------------------
 * Điều khiển Modal "Cài đặt" - nơi người dùng dán Gemini API Key.
 * Key được lưu ở localStorage của trình duyệt (theo yêu cầu kiến trúc
 * client-side-only). Đây KHÔNG phải nơi lưu trữ tuyệt đối an toàn -
 * modal sẽ hiển thị cảnh báo rõ ràng cho người dùng.
 *
 * Kiểm tra key + tải danh sách model: gọi thẳng REST API ListModels của
 * Gemini (https://generativelanguage.googleapis.com/v1beta/models?key=...)
 * - nếu key hợp lệ, Google trả về danh sách model mà chính key đó được
 * phép dùng (tuỳ loại key/gói mà danh sách có thể khác nhau, kể cả key
 * dạng "AIza..." lẫn "AQ...").
 */

const SettingsModule = (() => {
  let onKeyChange = () => {};

  /**
   * Gọi Gemini ListModels API để kiểm tra key hợp lệ hay không, đồng thời
   * lấy danh sách model mà key này được phép dùng (lọc những model hỗ trợ
   * generateContent - loại này mới dùng được cho tính năng phân tích).
   */
  async function fetchAvailableModels(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);

    if (!res.ok) {
      let msg = `Key không hợp lệ (HTTP ${res.status})`;
      try {
        const body = await res.json();
        if (body.error && body.error.message) msg = body.error.message;
      } catch (_) { /* ignore parse error, dùng msg mặc định */ }
      throw new Error(msg);
    }

    const data = await res.json();
    const models = (data.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), displayName: m.displayName || m.name }));

    return models;
  }

  function init(onKeyChangeCallback) {
    onKeyChange = onKeyChangeCallback || onKeyChange;

    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('btnOpenSettings');
    const closeBtn = document.getElementById('btnCloseSettings');
    const saveBtn = document.getElementById('btnSaveApiKey');
    const clearBtn = document.getElementById('btnClearApiKey');
    const input = document.getElementById('geminiApiKeyInput');
    const toggleVisBtn = document.getElementById('btnToggleKeyVisibility');
    const checkBtn = document.getElementById('btnCheckGeminiKey');
    const checkStatus = document.getElementById('geminiCheckStatus');
    const modelRow = document.getElementById('geminiModelRow');
    const modelSelect = document.getElementById('geminiModelSelect');

    input.value = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY) || '';

    function setCheckStatus(text, variant) {
      checkStatus.textContent = text;
      checkStatus.className = `model-check-status model-check-status--${variant}`;
    }

    async function runCheck() {
      const apiKey = input.value.trim();
      if (!apiKey) {
        setCheckStatus('', '');
        modelRow.style.display = 'none';
        return;
      }

      setCheckStatus('⏳ Đang kiểm tra...', 'checking');
      checkBtn.disabled = true;

      try {
        const models = await fetchAvailableModels(apiKey);

        if (!models.length) {
          setCheckStatus('⚠ Key hợp lệ nhưng không có mô hình nào hỗ trợ phân tích (generateContent).', 'warn');
          modelRow.style.display = 'none';
          return;
        }

        modelSelect.innerHTML = models
          .map(m => `<option value="${m.id}">${m.displayName} (${m.id})</option>`)
          .join('');

        // Ưu tiên giữ lại model đã lưu trước đó nếu vẫn còn trong danh sách,
        // nếu không thì ưu tiên chọn sẵn 1 model có chữ "flash" (nhanh/rẻ hơn).
        const savedModel = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_MODEL);
        if (savedModel && models.some(m => m.id === savedModel)) {
          modelSelect.value = savedModel;
        } else {
          const flashModel = models.find(m => m.id.includes('flash'));
          modelSelect.value = flashModel ? flashModel.id : models[0].id;
        }

        modelRow.style.display = 'flex';
        setCheckStatus(`✅ Key hợp lệ — tìm thấy ${models.length} mô hình khả dụng.`, 'ok');
      } catch (err) {
        console.error('Lỗi kiểm tra Gemini key:', err);
        setCheckStatus(`❌ ${err.message}`, 'error');
        modelRow.style.display = 'none';
      } finally {
        checkBtn.disabled = false;
      }
    }

    openBtn.addEventListener('click', () => {
      modal.classList.add('is-open');
      // Nếu đã có sẵn key từ trước, tự động kiểm tra ngay khi mở modal cho tiện
      if (input.value.trim()) runCheck();
    });
    closeBtn.addEventListener('click', () => modal.classList.remove('is-open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-open'); });

    toggleVisBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggleVisBtn.textContent = input.type === 'password' ? 'HIỆN' : 'ẨN';
    });

    checkBtn.addEventListener('click', runCheck);

    // Tự động kiểm tra khi rời khỏi ô nhập key (đổi sang key khác rồi bấm ra ngoài)
    input.addEventListener('blur', () => {
      if (input.value.trim()) runCheck();
    });

    saveBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) {
        alert('Vui lòng nhập API Key trước khi lưu.');
        return;
      }
      localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY, val);

      if (modelRow.style.display !== 'none' && modelSelect.value) {
        localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GEMINI_MODEL, modelSelect.value);
      }

      onKeyChange(true);
      modal.classList.remove('is-open');
    });

    clearBtn.addEventListener('click', () => {
      localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY);
      localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.GEMINI_MODEL);
      input.value = '';
      setCheckStatus('', '');
      modelRow.style.display = 'none';
      onKeyChange(false);
    });
  }

  return { init };
})();

window.SettingsModule = SettingsModule;
