/**
 * auth.js
 * -----------------------------------------------------------------------
 * Quản lý đăng nhập Google bằng Google Identity Services (GIS).
 * Dùng "Token Client" (Implicit Flow) vì đây là static site không có
 * server để đổi Authorization Code lấy token an toàn.
 *
 * QUAN TRỌNG: Access Token trả về CHỈ tồn tại trong bộ nhớ (biến JS),
 * KHÔNG được lưu vào localStorage/sessionStorage để giảm rủi ro bị đánh
 * cắp qua XSS. Khi refresh trang, người dùng phải đăng nhập lại.
 */

const AuthModule = (() => {
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let onStatusChange = () => {};

  function init(onChangeCallback) {
    onStatusChange = onChangeCallback || onStatusChange;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
      scope: APP_CONFIG.DRIVE_SCOPE,
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          console.error('Lỗi OAuth:', tokenResponse.error);
          onStatusChange({ signedIn: false, error: tokenResponse.error });
          return;
        }
        accessToken = tokenResponse.access_token;
        // expires_in tính bằng giây -> quy đổi ra mốc thời gian tuyệt đối
        tokenExpiresAt = Date.now() + (tokenResponse.expires_in * 1000);
        onStatusChange({ signedIn: true });
      },
    });
  }

  function signIn() {
    if (!tokenClient) {
      console.error('AuthModule chưa được init() - thư viện Google Identity Services có thể chưa tải xong.');
      alert('Thư viện đăng nhập Google chưa sẵn sàng. Vui lòng đợi vài giây rồi thử lại, hoặc tải lại trang (F5).');
      return;
    }
    // prompt: 'consent' lần đầu, các lần sau GIS tự động dùng '' (silent) nếu còn hợp lệ
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {
        accessToken = null;
        tokenExpiresAt = 0;
        onStatusChange({ signedIn: false });
      });
    } else {
      onStatusChange({ signedIn: false });
    }
  }

  function isSignedIn() {
    return !!accessToken && Date.now() < tokenExpiresAt;
  }

  function getAccessToken() {
    if (!isSignedIn()) return null;
    return accessToken;
  }

  /**
   * Đảm bảo có token hợp lệ trước khi gọi Drive API.
   * Nếu token hết hạn, tự động yêu cầu lại (có thể popup nếu session Google đã hết).
   */
  function ensureValidToken() {
    return new Promise((resolve, reject) => {
      if (isSignedIn()) {
        resolve(accessToken);
        return;
      }
      // Token hết hạn -> thử lấy lại silent trước, callback gốc sẽ update accessToken
      const originalCallback = tokenClient.callback;
      tokenClient.callback = (resp) => {
        originalCallback(resp);
        if (resp.error) {
          reject(new Error('Không thể làm mới phiên đăng nhập Google. Vui lòng đăng nhập lại.'));
        } else {
          resolve(accessToken);
        }
        tokenClient.callback = originalCallback;
      };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  return { init, signIn, signOut, isSignedIn, getAccessToken, ensureValidToken };
})();

window.AuthModule = AuthModule;
