const OPENAI_API_KEY_ENV = ["OPENAI_API_KEY", "OPENAI_KEY", "OPENAI_API_TOKEN"];
const OPENAI_MODEL_ENV = ["OPENAI_MODEL_WRITER", "OPENAI_MODEL", "OPENAI_MODEL_SUMMARY"];
const OPENAI_MODEL_ENV_SONG = ["OPENAI_MODEL_SONG"];
const OPENAI_MODEL_ENV_GRAMMAR = ["OPENAI_MODEL_GRAMMAR"];
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const normalizeOpenAiValue = (value) =>
  typeof value === "string" ? value.trim().replace(/\r/g, "") : "";

const getFirstEnvValue = (names) => {
  for (const name of names) {
    const normalized = normalizeOpenAiValue(process.env[name]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const getOpenAiApiKey = () => getFirstEnvValue(OPENAI_API_KEY_ENV);

const getOpenAiModelForWriter = () => getFirstEnvValue(OPENAI_MODEL_ENV) || DEFAULT_OPENAI_MODEL;
const getOpenAiModelForSong = () => getFirstEnvValue(OPENAI_MODEL_ENV_SONG) || DEFAULT_OPENAI_MODEL;
const getOpenAiModelForGrammar = () =>
  getFirstEnvValue(OPENAI_MODEL_ENV_GRAMMAR) || DEFAULT_OPENAI_MODEL;

module.exports = {
  getOpenAiApiKey,
  getOpenAiModelForWriter,
  getOpenAiModelForSong,
  getOpenAiModelForGrammar,
  normalizeOpenAiValue,
  normalizeOpenAiApiKey: normalizeOpenAiValue,
};
