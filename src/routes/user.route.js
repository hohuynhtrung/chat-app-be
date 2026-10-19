const router = require("express").Router();
const userController = require("../controllers/users.controller");
const auth = require("../middlewares/auth.middleware");

router.use(auth);
router.get("/", userController.list);
router.get("/:username", userController.getByUsername);

module.exports = router;
