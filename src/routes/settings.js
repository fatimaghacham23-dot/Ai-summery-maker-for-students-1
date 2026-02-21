const express = require("express");
const { AppError } = require("../middleware/errorHandler");
const settingsService = require("../services/settingsService");
const { normalizeOpenAiApiKey, normalizeOpenAiValue } = require("../utils/openaiConfig");

const router = express.Router();

const validateApiKey = (value) => {
  const normalized = normalizeOpenAiApiKey(value);
  if (!normalized) {
    throw new AppError("apiKey is required", 400, "VALIDATION_ERROR");
  }
  if (!normalized.startsWith("sk-")) {
    throw new AppError(
      "Invalid OpenAI API key format (must start with sk-).",
      400,
      "CONFIG_ERROR"
    );
  }
  return normalized;
};

const getModelWriterValue = () => {
  const envValue = normalizeOpenAiValue(process.env.OPENAI_MODEL_WRITER);
  if (envValue) {
    return envValue;
  }
  const settings = settingsService.getLocalSettings();
  return settings.openaiModelWriter || null;
};

const buildResponsePayload = () => {
  return {
    ...settingsService.getOpenAiStatus(),
    provider: "openai",
    modelWriter: getModelWriterValue(),
  };
};

router.get("/openai", (req, res) => {
  res.json(buildResponsePayload());
});

router.post("/openai", async (req, res, next) => {
  try {
    const apiKey = validateApiKey(req.body?.apiKey);
    const modelWriter =
      typeof req.body?.modelWriter === "string" ? req.body.modelWriter.trim() : undefined;
    await settingsService.saveOpenAiSettings({ apiKey, modelWriter });
    res.json(buildResponsePayload());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
