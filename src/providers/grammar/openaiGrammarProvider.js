const { AppError } = require("../../middleware/errorHandler");
const { debugFetch } = require("../../debug/debugFetch");
const { getOpenAiApiKey, getOpenAiModelForGrammar } = require("../../utils/openaiConfig");
const { buildInternalPrompt, buildUserPrompt } = require("../../services/grammarPrompts");

const ensureApiKey = () => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new AppError(
      "OPENAI_API_KEY is required to use the openai grammar provider. Set GRAMMAR_PROVIDER=openai and provide a valid key.",
      400,
      "CONFIG_ERROR"
    );
  }
  return apiKey;
};

const ensurePrompts = ({ internalPrompt, userPrompt }) => {
  if (!internalPrompt || !userPrompt) {
    throw new AppError("System and user prompts are required for grammar runs.", 500, "PROVIDER_ERROR");
  }
};

const parseChoiceContent = (payload) => {
  let content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError("OpenAI returned an empty grammar response.", 502, "PROVIDER_ERROR");
  }
  content = String(content).trim();
  if (!content) {
    throw new AppError("OpenAI returned an empty grammar response.", 502, "PROVIDER_ERROR");
  }
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    const fallback = content.match(/\{[\s\S]*\}/);
    if (fallback && fallback[0]) {
      try {
        return JSON.parse(fallback[0]);
      } catch {
        // fall through to the error below
      }
    }
    throw new AppError(
      "OpenAI grammar response was not valid JSON. Ensure the prompts request JSON output only.",
      502,
      "PROVIDER_ERROR"
    );
  }
};

const runGrammar = async (params = {}) => {
  const {
    text,
    goal,
    dialect,
    tone,
    level,
    preserveMeaning,
    preserveFormatting,
    explainChanges,
    instructions,
    isRefine = false,
    languageContext = {},
  } = params;
  const internalPrompt = buildInternalPrompt({
    goal,
    dialect,
    tone,
    level,
    preserveMeaning,
    preserveFormatting,
    explainChanges,
    instructions,
    languageInstruction: languageContext.instruction,
  });
  const userPrompt = buildUserPrompt({
    text,
    instructions,
    isRefine,
    languageInstruction: languageContext.instruction,
  });
  ensurePrompts({ internalPrompt, userPrompt });

  const apiKey = ensureApiKey();
  const model = getOpenAiModelForGrammar();

  const response = await debugFetch("grammar_run", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: internalPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    let parsedError = null;
    try {
      parsedError = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsedError = null;
    }
    const friendlyMessage =
      parsedError?.error?.message || parsedError?.message || response.statusText || "Request failed";
    if (response.status === 401) {
      throw new AppError(
        "Invalid OpenAI key. Recreate the key and update settings/.env.",
        401,
        "INVALID_API_KEY"
      );
    }
    if (response.status === 429) {
      throw new AppError("OpenAI request rate limited. Try again shortly.", 429, "RATE_LIMITED");
    }
    if (response.status >= 500 && response.status < 600) {
      throw new AppError(
        `OpenAI request failed: ${response.status} ${friendlyMessage}`,
        502,
        "PROVIDER_ERROR"
      );
    }
    throw new AppError(
      `OpenAI request failed: ${response.status} ${friendlyMessage}`,
      502,
      "PROVIDER_ERROR"
    );
  }

  const payload = await response.json();
  const parsed = parseChoiceContent(payload);
  const corrected = parsed.corrected ? String(parsed.corrected).trim() : "";
  if (!corrected) {
    throw new AppError("OpenAI grammar response missing the corrected text.", 502, "PROVIDER_ERROR");
  }
  const explanations =
    explainChanges && Array.isArray(parsed.explanations) ? parsed.explanations : undefined;

  return {
    corrected,
    explanations,
    meta: {
      provider: "openai",
      providerUsed: "openai",
      model,
    },
  };
};

const fix = async (params) => runGrammar({ ...params, isRefine: false });
const refine = async (params) => runGrammar({ ...params, isRefine: true });

module.exports = {
  fix,
  refine,
};
