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

  function buildPrompt(summary, meta) {
    const tagLines = Object.entries(summary).map(([key, s]) => {
      return `- ${s.label} (${s.unit || 'không đơn vị'}): min=${s.stats.min}, max=${s.stats.max}, ` +
        `trung bình=${s.stats.mean}, độ lệch chuẩn=${s.stats.std}, số điểm=${s.stats.count}. ` +
        `Mẫu dữ liệu theo thời gian (đã lấy mẫu đại diện): ${JSON.stringify(s.sample.slice(0, 30))}${s.sample.length > 30 ? ' ...(còn nữa)' : ''}`;
    }).join('\n');

    return `Bạn là kỹ sư quy trình (process engineer) chuyên về công đoạn nghiền bột giấy cơ học (mechanical/chemi-thermo-mechanical pulping - refiner). Hãy đóng vai chuyên gia phân tích dữ liệu vận hành SCADA.

Dữ liệu các tín hiệu đang được kỹ sư vận hành theo dõi trên dashboard (khung thời gian: ${meta.timeRangeLabel || 'không xác định'}):

${tagLines}

Yêu cầu phân tích:
1. Đánh giá tổng quan hiệu suất vận hành dựa trên các chỉ số trên (ổn định / bất thường / cần chú ý điểm nào).
2. Nếu phát hiện tương quan đáng ngờ giữa các tín hiệu (vd độ rung tăng cùng lúc plate gap giảm, hoặc nhiệt độ hơi bất thường ảnh hưởng tới quality), hãy nêu rõ.
3. Đưa ra chẩn đoán khả năng gốc rễ vấn đề (root cause) nếu có dấu hiệu bất thường, và mức độ ưu tiên xử lý (Thấp/Trung bình/Cao/Khẩn cấp).
4. Đề xuất hành động cụ thể cho kỹ sư vận hành (kiểm tra thiết bị nào, thông số nào cần điều chỉnh).
5. Trả lời bằng tiếng Việt, ngắn gọn, dùng gạch đầu dòng, giọng văn kỹ thuật chuyên nghiệp như báo cáo ca trực.`;
  }

  async function analyze(summary, meta = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình Gemini API Key. Vào Cài đặt để nhập key.');
    }
    if (!summary || Object.keys(summary).length === 0) {
      throw new Error('Chưa có tín hiệu nào được chọn để phân tích.');
    }

    const prompt = buildPrompt(summary, meta);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${APP_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
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
    const text = candidate?.content?.parts?.map(p => p.text).join('\n') || '(Không có phản hồi từ AI)';
    return text;
  }

  return { hasApiKey, analyze };
})();

window.GeminiModule = GeminiModule;
