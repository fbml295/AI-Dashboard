/**
 * statusIndicators.js
 * -----------------------------------------------------------------------
 * Quản lý 3 đèn trạng thái trên thanh header, giống bảng LED trạng thái
 * trên tủ điều khiển SCADA thật: Firebase / Gemini / Network.
 */

const StatusIndicatorsModule = (() => {
  function setIndicator(id, state, title, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.state = state; // 'ok' | 'warn' | 'off'
    if (title) el.title = title; // mô tả đầy đủ hiện khi hover chuột
    if (label) {
      const labelEl = el.querySelector('.status-label');
      if (labelEl) labelEl.textContent = label;
    }
  }

  /**
   * state: 'signedOut' | 'connecting' | 'connected' | 'denied'
   * Nhãn hiển thị luôn là "Firebase" cố định - chấm tròn màu thể hiện trạng thái,
   * mô tả đầy đủ xem khi hover (title).
   */
  function setFirebaseStatus(state) {
    const map = {
      signedOut:  { ledState: 'off',  title: 'Firebase: chưa đăng nhập' },
      connecting: { ledState: 'warn', title: 'Firebase: đang kết nối...' },
      connected:  { ledState: 'ok',   title: 'Firebase: đang nhận dữ liệu realtime' },
      denied:     { ledState: 'off',  title: 'Firebase: tài khoản chưa được cấp quyền' },
    };
    const s = map[state] || map.signedOut;
    setIndicator('statusFirebase', s.ledState, s.title);
  }

  function setGeminiStatus(hasKey) {
    setIndicator('statusGemini', hasKey ? 'ok' : 'off', hasKey ? 'Gemini AI: sẵn sàng phân tích' : 'Gemini AI: chưa có API Key');
  }

  function setNetworkStatus(online) {
    setIndicator('statusNetwork', online ? 'ok' : 'warn', online ? 'Đang online' : 'Mất kết nối mạng', online ? 'Online' : 'Offline');
  }

  function initNetworkWatcher() {
    setNetworkStatus(navigator.onLine);
    window.addEventListener('online', () => setNetworkStatus(true));
    window.addEventListener('offline', () => setNetworkStatus(false));
  }

  function initClock() {
    const dateEl = document.getElementById('liveClockDate');
    const timeEl = document.getElementById('liveClockTime');
    if (!dateEl || !timeEl) return;
    const tick = () => {
      const now = new Date();
      dateEl.textContent = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      timeEl.textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    setInterval(tick, 1000);
  }

  return { setFirebaseStatus, setGeminiStatus, setNetworkStatus, initNetworkWatcher, initClock };
})();

window.StatusIndicatorsModule = StatusIndicatorsModule;
