const mockWriterProvider = require("./mockWriterProvider");
const openaiWriterProvider = require("./openaiWriterProvider");
const { resolveProviderName } = require("../providerSelector");

let cachedProvider = null;

const buildProvider = () => {
  const providerKey = resolveProviderName({
    toolName: "Writer",
    configuredProvider: process.env.WRITER_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  return providerKey === "openai" ? openaiWriterProvider : mockWriterProvider;
};

const getWriterProvider = () => {
  if (!cachedProvider) {
    cachedProvider = buildProvider();
  }
  return cachedProvider;
};

const clearWriterProviderCache = () => {
  cachedProvider = null;
};

module.exports = {
  getWriterProvider,
  clearWriterProviderCache,
};
