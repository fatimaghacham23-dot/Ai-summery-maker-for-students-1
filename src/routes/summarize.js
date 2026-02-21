const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const { AppError } = require("../middleware/errorHandler");
const { getProvider } = require("../providers");
const { buildLanguageContext } = require("../utils/languageUtils");
const { isQuietTestLogs } = require("../utils/quietLogs");

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

const allowedLengths = ["short", "medium", "detailed", "unlimited"];
const allowedFormats = ["paragraph", "bullets"];

const SHORT_INPUT_THRESHOLD = 20;
const SHORT_INPUT_SUMMARY = "Text is too short to summarize meaningfully.";
const SHORT_INPUT_REASON = "SHORT_INPUT";
const TEXT_MIN_LENGTH = 5;
const TEXT_MAX_LENGTH = 12000;

const baseSummarySchema = z.object({
  length: z.enum(allowedLengths),
  format: z.enum(allowedFormats),
  targetLanguage: z.string().optional(),
  language: z.string().optional(),
});

const shortInputSchema = baseSummarySchema.extend({
  text: z.string().max(TEXT_MAX_LENGTH),
});

const summarizeSchema = baseSummarySchema.extend({
  text: z.string().min(TEXT_MIN_LENGTH).max(TEXT_MAX_LENGTH),
});

const handleValidation = (schema, data) => {
  const result = schema.safeParse(data || {});
  if (!result.success) {
    const details = result.error.flatten();
    throw new AppError("Validation failed.", 400, "VALIDATION_ERROR", details);
  }
  return result.data;
};

const validateRequest = (req, res, next) => {
  try {
    const parsed = handleValidation(shortInputSchema, req.body);
    const trimmedText = parsed.text.trim();
    if (!trimmedText) {
      throw new AppError("Text is required.", 400, "VALIDATION_ERROR");
    }

    parsed.text = trimmedText;
    parsed.requestedLanguage = (parsed.targetLanguage || parsed.language || "").trim();

    if (trimmedText.length < SHORT_INPUT_THRESHOLD) {
      return res.status(200).json({
        summary: SHORT_INPUT_SUMMARY,
        meta: { reason: SHORT_INPUT_REASON },
      });
    }

    const validated = handleValidation(summarizeSchema, parsed);
    validated.requestedLanguage = parsed.requestedLanguage;
    req.body = validated;
    return next();
  } catch (error) {
    return next(error);
  }
};

router.post("/summarize", limiter, validateRequest, async (req, res, next) => {
  try {
    const provider = getProvider();
    const { text, length, format } = req.body;
    const languageContext = buildLanguageContext({
      inputText: text,
      requestedLanguage: req.body.requestedLanguage,
    });
    const summary = await provider.summarize({ text, length, format, languageContext });

    res.json({
      summary,
      length,
      format,
      meta: {
        characters: text.length,
        language: languageContext.finalLanguage,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const code = error.code || "INTERNAL_ERROR";
    const payload = {
      error: true,
      message: error.message || "Unexpected error",
      code,
    };

    if (error.details) {
      payload.details = error.details;
    }

    if (statusCode >= 500 && !isQuietTestLogs()) {
      console.error(error);
    }

    res.status(statusCode).json(payload);
  }
});

module.exports = router;
