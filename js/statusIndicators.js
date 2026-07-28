/**
 * statusIndicators.js
 * -----------------------------------------------------------------------
 * Quản lý 3 đèn trạng thái trên thanh header, giống bảng LED trạng thái
 * trên tủ điều khiển SCADA thật: Firebase / Gemini / Network.
 */

const StatusIndicatorsModule = (() => {
  function setIndicator(id, state, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.state = state; // 'ok' | 'warn' | 'off'
    const labelEl = el.querySelector('.status-label');
    if (labelEl && label) labelEl.textContent = label;
  }

  /**
   * state: 'signedOut' | 'connecting' | 'connected' | 'denied'
   */
  function setFirebaseStatus(state) {
    const map = {
      signedOut:  { ledState: 'off',  label: 'FIREBASE: CHƯA ĐĂNG NHẬP' },
      connecting: { ledState: 'warn', label: 'FIREBASE: ĐANG KẾT NỐI...' },
      connected:  { ledState: 'ok',   label: 'FIREBASE: REALTIME' },
      denied:     { ledState: 'off',  label: 'FIREBASE: KHÔNG CÓ QUYỀN' },
    };
    const s = map[state] || map.signedOut;
    setIndicator('statusFirebase', s.ledState, s.label);
  }

  function setGeminiStatus(hasKey) {
    setIndicator('statusGemini', hasKey ? 'ok' : 'off', hasKey ? 'GEMINI: SẴN SÀNG' : 'GEMINI: CHƯA CÓ API KEY');
  }

  function setNetworkStatus(online) {
    setIndicator('statusNetwork', online ? 'ok' : 'warn', online ? 'MẠNG: ONLINE' : 'MẠNG: OFFLINE');
  }

  function initNetworkWatcher() {
    setNetworkStatus(navigator.onLine);
    window.addEventListener('online', () => setNetworkStatus(true));
    window.addEventListener('offline', () => setNetworkStatus(false));
  }

  function initClock() {
    const clockEl = document.getElementById('liveClock');
    if (!clockEl) return;
    const tick = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  return { setFirebaseStatus, setGeminiStatus, setNetworkStatus, initNetworkWatcher, initClock };
})();

window.StatusIndicatorsModule = StatusIndicatorsModule;
