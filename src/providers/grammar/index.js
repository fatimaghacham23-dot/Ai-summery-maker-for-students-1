const mockGrammarProvider = require("./mockGrammarProvider");
const openaiGrammarProvider = require("./openaiGrammarProvider");
const { resolveProviderName } = require("../providerSelector");

let cachedProvider = null;

const buildProvider = () => {
  const providerKey = resolveProviderName({
    toolName: "Grammar fixer",
    configuredProvider: process.env.GRAMMAR_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  return providerKey === "openai" ? openaiGrammarProvider : mockGrammarProvider;
};

const getGrammarProvider = () => {
  if (!cachedProvider) {
    cachedProvider = buildProvider();
  }
  return cachedProvider;
};

const clearGrammarProviderCache = () => {
  cachedProvider = null;
};

module.exports = {
  getGrammarProvider,
  clearGrammarProviderCache,
};
