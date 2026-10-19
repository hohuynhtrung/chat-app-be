const service = require("../services/conversations.service");

const list = async (req, res) => res.success(await service.list(req.userId));

const create = async (req, res) =>
  res.success(await service.create(req.userId, req.body), 201);

const remove = async (req, res) => {
  await service.remove(req.userId, req.params.id);
  res.success({ ok: true });
};

const listMessages = async (req, res) =>
  res.success(
    await service.listMessages(req.userId, req.params.id, {
      cursor: req.query.cursor,
      limit: req.query.limit,
    }),
  );

const sendMessage = async (req, res) =>
  res.success(
    await service.sendMessage(req.userId, req.params.id, req.body.content),
    201,
  );

module.exports = { list, create, remove, listMessages, sendMessage };
