const { AppError } = require("../../src/middleware/errorHandler");
const { buildUsedPrompt } = require("../../src/image/promptHelpers");
const { getOpenAiApiKey } = require("../../src/utils/openaiConfig");
const { getImageProviderStatus } = require("../../src/config/imageProviderStatus");

const HISTORY_LIMIT = 50;
const IMAGE_SIZE_OPTIONS = ["1024x1024", "1024x1536", "1536x1024"];
const DEFAULT_IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const MOCK_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAD+Msi5AAAAKklEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAICLAABwE5fAAAGW6k7fAAAAAElFTkSuQmCC";

<<<<<<< HEAD

const normalizeBaseUrl = (value) => String(value || "").replace(/\/+$/, "");
const trimSlashes = (value) => String(value || "").replace(/^\/+|\/+$/g, "");

const imageHistory = [];

const generateId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const addToHistory = (entry) => {
  imageHistory.unshift(entry);
  if (imageHistory.length > HISTORY_LIMIT) {
    imageHistory.length = HISTORY_LIMIT;
  }
};

const getMockImage = () => ({
  provider: "mock",
  model: null,
  imageUrl: MOCK_IMAGE_DATA_URL,
  mimeType: "image/png",
});

const getHfToken = () => normalizeValue(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY);

const buildRouterConfig = () => {
  const baseUrl = normalizeBaseUrl(process.env.HF_ROUTER_BASE_URL);
  const provider = trimSlashes(process.env.HF_ROUTER_PROVIDER);
  const model = trimSlashes(process.env.HF_IMAGE_MODEL);

  if (!baseUrl || !provider || !model) {
    throw new AppError("Missing Hugging Face router configuration", 500, "CONFIG_ERROR");
  }

  return {
    baseUrl,
    provider,
    model,
    route: `${baseUrl}/${provider}/models/${model}`,
  };
};

const ROUTER_HEADERS = () => {
  const token = getHfToken();
  if (!token) {
    throw new AppError("Hugging Face token missing for router access", 400, "CONFIG_ERROR");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "image/png",
  };
};

const parseSize = (value) => {
  const [width, height] = String(value || "")
    .split("x")
    .map((segment) => Number(segment) || 0);
  return {
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
};

const buildHfRequestBody = (usedPrompt, size) => {
  const { width, height } = parseSize(size);
  const payload = {
    inputs: usedPrompt,
    parameters: {
      num_inference_steps: 28,
    },
  };
  if (width) {
    payload.parameters.width = width;
  }
  if (height) {
    payload.parameters.height = height;
  }
  return payload;
};

const getHeaderValue = (headers, key) => {
  if (!headers) return null;
  const normalizedKey = key.toLowerCase();
  const value = headers[normalizedKey] || headers[key];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

const parseResponseError = async (body) => {
  if (!body) {
    return "Unexpected response from Hugging Face";
  }
=======
const generateImages = async ({
  prompt,
  style,
  size,
  quality,
  format,
  n = 1,
}) => {
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
  try {
    const usedPrompt = buildUsedPrompt({ prompt, style, quality });

    const limit = Math.max(1, Math.min(4, Number(n) || 1));
    const images = [];

    for (let i = 0; i < limit; i++) {
      const response = await fetch(
        "https://api-inference.huggingface.co/models/aiyouthalliance/Free-Image-Generation",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "image/png",
          },
          body: JSON.stringify({
            inputs: usedPrompt,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HF error ${response.status}: ${text}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      images.push({
        dataUrl: `data:image/png;base64,${base64}`,
        mimeType: "image/png",
        imageBase64: base64,
        b64: base64,
        byteLength: buffer.byteLength,
        contentType: "image/png",
        revisedPrompt: null,
      });
    }
<<<<<<< HEAD
  } catch (error) {
    return "Unexpected Hugging Face error";
  }
};

let routerValidationPromise = null;

const ensureRouterModelAvailable = async () => {
  if (routerValidationPromise) {
    return routerValidationPromise;
  }
  routerValidationPromise = (async () => {
    const { route, provider, model } = buildRouterConfig();
    const response = await request(route, {
      method: "HEAD",
      headers: {
        Authorization: ROUTER_HEADERS().Authorization,
      },
    });
    if ([401, 403, 404].includes(response.statusCode)) {
      throw new AppError(
        `Hugging Face Router provider "${provider}" / model "${model}" returned ${response.statusCode}.`,
        502,
        "hf-model-unavailable"
      );
    }
    if (response.statusCode >= 500) {
      throw new AppError(
        `Unable to validate Hugging Face Router route (status ${response.statusCode}).`,
        502,
        "hf-model-unavailable"
      );
    }
    return true;
  })();
  return routerValidationPromise;
};

const fetchSingleHfImage = async (usedPrompt, size) => {
  const { route, provider, model } = buildRouterConfig();
  const body = JSON.stringify(buildHfRequestBody(usedPrompt, size));
  const response = await request(route, {
    method: "POST",
    headers: ROUTER_HEADERS(),
    body,
  });
  if ([401, 403, 404].includes(response.statusCode)) {
    const message = await parseResponseError(response.body);
    throw new AppError(
      `Hugging Face Router provider "${provider}" / model "${model}" returned ${response.statusCode}: ${message}`,
=======

    return {
      provider: "huggingface-free",
      model: "aiyouthalliance/Free-Image-Generation",
      usedPrompt,
      style,
      size,
      quality,
      format,
      images,
      raw: {
        contentType: "image/png",
        byteLength: images[0]?.byteLength || 0,
      },
    };
  } catch (error) {
    throw new AppError(
      error.message || "Hugging Face free image generation failed",
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
      502,
      "hf-free-error"
    );
  }
<<<<<<< HEAD
  if (response.statusCode >= 400) {
    const message = await parseResponseError(response.body);
    throw new AppError(message, 502, "hf-error");
  }
  const contentType = String(getHeaderValue(response.headers, "content-type") || "")
    .toLowerCase();
  if (!contentType.startsWith("image/")) {
    const message = await parseResponseError(response.body);
    throw new AppError(message, 502, "hf-error");
  }
  const buffer = Buffer.from(await response.body.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = contentType.split(";")[0] || "image/png";
  return {
    model,
    contentType: mimeType,
    byteLength: buffer.byteLength,
    dataUrl: `data:${mimeType};base64,${base64}`,
    imageBase64: base64,
  };
};

const callHuggingface = async ({ usedPrompt, size }) => {
  await ensureRouterModelAvailable();
  const result = await fetchSingleHfImage(usedPrompt, size);
  return {
    provider: "huggingface",
    model: result.model,
    imageUrl: result.dataUrl,
    mimeType: result.contentType,
    byteLength: result.byteLength,
  };
};

const callOpenAi = async ({ usedPrompt, size }) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new AppError(
      "OPENAI_API_KEY is missing. Configure OPENAI_API_KEY, OPENAI_KEY, or OPENAI_API_TOKEN.",
      400,
      "CONFIG_ERROR"
    );
  }
  const model = DEFAULT_IMAGE_MODEL;
  const response = await request("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: usedPrompt,
      model,
      size,
      n: 1,
      response_format: "b64_json",
    }),
  });
  const rawBody = await response.body.text();
  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new AppError("OpenAI returned invalid response", 502, "PROVIDER_ERROR");
  }
  if (response.statusCode >= 400) {
    const message =
      payload?.error?.message ||
      payload?.error?.details ||
      payload?.message ||
      `OpenAI responded with status ${response.statusCode}`;
    throw new AppError(message, 502, "PROVIDER_ERROR");
  }
  const firstData = Array.isArray(payload?.data) ? payload.data[0] : null;
  const base64 = firstData?.b64_json;
  const url = firstData?.url;
  if (!base64 && !url) {
    throw new AppError("OpenAI did not return an image", 502, "PROVIDER_ERROR");
  }
  const imageUrl = base64
    ? `data:image/png;base64,${base64}`
    : url || MOCK_IMAGE_DATA_URL;
  return {
    provider: "openai",
    model,
    imageUrl,
    mimeType: base64 ? "image/png" : "image/png",
    byteLength: base64 ? Buffer.from(base64, "base64").byteLength : 0,
  };
};

const buildHistoryRecord = ({
  provider,
  prompt,
  usedPrompt,
  imageUrl,
  revisedPrompt,
  model,
  size,
  quality,
  style,
}) => {
  const entry = {
    id: generateId(),
    prompt,
    usedPrompt,
    revisedPrompt: revisedPrompt || null,
    provider,
    imageUrl,
    model: model || null,
    size: size || null,
    quality: quality || null,
    style: style || null,
    createdAt: new Date().toISOString(),
  };
  addToHistory(entry);
  return entry;
};

const getHistory = () => [...imageHistory];

const buildMissingConfigError = (missingEnvVars) => {
  const missingList = missingEnvVars.length ? missingEnvVars.join(", ") : "IMAGE_PROVIDER";
  return new AppError(
    `Image provider configuration missing: ${missingList}. Set USE_MOCK_IMAGE_PROVIDER=true to mock until credentials are supplied.`,
    400,
    "CONFIG_ERROR"
  );
};

const ensureProviderFromStatus = (status) => {
  if (status.shouldMock) {
    return "mock";
  }
  if (!status.provider || status.missingEnvVars.length > 0) {
    throw buildMissingConfigError(status.missingEnvVars);
  }
  return status.provider;
};

const getEnvStatus = () => {
  const status = getImageProviderStatus();
  return {
    ok: status.configured,
    provider: status.provider,
    missing: [...status.missingEnvVars],
    shouldMock: status.shouldMock,
    reason: status.reason,
    configured: status.configured,
    isProductionEnv: status.isProductionEnv,
    hasUseMockOverride: status.hasUseMockOverride,
  };
};

const generateImage = async ({ prompt, style, size, quality }) => {
  const status = getImageProviderStatus();
  const provider = ensureProviderFromStatus(status);
  const usedPrompt = buildUsedPrompt({ prompt, style, quality });
  const normalizedSize = IMAGE_SIZE_OPTIONS.includes(size) ? size : IMAGE_SIZE_OPTIONS[0];

  let result;
  switch (provider) {
    case "openai":
      result = await callOpenAi({ usedPrompt, size: normalizedSize });
      break;
    case "huggingface":
      result = await callHuggingface({ usedPrompt, size: normalizedSize });
      break;
    case "mock":
      result = getMockImage();
      break;
    default:
      throw new AppError("Unsupported image provider", 500, "CONFIG_ERROR");
  }

  const record = buildHistoryRecord({
    provider: result.provider,
    prompt,
    usedPrompt,
    imageUrl: result.imageUrl,
    revisedPrompt: result.revisedPrompt,
    model: result.model,
    size: normalizedSize,
    quality,
    style,
  });

  return {
    imageUrl: result.imageUrl,
    provider: result.provider,
    model: result.model,
    size: normalizedSize,
    quality,
    style,
    usedPrompt,
    revisedPrompt: record.revisedPrompt,
    historyId: record.id,
  };
};

module.exports = {
  generateImage,
  getEnvStatus,
  ensureRouterModelAvailable,
  getHistory,
=======
};

module.exports = {
  generateImages,
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
};
