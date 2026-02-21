const mockSongProvider = require("./mockSongProvider");
const openaiSongProvider = require("./openaiSongProvider");
const { resolveProviderName } = require("../providerSelector");

let cachedProvider = null;

const buildProvider = () => {
  const providerKey = resolveProviderName({
    toolName: "Song generator",
    configuredProvider: process.env.SONG_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  return providerKey === "openai" ? openaiSongProvider : mockSongProvider;
};

const getSongProvider = () => {
  if (!cachedProvider) {
    cachedProvider = buildProvider();
  }
  return cachedProvider;
};

const clearSongProviderCache = () => {
  cachedProvider = null;
};

module.exports = {
  getSongProvider,
  clearSongProviderCache,
};
