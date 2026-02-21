const { randomUUID } = require("crypto");
const { AppError } = require("../middleware/errorHandler");
const { db, runInTransaction } = require("../db");
const persistenceService = require("./persistenceService");
const { getSongProvider } = require("../providers/song");
const { buildInternalPrompt, buildUserPrompt } = require("./songPrompts");
const { buildLanguageContext } = require("../utils/languageUtils");

const TOOL_NAME = "song";

const ALLOWED_GENRES = [
  "pop",
  "rock",
  "hip-hop",
  "r&b",
  "electronic",
  "indie",
  "country",
  "folk",
];
const ALLOWED_STRUCTURES = [
  "verse-chorus",
  "verse-chorus-bridge",
  "story",
  "loop",
  "freeform",
];
const ALLOWED_LENGTHS = ["short", "medium", "long"];
const ALLOWED_REFINE_INSTRUCTIONS = ["clarity", "imagery", "energy", "structure"];

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeOption = (value, allowed, fallback) => {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
};

const toBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
};

const computeWordCount = (text) => {
  if (!text) return 0;
  return text
    .trim()
    .split(/\\s+/)
    .filter(Boolean).length;
};

const sanitizeReferenceArtists = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const DEFAULT_THEME_FALLBACK = "fresh momentum";

const normalizeWhitespace = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
};

const sanitizeTheme = (text) => {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return DEFAULT_THEME_FALLBACK;
  }
  let cleaned = normalized.replace(/\b(?:Genre|Mood|Language):[^\n\r]*/gi, "").trim();
  const writeIntroRegex =
    /^write\s+(?:an|a|the)?[\w\s'\"-]*?(?:song|chorus|verse|lines|lyrics|anthem|ode|piece|message|story|poem)?\s*(?:about|for|on|to|that)\s*/i;
  if (writeIntroRegex.test(cleaned)) {
    cleaned = cleaned.replace(writeIntroRegex, "").trim();
  }
  if (!cleaned) {
    cleaned = normalized.replace(/^write\s+(?:an|a|the)?\s*/i, "").trim();
  }
  if (!cleaned) {
    return DEFAULT_THEME_FALLBACK;
  }
  if (cleaned.length > 240) {
    cleaned = cleaned.slice(0, 240).trim();
  }
  return cleaned;
};

const validatePrompt = (text) => {
  if (!text || typeof text !== "string") {
    throw new AppError("Prompt is required.", 400, "VALIDATION_ERROR");
  }
  const trimmed = text.trim();
  if (trimmed.length < 10) {
    throw new AppError("Prompt must be at least 10 characters.", 400, "VALIDATION_ERROR");
  }
  if (trimmed.length > 2000) {
    throw new AppError("Prompt must be no more than 2000 characters.", 400, "VALIDATION_ERROR");
  }
  return trimmed;
};

const buildOptions = ({
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
}) => {
  const validatedPrompt = validatePrompt(prompt);
  return {
    prompt: validatedPrompt,
    theme: sanitizeTheme(validatedPrompt),
    genre: normalizeOption(genre, ALLOWED_GENRES, "pop"),
    structure: normalizeOption(structure, ALLOWED_STRUCTURES, "verse-chorus"),
    length: normalizeOption(length, ALLOWED_LENGTHS, "medium"),
    mood: (mood && mood.trim()) || "uplifting",
    language: (language && language.trim()) || "English",
    explicit: toBoolean(explicit),
    includeChords: toBoolean(includeChords),
    includeTitleIdeas: toBoolean(includeTitleIdeas),
    rhymeScheme: (rhymeScheme && rhymeScheme.trim()) || null,
    syllablesPerLine:
      Number.isFinite(Number(syllablesPerLine)) && Number(syllablesPerLine) > 0
        ? Number(Math.round(Number(syllablesPerLine)))
        : null,
    referenceArtists: sanitizeReferenceArtists(referenceArtists),
    instruction: instruction ? instruction.trim().toLowerCase() : null,
  };
};

const persistSongOutput = ({ runId, params, output, providerMeta }) => {
  const title = (output?.title || "Song lyrics").trim();
  const lyrics = (output?.lyrics || "").trim();
  if (!lyrics) {
    throw new AppError("Song provider returned empty lyrics.", 502, "PROVIDER_ERROR");
  }
  const titleIdeas = Array.isArray(output?.titleIdeas)
    ? output.titleIdeas.filter((item) => Boolean(item))
    : [];
  const wordCount = computeWordCount(lyrics);
  const paramsWithWordCount = { ...params, wordCount };

  persistenceService.persistRun({
    runId,
    tool: TOOL_NAME,
    type: TOOL_NAME,
    params: paramsWithWordCount,
    outputJson: {
      output: {
        type: "song",
        data: {
          title,
          lyrics,
          titleIdeas,
        },
      },
    },
    provider: providerMeta?.provider || "unknown",
    model: providerMeta?.model || null,
  });

  return {
    runId,
    title,
    lyrics,
    titleIdeas,
    meta: {
      ...params,
      titleIdeas,
      wordCount,
      provider: providerMeta?.provider || "unknown",
      providerUsed: providerMeta?.providerUsed || providerMeta?.provider || "unknown",
      model: providerMeta?.model || null,
    },
  };
};

const getStoredOutput = (runId) => {
  const run = persistenceService.getRunById(runId);
  if (!run) {
    throw new AppError("Run not found.", 404, "NOT_FOUND");
  }
  const stored = parseJson(run.outputJson) || {};
  const data = stored.output || {};
  return {
    title: String(data.title || ""),
    lyrics: String(data.lyrics || ""),
  };
};

const createSongRun = async (payload) => {
  const provider = getSongProvider();
  if (typeof provider.generate !== "function") {
    throw new AppError("Song provider does not support generation.", 500, "PROVIDER_ERROR");
  }
  const options = buildOptions(payload);
  const languageContext = buildLanguageContext({
    inputText: options.prompt,
    requestedLanguage: options.language,
  });
  const internalPrompt = buildInternalPrompt({
    ...options,
    languageInstruction: languageContext.instruction,
  });
  const userPrompt = buildUserPrompt({
    ...options,
    previousOutput: null,
    languageInstruction: languageContext.instruction,
  });
  const response = await provider.generate({
    internalPrompt,
    userPrompt,
    ...options,
    languageContext,
  });

  if (!response || !response.output) {
    throw new AppError("Song provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const runId = randomUUID();
  const paramsWithLanguage = {
    ...options,
    finalLanguage: languageContext.finalLanguage,
  };
  return persistSongOutput({
    runId,
    params: paramsWithLanguage,
    output: response.output,
    providerMeta: response.meta,
  });
};

const refineSongRun = async (payload) => {
  const { runId: referenceRunId } = payload || {};
  const targetId = referenceRunId;
  if (!targetId) {
    throw new AppError("runId is required to refine a song.", 400, "VALIDATION_ERROR");
  }
  const provider = getSongProvider();
  if (typeof provider.refine !== "function") {
    throw new AppError("Song provider does not support refining.", 500, "PROVIDER_ERROR");
  }
  const storedRun = persistenceService.getRunById(targetId);
  if (!storedRun) {
    throw new AppError("Run not found.", 404, "NOT_FOUND");
  }
  const promptFromHistory = storedRun.params?.prompt || "";
  const prompt = (payload.prompt && payload.prompt.trim()) || promptFromHistory;
  const options = buildOptions({
    ...payload,
    prompt,
    instruction: payload.instruction,
  });
  const languageContext = buildLanguageContext({
    inputText: options.prompt,
    requestedLanguage: options.language,
  });

  if (!options.instruction || !ALLOWED_REFINE_INSTRUCTIONS.includes(options.instruction)) {
    throw new AppError(
      `Instruction must be one of: ${ALLOWED_REFINE_INSTRUCTIONS.join(", ")}.`,
      400,
      "VALIDATION_ERROR"
    );
  }

  const previousOutput = getStoredOutput(targetId);
  const internalPrompt = buildInternalPrompt({
    ...options,
    instruction: options.instruction,
    languageInstruction: languageContext.instruction,
  });
  const userPrompt = buildUserPrompt({
    ...options,
    previousOutput: previousOutput.lyrics,
    languageInstruction: languageContext.instruction,
  });

  const response = await provider.refine({
    internalPrompt,
    userPrompt,
    previousOutput,
    ...options,
    languageContext,
  });

  if (!response || !response.output) {
    throw new AppError("Song provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const newRunId = randomUUID();
  const paramsWithLanguage = {
    ...options,
    finalLanguage: languageContext.finalLanguage,
  };
  return persistSongOutput({
    runId: newRunId,
    params: paramsWithLanguage,
    output: response.output,
    providerMeta: response.meta,
  });
};

const getHistory = (limit = 20) => {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.round(limit))) : 20;
  const rows = persistenceService.getRunsByType(TOOL_NAME, safeLimit);
  return rows.map((row) => {
    const params = parseJson(row.paramsJson) || {};
    const stored = parseJson(row.outputJson) || {};
    const data = stored.output || {};
    const lyrics = String(data.lyrics || "");
    return {
      id: row.id,
      title: String(data.title || "Song lyrics"),
      createdAt: row.createdAt,
      prompt: String(params.prompt || ""),
      genre: params.genre || null,
      structure: params.structure || null,
      length: params.length || null,
      mood: params.mood || null,
      language: params.language || null,
      explicit: Boolean(params.explicit),
      includeChords: Boolean(params.includeChords),
      includeTitleIdeas: Boolean(params.includeTitleIdeas),
      rhymeScheme: params.rhymeScheme || null,
      syllablesPerLine: params.syllablesPerLine || null,
      referenceArtists: Array.isArray(params.referenceArtists) ? params.referenceArtists : [],
      snippet: lyrics.length > 200 ? `${lyrics.slice(0, 200)}…` : lyrics,
      lyrics,
      titleIdeas: Array.isArray(data.titleIdeas) ? data.titleIdeas : [],
      wordCount: computeWordCount(lyrics),
    };
  });
};

const saveRun = ({ runId, title }) => {
  if (!runId) {
    throw new AppError("runId is required to save output.", 400, "VALIDATION_ERROR");
  }
  const run = persistenceService.getRunById(runId);
  if (!run) {
    throw new AppError("Run not found.", 404, "NOT_FOUND");
  }
  const savedId = randomUUID();
  const now = new Date().toISOString();
  runInTransaction((transactionalDb) => {
    transactionalDb.prepare(
      `INSERT INTO saved_items (id, documentId, runId, title, tagsJson, folder, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      savedId,
      run.documentId || null,
      runId,
      title && title.trim().length ? title.trim() : "Song lyrics",
      JSON.stringify([]),
      "song",
      now
    );
  });
  return {
    id: savedId,
    runId,
    title: title && title.trim().length ? title.trim() : "Song lyrics",
  };
};

const shareRun = ({ runId, savedItemId, ttlHours }) => {
  let targetRunId = runId;
  if (!targetRunId && savedItemId) {
    const saved = db.prepare("SELECT runId FROM saved_items WHERE id = ?").get(savedItemId);
    targetRunId = saved?.runId;
  }
  if (!targetRunId) {
    throw new AppError("runId or savedItemId is required to share output.", 400, "VALIDATION_ERROR");
  }
  const run = persistenceService.getRunById(targetRunId);
  if (!run) {
    throw new AppError("Run not found.", 404, "NOT_FOUND");
  }

  const token = randomUUID();
  const now = new Date().toISOString();
  const ttlValue = typeof ttlHours === "number" ? ttlHours : Number(ttlHours);
  const expiresAt =
    Number.isFinite(ttlValue) && ttlValue > 0
      ? new Date(Date.now() + ttlValue * 60 * 60 * 1000).toISOString()
      : null;

  runInTransaction((transactionalDb) => {
    transactionalDb.prepare(
      `INSERT INTO share_links (id, runId, token, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(randomUUID(), targetRunId, token, expiresAt, now);
  });

  return {
    token,
    urlPath: `/s/${token}`,
    expiresAt,
  };
};

module.exports = {
  createSongRun,
  refineSongRun,
  getHistory,
  saveRun,
  shareRun,
  allowedGenres: ALLOWED_GENRES,
  allowedStructures: ALLOWED_STRUCTURES,
  allowedLengths: ALLOWED_LENGTHS,
  allowedRefineInstructions: ALLOWED_REFINE_INSTRUCTIONS,
};
