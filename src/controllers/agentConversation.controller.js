const agentConversationService = require("../services/agentConversation.service");

const list = async (req, res, next) => {
  try {
    return res.success(await agentConversationService.list(req.userId));
  } catch (error) {
    return next(error);
  }
};

const create = async (req, res, next) => {
  try {
    return res.success(await agentConversationService.create(req.userId), 201);
  } catch (error) {
    return next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const messages = await agentConversationService.getMessages(
      req.userId,
      req.params.id,
    );
    return res.success(messages);
  } catch (error) {
    return next(error);
  }
};

const rename = async (req, res, next) => {
  try {
    const conversation = await agentConversationService.rename(
      req.userId,
      req.params.id,
      req.body?.name,
    );
    return res.success(conversation);
  } catch (error) {
    return next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const result = await agentConversationService.delete(
      req.userId,
      req.params.id,
    );
    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = { list, create, getMessages, rename, remove };
