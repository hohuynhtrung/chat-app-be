const express = require("express");
const multer = require("multer");
const speechController = require("../controllers/speech.controller");
const auth = require("../middlewares/auth.middleware");

const MAX_AUDIO_SIZE = 5 * 1024 * 1024;
const MAX_REQUESTS_PER_MINUTE = 10;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);
const requestsByUser = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_SIZE },
  fileFilter: (req, file, callback) => {
    const mimeType =
      typeof file.mimetype === "string"
        ? file.mimetype.split(";")[0].trim().toLowerCase()
        : "";
    if (!ALLOWED_AUDIO_TYPES.has(mimeType)) {
      return callback(new Error("Định dạng âm thanh không được hỗ trợ"));
    }
    return callback(null, true);
  },
});

const rateLimit = (req, res, next) => {
  const now = Date.now();
  const recentRequests = (requestsByUser.get(req.user.id) || []).filter(
    (timestamp) => now - timestamp < 60_000,
  );

  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    requestsByUser.set(req.user.id, recentRequests);
    return res.error("Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau một phút.", 429);
  }

  recentRequests.push(now);
  requestsByUser.set(req.user.id, recentRequests);
  return next();
};

const handleUpload = (req, res, next) => {
  upload.single("audio")(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.error("Tệp âm thanh vượt quá giới hạn 5MB", 413);
    }

    return res.error(error.message || "Tệp âm thanh không hợp lệ", 400);
  });
};

const router = express.Router();

router.post("/transcribe", auth, rateLimit, handleUpload, speechController.transcribe);

module.exports = router;
