const { AppError } = require("../../middleware/errorHandler");
const { debugFetch } = require("../../debug/debugFetch");
const { getOpenAiApiKey, getOpenAiModelForWriter } = require("../../utils/openaiConfig");

const ensureApiKey = () => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new AppError(
      "Set OPENAI_API_KEY (and WRITER_PROVIDER=openai) to enable Writer.",
      503,
      "CONFIG_ERROR"
    );
  }
  return apiKey;
};

const getModel = () => getOpenAiModelForWriter();

const runWriter = async ({ internalPrompt, userPrompt, languageContext = {} }) => {
  if (!internalPrompt || !userPrompt) {
    throw new AppError("Internal and user prompts are required.", 500, "PROVIDER_ERROR");
  }
  const apiKey = ensureApiKey();
  const model = getModel();

  const response = await debugFetch("writer_run", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: internalPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.35,
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    let parsedError = null;
    try {
      parsedError = rawText ? JSON.parse(rawText) : null;
    } catch (parseError) {
      // keep null if parsing fails
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
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new AppError("OpenAI returned an empty writer response.", 502, "PROVIDER_ERROR");
  }

  return {
    output: content,
    meta: {
      provider: "openai",
      model,
      providerUsed: "openai",
      language: languageContext.finalLanguage,
    },
  };
};

const generate = async (params) => runWriter(params);
const refine = async (params) => runWriter(params);

module.exports = {
  generate,
  refine,
};
