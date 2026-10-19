const router = require("express").Router();
const conversationsController = require("../controllers/conversations.controller");
const auth = require("../middlewares/auth.middleware");

router.use(auth);
router.get("/", conversationsController.list);
router.post("/", conversationsController.create);
router.delete("/:id", conversationsController.remove);
router.get("/:id/messages", conversationsController.listMessages);
router.post("/:id/messages", conversationsController.sendMessage);

module.exports = router;
