/**
 * gemini.js
 * -----------------------------------------------------------------------
 * Gọi trực tiếp Gemini REST API (generateContent) từ trình duyệt bằng
 * fetch(). API Key được đọc từ localStorage (xem settings.js), KHÔNG bao
 * giờ gửi đi đâu khác ngoài endpoint chính thức của Google.
 */

const GeminiModule = (() => {
  function getApiKey() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_API_KEY) || '';
  }

  function hasApiKey() {
    return getApiKey().trim().length > 0;
  }

  /**
   * Định dạng 1 dòng mô tả tag: tên, đơn vị, thống kê, xu hướng đầu-cuối file.
   */
  function formatTagLine(s, opts = {}) {
    const trendText = s.trend.direction === 'không đủ dữ liệu'
      ? 'không đủ dữ liệu để tính xu hướng'
      : `${s.trend.direction} ${Math.abs(s.trend.deltaPct)}% (từ ${s.trend.firstAvg} lúc đầu file lên/xuống ${s.trend.lastAvg} lúc cuối file)`;

    let line = `- ${s.label} (${s.unit || 'không đơn vị'}): giá trị mới nhất=${s.latest}, xu hướng ${trendText}, ` +
      `min=${s.stats.min}, max=${s.stats.max}, trung bình=${s.stats.mean}, độ lệch chuẩn=${s.stats.std}, số điểm=${s.stats.count}.`;

    if (opts.includeSample) {
      line += ` Mẫu dữ liệu theo thời gian (đã lấy mẫu đại diện): ${JSON.stringify(s.sample.slice(0, 30))}${s.sample.length > 30 ? ' ...(còn nữa)' : ''}`;
    }
    return line;
  }

  /**
   * Prompt đề xuất vận hành đĩa nghiền: dùng toàn bộ tag quá trình (loại trừ
   * class1/quality) làm căn cứ kỹ thuật, class1 + quality làm mục tiêu tham
   * chiếu, yêu cầu Gemini kết luận ĐÓNG ĐĨA / NHẢ ĐĨA / GIỮ NGUYÊN.
   */
  function buildOperationalPrompt(processSummary, referenceSummary, meta) {
    const processLines = Object.values(processSummary)
      .map(s => formatTagLine(s, { includeSample: false }))
      .join('\n');

    const refLines = Object.values(referenceSummary)
      .map(s => formatTagLine(s, { includeSample: true }))
      .join('\n');

    return `Bạn là kỹ sư quy trình (process engineer) chuyên vận hành máy nghiền bột giấy cơ học (refiner) trong dây chuyền sản xuất bột giấy.

BỐI CẢNH VẬN HÀNH (kiến thức nền để bạn lập luận, không phải dữ liệu đo):
- "Phân loại (Class 1)" là % tỷ lệ xơ sợi đạt chuẩn / độ mịn, đo bằng máy thí nghiệm.
- "Chỉ số chất lượng" là thang điểm 0-10 do người vận hành đánh giá: 0 = xơ sợi QUÁ THÔ (nghiền chưa đủ), 5 = ĐẠT chuẩn, 10 = xơ sợi QUÁ MỊN (nghiền quá mức, tốn năng lượng, có thể làm hỏng cấu trúc xơ).
- Nguyên lý điều khiển: ĐÓNG ĐĨA (giảm khe hở đĩa nghiền - "plategap") làm tăng cường độ cắt xé cơ học lên dăm/xơ gỗ -> xơ sợi mịn hơn -> chỉ số chất lượng và class1 có xu hướng tăng, nhưng đồng thời làm tăng công suất tiêu thụ (Pkwh, A), áp suất refiner, độ rung/gia tốc rung, nhiệt độ. NHẢ ĐĨA (tăng khe hở) làm giảm cường độ nghiền -> xơ sợi thô hơn -> chỉ số chất lượng giảm, nhưng giảm tải cho thiết bị (điện, rung, áp suất, nhiệt).
- Rủi ro nếu đóng đĩa quá mức: quá tải điện, rung bất thường, mòn/hỏng đĩa nghiền, tắc nghẽn dòng chảy.
- Rủi ro nếu nhả đĩa quá mức: sản phẩm không đạt chuẩn chất lượng, phải nghiền lại gây lãng phí năng lượng và nguyên liệu.

DỮ LIỆU CÁC THÔNG SỐ QUÁ TRÌNH (đo bằng cảm biến, toàn bộ giai đoạn ${meta.timeRangeLabel || 'không xác định'}) — đây là CĂN CỨ KỸ THUẬT để ra quyết định:
${processLines}

CHỈ SỐ THAM CHIẾU / MỤC TIÊU (Phân loại đo bằng máy thí nghiệm, Chất lượng do người vận hành đánh giá):
${refLines}

YÊU CẦU PHÂN TÍCH:
1. Đối chiếu xu hướng các thông số quá trình (đặc biệt: khe hở đĩa nghiền, độ rung, gia tốc rung, công suất/dòng điện, nhiệt độ hơi sơ bộ, độ ẩm dăm/xơ) với xu hướng của Phân loại (Class 1) và Chỉ số chất lượng.
2. Đưa ra KẾT LUẬN RÕ RÀNG ngay đầu câu trả lời (in đậm): nên **ĐÓNG ĐĨA** (giảm khe hở), **NHẢ ĐĨA** (tăng khe hở), hay **GIỮ NGUYÊN** khe hở đĩa nghiền hiện tại.
3. Giải thích căn cứ kỹ thuật dẫn tới kết luận trên — chỉ rõ tag nào đang biến động và biến động đó nói lên điều gì.
4. Nếu phát hiện dấu hiệu rủi ro vận hành đi kèm (rung bất thường, quá tải điện, áp suất/nhiệt độ bất thường), cảnh báo rõ và nêu mức độ ưu tiên xử lý (Thấp/Trung bình/Cao/Khẩn cấp).
5. Đề xuất hành động cụ thể tiếp theo cho kỹ sư vận hành (điều chỉnh thông số nào, theo dõi thêm tag nào).
6. Trả lời bằng tiếng Việt, giọng văn kỹ thuật chuyên nghiệp như báo cáo ca trực, dùng gạch đầu dòng, ngắn gọn súc tích.`;
  }

  async function callGemini(prompt) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình Gemini API Key. Vào Cài đặt để nhập key.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${APP_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1800 },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let msg = `Gemini API lỗi (${res.status})`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error && parsed.error.message) msg += `: ${parsed.error.message}`;
      } catch (_) { /* ignore parse error */ }
      throw new Error(msg);
    }

    const json = await res.json();
    const candidate = json.candidates && json.candidates[0];
    return candidate?.content?.parts?.map(p => p.text).join('\n') || '(Không có phản hồi từ AI)';
  }

  /**
   * Phân tích + đề xuất vận hành đĩa nghiền.
   * processSummary   : summary (từ ChartModule.getSummaryForAI) của TOÀN BỘ tag quá trình
   *                     (loại trừ class1/quality), dùng làm căn cứ kỹ thuật.
   * referenceSummary : summary của class1 + quality, dùng làm mục tiêu tham chiếu.
   */
  async function analyzeOperational(processSummary, referenceSummary, meta = {}) {
    if (!processSummary || Object.keys(processSummary).length === 0) {
      throw new Error('Chưa có dữ liệu quá trình để phân tích. Vui lòng chọn 1 file trước.');
    }
    const prompt = buildOperationalPrompt(processSummary, referenceSummary, meta);
    return callGemini(prompt);
  }

  return { hasApiKey, analyzeOperational };
})();

window.GeminiModule = GeminiModule;
