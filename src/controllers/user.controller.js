const usersService = require("../service/users.service");

const list = async (req, res) => res.success(await usersService.list());
const getByUsername = async (req, res) =>
  res.success(await usersService.getByUsername(req.params.username));

module.exports = { list, getByUsername };
