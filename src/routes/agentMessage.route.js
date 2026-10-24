const express = require("express");
const agentMessageController = require("../controllers/agentMessage.controller");
const auth = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(auth);

router.post("/chat", agentMessageController.chat);
router.get("/messages", agentMessageController.getMessages);

module.exports = router;
