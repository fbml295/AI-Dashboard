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
   * Model Gemini đang dùng - ưu tiên model người dùng đã chọn (sau khi kiểm
   * tra key ở Cài đặt), nếu chưa chọn thì dùng mặc định trong config.js.
   */
  function getSelectedModel() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_MODEL) || APP_CONFIG.GEMINI_MODEL;
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getSelectedModel()}:generateContent?key=${apiKey}`;

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

  /**
   * Định nghĩa "công cụ" (tool) cho Gemini Function Calling — Gemini sẽ TỰ QUYẾT
   * ĐỊNH gọi hàm này khi câu hỏi cần số liệu cụ thể trong 1 khoảng thời gian,
   * thay vì tự đoán/bịa số. Kết quả hàm do CHÍNH CODE của chúng ta tính toán
   * (chính xác tuyệt đối từ dữ liệu thật), Gemini chỉ diễn giải lại bằng lời.
   */
  function buildQueryTool() {
    const numericTags = TAG_DEFINITIONS.filter(t => t.type === 'numeric');
    const enumList = numericTags.map(t => t.key);
    const descLines = numericTags.map(t => `${t.key}: ${t.label} (${t.unit || 'không đơn vị'})`).join('\n');

    return {
      functionDeclarations: [{
        name: 'query_tag_data',
        description:
          'Truy vấn dữ liệu cảm biến THỰC TẾ đã ghi nhận trong 1 khoảng thời gian cụ thể cho 1 hoặc nhiều tag, ' +
          'trả về số liệu CHÍNH XÁC (giá trị đầu kỳ, cuối kỳ, mức thay đổi, min, max, trung bình). ' +
          'LUÔN gọi hàm này khi người dùng hỏi về giá trị, xu hướng, hoặc mức thay đổi của bất kỳ thông số nào ' +
          'trong 1 khoảng thời gian - KHÔNG được tự đoán hoặc suy diễn số liệu khi chưa gọi hàm.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tagKeys: {
              type: 'ARRAY',
              items: { type: 'STRING', enum: enumList },
              description: `Danh sách khoá tag cần tra cứu (có thể chọn nhiều). Các tag hợp lệ:\n${descLines}`,
            },
            fromDate: { type: 'STRING', description: 'Ngày bắt đầu, định dạng YYYY-MM-DD' },
            toDate: { type: 'STRING', description: 'Ngày kết thúc (bao gồm cả ngày này), định dạng YYYY-MM-DD' },
          },
          required: ['tagKeys', 'fromDate', 'toDate'],
        },
      }],
    };
  }

  /**
   * Hỏi-đáp tự do dựa trên dữ liệu thật, dùng Gemini Function Calling.
   *
   * question : câu hỏi tiếng Việt tự nhiên của người dùng
   * history  : mảng contents [{role, parts}] của cuộc hội thoại trước đó (rỗng nếu mới bắt đầu)
   * queryFn  : hàm (tagKeys, fromDate, toDate) => object kết quả - do app.js cung cấp,
   *            THỰC SỰ đọc và tính toán trên state.dataset (không đi qua Gemini)
   * meta     : { timeRangeLabel } - khung thời gian dữ liệu hiện có, cho Gemini biết phạm vi hợp lệ
   *
   * Trả về { text, history } - history đã cập nhật để dùng cho câu hỏi tiếp theo (hội thoại nhiều lượt).
   */
  async function askQuestion(question, history, queryFn, meta = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình Gemini API Key. Vào Cài đặt để nhập key.');
    }

    const contents = [...(history || [])];

    if (contents.length === 0) {
      const systemPreamble =
        `Bạn là trợ lý phân tích dữ liệu vận hành máy nghiền bột giấy (refiner). Người dùng sẽ hỏi bằng tiếng Việt ` +
        `về dữ liệu lịch sử đã ghi nhận (khung thời gian dữ liệu hiện có: ${meta.timeRangeLabel || 'không rõ'}). ` +
        `Khi câu hỏi liên quan tới giá trị, xu hướng, hoặc mức thay đổi của bất kỳ thông số nào trong 1 khoảng ` +
        `thời gian, LUÔN gọi hàm query_tag_data để lấy số liệu chính xác trước khi trả lời - KHÔNG được tự đoán ` +
        `hoặc bịa số liệu. Trả lời ngắn gọn, rõ ràng bằng tiếng Việt, nêu đúng con số lấy được từ hàm, kèm đơn vị.`;
      contents.push({ role: 'user', parts: [{ text: systemPreamble }] });
      contents.push({ role: 'model', parts: [{ text: 'Đã hiểu, tôi sẽ luôn tra cứu số liệu thật trước khi trả lời.' }] });
    }

    contents.push({ role: 'user', parts: [{ text: question }] });

    const tools = [buildQueryTool()];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getSelectedModel()}:generateContent?key=${apiKey}`;

    let finalText = null;
    let rounds = 0;

    while (finalText === null && rounds < 4) {
      rounds++;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          tools,
          generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
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
      const parts = candidate?.content?.parts || [];
      const functionCallPart = parts.find(p => p.functionCall);

      if (functionCallPart) {
        const { name, args } = functionCallPart.functionCall;
        contents.push({ role: 'model', parts: [{ functionCall: { name, args } }] });

        const functionResult = (name === 'query_tag_data')
          ? queryFn(args.tagKeys || [], args.fromDate, args.toDate)
          : { error: `Hàm "${name}" không được hỗ trợ.` };

        // Lưu ý: API báo role "function" không hợp lệ với model đang dùng - dùng "user"
        // (nằm trong danh sách role hợp lệ) để gửi kết quả hàm, đây là cách phổ biến
        // với các model/phiên bản API không hỗ trợ role "function" riêng.
        contents.push({ role: 'user', parts: [{ functionResponse: { name, response: functionResult } }] });
        // Vòng lặp tiếp tục -> gọi lại generateContent, lần này Gemini đã có kết quả hàm để trả lời
      } else {
        finalText = parts.map(p => p.text).filter(Boolean).join('\n') || '(Không có phản hồi từ AI)';
        contents.push({ role: 'model', parts: [{ text: finalText }] });
      }
    }

    if (finalText === null) {
      finalText = 'AI không thể hoàn tất câu trả lời (quá nhiều bước tra cứu). Vui lòng hỏi cụ thể hơn.';
    }

    return { text: finalText, history: contents };
  }

  return { hasApiKey, analyzeOperational, getSelectedModel, askQuestion };
})();

window.GeminiModule = GeminiModule;
