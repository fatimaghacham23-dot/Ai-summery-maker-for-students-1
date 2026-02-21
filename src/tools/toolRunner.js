const crypto = require("crypto");
const { AppError } = require("../middleware/errorHandler");
const { getProvider } = require("../providers");
const persistenceService = require("../services/persistenceService");
const { buildLanguageContext } = require("../utils/languageUtils");

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 50000;
const ALLOWED_TONES = new Set(["professional", "casual", "academic"]);
const ALLOWED_FOCI = new Set(["student", "manager", "lawyer", "developer"]);

const validateRequest = ({ tool, text }) => {
  if (!tool || typeof tool !== "string") {
    throw new AppError("Tool name is required.", 400, "VALIDATION_ERROR");
  }

  if (!text || typeof text !== "string") {
    throw new AppError("Text is required for tool execution.", 400, "VALIDATION_ERROR");
  }

  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) {
    throw new AppError("Text must be at least 20 characters.", 400, "VALIDATION_ERROR");
  }

  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new AppError("Text must be no more than 50000 characters.", 400, "VALIDATION_ERROR");
  }
};

const validateControls = (controls = {}) => {
  const errors = [];
  if (controls.length !== undefined && (typeof controls.length !== "number" || controls.length < 0 || controls.length > 1)) {
    errors.push("controls.length must be between 0 and 1.");
  }
  if (controls.tone && !ALLOWED_TONES.has(controls.tone)) {
    errors.push(`controls.tone must be one of: ${[...ALLOWED_TONES].join(", ")}.`);
  }
  if (controls.focus && !ALLOWED_FOCI.has(controls.focus)) {
    errors.push(`controls.focus must be one of: ${[...ALLOWED_FOCI].join(", ")}.`);
  }
  if (errors.length) {
    throw new AppError(errors.join(" "), 422, "VALIDATION_ERROR");
  }
};

const runTool = async ({ tool, text, controls = {}, options = {}, documentId }) => {
  validateRequest({ tool, text });
  validateControls(controls || {});
  const provider = getProvider();

  if (typeof provider.runTool !== "function") {
    throw new AppError("Provider does not implement tool execution.", 500, "PROVIDER_ERROR");
  }

  const runId = crypto.randomUUID();
  const trimmedText = text.trim();
  const requestedLanguage = options?.targetLanguage || controls?.language || "";
  const languageContext = buildLanguageContext({
    inputText: trimmedText,
    requestedLanguage,
  });
  const response = await provider.runTool({
    tool,
    text: trimmedText,
    controls,
    options,
    documentId,
    languageContext,
  });

  if (!response || !response.output) {
    throw new AppError("Tool execution returned an invalid response.", 502, "PROVIDER_ERROR");
  }

  persistenceService.persistRun({
    runId,
    tool,
    type: tool,
    documentId,
    params: {
      tool,
      controls,
      options,
      documentId,
      inputText: trimmedText,
      textPreview: trimmedText.slice(0, 400),
      language: languageContext.finalLanguage,
    },
    outputJson: {
      output: response.output,
      highlights: response.highlights || [],
    },
    provider: response.meta?.provider || "unknown",
    model: response.meta?.model || null,
  });

  return {
    runId,
    tool,
    output: response.output,
    highlights: response.highlights || [],
    meta: response.meta || { provider: "unknown", model: null },
  };
};

module.exports = {
  runTool,
};
