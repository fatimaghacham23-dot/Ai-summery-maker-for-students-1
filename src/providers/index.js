const mockProvider = require("./mockProvider");
const openaiProvider = require("./openaiProvider");
const { resolveProviderName } = require("./providerSelector");

const providers = {
  mock: mockProvider,
  openai: openaiProvider,
};

const getProvider = () => {
  const providerKey = resolveProviderName({
    toolName: "Summarizer",
    configuredProvider: process.env.SUMMARIZER_PROVIDER,
    availableProviders: Object.keys(providers),
    fallbackWithoutKey: "mock",
  });
  return providers[providerKey] || mockProvider;
};

module.exports = {
  getProvider,
};
