/**
 * settings.js
 * -----------------------------------------------------------------------
 * Điều khiển Modal "Cài đặt" - nơi người dùng dán Gemini API Key.
 * Key được lưu ở localStorage của trình duyệt (theo yêu cầu kiến trúc
 * client-side-only). Đây KHÔNG phải nơi lưu trữ tuyệt đối an toàn -
 * modal sẽ hiển thị cảnh báo rõ ràng cho người dùng.
 */

const SettingsModule = (() => {
  let onKeyChange = () => {};

  function init(onKeyChangeCallback) {
    onKeyChange = onKeyChangeCallback || onKeyChange;

    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('btnOpenSettings');
    const closeBtn = document.getElementById('btnCloseSettings');
    const saveBtn = document.getElementById('btnSaveApiKey');
    const clearBtn = document.getElementById('btnClearApiKey');
    const input = document.getElementById('geminiApiKeyInput');
    const toggleVisBtn = document.getElementById('btnToggleKeyVisibility');

    input.value = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY) || '';

    openBtn.addEventListener('click', () => modal.classList.add('is-open'));
    closeBtn.addEventListener('click', () => modal.classList.remove('is-open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-open'); });

    toggleVisBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggleVisBtn.textContent = input.type === 'password' ? 'HIỆN' : 'ẨN';
    });

    saveBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) {
        alert('Vui lòng nhập API Key trước khi lưu.');
        return;
      }
      localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY, val);
      onKeyChange(true);
      modal.classList.remove('is-open');
    });

    clearBtn.addEventListener('click', () => {
      localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY);
      input.value = '';
      onKeyChange(false);
    });
  }

  return { init };
})();

window.SettingsModule = SettingsModule;
