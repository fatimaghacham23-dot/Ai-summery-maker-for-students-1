const { AppError } = require("../middleware/errorHandler");
const { getOpenAiApiKey } = require("../utils/openaiConfig");

const isProduction = () =>
  (String(process.env.NODE_ENV || "").trim().toLowerCase() || "development") === "production";

const resolveProviderName = ({
  toolName,
  configuredProvider,
  availableProviders = [],
  fallbackWithoutKey = "mock",
} = {}) => {
  const normalizedConfigured = (configuredProvider || "").trim().toLowerCase();
  const providerList = new Set(availableProviders.map((name) => String(name || "").trim().toLowerCase()));
  const hasKey = Boolean(getOpenAiApiKey());

  const ensureSupported = (name) => {
    if (!providerList.has(name)) {
      throw new AppError(
        `${toolName} provider must be one of: ${Array.from(providerList).join(", ")}.`,
        400,
        "CONFIG_ERROR"
      );
    }
  };

  if (normalizedConfigured) {
    ensureSupported(normalizedConfigured);
    if (normalizedConfigured === "openai" && !hasKey) {
      throw new AppError(
        "OPENAI_API_KEY is required to use OpenAI providers. Configure the key and try again.",
        400,
        "CONFIG_ERROR"
      );
    }
    return normalizedConfigured;
  }

  if (!hasKey) {
    if (isProduction()) {
      throw new AppError(
        `OPENAI_API_KEY is required to power ${toolName} in production.`,
        400,
        "CONFIG_ERROR"
      );
    }
    return fallbackWithoutKey;
  }

  return "openai";
};

module.exports = {
  resolveProviderName,
};
