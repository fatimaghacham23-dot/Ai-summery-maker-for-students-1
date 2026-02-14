const { request } = require("undici");
const { AppError } = require("../../src/middleware/errorHandler");
const { buildUsedPrompt } = require("../../src/image/promptHelpers");

const REQUIRED_ENV = [
  "HUGGINGFACE_API_KEY",
  "HF_ROUTER_PROVIDER",
  "HF_ROUTER_BASE_URL",
  "HF_IMAGE_MODEL",
];

const normalizeBaseUrl = (value) => String(value || "").replace(/\/+$/, "");
const trimSlashes = (value) => String(value || "").replace(/^\/+|\/+$/g, "");

const ensureEnv = () => {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) {
    throw new AppError(
      `Missing environment variables: ${missing.join(", ")}`,
      500,
      "CONFIG_ERROR"
    );
  }
};

const buildRouterConfig = () => {
  ensureEnv();
  const baseUrl = normalizeBaseUrl(process.env.HF_ROUTER_BASE_URL);
  const provider = trimSlashes(process.env.HF_ROUTER_PROVIDER);
  const model = trimSlashes(process.env.HF_IMAGE_MODEL);
  return {
    baseUrl,
    provider,
    model,
    route: `${baseUrl}/${provider}/models/${model}`,
  };
};

const ROUTER_HEADERS = () => ({
  Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
  "Content-Type": "application/json",
  Accept: "image/png",
});

const getHeaderValue = (headers, key) => {
  if (!headers) {
    return null;
  }
  const normalizedKey = key.toLowerCase();
  const headerValue = headers[normalizedKey] || headers[key];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue || null;
};

const parseResponseError = async (body) => {
  try {
    const text = await body.text();
    if (!text) {
      return "Unexpected response from Hugging Face";
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) {
        return parsed.error;
      }
      if (parsed?.message) {
        return parsed.message;
      }
      return text;
    } catch {
      return text;
    }
  } catch (innerError) {
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
        `Hugging Face Router provider "${provider}" and model "${model}" returned ${response.statusCode} during validation.`,
        502,
        "hf-model-unavailable"
      );
    }

    if (response.statusCode >= 500) {
      throw new AppError(
        `Failed to validate Hugging Face Router route for provider "${provider}" and model "${model}". Received ${response.statusCode}.`,
        502,
        "hf-model-unavailable"
      );
    }

    return true;
  })();

  return routerValidationPromise;
};

const buildRequestBody = (usedPrompt) => ({
  inputs: usedPrompt,
  parameters: {
    num_inference_steps: 4,
  },
});

const fetchSingleImage = async (usedPrompt) => {
  const { route, provider, model } = buildRouterConfig();
  const body = JSON.stringify(buildRequestBody(usedPrompt));

  const response = await request(route, {
    method: "POST",
    headers: ROUTER_HEADERS(),
    body,
  });

  if ([401, 403, 404].includes(response.statusCode)) {
    const message = await parseResponseError(response.body);
    throw new AppError(
      `Hugging Face Router provider "${provider}" model "${model}" returned ${response.statusCode}: ${message}`,
      502,
      "hf-model-unavailable"
    );
  }

  if (response.statusCode >= 400) {
    const message = await parseResponseError(response.body);
    throw new AppError(message, 502, "hf-error");
  }

  const contentType = String(
    getHeaderValue(response.headers, "content-type") || ""
  ).toLowerCase();

  if (!contentType.startsWith("image/")) {
    const message = await parseResponseError(response.body);
    throw new AppError(message, 502, "hf-error");
  }

  const buffer = Buffer.from(await response.body.arrayBuffer());
  const mimeType = contentType.split(";")[0] || "image/png";
  const base64 = buffer.toString("base64");

  return {
    model,
    payload: {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      imageBase64: base64,
      b64: base64,
      byteLength: buffer.byteLength,
      contentType: mimeType,
    },
  };
};

const generateImages = async ({ prompt, style, size, quality, format, n = 4 }) => {
  ensureEnv();

  await ensureRouterModelAvailable();

  const usedPrompt = buildUsedPrompt({ prompt, style, quality });
  const limit = Math.max(1, Math.min(4, Number.isFinite(n) ? Number(n) : 1));

  const images = [];
  let rawInfo = null;
  let workingModel = null;

  for (let index = 0; index < limit; index += 1) {
    const { model, payload: imagePayload } = await fetchSingleImage(usedPrompt);
    workingModel = model;

    images.push({
      ...imagePayload,
      revisedPrompt: null,
    });

    if (!rawInfo) {
      rawInfo = {
        contentType: imagePayload.contentType,
        byteLength: imagePayload.byteLength,
      };
    }
  }

  return {
    provider: "huggingface",
    model: workingModel || trimSlashes(process.env.HF_IMAGE_MODEL),
    usedPrompt,
    style,
    size,
    quality,
    format,
    images,
    raw: rawInfo || { contentType: "image/png", byteLength: 0 },
  };
};

module.exports = {
  generateImages,
  ensureRouterModelAvailable,
};
