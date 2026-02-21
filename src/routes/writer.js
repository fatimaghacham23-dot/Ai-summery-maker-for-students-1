const express = require("express");
const rateLimit = require("express-rate-limit");
const { AppError } = require("../middleware/errorHandler");
const writerService = require("../services/writerService");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    code: "RATE_LIMITED",
    message: "Too many requests, please try again later.",
  },
});

const normalizeMode = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/\s+/g, "-");
};

const normalizeOption = (value) => (value ? String(value).trim().toLowerCase() : "");

const validateGenerateBody = (req, res, next) => {
  const { mode, text, tone, length, level, citationStyle } = req.body || {};

  if (!mode) {
    return next(new AppError("Mode is required.", 400, "VALIDATION_ERROR"));
  }
  const normalizedMode = normalizeMode(mode);
  if (!writerService.allowedModes.includes(normalizedMode)) {
    return next(
      new AppError(
        `Mode must be one of: ${writerService.allowedModes.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!text || typeof text !== "string" || !text.trim()) {
    return next(new AppError("Text is required.", 400, "VALIDATION_ERROR"));
  }
  const trimmedText = text.trim();
  if (trimmedText.length < 20 || trimmedText.length > 20000) {
    return next(
      new AppError("Text must be between 20 and 20000 characters.", 400, "VALIDATION_ERROR")
    );
  }

  const normalizedTone = normalizeOption(tone) || "neutral";
  if (!writerService.allowedTones.includes(normalizedTone)) {
    return next(
      new AppError(
        `Tone must be one of: ${writerService.allowedTones.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  const normalizedLength = normalizeOption(length) || "medium";
  if (!writerService.allowedLengths.includes(normalizedLength)) {
    return next(
      new AppError(
        `Length must be one of: ${writerService.allowedLengths.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  const normalizedLevel = normalizeOption(level) || "bachelor";
  if (!writerService.allowedLevels.includes(normalizedLevel)) {
    return next(
      new AppError(
        `Level must be one of: ${writerService.allowedLevels.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  const normalizedCitation = normalizeOption(citationStyle) || "none";
  if (!writerService.allowedCitations.includes(normalizedCitation)) {
    return next(
      new AppError(
        `Citation style must be one of: ${writerService.allowedCitations.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  req.body.mode = normalizedMode;
  req.body.text = trimmedText;
  req.body.tone = normalizedTone;
  req.body.length = normalizedLength;
  req.body.level = normalizedLevel;
  req.body.citationStyle = normalizedCitation;
  req.body.targetLanguage = req.body.targetLanguage || req.body.language || "";

  return next();
};

const allowedRefineInstructions = new Set(["clarity", "academic", "structure", "concise"]);

const validateRefineBody = (req, res, next) => {
  const { mode, text, runId, instruction, tone, length, level, citationStyle } = req.body || {};
  if (!mode) {
    return next(new AppError("Mode is required.", 400, "VALIDATION_ERROR"));
  }
  const normalizedMode = normalizeMode(mode);
  if (!writerService.allowedModes.includes(normalizedMode)) {
    return next(
      new AppError(
        `Mode must be one of: ${writerService.allowedModes.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!instruction || typeof instruction !== "string") {
    return next(new AppError("Instruction is required.", 400, "VALIDATION_ERROR"));
  }
  const normalizedInstruction = instruction.trim().toLowerCase();
  if (!allowedRefineInstructions.has(normalizedInstruction)) {
    return next(
      new AppError(
        "Instruction must be one of: clarity, academic, structure, concise.",
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!runId && (!text || typeof text !== "string" || !text.trim())) {
    return next(new AppError("Text or runId is required.", 400, "VALIDATION_ERROR"));
  }

  const trimmedText = text && typeof text === "string" ? text.trim() : "";

  const normalizedTone = normalizeOption(tone) || "neutral";
  const normalizedLength = normalizeOption(length) || "medium";
  const normalizedLevel = normalizeOption(level) || "bachelor";
  const normalizedCitation = normalizeOption(citationStyle) || "none";

  if (!writerService.allowedTones.includes(normalizedTone)) {
    return next(
      new AppError(
        `Tone must be one of: ${writerService.allowedTones.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!writerService.allowedLengths.includes(normalizedLength)) {
    return next(
      new AppError(
        `Length must be one of: ${writerService.allowedLengths.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!writerService.allowedLevels.includes(normalizedLevel)) {
    return next(
      new AppError(
        `Level must be one of: ${writerService.allowedLevels.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  if (!writerService.allowedCitations.includes(normalizedCitation)) {
    return next(
      new AppError(
        `Citation style must be one of: ${writerService.allowedCitations.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  req.body.mode = normalizedMode;
  req.body.text = trimmedText;
  req.body.instruction = normalizedInstruction;
  req.body.tone = normalizedTone;
  req.body.length = normalizedLength;
  req.body.level = normalizedLevel;
  req.body.citationStyle = normalizedCitation;
  req.body.targetLanguage = req.body.targetLanguage || req.body.language || "";

  return next();
};

router.post("/writer/generate", limiter, validateGenerateBody, async (req, res, next) => {
  try {
    const payload = await writerService.createWriterRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/writer/refine", validateRefineBody, async (req, res, next) => {
  try {
    const payload = await writerService.refineWriterRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/writer/history", (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const history = writerService.getHistory(limit);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

router.post("/writer/save", async (req, res, next) => {
  try {
    const { runId, title } = req.body || {};
    const saved = writerService.saveRun({ runId, title });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.post("/writer/share", async (req, res, next) => {
  try {
    const { runId, savedItemId, ttlHours } = req.body || {};
    const share = writerService.shareRun({ runId, savedItemId, ttlHours });
    res.json(share);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
