const agentMessageService = require("../services/agentMessage.service");

const MAX_INPUT_LENGTH = 2000;

const chat = async (req, res, next) => {
  try {
    const input =
      typeof req.body?.input === "string" ? req.body.input.trim() : "";

    if (!input) {
      return res.error("Vui lòng nhập nội dung", 400);
    }

    if (input.length > MAX_INPUT_LENGTH) {
      return res.error(`Nội dung tối đa ${MAX_INPUT_LENGTH} ký tự`, 400);
    }

    const result = await agentMessageService.chat(req.user, input);

    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const messages = await agentMessageService.getMessages(req.user, limit);

    return res.success(messages);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  chat,
  getMessages,
};
