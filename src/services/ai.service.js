const OpenAI = require("openai");

const openAIClient = new OpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  timeout: 60_000,
  maxRetries: 2,
});

class AIService {
  /**
   * Gửi messages đến AI Gateway.
   *
   * Mặc định trả về nội dung text.
   * Nếu stream=true, trả về stream để caller tự xử lý.
   */
  async completions(messages, model, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages phải là một mảng không rỗng.");
    }

    if (!model || typeof model !== "string") {
      throw new Error("AI model chưa được cấu hình hợp lệ.");
    }

    const { stream = false, ...requestOptions } = options;

    let response;

    try {
      response = await openAIClient.chat.completions.create({
        ...requestOptions,
        model,
        messages,
        stream,
      });
    } catch (error) {
      console.error("AI Gateway request failed:", {
        status: error.status,
        code: error.code,
        message: error.message,
      });

      if (error.status === 401 || error.status === 403) {
        throw new Error(
          "AI Gateway từ chối truy cập. Hãy kiểm tra API key, quyền truy cập và model.",
        );
      }

      if (error.status === 429) {
        throw new Error(
          "AI Gateway đang giới hạn yêu cầu hoặc đã hết quota. Vui lòng thử lại sau.",
        );
      }

      if (error.status >= 500) {
        throw new Error(
          "Dịch vụ AI Gateway đang gặp sự cố. Vui lòng thử lại sau.",
        );
      }

      throw new Error(`Không thể gọi AI Gateway: ${error.message}`);
    }

    if (stream) {
      return response;
    }

    const content = response?.choices?.[0]?.message?.content;

    let text = "";

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(
          (item) => item?.type === "text" && typeof item.text === "string",
        )
        .map((item) => item.text)
        .join("\n");
    }

    if (!text.trim()) {
      console.error("AI Gateway trả về nội dung rỗng:", {
        model,
        finishReason: response?.choices?.[0]?.finish_reason,
      });

      throw new Error("AI không trả về nội dung hợp lệ.");
    }

    return text.trim();
  }
}

module.exports = new AIService();
