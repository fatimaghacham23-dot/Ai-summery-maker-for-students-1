const { AppError } = require("../../middleware/errorHandler");
const { debugFetch } = require("../../debug/debugFetch");
const {
  getOpenAiApiKey,
  getOpenAiModelForSong,
} = require("../../utils/openaiConfig");

const ensureApiKey = () => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new AppError(
      "OPENAI_API_KEY is missing. Set it in your environment to use the openai song provider.",
      400,
      "CONFIG_ERROR"
    );
  }
  return apiKey;
};

const getModel = () => getOpenAiModelForSong();

const ensurePrompts = ({ internalPrompt, userPrompt }) => {
  if (!internalPrompt || !userPrompt) {
    throw new AppError("Internal and user prompts are required.", 500, "PROVIDER_ERROR");
  }
};

const parseSongResponse = (content) => {
  if (!content) {
    throw new AppError("OpenAI returned empty content for song.", 502, "PROVIDER_ERROR");
  }
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AppError("OpenAI song response was not valid JSON.", 502, "PROVIDER_ERROR");
  }
  if (typeof parsed !== "object" || !parsed.title || !parsed.lyrics) {
    throw new AppError("OpenAI song response is missing title or lyrics.", 502, "PROVIDER_ERROR");
  }
  return {
    title: String(parsed.title).trim(),
    lyrics: String(parsed.lyrics).trim(),
    titleIdeas: Array.isArray(parsed.titleIdeas)
      ? parsed.titleIdeas.filter((item) => item && typeof item === "string")
      : [],
  };
};

const runSong = async ({ internalPrompt, userPrompt, languageContext = {} }) => {
  ensurePrompts({ internalPrompt, userPrompt });
  const apiKey = ensureApiKey();
  const model = getModel();

  const response = await debugFetch("song_run", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.65,
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
  const content = payload.choices?.[0]?.message?.content?.trim();
  const parsed = parseSongResponse(content);
  return {
    output: {
      title: parsed.title,
      lyrics: parsed.lyrics,
      titleIdeas: parsed.titleIdeas,
    },
    meta: {
      provider: "openai",
      model,
      providerUsed: "openai",
      language: languageContext.finalLanguage,
    },
  };
};

const generate = async (params) => runSong(params);
const refine = async (params) => runSong(params);

module.exports = {
  generate,
  refine,
};
