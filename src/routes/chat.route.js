const router = require("express").Router();
const chatController = require("../controllers/chat.controller");
const auth = require("../middlewares/auth.middleware");

router.use(auth);
router.get("/", chatController.list);
router.post("/", chatController.create);
router.delete("/:id", chatController.remove);
router.get("/:id/messages", chatController.listMessages);
router.post("/:id/messages", chatController.sendMessage);

module.exports = router;
