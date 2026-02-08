const crypto = require("crypto");
const { createSummaryText, formatSummary, splitSentences } = require("../utils/summary");

const DEFAULT_CONTROLS = {
  length: 0.5,
  tone: "professional",
  language: "en",
  focus: "student",
};

const ALLOWED_TONES = new Set(["professional", "casual", "academic"]);
const ALLOWED_FOCI = new Set(["student", "manager", "lawyer", "developer"]);

const SUMMARY_TOOL_CONFIG = {
  "summary.short": { base: 2, min: 1, max: 4 },
  "summary.detailed": { base: 7, min: 5, max: 12 },
  "summary.bullets": { base: 5, min: 3, max: 8 },
  "summary.one_sentence": { base: 1, min: 1, max: 1 },
  "summary.tldr": { base: 3, min: 2, max: 6 },
  "summary.key_takeaways": { base: 5, min: 3, max: 7 },
  "summary.executive": { base: 6, min: 4, max: 10 },
};

const TONE_PREAMBLES = {
  professional: "Professional recap:",
  casual: "Casual recap:",
  academic: "Academic recap:",
};

const FOCUS_PREAMBLES = {
  student: "Highlights for students.",
  manager: "Focus on priorities and deliverables.",
  lawyer: "Mention compliance or obligations.",
  developer: "Call out technical and product implications.",
};

const ACTION_HEADERS = ["tasks", "tareas", "المهام", "задачи"];
const ACTION_KEYWORDS = [
  "action",
  "todo",
  "follow-up",
  "follow up",
  "next step",
  "next steps",
  "plan",
  "tarea",
  "خطة",
];

const QUESTION_HEADERS = [
  "open questions",
  "preguntas abiertas",
  "أسئلة مفتوحة",
  "открытые вопросы",
];
const DECISION_KEYWORDS = ["decision", "decisions", "decidimos", "решили", "تم الاتفاق"];

const DATE_RELATIVE_PATTERNS = [
  { regex: /\b(today|tomorrow|yesterday)\b/i, type: "date" },
  { regex: /\bby ([A-Za-z]+)\b/i, type: "deadline" },
  { regex: /\bbefore ([A-Za-z]+)\b/i, type: "deadline" },
  { regex: /\bpara el ([A-Za-z0-9, ]+)\b/i, type: "deadline" },
  { regex: /\bقبل ([A-Za-z0-9, ]+)\b/u, type: "deadline" },
  { regex: /\bдо ([A-Za-z0-9, ]+)\b/i, type: "deadline" },
];

const DATE_ABSOLUTE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]+ \d{1,2}, \d{4}\b/gi,
  /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) \d{1,2}, \d{4}\b/gi,
];

const STOPWORDS = {
  en: new Set(["the", "and", "to", "of", "a", "in", "for", "is", "on", "with", "that", "this", "are", "as", "it"]),
  es: new Set(["el", "la", "y", "de", "que", "en", "los", "para", "con", "se", "del", "las", "por", "una"]),
  ar: new Set(["و", "في", "على", "من", "أن", "إلى", "عن", "هو", "ب", "ما", "كل", "لم"]),
  ru: new Set(["и", "в", "на", "с", "что", "по", "для", "как", "это", "из", "от", "о", "не"]),
};

const normalizeControls = (controls = {}) => {
  const length =
    typeof controls.length === "number"
      ? Math.min(1, Math.max(0, controls.length))
      : DEFAULT_CONTROLS.length;
  const tone = typeof controls.tone === "string" && ALLOWED_TONES.has(controls.tone) ? controls.tone : DEFAULT_CONTROLS.tone;
  const language =
    typeof controls.language === "string" && controls.language.trim()
      ? controls.language.trim().toLowerCase()
      : DEFAULT_CONTROLS.language;
  const focus =
    typeof controls.focus === "string" && ALLOWED_FOCI.has(controls.focus)
      ? controls.focus
      : DEFAULT_CONTROLS.focus;
  return {
    length,
    tone,
    language,
    focus,
  };
};

const pickSentences = (sentences, count) => {
  if (!sentences.length) return [];
  if (count >= sentences.length) {
    return sentences;
  }
  const step = Math.max(1, Math.floor(sentences.length / count));
  const selected = [];
  for (let i = 0; i < sentences.length && selected.length < count; i += step) {
    selected.push(sentences[i]);
  }
  if (selected.length < count) {
    const extras = sentences.filter((sentence) => !selected.includes(sentence));
    selected.push(...extras.slice(0, count - selected.length));
  }
  return selected.slice(0, count);
};

const buildHighlights = (text, sentences, reasonPrefix) => {
  const highlights = [];
  let cursor = 0;
  sentences.forEach((sentence, index) => {
    if (!sentence) return;
    const start = text.indexOf(sentence, cursor);
    if (start === -1) {
      return;
    }
    highlights.push({
      start,
      end: start + sentence.length,
      reason: `${reasonPrefix}-${index}`,
      index,
    });
    cursor = start + sentence.length;
  });
  return highlights;
};

const applyControlsFlavor = (controls, sentences, tool) => {
  const toneIntro = TONE_PREAMBLES[controls.tone] || TONE_PREAMBLES.professional;
  const focusIntro = FOCUS_PREAMBLES[controls.focus] || FOCUS_PREAMBLES.student;
  const languageNote = controls.language && controls.language !== "en" ? ` (language: ${controls.language})` : "";
  const intro = `${toneIntro} ${focusIntro}${languageNote}`.trim();
  const body = sentences.join(" ");
  if (tool === "summary.one_sentence") {
    return `${intro} ${body}`.trim();
  }
  return `${intro}\n\n${body}`.trim();
};

const getSentenceCount = (tool, length) => {
  const config = SUMMARY_TOOL_CONFIG[tool] || { base: 3, min: 2, max: 8 };
  const extra = Math.round(length * 6);
  const target = config.base + extra;
  return Math.min(config.max, Math.max(config.min, target));
};

const getLanguageStopwords = (language) => {
  if (STOPWORDS[language]) {
    return STOPWORDS[language];
  }
  if (language.startsWith("es")) {
    return STOPWORDS.es;
  }
  if (language.startsWith("ar")) {
    return STOPWORDS.ar;
  }
  if (language.startsWith("ru")) {
    return STOPWORDS.ru;
  }
  return STOPWORDS.en;
};

const extractNames = (text) => {
  const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\b/g));
  const unique = [];
  matches.forEach((match) => {
    const name = match[1];
    if (!unique.includes(name)) {
      unique.push(name);
    }
  });
  return unique.slice(0, 6);
};

const detectOwner = (line) => {
  const ownerMatch = line.match(/(?:Owner|Responsable|مالك)[:\-]\s*([\w\s]+)/i);
  return ownerMatch ? ownerMatch[1].trim() : undefined;
};

const detectDue = (line) => {
  const dueMatch = line.match(/(?:due|by|before|hasta|قبل|до)\s+([A-Za-z0-9\u0600-\u06FF ,]+)/i);
  return dueMatch ? dueMatch[1].trim() : undefined;
};

const parseActionItems = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (
      line.startsWith("-") ||
      line.startsWith("*") ||
      line.startsWith("•") ||
      ACTION_KEYWORDS.some((keyword) => lower.includes(keyword)) ||
      ACTION_HEADERS.some((header) => lower.startsWith(`${header}:`))
    ) {
      candidates.push({
        text: line.replace(/^[-*•>]\s?/, "").trim(),
        owner: detectOwner(line),
        due: detectDue(line),
      });
    }
  });
  if (candidates.length) {
    return { items: candidates, usedFallback: false };
  }
  const headerIndex = lines.findIndex((line) =>
    ACTION_HEADERS.some((header) => line.toLowerCase().startsWith(header))
  );
  if (headerIndex !== -1) {
    const fallback = [];
    for (let i = headerIndex + 1; i < lines.length && fallback.length < 4; i += 1) {
      fallback.push({
        text: lines[i],
        owner: detectOwner(lines[i]),
        due: detectDue(lines[i]),
      });
    }
    if (fallback.length) {
      return { items: fallback, usedFallback: true };
    }
  }
  const sentences = splitSentences(text);
  return {
    items: sentences.slice(0, 3).map((sentence) => ({ text: sentence })),
    usedFallback: true,
  };
};

const parseQuestions = (text) => {
  const sentences = splitSentences(text);
  const candidates = sentences.filter((sentence) => sentence.includes("?"));
  if (candidates.length) {
    return { items: candidates.map((text) => ({ text })), usedFallback: false };
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    QUESTION_HEADERS.some((header) => line.toLowerCase().startsWith(header))
  );
  if (headerIndex !== -1) {
    const fallback = [];
    for (let i = headerIndex + 1; i < lines.length && fallback.length < 3; i += 1) {
      fallback.push({ text: lines[i] });
    }
    if (fallback.length) {
      return { items: fallback, usedFallback: true };
    }
  }
  const fallbackSentence = sentences.slice(-2);
  if (fallbackSentence.length) {
    return {
      items: fallbackSentence.map((text) => ({ text })),
      usedFallback: true,
    };
  }
  return { items: [{ text: text.slice(0, 80) }], usedFallback: true };
};

const parseDecisions = (text) => {
  const sentences = splitSentences(text);
  const candidates = sentences.filter((sentence) =>
    DECISION_KEYWORDS.some((keyword) => sentence.toLowerCase().includes(keyword))
  );
  if (candidates.length) {
    return { items: candidates.map((text) => ({ text })), usedFallback: false };
  }
  const fallback = sentences.slice(0, 3);
  if (fallback.length) {
    return {
      items: fallback.map((text) => ({ text })),
      usedFallback: true,
    };
  }
  return { items: [{ text: text.slice(0, 80) }], usedFallback: true };
};

const parseQuotes = (text) => {
  const matches = Array.from(text.matchAll(/["“”](.+?)["“”]/g));
  if (matches.length) {
    return {
      items: matches.map((match) => ({ text: match[1].trim() })),
      usedFallback: false,
    };
  }
  const fallbackSentences = splitSentences(text).slice(0, 2);
  if (fallbackSentences.length) {
    return {
      items: fallbackSentences.map((text) => ({ text })),
      usedFallback: true,
    };
  }
  return { items: [{ text }], usedFallback: true };
};

const parseKeywords = (text, language) => {
  const tokens = text
    .toLowerCase()
    .match(/\b[\p{L}]{3,}\b/gu)
    ?.filter(Boolean);
  if (!tokens) {
    return { items: [], usedFallback: true };
  }
  const stopwords = getLanguageStopwords(language);
  const freq = {};
  tokens.forEach((token) => {
    if (!stopwords.has(token)) {
      freq[token] = (freq[token] || 0) + 1;
    }
  });
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([text]) => ({ text }));
  if (sorted.length) {
    return { items: sorted, usedFallback: false };
  }
  return {
    items: [{ text: text.slice(0, 40) }],
    usedFallback: true,
  };
};

const parsePeople = (text) => {
  const names = extractNames(text);
  if (names.length) {
    return { items: names.map((name) => ({ text: name })), usedFallback: false };
  }
  const fallbackSentences = splitSentences(text).slice(0, 2);
  if (fallbackSentences.length) {
    return {
      items: fallbackSentences.map((text) => ({ text })),
      usedFallback: true,
    };
  }
  return { items: [{ text: text.slice(0, 80) }], usedFallback: true };
};

const parseDates = (text) => {
  const found = [];
  DATE_ABSOLUTE_PATTERNS.forEach((pattern) => {
    Array.from(text.matchAll(pattern)).forEach((match) => {
      const original = match[0];
      const parsed = new Date(original);
      const iso = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
      if (!found.some((item) => item.text === original)) {
        found.push({
          text: original,
          dateISO: iso,
          type: iso ? "date" : "date",
        });
      }
    });
  });
  if (!found.length) {
    DATE_RELATIVE_PATTERNS.forEach(({ regex, type }) => {
      const match = text.match(regex);
      if (match) {
        found.push({
          text: match[0],
          dateISO: null,
          type,
        });
      }
    });
  }
  if (found.length) {
    return { items: found.slice(0, 6), usedFallback: false };
  }
  const sentences = splitSentences(text).filter((sentence) => /\d/.test(sentence));
  if (sentences.length) {
    return {
      items: sentences.slice(0, 2).map((sentence) => ({
        text: sentence,
        type: "date",
      })),
      usedFallback: true,
    };
  }
  return { items: [{ text, type: "date" }], usedFallback: true };
};

const highlightItems = (text, items, reasonPrefix) => {
  const sentences = items.map((item) => item.text).filter(Boolean);
  return buildHighlights(text, sentences, reasonPrefix);
};

const buildExtractionResponse = (toolKey, parserResult, text, fallbackMessage) => {
  const dataKey = toolKey.split(".")[1];
  return {
    output: {
      type: "json",
      data: {
        [dataKey]: {
          items: parserResult.items,
        },
      },
    },
    highlights: highlightItems(text, parserResult.items, toolKey),
    meta: parserResult.usedFallback
      ? { notice: fallbackMessage || "No exact matches were found; heuristics were used." }
      : undefined,
  };
};

const chunkSections = (text, maxSectionChars = 3500) => {
  if (!text) {
    return [];
  }
  const sections = [];
  let cursor = 0;
  while (cursor < text.length && sections.length < 12) {
    const nextBreak = Math.min(cursor + maxSectionChars, text.length);
    let sliceEnd = nextBreak;
    const peek = text.slice(cursor, sliceEnd);
    const lastSentence = Math.max(peek.lastIndexOf(". "), peek.lastIndexOf("\n"));
    if (lastSentence > 0 && sliceEnd < text.length) {
      sliceEnd = cursor + lastSentence + 1;
    }
    if (sliceEnd <= cursor) {
      sliceEnd = cursor + maxSectionChars;
    }
    const chunk = text.slice(cursor, sliceEnd).trim();
    if (!chunk) {
      cursor = sliceEnd;
      continue;
    }
    sections.push({
      title: `Section ${sections.length + 1}`,
      text: chunk,
      index: sections.length,
    });
    cursor = sliceEnd;
  }
  return sections;
};

const renderSectionSummary = (sectionText, controls) => {
  const sectionSentences = splitSentences(sectionText);
  const sentenceCount = Math.min(5, Math.max(2, Math.round(controls.length * 4) + 1));
  const selected = pickSentences(sectionSentences, sentenceCount);
  return selected.join(" ");
};

const buildSectionedSummary = ({ text, controls, options }) => {
  const maxChars = options?.sectioned?.maxSectionChars || 3500;
  const sections = chunkSections(text, maxChars);
  if (!sections.length) {
    return {
      output: {
        type: "json",
        data: {
          sections: [
            {
              title: "Overview",
              summary: createSummaryText({ text, length: "short" }),
            },
          ],
        },
      },
      highlights: [],
    };
  }
  const payload = sections.map((section) => ({
    title: section.title,
    summary: renderSectionSummary(section.text, controls),
    index: section.index,
  }));
  const allSentences = payload.flatMap((section) => splitSentences(section.summary));
  return {
    output: {
      type: "json",
      data: {
        sections: payload,
      },
    },
    highlights: buildHighlights(text, allSentences, "summary-sectioned"),
  };
};

const runMockTool = ({ tool, text, controls = {}, options = {} }) => {
  const cleanText = (text || "").trim();
  const normalizedControls = normalizeControls(controls);
  const sentences = splitSentences(cleanText);

  if (tool === "summary.sectioned") {
    const sectionResult = buildSectionedSummary({
      text: cleanText,
      controls: normalizedControls,
      options,
    });
    const meta = normalizedControls.language !== "en" ? { notice: `Language set to ${normalizedControls.language}.` } : undefined;
    return {
      ...sectionResult,
      meta,
    };
  }

  switch (tool) {
    case "summary.short":
    case "summary.detailed":
    case "summary.bullets":
    case "summary.one_sentence":
    case "summary.tldr":
    case "summary.key_takeaways":
    case "summary.executive": {
      const sentenceCount = getSentenceCount(tool, normalizedControls.length);
      const selected = pickSentences(sentences, sentenceCount);
      const body =
        tool === "summary.bullets"
          ? formatSummary({ summaryText: selected.join(" "), format: "bullets" })
          : selected.join(" ");
      const flavored =
        tool === "summary.bullets"
          ? `${applyControlsFlavor(normalizedControls, [body], tool)}`
          : applyControlsFlavor(normalizedControls, selected, tool);
      return {
        output: {
          type: tool === "summary.key_takeaways" ? "json" : "text",
          data:
            tool === "summary.key_takeaways"
              ? { takeaways: selected }
              : flavored,
        },
        highlights: buildHighlights(cleanText, selected, `summary-${tool.split(".")[1]}`),
      };
    }
    case "extract.action_items":
      return buildExtractionResponse(
        tool,
        parseActionItems(cleanText),
        cleanText,
        "Task indicators were scarce; showing prioritized sentences."
      );
    case "extract.questions":
      return buildExtractionResponse(
        tool,
        parseQuestions(cleanText),
        cleanText,
        "No question marks were found; showing adjacent sentences."
      );
    case "extract.decisions":
      return buildExtractionResponse(
        tool,
        parseDecisions(cleanText),
        cleanText,
        "Explicit decisions were not called out; showing inferred statements."
      );
    case "extract.quotes":
      return buildExtractionResponse(
        tool,
        parseQuotes(cleanText),
        cleanText,
        "No quotes were matched; returning contextual sentences."
      );
    case "extract.keywords":
      return buildExtractionResponse(
        tool,
        parseKeywords(cleanText, normalizedControls.language),
        cleanText,
        "Keyword heuristics filled the list."
      );
    case "extract.people":
      return buildExtractionResponse(
        tool,
        parsePeople(cleanText),
        cleanText,
        "No obvious people were tagged; returning key phrases."
      );
    case "extract.dates":
      return buildExtractionResponse(
        tool,
        parseDates(cleanText),
        cleanText,
        "No concrete dates were found; returning sentences that mention timing."
      );
    case "rewrite": {
      const mode = (options?.rewrite?.mode || "shorter").toLowerCase();
      const rewriteSentences = pickSentences(sentences, Math.max(1, Math.min(sentences.length, 4)));
      if (mode === "longer") {
        const extended = `${rewriteSentences.join(" ")} ${sentences
          .slice(rewriteSentences.length, rewriteSentences.length + 2)
          .join(" ")}`.trim();
        const content = extended || rewriteSentences.join(" ");
        return {
          output: { type: "text", data: applyControlsFlavor(normalizedControls, [content], "rewrite") },
          highlights: buildHighlights(cleanText, splitSentences(content).slice(0, 3), "rewrite"),
        };
      }
      if (mode === "simpler") {
        const simpler = rewriteSentences
          .slice(0, 2)
          .map((sentence) =>
            sentence
              .toLowerCase()
              .replace(/complex|intricate/gi, "simple")
              .replace(/\butilize\b/gi, "use")
          )
          .join(" ");
        return {
          output: { type: "text", data: applyControlsFlavor(normalizedControls, [simpler], "rewrite") },
          highlights: buildHighlights(cleanText, [simpler], "rewrite"),
        };
      }
      const shorter = rewriteSentences.slice(0, Math.max(1, Math.floor(rewriteSentences.length / 2)));
      const compact = shorter.length ? shorter.join(" ") : rewriteSentences.join(" ");
      return {
        output: { type: "text", data: applyControlsFlavor(normalizedControls, [compact], "rewrite") },
        highlights: buildHighlights(cleanText, shorter.length ? shorter : rewriteSentences.slice(0, 2), "rewrite"),
      };
    }
    default:
      return {
        output: {
          type: "text",
          data: createSummaryText({ text: cleanText, length: "short" }),
        },
        highlights: buildHighlights(cleanText, sentences.slice(0, 3), "summary-default"),
      };
  }
};

const runIdFromSeed = (seed) => {
  const hash = crypto.createHash("md5").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
    16,
    20
  )}-${hash.slice(20, 32)}`;
};

module.exports = {
  runMockTool,
  normalizeControls,
  runIdFromSeed,
};
