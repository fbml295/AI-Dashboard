# Refiner AI — Industrial SCADA Trend Monitor

Dashboard giám sát dữ liệu vận hành refiner (nghiền bột giấy), 100% chạy client-side,
host tĩnh trên GitHub Pages, không cần backend.

## 1. Cấu hình trước khi deploy

Mở `js/config.js` và điền 2 giá trị:

```js
GOOGLE_CLIENT_ID: 'xxxxx.apps.googleusercontent.com',  // Từ Google Cloud Console
DRIVE_FOLDER_ID: 'xxxxxxxxxxxxxxxxxxxxxxxxx',            // ID folder "refiner_AI" trên Drive
```

Cách lấy `DRIVE_FOLDER_ID`: mở folder trên Google Drive, copy đoạn cuối URL:
`https://drive.google.com/drive/folders/<ĐÂY_LÀ_FOLDER_ID>`

Client ID lấy theo hướng dẫn ở phần trao đổi trước (Google Cloud Console → OAuth Client ID,
loại **Web application**, khai báo Authorized JavaScript origin đúng domain GitHub Pages của bạn).

## 2. Chạy thử local

Vì dùng `fetch` tới Google API, cần chạy qua HTTP server thật (không mở trực tiếp file://):

```bash
cd industrial-dashboard
python3 -m http.server 5500
# mở http://localhost:5500
```

Nhớ thêm `http://localhost:5500` vào **Authorized JavaScript origins** trong OAuth Client ID.

## 3. Deploy lên GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit: Refiner AI dashboard"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

Vào **Settings → Pages** của repo → Source: chọn branch `main`, thư mục `/ (root)`.
Sau khi trang chạy tại `https://<username>.github.io/<repo>/`, quay lại Google Cloud Console
thêm chính xác origin `https://<username>.github.io` vào Authorized JavaScript origins
(GIS chỉ kiểm tra origin, không kiểm tra path `/repo/`).

## 4. Sử dụng Gemini API Key

Người vận hành tự vào https://aistudio.google.com/app/apikey tạo key miễn phí, dán vào
nút **⚙ CÀI ĐẶT** trên dashboard. Key lưu ở `localStorage` trình duyệt đó — mỗi máy/mỗi
người dùng cần tự nhập key riêng.

## 5. Cấu trúc dữ liệu CSV kỳ vọng

Header (không phân biệt hoa/thường, khoảng trắng sẽ bị loại bỏ khi parse):

```
Ngay, Gio, Pkwh, A, plategap, vibration, acceleration, dsfspeed, dsfflow,
suppressure, digesterp, refinerp, presteamtemp, cookingtime, chipmoisture,
fibermoisture, acacia, pine, mixwood, class1, quality
```

- `Ngay`: hỗ trợ định dạng `dd/mm/yyyy`, `yyyy-mm-dd`.
- `Gio`: hỗ trợ `HH:mm:ss`, `HH:mm`, hoặc chỉ giờ nguyên (`14` → `14:00:00`).
- Muốn đổi tên cột / thêm bớt tag: sửa mảng `TAG_DEFINITIONS` trong `js/config.js`.

## 6. Giới hạn đã biết (do kiến trúc client-side)

- Token Google hết hạn sau ~1 giờ, refresh trang phải đăng nhập lại (không lưu refresh token
  ở client vì lý do bảo mật).
- Gemini API Key nằm trong localStorage — không phù hợp nếu máy dùng chung nhiều người
  mà không tin tưởng lẫn nhau.
- File Excel `.xlsx/.xls` chỉ đọc sheet đầu tiên.
- OAuth Consent Screen ở trạng thái "Testing" giới hạn 100 tài khoản test user và Google
  có thể yêu cầu đăng nhập lại sau 7 ngày — chuyển sang "Production" nếu cần dùng ổn định lâu dài.
