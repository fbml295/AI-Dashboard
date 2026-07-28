/**
 * firebaseAuth.js
 * -----------------------------------------------------------------------
 * Đăng nhập Google THÔNG QUA Firebase Authentication (khác với auth.js cũ
 * dùng Google Identity Services thuần). Lý do đổi: để Firebase Realtime
 * Database Security Rules có thể kiểm tra được danh tính người dùng
 * (auth.token.email) và quyết định ai được đọc dữ liệu, mà không cần lộ
 * bất kỳ secret nào ra trình duyệt.
 */

const FirebaseAuthModule = (() => {
  let onStatusChange = () => {};
  let initialized = false;

  function init(onStatusChangeCallback) {
    onStatusChange = onStatusChangeCallback || onStatusChange;

    if (!firebase.apps.length) {
      firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
    }

    firebase.auth().onAuthStateChanged((user) => {
      initialized = true;
      onStatusChange({ signedIn: !!user, user });
    });
  }

  function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Luôn hiện màn hình chọn tài khoản Google, tránh tự động đăng nhập nhầm tài khoản trước đó
    provider.setCustomParameters({ prompt: 'select_account' });

    firebase.auth().signInWithPopup(provider).catch((err) => {
      console.error('Đăng nhập Firebase thất bại:', err);
      if (err.code === 'auth/popup-blocked') {
        alert('Trình duyệt đang chặn popup đăng nhập. Vui lòng cho phép popup từ trang này rồi thử lại.');
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        alert('Đăng nhập thất bại: ' + err.message);
      }
    });
  }

  function signOut() {
    firebase.auth().signOut();
  }

  function isSignedIn() {
    return !!firebase.auth().currentUser;
  }

  function getCurrentUser() {
    return firebase.auth().currentUser;
  }

  return { init, signIn, signOut, isSignedIn, getCurrentUser };
})();

window.FirebaseAuthModule = FirebaseAuthModule;
