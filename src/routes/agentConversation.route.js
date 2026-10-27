const express = require("express");
const agentConversationController = require("../controllers/agentConversation.controller");
const auth = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(auth);
router.get("/", agentConversationController.list);
router.post("/", agentConversationController.create);
router.get("/:id/messages", agentConversationController.getMessages);
router.patch("/:id", agentConversationController.rename);
router.delete("/:id", agentConversationController.remove);

module.exports = router;
