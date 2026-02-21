const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const imageService = require("../../server/services/imageService");
const { AppError } = require("../middleware/errorHandler");
const {
  IMAGE_STYLES,
  IMAGE_SIZE_OPTIONS,
  IMAGE_QUALITIES,
  IMAGE_FORMATS,
} = require("../image/constants");

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

const imageSchema = z.object({
  prompt: z.string().min(3).max(2000),
  style: z.enum(IMAGE_STYLES).optional().default("prompt-only"),
  size: z.enum(IMAGE_SIZE_OPTIONS).optional().default("1024x1024"),
  quality: z.enum(IMAGE_QUALITIES).optional().default("standard"),
  format: z.enum(IMAGE_FORMATS).optional().default("png"),
  n: z.number().int().min(1).max(4).optional().default(1),
});

const handleValidation = (schema, data) => {
  const result = schema.safeParse(data || {});
  if (!result.success) {
    const details = result.error.flatten();
    throw new AppError("Validation failed.", 400, "VALIDATION_ERROR", details);
  }
  return result.data;
};

router.post("/image/generate", limiter, async (req, res, next) => {
  try {
    const payload = handleValidation(imageSchema, req.body);
    payload.prompt = String(payload.prompt || "").trim();
    if (payload.prompt.length < 3) {
      throw new AppError("Prompt must be at least 3 characters.", 400, "VALIDATION_ERROR");
    }
    const result = await imageService.generateImage(payload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/image/history", async (req, res, next) => {
  try {
    res.json(imageService.getHistory());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
