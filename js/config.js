/**
 * config.js
 * -----------------------------------------------------------------------
 * TOÀN BỘ giá trị cấu hình của dashboard nằm ở đây.
 * Đây là NƠI DUY NHẤT bạn cần sửa khi deploy lên GitHub Pages của riêng bạn.
 * -----------------------------------------------------------------------
 */

const APP_CONFIG = {
  // Lấy từ Google Cloud Console > APIs & Services > Credentials > OAuth Client ID
  // Đây là Client ID public, KHÔNG phải Client Secret -> an toàn để commit lên repo public.
  GOOGLE_CLIENT_ID: '468592081191-tm93okutphcafti4ilee8m1r5u2lp2jj.apps.googleusercontent.com',

  // ID của folder Google Drive "refiner_AI" đã chia sẻ.
  // Cách lấy: mở folder trên Drive -> copy đoạn cuối URL:
  // https://drive.google.com/drive/folders/<FOLDER_ID_NAM_O_DAY>
  DRIVE_FOLDER_ID: '14XsG0Ke6-ayyZxshVEF790S92rPEBkIh',

  // Quyền yêu cầu: chỉ đọc, không sửa/xoá file trên Drive của người dùng.
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',

  // Model Gemini dùng cho phân tích. Có thể đổi sang bản khác nếu Google cập nhật.
  GEMINI_MODEL: 'gemini-3-flash-preview',

  // Ngưỡng số điểm dữ liệu / series trước khi kích hoạt LTTB downsampling.
  DOWNSAMPLE_THRESHOLD: 2000,

  // Key lưu trong localStorage
  STORAGE_KEYS: {
    GEMINI_API_KEY: 'refinerAI_geminiApiKey',
  },
};

/**
 * Mô tả toàn bộ 21 cột dữ liệu (theo đúng file CSV nguồn của bạn).
 * key       : đúng tên cột trong CSV (không phân biệt hoa/thường khi parse)
 * label     : tên hiển thị tiếng Việt trên UI
 * unit      : đơn vị hiển thị trên trục Y / tooltip
 * group     : dùng để nhóm tag trên panel bên trái
 * type      : 'timestamp' | 'numeric' | 'categorical'
 * color     : màu neon cố định cho tag đó trên biểu đồ (để dễ nhận diện khi bật/tắt nhiều tag)
 */
const TAG_DEFINITIONS = [
  { key: 'ngay',          label: 'Ngày',              unit: '',      group: '__timestamp__', type: 'timestamp' },
  { key: 'gio',           label: 'Giờ',               unit: '',      group: '__timestamp__', type: 'timestamp' },

  { key: 'pkwh',          label: 'Công suất tiêu thụ', unit: 'kWh',   group: 'Điện - Cơ khí', type: 'numeric', color: '#00e5ff' },
  { key: 'a',             label: 'Dòng điện',          unit: 'A',     group: 'Điện - Cơ khí', type: 'numeric', color: '#33ffd6' },
  { key: 'plategap',      label: 'Khe hở đĩa nghiền',  unit: 'mm',    group: 'Điện - Cơ khí', type: 'numeric', color: '#7cf5ff' },
  { key: 'vibration',     label: 'Độ rung',            unit: 'mm/s',  group: 'Điện - Cơ khí', type: 'numeric', color: '#ffcc00' },
  { key: 'acceleration',  label: 'Gia tốc rung',       unit: 'g',     group: 'Điện - Cơ khí', type: 'numeric', color: '#ff9f1c' },
  { key: 'dsfspeed',      label: 'Tốc độ DSF',         unit: 'rpm',   group: 'Điện - Cơ khí', type: 'numeric', color: '#c792ea' },
  { key: 'dsfflow',       label: 'Lưu lượng DSF',      unit: 'm³/h',  group: 'Điện - Cơ khí', type: 'numeric', color: '#82aaff' },

  { key: 'suppressure',   label: 'Áp suất Suppressure', unit: 'kPa',  group: 'Áp suất - Nhiệt', type: 'numeric', color: '#ff5370' },
  { key: 'digesterp',     label: 'Áp suất Digester',    unit: 'kPa',  group: 'Áp suất - Nhiệt', type: 'numeric', color: '#ff8a80' },
  { key: 'refinerp',      label: 'Áp suất Refiner',     unit: 'kPa',  group: 'Áp suất - Nhiệt', type: 'numeric', color: '#ff3b5c' },
  { key: 'presteamtemp',  label: 'Nhiệt độ hơi sơ bộ', unit: '°C',    group: 'Áp suất - Nhiệt', type: 'numeric', color: '#ffab40' },
  { key: 'cookingtime',   label: 'Thời gian nấu',       unit: 'phút', group: 'Áp suất - Nhiệt', type: 'numeric', color: '#ffd740' },

  { key: 'chipmoisture',  label: 'Độ ẩm dăm gỗ',       unit: '%',     group: 'Nguyên liệu', type: 'numeric', color: '#69f0ae' },
  { key: 'fibermoisture', label: 'Độ ẩm xơ sợi',       unit: '%',     group: 'Nguyên liệu', type: 'numeric', color: '#00e676' },
  { key: 'acacia',        label: 'Tỷ lệ gỗ Keo (Acacia)', unit: '%',  group: 'Nguyên liệu', type: 'numeric', color: '#b2ff59' },
  { key: 'pine',          label: 'Tỷ lệ gỗ Thông (Pine)', unit: '%',  group: 'Nguyên liệu', type: 'numeric', color: '#ccff90' },
  { key: 'mixwood',       label: 'Tỷ lệ gỗ hỗn hợp',   unit: '%',     group: 'Nguyên liệu', type: 'numeric', color: '#eeff41' },

  { key: 'class1',        label: 'Phân loại (Class 1)', unit: '',     group: 'Chất lượng', type: 'categorical', color: '#40c4ff' },
  { key: 'quality',       label: 'Chỉ số chất lượng',   unit: '',     group: 'Chất lượng', type: 'numeric', color: '#00e5ff' },
];

// Danh sách nhóm theo đúng thứ tự hiển thị mong muốn
const TAG_GROUP_ORDER = ['Điện - Cơ khí', 'Áp suất - Nhiệt', 'Nguyên liệu', 'Chất lượng'];
