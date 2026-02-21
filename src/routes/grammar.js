const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { AppError } = require("../middleware/errorHandler");
const grammarService = require("../services/grammarService");

const router = express.Router();

const limiter =
  process.env.NODE_ENV === "test"
    ? (req, res, next) => next()
    : rateLimit({
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

const grammarFixSchema = z.object({
  text: z
    .string()
    .transform((value) => String(value || "").trim())
    .refine((value) => value.length >= 3, { message: "Text must be at least 3 characters." }),
  goal: z.enum(["grammar", "clarity", "formal", "friendly", "concise", "academic"]).default("grammar"),
  dialect: z.enum(["US", "UK", "CA", "AU", "other"]).default("US"),
  tone: z.enum(["neutral", "formal", "friendly", "professional"]).default("neutral"),
  level: z.enum(["light", "standard", "strict"]).default("standard"),
  preserveMeaning: z.boolean().default(true),
  preserveFormatting: z.boolean().default(true),
  explainChanges: z.boolean().default(false),
});

const grammarRefineSchema = z.object({
  runId: z.string().optional(),
  text: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return "";
      return String(value).trim();
    }),
  instructions: z
    .string()
    .transform((value) => String(value || "").trim())
    .refine((value) => value.length >= 3, {
      message: "Instruction must be at least 3 characters.",
    }),
});

const toAppError = (error) => {
  if (error instanceof z.ZodError) {
    const firstIssue = error.errors[0];
    const message = firstIssue?.message || "Invalid request data.";
    return new AppError(message, 400, "VALIDATION_ERROR");
  }
  return error;
};

const validateFixBody = (req, res, next) => {
  try {
    req.body = grammarFixSchema.parse(req.body || {});
    return next();
  } catch (error) {
    return next(toAppError(error));
  }
};

const validateRefineBody = (req, res, next) => {
  try {
    req.body = grammarRefineSchema.parse(req.body || {});
    const { runId, text } = req.body || {};
    if (text && text.length > 0 && text.length < 3) {
      return next(new AppError("Text must be at least 3 characters.", 400, "VALIDATION_ERROR"));
    }
    if (!runId && !text) {
      return next(
        new AppError("runId or text is required to refine grammar.", 400, "VALIDATION_ERROR")
      );
    }
    return next();
  } catch (error) {
    return next(toAppError(error));
  }
};

router.post("/grammar/fix", limiter, validateFixBody, async (req, res, next) => {
  try {
    const payload = await grammarService.createGrammarRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/grammar/refine", limiter, validateRefineBody, async (req, res, next) => {
  try {
    const payload = await grammarService.refineGrammarRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/grammar/history", (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const history = grammarService.getHistory(limit);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

router.post("/grammar/save", async (req, res, next) => {
  try {
    const { runId, title } = req.body || {};
    const saved = grammarService.saveRun({ runId, title });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.post("/grammar/share", async (req, res, next) => {
  try {
    const { runId, savedItemId, ttlHours } = req.body || {};
    const share = grammarService.shareRun({ runId, savedItemId, ttlHours });
    res.json(share);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
