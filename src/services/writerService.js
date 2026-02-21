const { randomUUID } = require("crypto");
const { AppError } = require("../middleware/errorHandler");
const { db, runInTransaction } = require("../db");
const { getWriterProvider } = require("../providers/writer");
const { buildInternalPrompt, buildUserPrompt } = require("./writerPrompts");
const persistenceService = require("./persistenceService");
const { buildLanguageContext } = require("../utils/languageUtils");

const TOOL_NAME = "writer";
const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 20000;
const ALLOWED_MODES = [
  "essay",
  "outline",
  "paraphrase",
  "expand",
  "shorten",
  "explain",
  "flashcards",
  "email",
  "cover-letter",
  "notes-to-study-guide",
];
const ALLOWED_TONES = ["academic", "neutral", "simple", "persuasive"];
const ALLOWED_LENGTHS = ["short", "medium", "long"];
const ALLOWED_LEVELS = ["high_school", "bachelor", "master", "phd"];
const ALLOWED_CITATIONS = ["none", "apa", "mla", "chicago"];

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeKeywords = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const computeWordCount = (text) => {
  if (!text) {
    return 0;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
};

const persistWriterOutput = ({ runId, params, output, providerMeta }) => {
  const cleanOutput = output.trim();
  if (!cleanOutput) {
    throw new AppError("Writer provider returned empty output.", 502, "PROVIDER_ERROR");
  }
  const wordCount = computeWordCount(cleanOutput);
  const paramsWithWordCount = { ...params, wordCount };
  const provider = providerMeta?.provider || "unknown";
  const providerUsed = providerMeta?.providerUsed || provider;
  const model = providerMeta?.model || null;
  const openaiError = providerMeta?.openaiError || null;
  persistenceService.persistRun({
    runId,
    tool: TOOL_NAME,
    type: TOOL_NAME,
    params: paramsWithWordCount,
    outputJson: {
      output: {
        type: "text",
        data: cleanOutput,
      },
    },
    provider,
    model,
  });
  return {
    runId,
    output: cleanOutput,
    meta: {
      ...params,
      wordCount,
      provider,
      providerUsed,
      model,
      openaiError,
    },
  };
};

const buildParams = ({
  text,
  mode,
  tone,
  length,
  level,
  citationStyle,
  keywords,
  languageContext = null,
  extra = {},
}) => ({
  mode,
  tone,
  length,
  level,
  citationStyle,
  keywords: sanitizeKeywords(keywords),
  inputText: text,
  textPreview: text.slice(0, 400),
  ...(languageContext?.finalLanguage ? { language: languageContext.finalLanguage } : {}),
  ...extra,
});

const validateMode = (mode) => {
  if (!mode || typeof mode !== "string") {
    throw new AppError("Mode is required.", 400, "VALIDATION_ERROR");
  }
  if (!ALLOWED_MODES.includes(mode.toLowerCase())) {
    throw new AppError(
      `Mode must be one of: ${ALLOWED_MODES.join(", ")}.`,
      400,
      "VALIDATION_ERROR"
    );
  }
};

const validateText = (text) => {
  if (!text || typeof text !== "string") {
    throw new AppError("Text is required.", 400, "VALIDATION_ERROR");
  }
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) {
    throw new AppError("Text must be at least 20 characters.", 400, "VALIDATION_ERROR");
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new AppError(
      `Text must be no more than ${MAX_TEXT_LENGTH} characters.`,
      400,
      "VALIDATION_ERROR"
    );
  }
  return trimmed;
};

const normalizeOption = (value, allowed, fallback) => {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
};

const createWriterRun = async (payload) => {
  const provider = getWriterProvider();
  if (typeof provider.generate !== "function") {
    throw new AppError("Writer provider does not support generation.", 500, "PROVIDER_ERROR");
  }
  const normalizedText = validateText(payload.text);
  const mode = payload.mode.toLowerCase();
  validateMode(mode);
  const length = normalizeOption(payload.length, ALLOWED_LENGTHS, "medium");
  const tone = normalizeOption(payload.tone, ALLOWED_TONES, "neutral");
  const level = normalizeOption(payload.level, ALLOWED_LEVELS, "bachelor");
  const citationStyle = normalizeOption(payload.citationStyle, ALLOWED_CITATIONS, "none");
  const keywords = sanitizeKeywords(payload.keywords);

  const requestedLanguage = payload.targetLanguage || payload.language || "";
  const languageContext = buildLanguageContext({
    inputText: normalizedText,
    requestedLanguage,
  });
  const params = buildParams({
    text: normalizedText,
    mode,
    tone,
    length,
    level,
    citationStyle,
    keywords,
    languageContext,
  });

  const internalPrompt = buildInternalPrompt({
    mode,
    tone,
    length,
    level,
    citationStyle,
    keywords,
    instruction: null,
    languageInstruction: languageContext.instruction,
  });
  const userPrompt = buildUserPrompt({
    text: normalizedText,
    mode,
    tone,
    length,
    level,
    citationStyle,
    keywords,
    languageInstruction: languageContext.instruction,
  });

  const response = await provider.generate({
    internalPrompt,
    userPrompt,
    mode,
    tone,
    length,
    level,
    citationStyle,
    keywords,
    text: normalizedText,
    languageContext,
  });

  if (!response || typeof response.output !== "string") {
    throw new AppError("Writer provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const runId = randomUUID();
  return persistWriterOutput({
    runId,
    params,
    output: response.output,
    providerMeta: response.meta,
  });
};

const getStoredOutput = (runId) => {
  const run = persistenceService.getRunById(runId);
  if (!run) {
    throw new AppError("Run not found.", 404, "NOT_FOUND");
  }
  return String(run.output?.data || "");
};

const refineWriterRun = async ({
  runId: previousRunId,
  text,
  instruction,
  mode,
  tone,
  length,
  level,
  citationStyle,
  keywords,
}) => {
  const provider = getWriterProvider();
  if (typeof provider.refine !== "function") {
    throw new AppError("Writer provider does not support refine.", 500, "PROVIDER_ERROR");
  }
  const normalizedText = text ? text.trim() : "";
  const previousOutput = previousRunId ? getStoredOutput(previousRunId) : null;
  const sourceText = normalizedText || previousOutput || "";
  if (!sourceText) {
    throw new AppError("Text or runId is required to refine.", 400, "VALIDATION_ERROR");
  }
  const validatedText = validateText(sourceText);
  const normalizedMode = mode?.toLowerCase();
  validateMode(normalizedMode);
  const normalizedLength = normalizeOption(length, ALLOWED_LENGTHS, "medium");
  const normalizedTone = normalizeOption(tone, ALLOWED_TONES, "neutral");
  const normalizedLevel = normalizeOption(level, ALLOWED_LEVELS, "bachelor");
  const normalizedCitation = normalizeOption(citationStyle, ALLOWED_CITATIONS, "none");
  const normalizedKeywords = sanitizeKeywords(keywords);
  const requestedLanguage = payload.targetLanguage || payload.language || "";
  const languageContext = buildLanguageContext({
    inputText: validatedText,
    requestedLanguage,
  });
  const normalizedInstruction = String(instruction || "").toLowerCase();
  const allowedInstructions = ["clarity", "academic", "structure", "concise"];
  if (!allowedInstructions.includes(normalizedInstruction)) {
    throw new AppError(
      "Instruction must be one of: clarity, academic, structure, concise.",
      400,
      "VALIDATION_ERROR"
    );
  }

  const params = buildParams({
    text: validatedText,
    mode: normalizedMode,
    tone: normalizedTone,
    length: normalizedLength,
    level: normalizedLevel,
    citationStyle: normalizedCitation,
    keywords: normalizedKeywords,
    extra: { instruction: normalizedInstruction },
    languageContext,
  });

  const internalPrompt = buildInternalPrompt({
    mode: normalizedMode,
    tone: normalizedTone,
    length: normalizedLength,
    level: normalizedLevel,
    citationStyle: normalizedCitation,
    keywords: normalizedKeywords,
    instruction: normalizedInstruction,
    languageInstruction: languageContext.instruction,
  });
  const userPrompt = buildUserPrompt({
    text: validatedText,
    mode: normalizedMode,
    tone: normalizedTone,
    length: normalizedLength,
    level: normalizedLevel,
    citationStyle: normalizedCitation,
    keywords: normalizedKeywords,
    previousOutput,
    instruction: normalizedInstruction,
    languageInstruction: languageContext.instruction,
  });

  const response = await provider.refine({
    internalPrompt,
    userPrompt,
    mode: normalizedMode,
    tone: normalizedTone,
    length: normalizedLength,
    level: normalizedLevel,
    citationStyle: normalizedCitation,
    keywords: normalizedKeywords,
    text: validatedText,
    instruction: normalizedInstruction,
    previousOutput,
    languageContext,
  });

  if (!response || typeof response.output !== "string") {
    throw new AppError("Writer provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const newRunId = randomUUID();
  return persistWriterOutput({
    runId: newRunId,
    params,
    output: response.output,
    providerMeta: response.meta,
  });
};

const getHistory = (limit = 20) => {
  const requested = Number(limit);
  const safeLimit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.round(requested))) : 20;
  const rows = persistenceService.getRunsByType(TOOL_NAME, safeLimit);

  return rows.map((row) => {
    const params = parseJson(row.paramsJson) || {};
    const outputStored = parseJson(row.outputJson);
    const text = String(outputStored?.output?.data || "");
    return {
      id: row.id,
      createdAt: row.createdAt,
      mode: params.mode || null,
      tone: params.tone || null,
      length: params.length || null,
      level: params.level || null,
      citationStyle: params.citationStyle || null,
      keywords: params.keywords || [],
      snippet: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      wordCount: computeWordCount(text),
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
      title && title.trim().length ? title.trim() : "Writer output",
      JSON.stringify([]),
      "writer",
      now
    );
  });
  return {
    id: savedId,
    runId,
    title: title && title.trim().length ? title.trim() : "Writer output",
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
  createWriterRun,
  refineWriterRun,
  getHistory,
  saveRun,
  shareRun,
  allowedModes: ALLOWED_MODES,
  allowedLengths: ALLOWED_LENGTHS,
  allowedTones: ALLOWED_TONES,
  allowedLevels: ALLOWED_LEVELS,
  allowedCitations: ALLOWED_CITATIONS,
};
