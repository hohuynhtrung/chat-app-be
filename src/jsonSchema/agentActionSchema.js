const agentActionSchema = {
  type: "json_schema",
  json_schema: {
    name: "agent_action",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["readFile", "writeFile", "exec", "search_web", "respond"],
          description:
            "Action duy nhất agent sẽ thực hiện trong lượt hiện tại.",
        },
        params: {
          type: "object",
          properties: {
            path: {
              type: ["string", "null"],
              description: "Đường dẫn file dành cho readFile hoặc writeFile.",
            },
            content: {
              type: ["string", "null"],
              description: "Nội dung cần ghi vào file khi dùng writeFile.",
            },
            command: {
              type: ["string", "null"],
              description: "Lệnh shell ngắn khi dùng action exec.",
            },
            query: {
              type: ["string", "null"],
              description: "Từ khóa tìm kiếm khi dùng action search_web.",
            },
            message: {
              type: ["string", "null"],
              description:
                "Câu trả lời hoàn chỉnh hiển thị cho người dùng khi dùng respond.",
            },
            thinking: {
              type: "string",
              description:
                "Mô tả ngắn gọn bước xử lý hiện tại, không phải câu trả lời cuối.",
            },
          },
          required: [
            "path",
            "content",
            "command",
            "query",
            "message",
            "thinking",
          ],
          additionalProperties: false,
        },
      },
      required: ["action", "params"],
      additionalProperties: false,
    },
  },
};

module.exports = agentActionSchema;
