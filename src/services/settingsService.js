const path = require("path");
const fs = require("fs");

const SETTINGS_FILE = path.resolve(__dirname, "..", "..", ".local.settings.json");
const fsPromises = fs.promises;
const { getOpenAiApiKey, normalizeOpenAiValue, normalizeOpenAiApiKey } = require("../utils/openaiConfig");
const { clearWriterProviderCache } = require("../providers/writer");

let cachedSettings = null;

const applySettingsToEnv = (settings = {}) => {
  const normalizedKey = normalizeOpenAiApiKey(settings.openaiApiKey);
  if (normalizedKey) {
    process.env.OPENAI_API_KEY = normalizedKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  const normalizedModel = normalizeOpenAiValue(settings.openaiModelWriter);
  if (normalizedModel) {
    process.env.OPENAI_MODEL_WRITER = normalizedModel;
  } else {
    delete process.env.OPENAI_MODEL_WRITER;
  }
};

const readSettingsFile = async () => {
  try {
    const raw = await fsPromises.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Unable to read .local.settings.json:", error.message || error);
    }
    return {};
  }
};

const writeSettingsFile = async (settings) => {
  const payload = JSON.stringify(settings, null, 2);
  await fsPromises.writeFile(SETTINGS_FILE, payload, "utf-8");
};

const sanitizeSettings = (settings = {}) => ({
  ...settings,
  openaiApiKey: normalizeOpenAiApiKey(settings.openaiApiKey),
  openaiModelWriter: normalizeOpenAiValue(settings.openaiModelWriter),
});

const loadLocalSettings = async () => {
  const settings = sanitizeSettings(await readSettingsFile());
  cachedSettings = settings;
  applySettingsToEnv(settings);
  return settings;
};

const getLocalSettings = () => cachedSettings || {};

const determineKeyPrefix = (key) => {
  if (!key || typeof key !== "string") {
    return null;
  }
  if (key.startsWith("sk-proj-")) {
    return "sk-proj-";
  }
  if (key.startsWith("sk-")) {
    return "sk-";
  }
  return null;
};

const getOpenAiStatus = () => {
  const localKey = normalizeOpenAiApiKey(cachedSettings?.openaiApiKey);
  const envKey = getOpenAiApiKey();
  const activeKey = localKey || envKey;
  const source = localKey ? "local_settings" : envKey ? "env" : "none";

  return {
    configured: Boolean(activeKey),
    source,
    keyPrefix: activeKey ? determineKeyPrefix(activeKey) : null,
  };
};

const saveOpenAiSettings = async ({ apiKey, modelWriter }) => {
  const keyValue = normalizeOpenAiApiKey(apiKey);
  if (!keyValue) {
    throw new Error("apiKey is required");
  }

  const nextSettings = {
    ...(cachedSettings || {}),
    openaiApiKey: keyValue,
  };

  const modelValue = normalizeOpenAiValue(modelWriter);
  if (modelValue) {
    nextSettings.openaiModelWriter = modelValue;
  } else {
    delete nextSettings.openaiModelWriter;
  }

  const sanitizedSettings = sanitizeSettings(nextSettings);
  await writeSettingsFile(sanitizedSettings);
  cachedSettings = sanitizedSettings;
  applySettingsToEnv(sanitizedSettings);
  clearWriterProviderCache();
  return sanitizedSettings;
};

module.exports = {
  loadLocalSettings,
  getLocalSettings,
  saveOpenAiSettings,
  getOpenAiStatus,
};
