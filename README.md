# AI-Dashboard — Industrial SCADA Realtime Monitor

Dashboard giám sát dữ liệu vận hành refiner (nghiền bột giấy), 100% chạy client-side,
host tĩnh trên GitHub Pages, không cần backend. Dữ liệu đổ về **realtime** từ
Firebase Realtime Database, do 1 gateway (script PowerShell) chạy trên máy tính tại
xưởng liên tục đẩy lên từ file CSV cục bộ.

## Kiến trúc tổng quan

```
[Máy đo/PLC] → MayNghien.csv → [Gateway PowerShell] → Firebase Realtime Database
                                                              │
                                              (Security Rules kiểm tra quyền)
                                                              │
                                                              ▼
                                              [Web Dashboard - GitHub Pages]
                                       (đăng nhập Google qua Firebase Auth,
                                        chỉ tài khoản trong "allowedUsers" đọc được)
```

## 1. Cấu hình trước khi deploy

Mở `js/config.js`, điền `FIREBASE_CONFIG` (lấy ở Firebase Console → Project settings →
General → Your apps → Config) — đây là thông tin **public**, an toàn để commit lên repo public:

```js
FIREBASE_CONFIG: {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  databaseURL: "https://...firebasedatabase.app",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
},
FIREBASE_DATA_PATH: 'scada_data',   // node gốc chứa dữ liệu trên Realtime Database
```

⚠️ **KHÔNG BAO GIỜ** đưa "Database Secret" (chuỗi dài dùng trong gateway PowerShell) vào code
web. Secret đó chỉ dùng trong script gateway chạy riêng trên máy tính tại xưởng.

## 2. Thiết lập Firebase (làm 1 lần)

### 2.1 — Bật Google Sign-In
Console → **Authentication** → **Sign-in method** → **Google** → **Enable**.

### 2.2 — Security Rules (Console → Realtime Database → tab Rules)
```json
{
  "rules": {
    "allowedUsers": {
      ".read": false,
      ".write": false
    },
    "scada_data": {
      ".read": "auth != null && root.child('allowedUsers').child(auth.token.email.replace('.', ',')).val() === true",
      ".write": false
    }
  }
}
```
`.write: false` chặn mọi ghi/sửa từ trình duyệt — việc ghi dữ liệu chỉ do gateway PowerShell
đảm nhiệm (dùng Database Secret, secret này **bỏ qua** Security Rules theo thiết kế của Firebase
nên vẫn ghi được dù rule chặn `.write` từ web).

### 2.3 — Cấp quyền cho tài khoản Google
Console → Realtime Database → tab Data → menu **⋮** → **Import JSON**:
```json
{ "allowedUsers": { "email_cua_ban@gmail,com": true } }
```
Lưu ý: dấu `.` trong email phải đổi thành `,` (Firebase không cho phép `.` trong key).
Muốn thêm/bớt người dùng chỉ cần sửa node này trên Console, không cần sửa code/deploy lại.

## 3. Gateway đẩy dữ liệu (chạy trên máy tính tại xưởng)

Dùng script `gateway_clean.ps1` — cơ chế "Store and Forward": quét file CSV mỗi 5 giây
(chỉnh được ở dòng `Start-Sleep -Seconds 5`), chỉ gửi phần dòng MỚI (dựa vào `bookmark.txt`),
dùng Database Secret qua `?auth=` để ghi thẳng vào `scada_data` (secret này chỉ nằm trên máy
tính tại xưởng, không bao giờ xuất hiện trong code web công khai).

**Để chạy tự động, liên tục kể cả khi không ai đăng nhập Windows**: thiết lập qua
**Task Scheduler** → Create Task → Trigger "At startup" → Action chạy
`powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "đường-dẫn\gateway_clean.ps1"`
→ tab Settings bật "Restart on failure" để tự phục hồi nếu gateway bị lỗi.

## 4. Chạy thử local & Deploy GitHub Pages

```bash
cd industrial-dashboard
python3 -m http.server 5500
# mở http://localhost:5500
```

Deploy:
```bash
git init && git add . && git commit -m "Init"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```
Bật **Settings → Pages** → Source: branch `main`, `/ (root)`.

⚠️ Vào Firebase Console → Authentication → Settings → **Authorized domains** → thêm
`<username>.github.io` (Firebase Auth cần domain được khai báo mới cho phép popup đăng nhập).

## 5. Sử dụng Gemini API Key

Vào https://aistudio.google.com/app/apikey tạo key miễn phí, dán vào nút **⚙ CÀI ĐẶT**.
Key lưu ở `localStorage` trình duyệt — mỗi máy/mỗi người dùng tự nhập key riêng.

## 6. Cấu trúc dữ liệu Firebase kỳ vọng (`scada_data`)

Mỗi bản ghi con dưới `scada_data` là 1 object phẳng, field name giữ nguyên như CSV gốc
(không phân biệt hoa/thường khi đọc):

```
Ngay, Gio, Pkwh, A, plategap, vibration, acceleration, dsfspeed, dsfflow,
suppressure, digesterp, refinerp, presteamtemp, cookingtime, chipmoisture,
fibermoisture, acacia, pine, mixwood, class1, quality
```

- `Ngay`+`Gio` được ghép thành 1 timestamp; hỗ trợ `dd-mm-yyyy`, `yyyy-mm-dd`, giờ 24h
  hoặc 12h AM/PM (`10:00:42 AM`).
- **Key của mỗi bản ghi trên Firebase KHÔNG phải thời gian cảm biến** (là thời điểm gateway
  ghi lên) — web luôn tự sắp xếp lại theo đúng `Ngay`+`Gio` thực tế, không dựa theo thứ tự key.
- Muốn đổi tên cột/thêm bớt tag: sửa mảng `TAG_DEFINITIONS` trong `js/config.js`.

## 7. 🔮 Dự đoán & Mô phỏng (mô hình tự học — tách biệt hoàn toàn với Gemini)

Nút **"🔮 DỰ ĐOÁN"** mở panel chứa 1 mô hình **hồi quy tuyến tính (Ridge Regression)** chạy
100% trong trình duyệt — không gọi API, không tốn phí:

- **Tự động huấn luyện lại mỗi khi Firebase đẩy dữ liệu mới về** (không cần thao tác gì) —
  đúng yêu cầu "mô hình liên tục học" vì dữ liệu vận hành thay đổi liên tục.
- **Phần 1**: so sánh Phân loại/Chất lượng model dự đoán vs giá trị mới nhất, kèm độ tin cậy R².
- **Phần 2**: mô phỏng what-if — tick chọn NHIỀU tag cùng lúc, xem kết quả dự đoán ngay.
- **Phần 3**: tự động hiện khuyến nghị ĐÓNG ĐĨA/NHẢ ĐĨA/GIỮ NGUYÊN (mục tiêu mặc định
  Chất lượng = 5.0, giải ngược phương trình ra chính xác giá trị `plategap` cần thiết).

Yêu cầu tối thiểu **30 bản ghi hợp lệ** để huấn luyện. Đây là mô hình thống kê tuyến tính đơn
giản, hỗ trợ ra quyết định nhanh nhưng **không thay thế đánh giá kỹ thuật của kỹ sư vận hành**.

## 8. Ô KPI "Phân loại" & "Chỉ số chất lượng"

Nằm giữa thanh công cụ. Mặc định hiển thị giá trị mới nhất; hover lên biểu đồ để xem giá trị
tại đúng thời điểm đó. Ngưỡng đánh giá Chất lượng (QUÁ THÔ/ĐẠT/QUÁ MỊN) cấu hình ở
`QUALITY_BANDS` trong `js/config.js`.

## 9. Lưu ý khi cập nhật file (tránh lỗi cache trình duyệt)

Các thẻ `<script>`/`<link>` trong `index.html` có query string `?v=5`. Mỗi khi sửa file
JS/CSS và deploy lại, tăng số version này lên để buộc trình duyệt tải bản mới, tránh tình
trạng HTML mới - JS cũ lẫn lộn gây lỗi `Cannot set properties of null`. Nếu nghi ngờ dính
cache: **hard refresh** (`Ctrl/Cmd + Shift + R`).

## 10. Giới hạn đã biết

- Gemini API Key nằm trong `localStorage` — không phù hợp nếu máy dùng chung nhiều người
  không tin tưởng lẫn nhau.
- `scada_data` sẽ phình to vô hạn theo thời gian vì gateway liên tục ghi thêm (không tự xoá
  dữ liệu cũ) — cần cân nhắc chiến lược lưu trữ lâu dài (archive sang nơi khác định kỳ) nếu
  chạy nhiều tháng/năm, tránh vượt quota băng thông của gói Firebase đang dùng.
- Vì "Phân loại"/"Chất lượng" chỉ được nhập sau khi đo phòng thí nghiệm (không phải mỗi dòng
  cảm biến đều có), số bản ghi thực sự dùng để huấn luyện mô hình dự đoán có thể ít hơn nhiều
  so với tổng số bản ghi cảm biến — theo dõi chỉ số R² trong panel Dự đoán để biết độ tin cậy.
