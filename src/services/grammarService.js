const { randomUUID } = require("crypto");
const { AppError } = require("../middleware/errorHandler");
const { db, runInTransaction } = require("../db");
const persistenceService = require("./persistenceService");
const { getGrammarProvider } = require("../providers/grammar");
const { buildLanguageContext } = require("../utils/languageUtils");

const TOOL_NAME = "grammar";

const DEFAULT_META = {
  goal: "grammar",
  dialect: "US",
  tone: "neutral",
  level: "standard",
  preserveMeaning: true,
  preserveFormatting: true,
  explainChanges: false,
};

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeMeta = (input = {}) => ({
  goal: input.goal || DEFAULT_META.goal,
  dialect: input.dialect || DEFAULT_META.dialect,
  tone: input.tone || DEFAULT_META.tone,
  level: input.level || DEFAULT_META.level,
  preserveMeaning:
    typeof input.preserveMeaning === "boolean" ? input.preserveMeaning : DEFAULT_META.preserveMeaning,
  preserveFormatting:
    typeof input.preserveFormatting === "boolean"
      ? input.preserveFormatting
      : DEFAULT_META.preserveFormatting,
  explainChanges:
    typeof input.explainChanges === "boolean" ? input.explainChanges : DEFAULT_META.explainChanges,
});

const buildParams = ({ text, meta, languageContext }) => ({
  inputText: text,
  textPreview: String(text || "").slice(0, 400),
  ...(languageContext?.finalLanguage ? { language: languageContext.finalLanguage } : {}),
  ...meta,
});

const buildOutputPayload = ({ original, corrected, explanations }) => {
  const payload = {
    type: TOOL_NAME,
    data: {
      original,
      corrected,
    },
  };
  if (Array.isArray(explanations) && explanations.length) {
    payload.data.explanations = explanations;
  }
  return payload;
};

const persistGrammarOutput = async ({
  runId,
  original,
  corrected,
  explanations,
  meta,
  params,
  providerMeta,
}) => {
  persistenceService.persistRun({
    runId,
    tool: TOOL_NAME,
    type: TOOL_NAME,
    params,
    outputJson: {
      output: buildOutputPayload({ original, corrected, explanations }),
    },
    provider: providerMeta?.provider || "unknown",
    model: providerMeta?.model || null,
  });

  const stored = persistenceService.getRunById(runId);
  return {
    runId,
    original,
    corrected,
    meta,
    provider: providerMeta?.provider || "unknown",
    createdAt: stored?.createdAt || new Date().toISOString(),
    ...(Array.isArray(explanations) && explanations.length ? { explanations } : {}),
  };
};

const createGrammarRun = async ({
  text,
  goal,
  dialect,
  tone,
  level,
  preserveMeaning,
  preserveFormatting,
  explainChanges,
  targetLanguage,
  language,
}) => {
  const provider = getGrammarProvider();
  if (typeof provider.fix !== "function") {
    throw new AppError("Grammar provider is not configured correctly.", 500, "PROVIDER_ERROR");
  }
  const normalizedText = String(text || "").trim();
  if (!normalizedText || normalizedText.length < 3) {
    throw new AppError("Text must be at least 3 characters.", 400, "VALIDATION_ERROR");
  }

  const requestedLanguage = targetLanguage || language || "";
  const languageContext = buildLanguageContext({
    inputText: normalizedText,
    requestedLanguage,
  });
  const meta = normalizeMeta({
    goal,
    dialect,
    tone,
    level,
    preserveMeaning,
    preserveFormatting,
    explainChanges,
  });
  const params = buildParams({ text: normalizedText, meta, languageContext });

  const response = await provider.fix({
    text: normalizedText,
    ...meta,
    languageContext,
  });

  if (!response || typeof response.corrected !== "string") {
    throw new AppError("Grammar provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const runId = randomUUID();
  return persistGrammarOutput({
    runId,
    original: normalizedText,
    corrected: response.corrected,
    explanations: response.explanations,
    meta,
    params,
    providerMeta: response.meta || {},
  });
};

const getRunMeta = (runId) => {
  if (!runId) return null;
  return persistenceService.getRunById(runId);
};

const refineGrammarRun = async ({ runId, text, instructions, targetLanguage, language }) => {
  const provider = getGrammarProvider();
  if (typeof provider.refine !== "function") {
    throw new AppError("Grammar provider does not support refine.", 500, "PROVIDER_ERROR");
  }

  const storedRun = runId ? getRunMeta(runId) : null;
  const availableText =
    (text && String(text).trim()) ||
    (storedRun?.output?.data?.corrected && String(storedRun.output.data.corrected)) ||
    "";

  if (!availableText) {
    throw new AppError("Text or runId is required to refine.", 400, "VALIDATION_ERROR");
  }

  const baseMeta = storedRun?.params ? normalizeMeta(storedRun.params) : DEFAULT_META;
  const requestedLanguage = targetLanguage || language || "";
  const languageContext = buildLanguageContext({
    inputText: availableText,
    requestedLanguage,
  });
  const params = buildParams({ text: availableText, meta: baseMeta, languageContext });

  const response = await provider.refine({
    text: availableText,
    instructions,
    ...baseMeta,
    languageContext,
  });

  if (!response || typeof response.corrected !== "string") {
    throw new AppError("Grammar provider returned invalid output.", 502, "PROVIDER_ERROR");
  }

  const newRunId = randomUUID();
  const providerMeta =
    response.meta ||
    (storedRun
      ? {
          provider: storedRun.provider || "unknown",
          model: storedRun.model || null,
        }
      : {});
  return persistGrammarOutput({
    runId: newRunId,
    original: availableText,
    corrected: response.corrected,
    explanations: response.explanations,
    meta: baseMeta,
    params,
    providerMeta,
  });
};

const getHistory = (limit = 20) => {
  const requested = Number(limit);
  const safeLimit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.round(requested))) : 20;
  const rows = persistenceService.getRunsByType(TOOL_NAME, safeLimit);
  return rows.map((row) => {
    const params = parseJson(row.paramsJson) || {};
    const outputStored = parseJson(row.outputJson);
    const corrected = String(outputStored?.output?.data?.corrected || "");
    return {
      id: row.id,
      createdAt: row.createdAt,
      snippet: corrected.length > 200 ? `${corrected.slice(0, 200)}…` : corrected,
      meta: {
        goal: params.goal || DEFAULT_META.goal,
        dialect: params.dialect || DEFAULT_META.dialect,
        tone: params.tone || DEFAULT_META.tone,
        level: params.level || DEFAULT_META.level,
        preserveMeaning:
          typeof params.preserveMeaning === "boolean" ? params.preserveMeaning : DEFAULT_META.preserveMeaning,
        preserveFormatting:
          typeof params.preserveFormatting === "boolean"
            ? params.preserveFormatting
            : DEFAULT_META.preserveFormatting,
        explainChanges:
          typeof params.explainChanges === "boolean" ? params.explainChanges : DEFAULT_META.explainChanges,
      },
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
      title && title.trim().length ? title.trim() : "Grammar fix",
      JSON.stringify([]),
      "grammar",
      now
    );
  });
  return {
    id: savedId,
    runId,
    title: title && title.trim().length ? title.trim() : "Grammar fix",
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
  createGrammarRun,
  refineGrammarRun,
  getHistory,
  saveRun,
  shareRun,
};
