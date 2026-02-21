const { getOpenAiApiKey } = require("../utils/openaiConfig");

const AVAILABLE_PROVIDERS = ["openai", "huggingface", "mock"];
const HF_ROUTER_KEYS = ["HF_ROUTER_BASE_URL", "HF_ROUTER_PROVIDER", "HF_IMAGE_MODEL"];

const normalizeValue = (value) => (typeof value === "string" ? value.trim() : "");
const hasValue = (value) => Boolean(normalizeValue(value));
const parseBooleanFlag = (value) => String(value || "").toLowerCase() === "true";

const NODE_ENV = (process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION_ENV = NODE_ENV === "production";

const getHfToken = () => normalizeValue(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY);

const getImageProviderStatus = () => {
  const requestedRaw = normalizeValue(process.env.IMAGE_PROVIDER);
  const requestedProvider = requestedRaw ? requestedRaw.toLowerCase() : null;
  const provider = requestedProvider && AVAILABLE_PROVIDERS.includes(requestedProvider)
    ? requestedProvider
    : null;

  const missingEnvVars = [];

  if (!requestedProvider) {
    missingEnvVars.push("IMAGE_PROVIDER");
  } else if (!provider) {
    missingEnvVars.push(`IMAGE_PROVIDER must be one of ${AVAILABLE_PROVIDERS.join(", ")}`);
  }

  if (provider === "openai" && !getOpenAiApiKey()) {
    missingEnvVars.push("OPENAI_API_KEY|OPENAI_KEY|OPENAI_API_TOKEN");
  }

  if (provider === "huggingface") {
    if (!getHfToken()) {
      missingEnvVars.push("HF_TOKEN or HUGGINGFACE_API_KEY");
    }
    HF_ROUTER_KEYS.forEach((key) => {
      if (!hasValue(process.env[key])) {
        missingEnvVars.push(key);
      }
    });
  }

  const hasUseMockOverride = typeof process.env.USE_MOCK_IMAGE_PROVIDER !== "undefined";
  const useMockOverride = parseBooleanFlag(process.env.USE_MOCK_IMAGE_PROVIDER);
  const configured = Boolean(provider && missingEnvVars.length === 0);

  let shouldMock = false;
  let reason = null;

  if (hasUseMockOverride) {
    shouldMock = useMockOverride;
    reason = useMockOverride ? "FORCED_TRUE" : "FORCED_FALSE";
  } else if (provider === "mock") {
    shouldMock = true;
    reason = "FORCED_TRUE";
  } else if (!configured) {
    shouldMock = false;
    reason = "MISSING_ENV_VARS";
  } else if (IS_PRODUCTION_ENV) {
    shouldMock = false;
    reason = "PRODUCTION_NO_MOCK";
  } else {
    shouldMock = false;
    reason = "CONFIGURED_NO_MOCK";
  }

  return {
    availableProviders: [...AVAILABLE_PROVIDERS],
    provider,
    requestedProvider,
    missingEnvVars,
    shouldMock,
    reason,
    configured,
    isProductionEnv: IS_PRODUCTION_ENV,
    hasUseMockOverride,
  };
};

module.exports = {
  AVAILABLE_PROVIDERS,
  getImageProviderStatus,
};
