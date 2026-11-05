const { experimental_transcribe, gateway } = require("ai");

const transcribe = async (audio, language) => {
  try {
    const result = await experimental_transcribe({
      model: gateway.transcriptionModel(
        process.env.STT_MODEL || "openai/gpt-4o-mini-transcribe",
      ),
      audio,
      providerOptions: {
        openai: { language },
      },
    });

    return typeof result.text === "string" ? result.text.trim() : "";
  } catch (error) {
    if (error?.name === "AI_NoTranscriptGeneratedError") {
      return "";
    }

    throw error;
  }
};

module.exports = { transcribe };
