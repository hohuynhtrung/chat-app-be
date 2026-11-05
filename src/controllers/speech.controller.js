const speechService = require("../services/speech.service");

const MAX_TRANSCRIPT_LENGTH = 2000;

const transcribe = async (req, res) => {
  if (!req.file) {
    return res.error("Vui lòng gửi tệp âm thanh", 400);
  }

  const language =
    typeof req.body?.language === "string" && req.body.language.trim()
      ? req.body.language.trim()
      : "vi";

  try {
    const text = await speechService.transcribe(req.file.buffer, language);
    return res.success({
      text: typeof text === "string" ? text.trim().slice(0, MAX_TRANSCRIPT_LENGTH) : "",
    });
  } catch (error) {
    console.error("Speech transcription failed:", error?.message || error);
    return res.error(
      "Dịch vụ nhận dạng giọng nói đang gặp sự cố hoặc model chưa được hỗ trợ.",
      503,
    );
  }
};

module.exports = { transcribe };
