const { randomUUID } = require("node:crypto");
const prisma = require("../libs/prisma");
const aiService = require("./ai.service");
const agentActionSchema = require("../jsonSchema/agentActionSchema");
const agentTools = require("../utils/agentTools");
const { getOsInfo } = require("../utils/osInfo");
const pusher = require("../libs/pusher");

const AGENT_MODEL = "alibaba/qwen3.8-omni-flash";
const CHAT_HISTORY_LIMIT = 20;
const MAX_AGENT_STEPS = 30;

const MAX_STEPS_EXCEEDED_MESSAGE =
  "Phiên xử lý đã đạt giới hạn số bước cho phép nên tôi tạm dừng tại đây. Bạn thử rút gọn yêu cầu hoặc chia nhỏ tác vụ rồi hỏi lại từng phần nhé.";

const FALLBACK_MESSAGE =
  "Xin lỗi, tôi chưa thể xử lý yêu cầu này. Bạn vui lòng thử lại.";

const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }];

const ALLOWED_ACTIONS = new Set([
  "readFile",
  "writeFile",
  "exec",
  "search_web",
  "respond",
]);

/**
 * Chuyển nội dung JSON do AI trả về thành object.
 * Hỗ trợ JSON thông thường và JSON nằm trong code fence.
 */
function parseJsonResponse(rawContent) {
  if (typeof rawContent !== "string" || !rawContent.trim()) {
    throw new Error("AI trả về nội dung rỗng.");
  }

  const cleanedContent = rawContent
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleanedContent);
  } catch {
    throw new Error("AI trả về JSON không hợp lệ.");
  }
}

/**
 * Chuẩn hóa phản hồi AI về định dạng:
 * { action, params }
 *
 * Đồng thời hỗ trợ cấu trúc model hiện tại đôi khi trả về:
 * { thinking, respond }
 */
function normalizeAgentAction(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("AI trả về dữ liệu không hợp lệ.");
  }

  // Tương thích với cấu trúc { thinking, respond }.
  if (typeof result.action !== "string" && typeof result.respond === "string") {
    result = {
      action: "respond",
      params: {
        path: null,
        content: null,
        command: null,
        query: null,
        message: result.respond,
        thinking:
          typeof result.thinking === "string"
            ? result.thinking
            : "Trả lời trực tiếp người dùng.",
      },
    };
  }

  if (!ALLOWED_ACTIONS.has(result.action)) {
    throw new Error("AI trả về action không được hỗ trợ.");
  }

  if (
    !result.params ||
    typeof result.params !== "object" ||
    Array.isArray(result.params)
  ) {
    throw new Error("AI trả về dữ liệu thiếu params.");
  }

  const source = result.params;

  const nullableString = (value, fieldName) => {
    if (value == null) return null;

    if (typeof value !== "string") {
      throw new Error(`Tham số "${fieldName}" phải là chuỗi hoặc null.`);
    }

    return value;
  };

  const params = {
    path: nullableString(source.path, "path"),
    content: nullableString(source.content, "content"),
    command: nullableString(source.command, "command"),
    query: nullableString(source.query, "query"),
    message: nullableString(source.message, "message"),
    thinking: typeof source.thinking === "string" ? source.thinking.trim() : "",
  };

  if (result.action === "respond" && !params.message?.trim()) {
    throw new Error("AI chọn action respond nhưng không có message.");
  }

  return {
    action: result.action,
    params,
  };
}

class AgentMessageService {
  /**
   * Lấy lịch sử hội thoại hiển thị cho người dùng.
   * Các bản ghi thinking không được đưa ra giao diện.
   */
  async getMessages(user, limit = CHAT_HISTORY_LIMIT) {
    const safeLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || CHAT_HISTORY_LIMIT, 1),
      CHAT_HISTORY_LIMIT,
    );

    const messages = await prisma.agentMessage.findMany({
      where: {
        userId: user.id,
        thinking: false,
      },
      orderBy: NEWEST_FIRST,
      take: safeLimit,
    });

    return messages.reverse();
  }

  /**
   * Xử lý một tin nhắn:
   * 1. Tải lịch sử hội thoại.
   * 2. Lưu tin nhắn người dùng.
   * 3. Lặp qua các action.
   * 4. Lưu và trả về câu trả lời cuối cùng.
   */
  async chat(user, input, requestId) {
    if (!user?.id) {
      throw new Error("Không xác định được người dùng.");
    }

    if (typeof input !== "string" || !input.trim()) {
      throw new Error("Nội dung tin nhắn không được để trống.");
    }

    const normalizedInput = input.trim();
    const eventRequestId =
      typeof requestId === "string" && requestId.trim().length <= 128
        ? requestId.trim() || randomUUID()
        : randomUUID();

    const context = [
      {
        role: "system",
        content: this._systemPrompt(),
      },
      ...(await this._loadChatHistory(user.id)),
    ];

    const userMessage = {
      role: "user",
      content: normalizedInput,
    };

    context.push(userMessage);

    await this._insertMessage(user.id, userMessage);

    for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
      const { action, params } = await this._think(context);

      if (params.thinking) {
        await this._insertMessage(user.id, {
          role: "assistant",
          content: params.thinking,
          thinking: true,
        });

        await this._publishAgentEvent(user.id, "agent:thinking", {
          requestId: eventRequestId,
          step,
          thinking: params.thinking,
        });
      }

      if (action === "respond") {
        const answer = params.message.trim();

        await this._publishAgentEvent(user.id, "agent:complete", {
          requestId: eventRequestId,
        });

        return this._insertMessage(user.id, {
          role: "assistant",
          content: answer,
          thinking: false,
        });
      }

      const toolResult = await this._runTool(action, params);

      // Ghi nhận action và kết quả để model quyết định bước tiếp theo.
      context.push({
        role: "assistant",
        content: JSON.stringify({
          action,
          status: params.thinking,
        }),
      });

      context.push({
        role: "user",
        content: `Kết quả thực thi công cụ:\n${JSON.stringify(toolResult)}`,
      });
    }

    await this._publishAgentEvent(user.id, "agent:complete", {
      requestId: eventRequestId,
    });

    return this._insertMessage(user.id, {
      role: "assistant",
      content: MAX_STEPS_EXCEEDED_MESSAGE,
      thinking: false,
    });
  }

  async _publishAgentEvent(userId, eventName, payload) {
    try {
      await pusher.trigger(`agent-${userId}`, eventName, payload);
    } catch (error) {
      console.error(`Pusher event "${eventName}" failed:`, error.message);
    }
  }

  /**
   * Chạy tool nếu được hỗ trợ.
   */
  async _runTool(action, params) {
    if (!ALLOWED_ACTIONS.has(action) || action === "respond") {
      return {
        success: false,
        error: `Action "${action}" không hợp lệ để thực thi công cụ.`,
      };
    }

    if (
      !Object.hasOwn(agentTools, action) ||
      typeof agentTools[action] !== "function"
    ) {
      return {
        success: false,
        error: `Công cụ "${action}" chưa được triển khai.`,
      };
    }

    try {
      return await agentTools[action](params);
    } catch (error) {
      console.error(`Agent tool "${action}" failed:`, error);

      return {
        success: false,
        error: error.message || "Công cụ thực thi thất bại.",
      };
    }
  }

  /**
   * Chỉ lấy lịch sử hội thoại thật.
   * Không đưa bản ghi thinking vào lịch sử gửi cho model.
   */
  async _loadChatHistory(userId) {
    const rows = await prisma.agentMessage.findMany({
      where: {
        userId,
        thinking: false,
      },
      orderBy: NEWEST_FIRST,
      take: CHAT_HISTORY_LIMIT,
    });

    return rows.reverse().map(({ role, content }) => ({
      role,
      content,
    }));
  }

  async _insertMessage(userId, data) {
    return prisma.agentMessage.create({
      data: {
        userId,
        thinking: false,
        ...data,
      },
    });
  }

  /**
   * Gọi model và chuẩn hóa kết quả trước khi agent xử lý.
   */
  async _think(context) {
    const rawContent = await aiService.completions(context, AGENT_MODEL, {
      response_format: agentActionSchema,
      temperature: 0.2,
    });

    let parsedResult;

    try {
      parsedResult = parseJsonResponse(rawContent);
      return normalizeAgentAction(parsedResult);
    } catch (error) {
      console.error("Agent nhận phản hồi không hợp lệ:", {
        error: error.message,
        response: rawContent,
      });

      throw error;
    }
  }

  _systemPrompt() {
    const os = getOsInfo();

    return [
      "## Vai trò",
      "Bạn là Chat App, một AI agent hỗ trợ người dùng bằng tiếng Việt.",
      "Bạn có thể sử dụng các công cụ được backend cung cấp.",
      "Mỗi lượt chỉ chọn một action. Khi hoàn tất, hãy chọn respond.",
      "",
      "## Định dạng đầu ra",
      "Chỉ trả về một JSON object hợp lệ, không dùng markdown hoặc code fence.",
      'Cấu trúc bắt buộc: {"action":"respond","params":{"path":null,"content":null,"command":null,"query":null,"message":"Câu trả lời","thinking":"Mô tả ngắn bước xử lý"}}.',
      "Luôn có action và params.",
      "params phải chứa đủ các trường path, content, command, query, message, thinking.",
      "Các trường không dùng phải là null; thinking luôn là chuỗi.",
      "",
      "## Phong cách",
      "- Trả lời người dùng bằng tiếng Việt, súc tích và lịch sự.",
      "- Khi trích code hoặc log, dùng markdown phù hợp bên trong params.message.",
      "- thinking chỉ là mô tả ngắn về bước xử lý, không phải câu trả lời cuối.",
      "",
      "## Action",
      "- respond: trả lời người dùng; message phải chứa câu trả lời hoàn chỉnh.",
      "- readFile: đọc file; path là đường dẫn file.",
      "- writeFile: ghi file; path là đường dẫn và content là nội dung cần ghi.",
      "- exec: chạy lệnh ngắn phù hợp với hệ điều hành.",
      "- search_web: tìm thông tin trên internet; query là từ khóa tìm kiếm.",
      "- Dùng search_web khi người dùng hỏi tin thời sự, thông tin mới/có thể thay đổi, hoặc nội dung ngoài kiến thức sẵn có.",
      "- Sau khi tìm kiếm, tổng hợp câu trả lời từ kết quả; ưu tiên nguồn đáng tin cậy và đưa URL nguồn khi phù hợp.",
      "- Nếu tìm kiếm không có kết quả hoặc công cụ báo lỗi, hãy nói rõ giới hạn đó, không tự bịa thông tin.",
      "",
      "## An toàn",
      "- Không tự ý thực hiện thao tác xóa dữ liệu hoặc ghi đè hàng loạt.",
      "- Không chạy server, watcher hoặc tiến trình kéo dài.",
      "- Không chọn action nếu thiếu thông tin cần thiết; hãy dùng respond để hỏi lại.",
      `- Hệ điều hành hiện tại: ${os}.`,
    ].join("\n");
  }
}

module.exports = new AgentMessageService();
