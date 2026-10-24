const router = require("express").Router();

router.use("/auth", require("./auth.route"));
router.use("/users", require("./auth.route"));
router.use("/chat", require("./chat.route"));

module.exports = router;
