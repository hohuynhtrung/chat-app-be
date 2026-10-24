const router = require("express").Router();

router.use("/auth", require("./auth.route"));
router.use("/users", require("./auth.route"));
router.use("/chat", require("./chat.route"));
router.use("/agentMessage", require("./agentMessage.route"));

module.exports = router;
