const router = require("express").Router();

router.use("/auth", require("./auth.route"));
router.use("/users", require("./auth.route"));
router.use("/conversations", require("./conversations.route"));

module.exports = router;
