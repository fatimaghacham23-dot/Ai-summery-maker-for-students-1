const FALLBACK_LANGUAGE = {
  iso6391: "en",
  iso6393: "eng",
  name: "English",
  nativeName: "English",
};

const LANGUAGE_DEFINITIONS = [
  {
    code: "en",
    iso3: "eng",
    name: "English",
    nativeName: "English",
    aliases: ["en", "english"],
  },
  {
    code: "es",
    iso3: "spa",
    name: "Spanish",
    nativeName: "Español",
    aliases: ["es", "spanish", "español", "espanol"],
  },
  {
    code: "fr",
    iso3: "fra",
    name: "French",
    nativeName: "Français",
    aliases: ["fr", "french", "français", "francais"],
  },
  {
    code: "ar",
    iso3: "arb",
    name: "Arabic",
    nativeName: "العربية",
    aliases: ["ar", "arabic", "العربية"],
  },
  {
    code: "de",
    iso3: "deu",
    name: "German",
    nativeName: "Deutsch",
    aliases: ["de", "german", "deutsch"],
  },
  {
    code: "pt",
    iso3: "por",
    name: "Portuguese",
    nativeName: "Português",
    aliases: ["pt", "portuguese", "português"],
  },
];

const SCRIPT_PATTERNS = [
  {
    code: "ar",
    name: "Arabic",
    iso3: "arb",
    pattern: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/,
  },
  {
    code: "ru",
    name: "Russian",
    iso3: "rus",
    pattern: /[\u0400-\u052F]+/,
  },
  {
    code: "el",
    name: "Greek",
    iso3: "ell",
    pattern: /[\u0370-\u03FF]+/,
  },
  {
    code: "zh",
    name: "Chinese",
    iso3: "zho",
    pattern: /[\u4E00-\u9FFF]+/,
  },
  {
    code: "ja",
    name: "Japanese",
    iso3: "jpn",
    pattern: /[\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF]+/,
  },
  {
    code: "ko",
    name: "Korean",
    iso3: "kor",
    pattern: /[\uAC00-\uD7AF\u1100-\u11FF]+/,
  },
  {
    code: "hi",
    name: "Hindi",
    iso3: "hin",
    pattern: /[\u0900-\u097F]+/,
  },
];

const LATIN_ACCENT_PATTERNS = [
  {
    code: "es",
    name: "Spanish",
    iso3: "spa",
    pattern: /[áéíóúñ¿¡]/i,
  },
  {
    code: "fr",
    name: "French",
    iso3: "fra",
    pattern: /[éèêëàâäôöûùüÿœæç]/i,
  },
  {
    code: "de",
    name: "German",
    iso3: "deu",
    pattern: /[äöüß]/i,
  },
  {
    code: "pt",
    name: "Portuguese",
    iso3: "por",
    pattern: /[ãñõáéíóúàâêîôûç]/i,
  },
];

const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

const mapDefinition = (entry) => ({
  iso6391: entry.code,
  iso6393: entry.iso3,
  name: entry.name,
  nativeName: entry.nativeName || entry.name,
});

const resolveLanguagePreference = (value) => {
  const normalized = normalizeLabel(value);
  if (!normalized) return null;
  for (const definition of LANGUAGE_DEFINITIONS) {
    const aliases = (definition.aliases || []).map((alias) => alias.toLowerCase());
    if (aliases.includes(normalized)) {
      return mapDefinition(definition);
    }
  }
  return null;
};

const detectLanguageFromText = (text) => {
  const cleaned = String(text || "").trim();
  if (!cleaned) return null;
  for (const script of SCRIPT_PATTERNS) {
    if (script.pattern.test(cleaned)) {
      return mapDefinition(script);
    }
  }
  for (const accent of LATIN_ACCENT_PATTERNS) {
    if (accent.pattern.test(cleaned)) {
      return mapDefinition(accent);
    }
  }
  return null;
};

const buildLanguageInstruction = ({ finalLanguage, requested, detected }) => {
  const label = finalLanguage?.name || "English";
  if (requested) {
    return `Respond entirely in ${label}. Do not introduce metadata labels like "Language:", and do not mix languages unless the user explicitly asks.`;
  }
  if (detected) {
    return `Respond entirely in ${label}, matching the detected input language. Do not mix languages unless the user explicitly asks.`;
  }
  return `Respond entirely in ${label} unless the user explicitly requests a different language. Do not mix languages spontaneously.`;
};

const buildLanguageContext = ({ inputText = "", requestedLanguage = "" } = {}) => {
  const detectedLanguage = detectLanguageFromText(inputText);
  const requested = requestedLanguage ? resolveLanguagePreference(requestedLanguage) : null;
  const finalLanguage = requested || detectedLanguage || FALLBACK_LANGUAGE;
  return {
    detectedLanguage,
    requestedLanguage: requested,
    finalLanguage,
    instruction: buildLanguageInstruction({
      finalLanguage,
      requested,
      detected: detectedLanguage,
    }),
  };
};

module.exports = {
  buildLanguageContext,
  detectLanguageFromText,
  resolveLanguagePreference,
};
