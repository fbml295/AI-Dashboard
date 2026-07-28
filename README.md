# AI-Dashboard — Industrial SCADA Trend Monitor

Dashboard giám sát dữ liệu vận hành refiner (nghiền bột giấy), 100% chạy client-side,
host tĩnh trên GitHub Pages, không cần backend.

## 1. Cấu hình trước khi deploy

Mở `js/config.js` và điền 2 giá trị:

```js
GOOGLE_CLIENT_ID: 'xxxxx.apps.googleusercontent.com',  // Từ Google Cloud Console
DRIVE_FOLDER_ID: 'xxxxxxxxxxxxxxxxxxxxxxxxx',            // ID folder "AI-Dashboard" trên Drive
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
git commit -m "Initial commit: AI-Dashboard dashboard"
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

## 6. 🔮 Dự đoán & Mô phỏng (mô hình tự học — tách biệt hoàn toàn với Gemini)

Nút **"🔮 DỰ ĐOÁN"** (cạnh nút "PHÂN TÍCH AI") mở panel chứa 1 mô hình **hồi quy tuyến tính
(Ridge Regression)** chạy 100% trong trình duyệt — không gọi API, không tốn phí, không gửi
dữ liệu ra ngoài:

- **Tự động huấn luyện lại** từ toàn bộ dữ liệu mỗi khi bạn mở file mới hoặc khi auto-refresh
  tải dữ liệu mới — đúng yêu cầu "mô hình cần liên tục học" vì dữ liệu vận hành thay đổi liên tục.
- **Phần 1 — So sánh dự đoán vs thực tế**: đối chiếu Phân loại/Chất lượng model dự đoán so với
  giá trị đo thật gần nhất, kèm độ tin cậy R² (0-100%, màu xanh/vàng/đỏ theo mức TỐT/TRUNG BÌNH/THẤP).
- **Phần 2 — Mô phỏng what-if đa tag**: tick chọn 1 hoặc NHIỀU tag cùng lúc, nhập giá trị giả định,
  mô hình tính ngay kết quả Phân loại/Chất lượng mới (các tag không chọn giữ nguyên giá trị mới nhất).
- **Phần 3 — Khuyến nghị đóng/nhả đĩa**: tự động hiển thị ngay khi mở panel (mục tiêu mặc định =
  Chất lượng 5.0, có thể đổi) — mô hình **giải ngược phương trình tuyến tính** ra chính xác giá trị
  `plategap` cần thiết, kết luận rõ ĐÓNG ĐĨA / NHẢ ĐĨA / GIỮ NGUYÊN kèm số mm cụ thể.

Yêu cầu tối thiểu **30 dòng dữ liệu hợp lệ** (đủ cả feature lẫn Phân loại/Chất lượng) để huấn luyện;
ít hơn sẽ báo "chưa đủ dữ liệu" thay vì đưa ra kết quả không đáng tin cậy.

⚠️ Đây là mô hình thống kê tuyến tính đơn giản (không phải deep learning), phù hợp để tham khảo
xu hướng và ra quyết định nhanh, nhưng **không thay thế đánh giá kỹ thuật của kỹ sư vận hành**,
đặc biệt khi ngoại suy ra ngoài phạm vi dữ liệu lịch sử (panel sẽ tự cảnh báo trường hợp này).

## 7. Ô KPI "Phân loại" & "Chỉ số chất lượng"

Hai ô này nằm giữa thanh công cụ (giữa nút "Chuẩn hoá" và "Phân tích AI"):

- **Phân loại (Class 1)**: hiển thị giá trị cột `class1`, đơn vị `%`.
- **Chỉ số chất lượng**: hiển thị giá trị cột `quality` theo thang **0–10** (5 là đạt chuẩn,
  0 là quá thô, 10 là quá mịn). Ngưỡng đánh giá (QUÁ THÔ / ĐẠT / QUÁ MỊN) cấu hình ở
  `QUALITY_BANDS` trong `js/config.js`.
- Mặc định hiển thị **giá trị dòng cuối cùng** trong file đang mở. Khi bạn di chuột lên
  biểu đồ, 2 ô này tự động đổi sang giá trị tại đúng thời điểm đang hover; rời chuột khỏi
  biểu đồ sẽ quay lại giá trị mới nhất.

## 8. Tự động cập nhật dữ liệu từ Google Drive

Vào **⚙ Cài đặt** → mục "Chu kỳ tự động cập nhật dữ liệu (phút)" để đặt chu kỳ (mặc định 5 phút,
đặt `0` để tắt). Hệ thống chỉ tự tải lại khi:
- Đang có người đăng nhập Google, **và**
- Đang có 1 file được mở trên dashboard.

Nếu không ai mở web / chưa đăng nhập, không có request nào được gửi đi (tiết kiệm quota Drive API).
Giá trị chu kỳ lưu ở `localStorage`, áp dụng ngay không cần tải lại trang.

## 9. Lưu ý khi cập nhật file (tránh lỗi cache trình duyệt)

Các thẻ `<script>`/`<link>` trong `index.html` có query string `?v=4` ở cuối (vd `js/app.js?v=4`).
Đây là kỹ thuật **cache-busting**: mỗi khi bạn sửa bất kỳ file JS/CSS nào và deploy lại, hãy tăng
số version này lên (`?v=4`, `?v=5`, ...) trong `index.html` để buộc trình duyệt tải bản mới thay vì
dùng bản cache cũ. Nếu quên bước này, có thể xảy ra tình trạng HTML mới nhưng JS cũ (hoặc ngược lại)
được tải cùng lúc, gây lỗi kiểu `Cannot set properties of null` do 2 bản không khớp ID phần tử.

Cách nhanh nhất khi nghi ngờ dính cache: **hard refresh** (`Ctrl/Cmd + Shift + R`) hoặc mở bằng
cửa sổ ẩn danh.

## 10. Giới hạn đã biết (do kiến trúc client-side)

- Token Google hết hạn sau ~1 giờ, refresh trang phải đăng nhập lại (không lưu refresh token
  ở client vì lý do bảo mật).
- Gemini API Key nằm trong localStorage — không phù hợp nếu máy dùng chung nhiều người
  mà không tin tưởng lẫn nhau.
- File Excel `.xlsx/.xls` chỉ đọc sheet đầu tiên.
- OAuth Consent Screen ở trạng thái "Testing" giới hạn 100 tài khoản test user và Google
  có thể yêu cầu đăng nhập lại sau 7 ngày — chuyển sang "Production" nếu cần dùng ổn định lâu dài.
