const express = require("express");
const rateLimit = require("express-rate-limit");
const { AppError } = require("../middleware/errorHandler");
const songService = require("../services/songService");

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

const normalizeOption = (value, allowed, fallback) => {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
};

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
};

const validateGenerateBody = (req, res, next) => {
  const {
    prompt,
    genre,
    structure,
    length,
    mood,
    language,
    explicit,
    includeChords,
    includeTitleIdeas,
    rhymeScheme,
    syllablesPerLine,
    referenceArtists,
  } = req.body || {};

  let normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!normalizedPrompt) {
    return next(new AppError("Prompt is required.", 400, "VALIDATION_ERROR"));
  }
  if (normalizedPrompt.length < 10) {
    return next(
      new AppError("Prompt must be at least 10 characters.", 400, "VALIDATION_ERROR")
    );
  }
  if (normalizedPrompt.length > 2000) {
    return next(
      new AppError("Prompt must be no more than 2000 characters.", 400, "VALIDATION_ERROR")
    );
  }
  const normalizedGenre = normalizeOption(genre, songService.allowedGenres, "pop");
  const normalizedStructure = normalizeOption(
    structure,
    songService.allowedStructures,
    "verse-chorus"
  );
  const normalizedLength = normalizeOption(length, songService.allowedLengths, "medium");
  const trimmedMood = typeof mood === "string" ? mood.trim() : "";
  const trimmedLanguage = typeof language === "string" ? language.trim() : "";
  const normalizedRhyme =
    typeof rhymeScheme === "string" && rhymeScheme.trim().length <= 24
      ? rhymeScheme.trim()
      : null;
  const syllablesNumber = Number(syllablesPerLine);
  const normalizedSyllables =
    Number.isFinite(syllablesNumber) && syllablesNumber > 0
      ? Math.round(syllablesNumber)
      : null;

  req.body = {
    prompt: normalizedPrompt,
    genre: normalizedGenre,
    structure: normalizedStructure,
    length: normalizedLength,
    mood: trimmedMood,
    language: trimmedLanguage,
    explicit: normalizeBoolean(explicit),
    includeChords: normalizeBoolean(includeChords),
    includeTitleIdeas: normalizeBoolean(includeTitleIdeas),
    rhymeScheme: normalizedRhyme,
    syllablesPerLine: normalizedSyllables,
    referenceArtists,
  };

  return next();
};

const validateRefineBody = (req, res, next) => {
  const {
    runId,
    prompt,
    genre,
    structure,
    length,
    mood,
    language,
    explicit,
    includeChords,
    includeTitleIdeas,
    rhymeScheme,
    syllablesPerLine,
    referenceArtists,
    instruction,
  } = req.body || {};

  if (!runId) {
    return next(new AppError("runId is required.", 400, "VALIDATION_ERROR"));
  }
  if (!instruction || typeof instruction !== "string") {
    return next(new AppError("Instruction is required.", 400, "VALIDATION_ERROR"));
  }
  const normalizedInstruction = instruction.trim().toLowerCase();
  if (!songService.allowedRefineInstructions.includes(normalizedInstruction)) {
    return next(
      new AppError(
        `Instruction must be one of: ${songService.allowedRefineInstructions.join(", ")}.`,
        400,
        "VALIDATION_ERROR"
      )
    );
  }

  const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const normalizedGenre = normalizeOption(genre, songService.allowedGenres, "pop");
  const normalizedStructure = normalizeOption(
    structure,
    songService.allowedStructures,
    "verse-chorus"
  );
  const normalizedLength = normalizeOption(length, songService.allowedLengths, "medium");
  const trimmedMood = typeof mood === "string" ? mood.trim() : "";
  const trimmedLanguage = typeof language === "string" ? language.trim() : "";
  const normalizedRhyme =
    typeof rhymeScheme === "string" && rhymeScheme.trim().length <= 24
      ? rhymeScheme.trim()
      : null;
  const syllablesNumber = Number(syllablesPerLine);
  const normalizedSyllables =
    Number.isFinite(syllablesNumber) && syllablesNumber > 0
      ? Math.round(syllablesNumber)
      : null;

  req.body = {
    runId,
    prompt: normalizedPrompt || "",
    genre: normalizedGenre,
    structure: normalizedStructure,
    length: normalizedLength,
    mood: trimmedMood,
    language: trimmedLanguage,
    explicit: normalizeBoolean(explicit),
    includeChords: normalizeBoolean(includeChords),
    includeTitleIdeas: normalizeBoolean(includeTitleIdeas),
    rhymeScheme: normalizedRhyme,
    syllablesPerLine: normalizedSyllables,
    referenceArtists,
    instruction: normalizedInstruction,
  };

  return next();
};

router.post("/song/generate", limiter, validateGenerateBody, async (req, res, next) => {
  try {
    const payload = await songService.createSongRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/song/refine", validateRefineBody, async (req, res, next) => {
  try {
    const payload = await songService.refineSongRun(req.body);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/song/history", (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const history = songService.getHistory(limit);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

router.post("/song/save", async (req, res, next) => {
  try {
    const saved = songService.saveRun(req.body || {});
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.post("/song/share", async (req, res, next) => {
  try {
    const share = songService.shareRun(req.body || {});
    res.json(share);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
