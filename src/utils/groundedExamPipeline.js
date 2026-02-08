const crypto = require("crypto");
const { retrieveRelevantChunks } = require("../knowledge/retrieve");

const API_VERSION = 2;
const PIPELINE_VERSION = "grounded-1.0";

const POINTS_BY_TYPE = {
  mcq: 1,
  trueFalse: 1,
  shortAnswer: 2,
  fillBlank: 1,
};

const BLANK_TOKEN = "____";
const MIN_TF_FB_SENTENCE_CHARS = 20;
const MIN_FILLBLANK_CONTEXT_TOKENS = 3;
const MIN_FILLBLANK_WORDS_AFTER_BLANK = 6;
const MIN_FILLBLANK_CONTEXT_WORDS = 12;
const EXTRA_FILLBLANK_ATTEMPTS = 6;
const MAX_FILLBLANK_TEMPLATE_FAILURES = 3;
const MAX_FILLBLANK_COMPLETION_ATTEMPTS = 10;
const MAX_MCQ_COMPLETION_ATTEMPTS = 10;
const MAX_TEMPLATE_FAILURES = 4;
const KNOWLEDGE_LIMIT_PER_SUBJECT = 2;

const DEFAULT_STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "study",
  "notes",
  "note",
  "text",
  "topic",
  "topics",
  "concept",
  "concepts",
  "important",
  "importance",
  "provide",
  "provided",
  "provides",
  "including",
  "include",
  "includes",
  "example",
  "examples",
  "statement",
  "statements",
  "correct",
  "incorrect",
  "option",
  "options",
  "identify",
  "identifies",
  "identified",
  "true",
  "false",
  "whether",
  "claim",
  "explain",
  "describe",
  "compare",
  "complete",
  "missing",
  "fill",
  "blank",
  "term",
  "choose",
  "select",
  "following",
  "based",
  "described",
  "description",
  "match",
  "matches",
  "fit",
  "fits",
  "student",
  "observes",
  "main",
  "changes",
  "happens",
  "related",
  "best",
  "source",
  "inconsistent",
]);

const normalizeSubjectKey = (subject) => String(subject || "").trim().toLowerCase();

const canonicalSubjectKey = (subject) => normalizeSubjectKey(subject);

const isHistorySubject = (subjectCategory) => canonicalSubjectKey(subjectCategory) === "history";

const BANNED_STEM_REGEXES = [
  /which statement best matches/i,
  /which best describes/i,
  /according to the provided text/i,
  /which concept is described/i,
  /a student observes/i,
  /which term matches this description/i,
  /describe the role or function of/i,
  /compare .* with a related idea/i,
];

const BANNED_PROMPT_PHRASE_REGEXES = [
  /\bfield study\b/i,
  /\bappears\b/i,
  /\boccurs\b/i,
];

const MIN_SCENARIO_TERMS = 2;
const GENERIC_SCENARIO_TOKENS = new Set([
  "process",
  "topic",
  "concept",
  "idea",
  "thing",
  "example",
  "study",
  "statement",
  "sentence",
  "scenario",
  "text",
]);

const ACTION_VERB_REGEX = /\b(?:protects?|supports?|describes?|reports?|observes?|explains?|highlights?|documents?|records?|enforces?|focuses?|promotes?|ensures?|leads?|causes?|results?|affects?|develops?|builds?|advances?|expands?|defends?|regulates?|maintains?|delivers?|connects?|guides?|advocates?|challenges?|celebrates?|analyzes?|studies?|compares?|investigates?|examines?|evaluates?|applies?|creates?|improves?)\b/i;

const SAFE_SCENARIO_WRAPPERS = [
  ({ phrase, actionVerb, focus }) =>
    `In class, ${phrase} ${actionVerb} ${focus}. Which option best matches the evidence?`,
  ({ phrase, actionVerb, focus }) =>
    `In a report, ${phrase} ${actionVerb} ${focus}. Which statement reflects that finding?`,
  ({ phrase, actionVerb, focus }) =>
    `A student observes ${phrase} ${actionVerb} ${focus}. Which conclusion matches the observation?`,
];

const buildMarkerRegexFromList = (values) => {
  const escaped = values.map((value) =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
};

const CAUSE_MARKERS = ["because", "due to", "leads to", "results in", "effects", "effects of", "causes", "is caused by"];
const CAUSE_MARKER_REGEX = buildMarkerRegexFromList(CAUSE_MARKERS);

const CLASSIFICATION_MARKERS = [
  "such as",
  "including",
  "consists of",
  "comprises",
  "features",
  "is made of",
  "are examples of",
  "is an example of",
  "examples include",
];
const CLASSIFICATION_MARKER_REGEX = buildMarkerRegexFromList(CLASSIFICATION_MARKERS);

const COMPARISON_MARKERS = ["whereas", "while", "contrast", "compared to", "vs", "versus"];
const COMPARISON_MARKER_REGEX = buildMarkerRegexFromList(COMPARISON_MARKERS);

const BANNED_PHRASES = [
  "in practice",
  "in a practical context",
  "connects to",
  "influences outcomes",
  "described in the notes",
];

const RELIABILITY_CRITERIA_REGEX = /\b(origin|purpose|content|bias)\b/i;
const GOVERNMENT_FORM_REGEX = /\b(monarchy|democracy|republic|empire)\b/i;
const CHRONOLOGY_CONTEXT_REGEX =
  /\b(timeline|century|decade|bc|bce|ad|ce|year|date|era|period|[12]\d{3}s?)\b/i;

const PROMPT_MIN_WORDS = {
  default: 7,
  fillBlank: 5,
};

const UNRESOLVED_PLACEHOLDER_REGEXES = [
  /<[^>]*>/,
  /\{\{[^}]*\}\}/,
  /\[[^\]]*\]/,
  /\b(todo|tbd|fixme)\b/i,
];

const ENGLISH_DEVICE_TERMS = [
  "metaphor",
  "simile",
  "personification",
  "hyperbole",
  "alliteration",
  "imagery",
  "onomatopoeia",
  "irony",
  "foreshadowing",
  "symbolism",
];

const ENGLISH_GRAMMAR_TERMS = [
  "comma splice",
  "run-on sentence",
  "sentence fragment",
  "subject-verb agreement",
  "pronoun-antecedent agreement",
  "verb tense shift",
  "misplaced modifier",
  "parallel structure",
];

const ENGLISH_WRITING_TERMS = [
  "clarity",
  "concision",
  "word choice",
  "tone",
  "sentence variety",
  "strong verbs",
];

const MAX_TEMPLATE_SHARE = 0.35;
const PROMPT_SIMILARITY_THRESHOLD = 0.82;
const ANSWER_EVIDENCE_OVERLAP_LIMIT = 0.3;
const PROMPT_EVIDENCE_SIMILARITY_STRICT = 0.86;
const TF_PROMPT_EVIDENCE_SIMILARITY_LIMIT = 0.94;
const MATH_MCQ_OVERLAP_LIMIT = 0.85;
const MATH_MCQ_FORMULA_OVERLAP_LIMIT = 0.9;
const MATH_MCQ_NEAR_IDENTICAL_THRESHOLD = 0.97;
const MAX_TF_FAMILY_FAILURES = 3;
const MAX_TF_REWRITE_ATTEMPTS = 2;
const MAX_PROMPT_UNSEEN_TOKENS = 3;
const MIN_CHOICE_KEYWORD_MATCHES = 2;
const MAX_GENERATION_ATTEMPTS = 8;
const CORE_MCQ_TARGET_SHARE = 0.75;
const MATH_TF_MIN_OVERLAP = 0.35;

const MATH_TF_GLUE_TOKENS = new Set([
  "true",
  "false",
  "equals",
  "is",
  "are",
  "a",
  "an",
  "the",
  "means",
]);

const ALLOWED_GLUE_TOKENS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "equals",
  "equal",
  "of",
  "to",
  "in",
  "for",
  "and",
  "or",
  "by",
  "as",
  "with",
  "from",
  "on",
  "at",
  "that",
  "this",
  "these",
  "those",
]);

const SCENARIO_WRAPPER_TOKENS = new Set([
  ...ALLOWED_GLUE_TOKENS,
  "which",
  "what",
  "when",
  "where",
  "who",
  "how",
  "why",
  "option",
  "options",
  "choose",
  "select",
  "most",
  "best",
  "describe",
  "explain",
  "student",
  "teacher",
  "historian",
  "source",
  "evidence",
  "text",
  "scenario",
  "context",
  "about",
  "described",
  "type",
  "changes",
  "happens",
  "form",
  "does",
  "not",
  "fit",
  "works",
  "statement",
  "accurately",
  "defines",
  "uses",
  "should",
  "applied",
  "description",
  "refers",
  "property",
  "classifies",
  "rather",
  "than",
  "applies",
  "situation",
  "involves",
  "involved",
  "involving",
  "correct",
  "error",
  "process",
  "real",
  "world",
  "case",
  "contains",
  "next",
  "step",
  "gives",
  "circle",
  "imagine",
  "distinguishes",
  "role",
  "play",
  "you",
  "researching",
  "would",
  "circumference",
  "primarily",
  "responsible",
  "volume",
  "cylinder",
  "while",
  "improving",
  "algorithmic",
]);
const SCENARIO_EVIDENCE_TOKEN_RATIO_THRESHOLD = 0.7;
const MAX_SCENARIO_WRAPPER_TOKENS = 10;
const MATH_TF_TEMPLATE_IDS = new Set([
  "tf_math_direct",
  "tf_math_mutated",
  "tf_math_fallback_safe",
]);

const MATH_TF_MUTATION_TERMS = {
  number_types: ["natural", "whole", "integer", "integers", "rational", "irrational", "real"],
  geometry_formulas: [
    "area",
    "perimeter",
    "circumference",
    "volume",
    "radius",
    "diameter",
    "triangle",
    "circle",
    "cylinder",
  ],
  averages_ratio: ["mean", "median", "mode", "range", "average", "ratio", "proportion"],
  fraction_percent: ["proper", "improper", "mixed", "fraction", "percent", "decimal"],
};

const MATH_MCQ_LOOSE_FAMILIES = new Set([
  "math-definition",
  "math-core",
  "equations",
  "statement-correct",
]);

const MATH_MCQ_RELAXATION_TEMPLATE_IDS = new Set([
  "mcq_math_definition",
  "mcq_math_definition_fallback",
  "mcq_math_category",
  "mcq_equation_process",
  "mcq_statement_correct",
]);

const SUBJECT_SCENARIO_FAMILY_DATA = {
  history: [
    "history-sources",
    "history-reliability",
    "history-chronology",
    "history-government",
    "history-cause",
    "history-rights",
  ],
  math: ["math-application", "math-core", "math-error", "math-classify"],
  science: [
    "science-cause",
    "science-function",
    "science-classify",
    "organelles",
    "equations",
    "genetics",
    "ecology",
  ],
  english: ["english-grammar", "english-device", "english-improvement", "english-voice"],
  geography: ["geography-scenario", "geography-climate", "geography-resources"],
  cs: ["cs-ipo", "cs-hardware", "cs-algorithm", "cs-data"],
};

const SUBJECT_SCENARIO_FAMILY_LOOKUP = new Map(
  Object.entries(SUBJECT_SCENARIO_FAMILY_DATA).map(([subject, families]) => [
    subject,
    new Set(families),
  ])
);

const FAMILY_SUBJECT_MAP = new Map();
SUBJECT_SCENARIO_FAMILY_LOOKUP.forEach((families, subject) => {
  families.forEach((family) => FAMILY_SUBJECT_MAP.set(family, subject));
});

const MCQ_SCENARIO_FAMILIES = (() => {
  const set = new Set(["scenario-application"]);
  SUBJECT_SCENARIO_FAMILY_LOOKUP.forEach((families) => {
    families.forEach((family) => set.add(family));
  });
  return set;
})();

const HISTORY_SOURCE_PRIMARY_MARKERS = [
  "diary",
  "letter",
  "speech",
  "photograph",
  "photo",
  "artifact",
  "map",
  "newspaper",
  "law",
  "treaty",
  "memoir",
  "interview",
  "proclamation",
];

const HISTORY_SOURCE_SECONDARY_MARKERS = [
  "textbook",
  "encyclopedia",
  "historian",
  "analysis",
  "biography",
  "documentary",
  "summary",
  "overview",
  "review",
];

const HISTORY_GOVERNMENT_FORMS = ["monarchy", "democracy", "republic", "empire"];

const HISTORY_RELIABILITY_CRITERIA = [
  { id: "origin", prompt: "Which question best checks a source's ORIGIN?", answer: "When was it created?" },
  { id: "purpose", prompt: "Which question best checks a source's PURPOSE?", answer: "Why was it created?" },
  { id: "content", prompt: "Which question best checks a source's CONTENT?", answer: "What does it say?" },
  { id: "bias", prompt: "Which question best checks a source's BIAS?", answer: "What point of view is shown?" },
];

const HISTORY_RELIABILITY_DISTRACTORS = [
  "When was it created?",
  "Why was it created?",
  "What does it say?",
  "What point of view is shown?",
];

const HISTORY_ALLOWED_TOKENS = new Set([
  "primary",
  "secondary",
  "source",
  "origin",
  "purpose",
  "content",
  "bias",
  "timeline",
  "century",
  "decade",
  "monarchy",
  "democracy",
  "republic",
  "empire",
  "government",
]);

const MCQ_RELAXED_EVIDENCE_FAMILIES = new Set([
  "history-sources",
  "history-reliability",
  "history-chronology",
  "history-government",
]);

const CATEGORY_TERMS = {
  body_systems: [
    "respiratory system",
    "digestive system",
    "excretory system",
    "nervous system",
    "circulatory system",
  ],
  genetics: ["gene", "allele", "genotype", "phenotype", "dominant", "recessive"],
  organelles: [
    "nucleus",
    "mitochondria",
    "ribosomes",
    "golgi apparatus",
    "lysosomes",
    "chloroplast",
    "vacuole",
    "endoplasmic reticulum",
  ],
  ecology: ["ecosystem", "food chain", "producers", "consumers", "decomposers"],
  equations: ["aerobic respiration", "anaerobic respiration", "photosynthesis", "fermentation"],
};

const CATEGORY_KEYWORDS = {
  body_systems: ["system", "respiratory", "digestive", "excretory", "nervous", "circulatory"],
  genetics: ["gene", "allele", "genotype", "phenotype", "dominant", "recessive", "inheritance"],
  organelles: [
    "organelle",
    "nucleus",
    "mitochondria",
    "ribosome",
    "golgi",
    "lysosome",
    "chloroplast",
    "vacuole",
    "endoplasmic",
  ],
  ecology: ["ecosystem", "food chain", "producer", "consumer", "decomposer", "energy flow"],
  equations: [
    "equation",
    "reactant",
    "product",
    "glucose",
    "oxygen",
    "carbon dioxide",
    "photosynthesis",
    "respiration",
    "aerobic",
    "anaerobic",
  ],
};

const MATH_CATEGORY_TERMS = {
  number_types: [
    "integer",
    "whole number",
    "natural number",
    "rational number",
    "irrational number",
  ],
  fraction_percent: [
    "proper fraction",
    "improper fraction",
    "mixed number",
    "unit fraction",
    "fraction",
    "percent",
    "decimal",
  ],
  geometry_formulas: [
    "Area of a circle (A = πr^2)",
    "Circumference of a circle (C = 2πr)",
    "Area of a triangle (A = 1/2bh)",
    "Volume of a cylinder (V = πr^2h)",
    "Area of a rectangle (A = lw)",
  ],
  averages_ratio: [
    "mean (average)",
    "median",
    "mode",
    "ratio",
    "proportion",
    "average rate",
  ],
};

const MATH_CATEGORY_KEYWORDS = {
  number_types: ["integer", "whole number", "natural number", "rational", "irrational"],
  fraction_percent: [
    "fraction",
    "proper fraction",
    "improper fraction",
    "mixed number",
    "percent",
    "percentage",
    "decimal",
  ],
  geometry_formulas: ["area", "circumference", "radius", "diameter", "volume", "π", "triangle", "circle", "cylinder"],
  averages_ratio: ["mean", "median", "mode", "average", "ratio", "proportion", "rate"],
};

const SUBJECT_HEADING_PATTERNS = [
  { subject: "math", headings: ["mathematics", "math"] },
  { subject: "science", headings: ["science"] },
  { subject: "english", headings: ["english", "language arts", "ela"] },
  { subject: "geography", headings: ["geography"] },
  { subject: "civics", headings: ["civics"] },
  { subject: "history", headings: ["history", "social studies"] },
  { subject: "cs", headings: ["computer science", "ict", "information and communication technology"] },
];

const normalizeWhitespace = (text) => String(text || "").replace(/\s+/g, " ").trim();

const ensureSentence = (text) => {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) {
    return "";
  }
  if (/[.!?]["')\]]?$/.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}.`;
};

const hashId = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

const hashToUuid = (value) => {
  const hash = crypto.createHash("sha256").update(String(value)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
    16,
    20
  )}-${hash.slice(20, 32)}`;
};

const toSentenceId = (index) => `s${index + 1}`;

const GENERIC_TOKENS = new Set([
  "produces",
  "produce",
  "producing",
  "system",
  "systems",
  "process",
  "processes",
  "types",
  "type",
  "section",
  "sections",
  "example",
  "examples",
  "used",
  "use",
  "uses",
  "using",
  "site",
  "sites",
  "stages",
  "stage",
]);

const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "dr", "prof"]);

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BANNED_PHRASE_REGEXES = BANNED_PHRASES.map(
  (phrase) => new RegExp(escapeRegex(phrase), "i")
);

const findTermMatch = (sentenceText, token) => {
  if (!sentenceText || !token) {
    return null;
  }
  const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
  const match = pattern.exec(sentenceText);
  return match ? match[0] : token;
};

const determineScenarioFocus = ({ sentenceText, concept, matches }) => {
  if (concept?.name) {
    const pattern = new RegExp(`\\b${escapeRegex(concept.name)}\\b`, "i");
    const match = pattern.exec(sentenceText);
    if (match) {
      return match[0];
    }
  }
  if (matches.length >= 3) {
    return matches[2];
  }
  return matches[1] || matches[0];
};

const findActionVerbInSentence = (sentenceText) => {
  if (!sentenceText) {
    return null;
  }
  const match = sentenceText.match(ACTION_VERB_REGEX);
  return match ? match[0] : null;
};

const buildScenarioContext = ({ sentenceText, concept, limit = 4 }) => {
  if (!sentenceText) {
    return null;
  }
  const tokens = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, limit * 2);
  const filtered = tokens.filter((token) => !GENERIC_SCENARIO_TOKENS.has(token));
  const unique = [];
  for (const token of filtered) {
    if (unique.length >= limit) {
      break;
    }
    if (!unique.includes(token)) {
      unique.push(token);
    }
  }
  if (unique.length < MIN_SCENARIO_TERMS) {
    return null;
  }
  const matches = unique.map((token) => findTermMatch(sentenceText, token) || token);
  const actionVerb = findActionVerbInSentence(sentenceText);
  if (!actionVerb) {
    return null;
  }
  const focusTerm = determineScenarioFocus({ sentenceText, concept, matches });
  if (!focusTerm) {
    return null;
  }
  const phrase = matches.slice(0, MIN_SCENARIO_TERMS).join(" and ");
  return {
    phrase,
    actionVerb,
    focusTerm,
    keywords: matches,
  };
};

const buildFillBlankUltraFallbackFromSentence = ({ sentence, seedSalt, subjectCategory }) => {
  if (!sentence?.text || sentence.isHeading) {
    return null;
  }
  const evidence = ensureSentence(sentence.text);
  if (countWords(evidence) < 8) {
    return null;
  }
  const rng = rngFromString(`${seedSalt || ""}|fb-ultra|${sentence.id}`);
  const tokens = normalizePromptTokens(evidence, DEFAULT_STOPWORDS).filter((t) => t.length >= 4);
  if (!tokens.length) {
    return null;
  }
  const picked = shuffleDeterministic([...new Set(tokens)], rng)[0];
  if (!picked) {
    return null;
  }
  const pattern = new RegExp(`\\b${escapeRegex(picked)}\\b`, "i");
  if (!pattern.test(evidence)) {
    return null;
  }
  const blankedSentence = ensureSentence(evidence.replace(pattern, BLANK_TOKEN));
  if (!blankedSentence.includes(BLANK_TOKEN)) {
    return null;
  }
  const prompt = formatFillBlankPrompt({ blankedSentence, topic: picked });
  if (!prompt) {
    return null;
  }
  const statementForContext = extractFillBlankStatementForComparison(prompt);
  const contextWords = countWords(statementForContext.replace(BLANK_TOKEN, ""));
  if (contextWords < 10) {
    return null;
  }
  const filledEvidence = statementForContext.replace(BLANK_TOKEN, picked);
  return {
    id: hashToUuid(`${seedSalt || sentence.id}|fb-ultra|${sentence.id}`),
    type: "fillBlank",
    topic: picked,
    topicConceptId: `fallback-fb-${sentence.id}`,
    bloomLevel: "L2",
    prompt,
    answerKeyBlank: picked,
    explanation: filledEvidence,
    grounding: {
      sourceSentenceIds: [sentence.id],
      evidenceSnippets: [evidence],
    },
    points: POINTS_BY_TYPE.fillBlank,
    meta: {
      difficulty: "medium",
      tags: ["fallback"],
      regeneratedFrom: seedSalt || null,
      templateId: "fillBlank_fallback_ultra",
      templateFamily: "fallback",
      subjectCategory: subjectCategory || null,
    },
  };
};

const buildDeterministicScenarioMcqFallback = ({
  sentences,
  subjectCategory,
  seedSalt,
  usedSentenceIds,
  startIndex = 0,
}) => {
  if (!Array.isArray(sentences) || !sentences.length) {
    return null;
  }
  const used = usedSentenceIds instanceof Set ? usedSentenceIds : new Set();
  for (let offset = 0; offset < sentences.length; offset += 1) {
    const sentence = sentences[(startIndex + offset) % sentences.length];
    if (!sentence || sentence.isHeading) {
      continue;
    }
    if (used.has(sentence.id)) {
      continue;
    }
    const candidate = buildMcqFallbackFromSentence({
      sentence,
      sentences,
      subjectCategory,
      seedSalt,
    });
    if (candidate) {
      used.add(sentence.id);
      return candidate;
    }
  }
  if (used.size) {
    return buildDeterministicScenarioMcqFallback({
      sentences,
      subjectCategory,
      seedSalt,
      usedSentenceIds: new Set(),
      startIndex,
    });
  }
  return null;
};

const buildTrueFalseFallbackFromSentence = ({ sentence, seedSalt, subjectCategory }) => {
  if (!sentence?.text || sentence.isHeading) {
    return null;
  }
  const evidence = ensureSentence(sentence.text);
  if (countWords(evidence) < 2) {
    return null;
  }
  const rng = rngFromString(`${seedSalt || ""}|tf-fallback|${sentence.id}`);
  const answerKeyBool = Math.floor((rng || Math.random)() * 2) === 0;
  const prompt = `True or False: ${evidence}`;
  return {
    id: hashToUuid(`${seedSalt || sentence.id}|tf-fallback|${sentence.id}`),
    type: "trueFalse",
    topic: "Scenario",
    topicConceptId: `fallback-tf-${sentence.id}`,
    bloomLevel: "L2",
    prompt,
    classification: "Application",
    answerKeyBool,
    explanation: `${evidence} This statement is ${answerKeyBool ? "true" : "false"} based on the source text. The explanation references the same evidence sentence.`,
    grounding: {
      sourceSentenceIds: [sentence.id],
      evidenceSnippets: [evidence],
    },
    points: POINTS_BY_TYPE.trueFalse,
    meta: {
      difficulty: "medium",
      tags: ["fallback"],
      regeneratedFrom: seedSalt || null,
      templateId: "tf_fallback_deterministic",
      templateFamily: "fallback",
      subjectCategory: subjectCategory || null,
    },
  };
};

const buildDeterministicTrueFalseFallback = ({
  sentences,
  subjectCategory,
  seedSalt,
  usedSentenceIds,
  startIndex = 0,
}) => {
  if (!Array.isArray(sentences) || !sentences.length) {
    return null;
  }
  const used = usedSentenceIds instanceof Set ? usedSentenceIds : new Set();
  for (let offset = 0; offset < sentences.length; offset += 1) {
    const sentence = sentences[(startIndex + offset) % sentences.length];
    if (!sentence || sentence.isHeading) {
      continue;
    }
    if (used.has(sentence.id)) {
      continue;
    }
    const candidate = buildTrueFalseFallbackFromSentence({
      sentence,
      seedSalt,
      subjectCategory,
    });
    if (candidate) {
      used.add(sentence.id);
      return candidate;
    }
  }
  return null;
};

const renderSafeScenarioPrompt = ({ context, rng }) => {
  if (!context) {
    return null;
  }
  const wrapper =
    SAFE_SCENARIO_WRAPPERS[Math.floor((rng || Math.random)() * SAFE_SCENARIO_WRAPPERS.length)];
  return ensureSentence(wrapper(context));
};

const extractFillBlankStatementForComparison = (prompt) => {
  const raw = stripFillBlankTopicLine(prompt);
  const hintMatch = raw.match(/^(.*?)(?:\s*\(?hint:)/i);
  const trimmedRaw = hintMatch ? hintMatch[1] : raw;
  if (!trimmedRaw.includes(BLANK_TOKEN)) {
    return normalizeWhitespace(trimmedRaw);
  }
  const lastColon = trimmedRaw.lastIndexOf(":");
  if (lastColon !== -1) {
    const afterLast = trimmedRaw.slice(lastColon + 1);
    if (afterLast.includes(BLANK_TOKEN)) {
      return normalizeWhitespace(afterLast);
    }
  }
  return normalizeWhitespace(trimmedRaw);
};

const getLinesWithOffsets = (text) => {
  const raw = String(text || "");
  const lines = [];
  let cursor = 0;
  for (let i = 0; i <= raw.length; i += 1) {
    if (i === raw.length || raw[i] === "\n") {
      lines.push({
        text: raw.slice(cursor, i),
        start: cursor,
        end: i,
      });
      cursor = i + 1;
    }
  }
  return lines;
};

const isBulletLine = (line) => /^(\s*([-*•]|\d+[\).]))\s+/.test(String(line || ""));

const isHeadingLikeText = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 60) {
    return false;
  }
  if (/[.!?]$/.test(trimmed)) {
    return false;
  }
  if (/^[A-Z0-9\s\-()]+$/.test(trimmed)) {
    return true;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && words.every((w) => /^[A-Z]/.test(w))) {
    return true;
  }
  return false;
};

const isNumberedHeading = (text) => /^\d+[\.\)]\s*/.test(String(text || "").trim());

const isMostlySymbols = (text) => {
  const str = String(text || "");
  const nonSpace = (str.match(/\S/g) || []).length;
  if (!nonSpace) {
    return true;
  }
  const alphaNum = (str.match(/[A-Za-z0-9]/g) || []).length;
  return alphaNum / nonSpace < 0.5;
};

const hasMeaningfulStructure = (text) => {
  const str = String(text || "");
  if (/[=:]/.test(str)) {
    return true;
  }
  if (
    /\b(is|are|was|were|means|mean|equal|equals|equaling|represent|represents|refers|define|defined|has|have|can|will)\b/i.test(
      str
    )
  ) {
    return true;
  }
  return /\b\w+(ed|ing)\b/i.test(str);
};

const isValidTfFbSentence = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length < MIN_TF_FB_SENTENCE_CHARS) {
    return false;
  }
  if (isNumberedHeading(trimmed)) {
    return false;
  }
  if (isHeadingLikeText(trimmed)) {
    return false;
  }
  if (isMostlySymbols(trimmed)) {
    return false;
  }
  if (!hasMeaningfulStructure(trimmed)) {
    return false;
  }
  return true;
};

const getColonTerm = (text) => {
  const match = String(text || "").match(/^(.{2,80}?):\s+\S+/);
  if (!match) {
    return null;
  }
  const term = normalizeWhitespace(match[1]);
  if (term.length < 2 || term.length > 60) {
    return null;
  }
  return term;
};

const hasOpenParenthesis = (text) => {
  const str = String(text || "");
  const open = (str.match(/\(/g) || []).length;
  const close = (str.match(/\)/g) || []).length;
  return open > close;
};

const endsWithAbbreviation = (text) => {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/([A-Za-z]{1,5})\.?$/);
  if (!match) {
    return false;
  }
  const token = match[1].toLowerCase();
  return ABBREVIATIONS.has(token);
};

const hasTerminalPunctuation = (text) => /[.!?]["')\]]?$/.test(String(text || "").trim());

const hasContextClause = (text) =>
  /[,;:]/.test(String(text || "")) ||
  /\b(because|although|while|which|that|who|when|where|since|after|before|but)\b/i.test(
    String(text || "")
  );

const isContinuationLine = (nextText) => {
  const trimmed = String(nextText || "").trim();
  if (!trimmed) {
    return false;
  }
  if (/^[a-z(]/.test(trimmed)) {
    return true;
  }
  if (/^\d/.test(trimmed)) {
    return true;
  }
  if (/^[,"')\]]/.test(trimmed)) {
    return true;
  }
  if (/^\s+/.test(String(nextText || ""))) {
    return true;
  }
  return false;
};

const shouldMergeLines = ({ prevText, nextText, prevIsBullet, nextIsBullet }) => {
  const prevTrim = String(prevText || "").trim();
  const nextTrim = String(nextText || "").trim();
  if (!nextTrim) {
    return false;
  }
  if (nextIsBullet) {
    return false;
  }
  if (prevIsBullet) {
    if (isHeadingLikeText(nextText)) {
      return false;
    }
    return true;
  }
  if (hasOpenParenthesis(prevTrim)) {
    return true;
  }
  if (prevTrim.endsWith("(") || /\(e\.g\.?$/i.test(prevTrim) || endsWithAbbreviation(prevTrim)) {
    return true;
  }
  if (prevTrim.endsWith(":")) {
    return true;
  }
  if (!hasTerminalPunctuation(prevTrim) && isContinuationLine(nextText)) {
    return true;
  }
  return false;
};

const mergeLinesIntoUnits = (text) => {
  const lines = getLinesWithOffsets(String(text || "").replace(/\r\n/g, "\n"));
  const units = [];
  let current = null;

  const finalize = () => {
    if (!current) {
      return;
    }
    const raw = String(text || "");
    let start = current.start;
    let end = current.end;
    while (start < end && /\s/.test(raw[start])) {
      start += 1;
    }
    while (end > start && /\s/.test(raw[end - 1])) {
      end -= 1;
    }
    const slice = raw.slice(start, end);
    units.push({
      start,
      end,
      text: slice,
      isBullet: current.isBullet,
      isDefinition: current.isDefinition,
      isHeading: isHeadingLikeText(slice),
    });
    current = null;
  };

  lines.forEach((line) => {
    const trimmed = String(line.text || "").trim();
    if (!trimmed) {
      finalize();
      return;
    }
    const isBullet = isBulletLine(line.text);
    const isDefinition = Boolean(getColonTerm(line.text));
    if (!current) {
      current = {
        start: line.start,
        end: line.end,
        isBullet,
        isDefinition,
        lastText: line.text,
      };
      return;
    }
    const merge = shouldMergeLines({
      prevText: current.lastText,
      nextText: line.text,
      prevIsBullet: current.isBullet,
      nextIsBullet: isBullet,
    });
    if (merge) {
      current.end = line.end;
      current.lastText = line.text;
      current.isBullet = current.isBullet || isBullet;
      current.isDefinition = current.isDefinition || isDefinition;
    } else {
      finalize();
      current = {
        start: line.start,
        end: line.end,
        isBullet,
        isDefinition,
        lastText: line.text,
      };
    }
  });

  finalize();
  return units;
};

const splitUnitIntoSentences = (unit, rawText) => {
  const raw = rawText.slice(unit.start, unit.end);
  const segments = [];
  const boundary = /(?<=[.!?])\s+/g;
  let lastIndex = 0;
  let match;
  while ((match = boundary.exec(raw)) !== null) {
    const chunk = raw.slice(lastIndex, match.index);
    segments.push({ text: chunk, start: unit.start + lastIndex, end: unit.start + match.index });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex), start: unit.start + lastIndex, end: unit.end });
  }

  const merged = [];
  segments.forEach((segment) => {
    if (!segment.text.trim()) {
      return;
    }
    if (!merged.length) {
      merged.push(segment);
      return;
    }
    const prev = merged[merged.length - 1];
    const prevText = prev.text.trim();
    if (hasOpenParenthesis(prevText) || endsWithAbbreviation(prevText) || /\(e\.g\.?$/i.test(prevText)) {
      prev.text = `${prev.text}${segment.text}`;
      prev.end = segment.end;
      return;
    }
    merged.push(segment);
  });

  return merged;
};

const splitIntoSentences = (text) => {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const units = mergeLinesIntoUnits(raw);
  const sentences = [];

  units.forEach((unit) => {
    if (!unit.text.trim()) {
      return;
    }
    if (unit.isBullet || unit.isDefinition) {
      sentences.push({
        id: toSentenceId(sentences.length),
        index: sentences.length,
        start: unit.start,
        end: unit.end,
        text: unit.text,
        isHeading: unit.isHeading,
      });
      return;
    }
    const segments = splitUnitIntoSentences(unit, raw);
    segments.forEach((segment) => {
      const trimmed = segment.text.trim();
      if (!trimmed) {
        return;
      }
      sentences.push({
        id: toSentenceId(sentences.length),
        index: sentences.length,
        start: segment.start + (segment.text.length - segment.text.trimStart().length),
        end: segment.end - (segment.text.length - segment.text.trimEnd().length),
        text: trimmed,
        isHeading: isHeadingLikeText(trimmed),
      });
    });
  });

  return sentences;
};

const splitIntoSections = (text, sentences) => {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const paragraphs = [];
  let cursor = 0;
  const separator = /\n{2,}/g;
  let match;
  while ((match = separator.exec(raw)) !== null) {
    const chunk = raw.slice(cursor, match.index);
    if (chunk.trim()) {
      paragraphs.push({ text: chunk, start: cursor, end: match.index });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < raw.length && raw.slice(cursor).trim()) {
    paragraphs.push({ text: raw.slice(cursor), start: cursor, end: raw.length });
  }

  if (!paragraphs.length) {
    return [
      {
        id: "sec1",
        title: "Section 1",
        paragraphIndexes: [0],
        sentenceIds: sentences.map((s) => s.id),
      },
    ];
  }

  const sections = [];
  let sentenceCursor = 0;

  paragraphs.forEach((paragraph, idx) => {
    const titleCandidate = paragraph.text.split("\n")[0].trim();
    const title =
      titleCandidate.length <= 60 &&
      (titleCandidate.endsWith(":") || /^[A-Z0-9\s-]{6,}$/.test(titleCandidate))
        ? titleCandidate.replace(/:$/, "")
        : `Section ${idx + 1}`;

    const sentenceIds = [];
    while (sentenceCursor < sentences.length) {
      const sentence = sentences[sentenceCursor];
      if (sentence.start >= paragraph.start && sentence.end <= paragraph.end) {
        sentenceIds.push(sentence.id);
        sentenceCursor += 1;
      } else {
        break;
      }
    }

    sections.push({
      id: `sec${idx + 1}`,
      title,
      paragraphIndexes: [idx],
      sentenceIds: sentenceIds.length ? sentenceIds : sentences.map((s) => s.id),
    });
  });

  return sections;
};

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

const countWords = (text) => tokenize(text).length;

const isStopword = (token, stopwords) => stopwords.has(String(token || "").toLowerCase());

const normalizePromptTokens = (prompt, stopwords) =>
  tokenize(prompt)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !isStopword(token, stopwords));

const normalizeTerm = (term) =>
  String(term || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const termAppearsInContext = (term, ...sources) => {
  if (!term) {
    return false;
  }
  const normalizedTerm = normalizeTerm(term);
  if (!normalizedTerm) {
    return false;
  }
  return sources.some((source) => {
    const normalizedSource = normalizeTerm(source);
    return normalizedSource && normalizedSource.includes(normalizedTerm);
  });
};

const isFormulaLike = (text) => {
  const str = String(text || "");
  if (!str) {
    return false;
  }
  const symbolCount = (str.match(/[=±×÷√π^*/]/g) || []).length;
  const hasAssignment = /[A-Za-z]\s*=\s*[^=]/.test(str);
  const wordCount = (str.match(/[A-Za-z]+/g) || []).length;
  return (symbolCount >= 2 && wordCount <= 8) || hasAssignment;
};
const findMathOperatorToken = (text) => {
  const str = String(text || "");
  if (!str) {
    return null;
  }
  const match = str.match(/[=+\-*/^]/);
  return match ? match[0] : null;
};

const isMathMcqOverlapRelaxed = ({ question, subjectCategory, evidenceText }) => {
  if (subjectCategory !== "math" || question?.type !== "mcq") {
    return false;
  }
  const templateFamily = question?.meta?.templateFamily;
  const templateId = question?.meta?.templateId;
  if (templateFamily && MATH_MCQ_LOOSE_FAMILIES.has(templateFamily)) {
    return true;
  }
  if (templateId && MATH_MCQ_RELAXATION_TEMPLATE_IDS.has(templateId)) {
    return true;
  }
  if (isFormulaLike(evidenceText)) {
    return true;
  }
  if (/[:=]/.test(String(evidenceText || ""))) {
    return true;
  }
  return /[0-9][0-9+\-*/^=]/.test(String(evidenceText || ""));
};

const hasTaskFraming = (prompt) =>
  /\b(which|what|choose|select|correct|best|term|formula|statement)\b/i.test(
    String(prompt || "")
  );

const normalizedLevenshteinSimilarity = (a, b) => {
  const s = normalizeWhitespace(String(a || "").toLowerCase());
  const t = normalizeWhitespace(String(b || "").toLowerCase());
  if (!s && !t) {
    return 1;
  }
  if (!s || !t) {
    return 0;
  }
  const m = s.length;
  const n = t.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) {
    dp[j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  const dist = dp[n];
  return 1 - dist / Math.max(m, n);
};

const normalizeHeadingLine = (line) =>
  normalizeWhitespace(String(line || ""))
    .replace(/[:\-��]+$/g, "")
    .replace(/[^\w\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const detectSubjectCategory = (text) => {
  const str = String(text || "");
  if (!str) {
    return "other";
  }
  const lowered = str.toLowerCase();
  const trimmedLen = lowered.trim().length;
  const mathSignals = [
    /[=±×÷√π]/,
    /[A-Za-z]\s*=\s*[^=]/,
    /[A-Za-z]\s*\^\s*\d/,
    /\b\d+\s*\/\s*\d+\b/,
    /\b(sin|cos|tan|log|ln)\b/i,
  ];
  let hits = 0;
  mathSignals.forEach((pattern) => {
    if (pattern.test(str)) {
      hits += 1;
    }
  });
  if (hits >= 2 || isFormulaLike(str)) {
    return "math";
  }
  if (trimmedLen < 120) {
    return "other";
  }
  const allowShortScienceSignals = false;
  const subjectSignals = [
    {
      subject: "science",
      patterns: [
        /\bphotosynthesis\b/i,
        /\bchlorophyll\b/i,
        /\bcarbon dioxide\b/i,
        /\bglucose\b/i,
        /\boxygen\b/i,
        /\becosystem\b/i,
        /\bcell(s)?\b/i,
        /\batom(s)?\b/i,
        /\benergy\b/i,
      ],
      threshold: 2,
    },
    {
      subject: "english",
      patterns: [/\bmodifier\b/i, /\bpunctuation\b/i, /\btense\b/i, /\bgrammar\b/i],
      threshold: 2,
    },
    {
      subject: "geography",
      patterns: [/\blatitude\b/i, /\blongitude\b/i, /\bclimate\b/i, /\berosion\b/i],
      threshold: 2,
    },
    {
      subject: "cs",
      patterns: [/\balgorithm\b/i, /\bthread(s)?\b/i, /\bmemory\b/i, /\bipo\b/i],
      threshold: 2,
    },
    {
      subject: "history",
      patterns: [/\brevolution\b/i, /\bprimary source\b/i, /\bsecondary source\b/i, /\bempire\b/i],
      threshold: 2,
    },
    {
      subject: "civics",
      patterns: [/\bright(s)?\b/i, /\bresponsibilit(y|ies)\b/i, /\bgovernment\b/i, /\blaw(s)?\b/i],
      threshold: 2,
    },
  ];
  for (const entry of subjectSignals) {
    if (allowShortScienceSignals && entry.subject !== "science") {
      continue;
    }
    let score = 0;
    entry.patterns.forEach((pattern) => {
      if (pattern.test(lowered)) {
        score += 1;
      }
    });
    if (score >= entry.threshold) {
      return entry.subject;
    }
  }
  return "other";
};

function buildMcqFallbackFromSentence({
  sentence,
  sentences,
  subjectCategory,
  seedSalt,
}) {
  if (!sentence?.text || sentence.isHeading) {
    return null;
  }
  const evidence = ensureSentence(sentence.text);
  if (countWords(evidence) < 6) {
    return null;
  }
  const rng = rngFromString(`${seedSalt || ""}|mcq-fallback|${sentence.id}`);
  const evidenceTokens = normalizePromptTokens(evidence, DEFAULT_STOPWORDS).filter((t) => t.length >= 4);
  if (evidenceTokens.length < 4) {
    return null;
  }
  const pickedTokens = shuffleDeterministic([...new Set(evidenceTokens)], rng).slice(0, 4);
  const prompt = `In this scenario, which statement is supported by the text about ${pickedTokens[0]}?`;

  const distractorPool = shuffleDeterministic(
    (sentences || []).filter((s) => s && s.id !== sentence.id && !s.isHeading && String(s.text || "").trim()),
    rng
  );
  const replacementTokens = [];
  distractorPool.forEach((s) => {
    if (replacementTokens.length >= 8) {
      return;
    }
    normalizePromptTokens(s.text, DEFAULT_STOPWORDS)
      .filter((t) => t.length >= 4)
      .forEach((t) => {
        if (replacementTokens.length < 8 && !replacementTokens.includes(t) && !pickedTokens.includes(t)) {
          replacementTokens.push(t);
        }
      });
  });
  if (!replacementTokens.length) {
    replacementTokens.push("process", "system", "change", "result");
  }

  const mutate = (base, tokenIndex) => {
    const target = pickedTokens[tokenIndex % pickedTokens.length];
    const replacement = replacementTokens[tokenIndex % replacementTokens.length];
    const pattern = new RegExp(`\\b${escapeRegex(target)}\\b`, "i");
    if (!pattern.test(base)) {
      return null;
    }
    return ensureSentence(base.replace(pattern, replacement));
  };

  const correctChoice = evidence;
  const distractors = [];
  for (let i = 0; i < 6 && distractors.length < 3; i += 1) {
    const candidate = mutate(evidence, i);
    if (!candidate) {
      continue;
    }
    const normalized = normalizeWhitespace(candidate).toLowerCase();
    if (
      normalized === normalizeWhitespace(correctChoice).toLowerCase() ||
      distractors.some((d) => normalizeWhitespace(d).toLowerCase() === normalized)
    ) {
      continue;
    }
    distractors.push(candidate);
  }
  while (distractors.length < 3) {
    const idx = distractors.length;
    const token = replacementTokens[idx % replacementTokens.length];
    const candidate = ensureSentence(`${evidence} (Focus: ${token}.)`);
    distractors.push(candidate);
  }

  const choiceObjs = [
    { choice: correctChoice, isCorrect: true },
    ...distractors.map((choice) => ({ choice, isCorrect: false })),
  ].slice(0, 4);
  const shuffled = shuffleDeterministic(choiceObjs, rngFromString(`${seedSalt || ""}|mcq-fallback|shuffle|${sentence.id}`));
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  const answerKey = choiceLabels[Math.max(0, answerIndex)];
  const choices = shuffled.map((item) => item.choice);
  return {
    id: hashToUuid(`${seedSalt || sentence.id}|mcq-fallback|${sentence.id}`),
    type: "mcq",
    topic: pickedTokens[0] || "Scenario",
    topicConceptId: `fallback-${sentence.id}`,
    bloomLevel: "L3",
    prompt,
    choices,
    answerKey,
    explanation: evidence,
    grounding: {
      sourceSentenceIds: [sentence.id],
      evidenceSnippets: [evidence],
    },
    points: POINTS_BY_TYPE.mcq,
    meta: {
      difficulty: "medium",
      tags: ["fallback"],
      regeneratedFrom: seedSalt || null,
      templateId: "mcq_fallback_deterministic",
      templateFamily: "scenario-application",
      choiceFormat: "statement",
      category: "fallback",
      mathCategory: null,
      subjectCategory: subjectCategory || null,
    },
  };
}

const detectSubjectsFromHeadings = (text) => {
  const lines = getLinesWithOffsets(text);
  const subjects = [];
  lines.forEach((line) => {
    const normalized = normalizeHeadingLine(line.text);
    if (!normalized || normalized.length > 40) {
      return;
    }
    for (const entry of SUBJECT_HEADING_PATTERNS) {
      if (entry.headings.some((heading) => normalized === heading || normalized.startsWith(`${heading} `))) {
        subjects.push({
          subject: entry.subject,
          start: line.start,
          end: line.end,
        });
        break;
      }
    }
  });
  return subjects;
};

const buildSubjectSections = (text) => {
  const headingMatches = detectSubjectsFromHeadings(text);
  if (!headingMatches.length) {
    return [];
  }
  const sections = [];
  for (let i = 0; i < headingMatches.length; i += 1) {
    const current = headingMatches[i];
    const next = headingMatches[i + 1];
    const start = current.end + 1;
    const end = next ? next.start - 1 : text.length;
    sections.push({
      subject: current.subject,
      start,
      end,
    });
  }
  return sections;
};

const detectSubjects = (text) => {
  const sections = buildSubjectSections(text);
  if (sections.length) {
    return {
      subjects: [...new Set(sections.map((section) => section.subject))],
      sections,
    };
  }
  return { subjects: [], sections: [] };
};
const singularizeTerm = (term) => {
  if (!term) {
    return term;
  }
  if (term.endsWith("s") && term.length > 3) {
    return term.slice(0, -1);
  }
  return term;
};

const CATEGORY_LOOKUP = (() => {
  const lookup = new Map();
  Object.entries(CATEGORY_TERMS).forEach(([category, terms]) => {
    const termMap = new Map();
    terms.forEach((term) => {
      const normalized = normalizeTerm(term);
      if (normalized) {
        termMap.set(normalized, term);
        termMap.set(singularizeTerm(normalized), term);
      }
    });
    lookup.set(category, termMap);
  });
  const organelleMap = lookup.get("organelles");
  if (organelleMap) {
    organelleMap.set("mitochondrion", "mitochondria");
    organelleMap.set("golgi", "golgi apparatus");
    organelleMap.set("ribosome", "ribosomes");
    organelleMap.set("lysosome", "lysosomes");
  }
  const systemMap = lookup.get("body_systems");
  if (systemMap) {
    systemMap.set("respiratory", "respiratory system");
    systemMap.set("digestive", "digestive system");
    systemMap.set("excretory", "excretory system");
    systemMap.set("nervous", "nervous system");
    systemMap.set("circulatory", "circulatory system");
  }
  return lookup;
})();

const MATH_CATEGORY_LOOKUP = (() => {
  const lookup = new Map();
  Object.entries(MATH_CATEGORY_TERMS).forEach(([category, terms]) => {
    const termMap = new Map();
    terms.forEach((term) => {
      const normalized = normalizeTerm(term);
      if (normalized) {
        termMap.set(normalized, term);
        termMap.set(singularizeTerm(normalized), term);
      }
    });
    lookup.set(category, termMap);
  });
  return lookup;
})();

const ENGLISH_CATEGORY_TERMS = {
  device: ENGLISH_DEVICE_TERMS,
  grammar: ENGLISH_GRAMMAR_TERMS,
  writing: ENGLISH_WRITING_TERMS,
};

const ENGLISH_CATEGORY_LOOKUP = (() => {
  const lookup = new Map();
  Object.entries(ENGLISH_CATEGORY_TERMS).forEach(([category, terms]) => {
    const termMap = new Map();
    terms.forEach((term) => {
      const normalized = normalizeTerm(term);
      if (normalized) {
        termMap.set(normalized, term);
        termMap.set(singularizeTerm(normalized), term);
      }
    });
    lookup.set(category, termMap);
  });
  return lookup;
})();

const inferCategory = ({ concept, sectionTitle, sentenceText }) => {
  const haystack = normalizeTerm(
    `${concept?.name || ""} ${sectionTitle || ""} ${sentenceText || ""}`
  );
  if (!haystack) {
    return null;
  }
  const order = ["organelles", "body_systems", "genetics", "ecology", "equations"];
  for (const category of order) {
    const keywords = CATEGORY_KEYWORDS[category] || [];
    if (keywords.some((keyword) => haystack.includes(normalizeTerm(keyword)))) {
      return category;
    }
  }
  return null;
};

const inferMathCategory = ({ concept, sectionTitle, sentenceText }) => {
  const haystack = normalizeTerm(
    `${concept?.name || ""} ${sectionTitle || ""} ${sentenceText || ""}`
  );
  if (!haystack) {
    return null;
  }
  const order = ["geometry_formulas", "averages_ratio", "fraction_percent", "number_types"];
  for (const category of order) {
    const keywords = MATH_CATEGORY_KEYWORDS[category] || [];
    if (keywords.some((keyword) => haystack.includes(normalizeTerm(keyword)))) {
      return category;
    }
  }
  return null;
};

const matchCategoryTerm = (term, category) => {
  if (!term || !category) {
    return null;
  }
  const termMap = CATEGORY_LOOKUP.get(category);
  if (!termMap) {
    return null;
  }
  const normalized = normalizeTerm(term);
  return termMap.get(normalized) || termMap.get(singularizeTerm(normalized)) || null;
};

const matchEnglishCategoryTerm = (term, category) => {
  if (!term || !category) {
    return null;
  }
  const termMap = ENGLISH_CATEGORY_LOOKUP.get(category);
  if (!termMap) {
    return null;
  }
  const normalized = normalizeTerm(term);
  return termMap.get(normalized) || termMap.get(singularizeTerm(normalized)) || null;
};

const matchMathCategoryTerm = (term, category) => {
  if (!term || !category) {
    return null;
  }
  const termMap = MATH_CATEGORY_LOOKUP.get(category);
  if (!termMap) {
    return null;
  }
  const normalized = normalizeTerm(term);
  return termMap.get(normalized) || termMap.get(singularizeTerm(normalized)) || null;
};

const findMathTermInText = (text, category) => {
  const termMap = MATH_CATEGORY_LOOKUP.get(category);
  if (!termMap) {
    return null;
  }
  const haystack = normalizeTerm(text);
  if (!haystack) {
    return null;
  }
  for (const [normalized, term] of termMap.entries()) {
    if (normalized && haystack.includes(normalized)) {
      return term;
    }
  }
  return null;
};

const filterDistractorCandidates = ({ choices, correctChoice }) => {
  const correct = String(correctChoice || "").trim().toLowerCase();
  const correctTokens = new Set(correct.split(/\s+/).filter(Boolean));
  return choices.filter((choice) => {
    const normalized = String(choice || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === correct) {
      return false;
    }
    if (normalized.includes(correct) || correct.includes(normalized)) {
      return false;
    }
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1 && correctTokens.has(tokens[0])) {
      return false;
    }
    return true;
  });
};

const buildCategoryChoiceSet = ({ category, concept, rng }) => {
  if (!category || !concept) {
    return null;
  }
  const terms = CATEGORY_TERMS[category] || [];
  if (!terms.length) {
    return null;
  }
  const localTerms = terms.filter((term) =>
    termAppearsInContext(term, concept?.name)
  );
  if (!localTerms.length) {
    return null;
  }
  const correctTerm = matchCategoryTerm(concept.name, category);
  if (!correctTerm) {
    return null;
  }
  const pool = filterDistractorCandidates({
    choices: localTerms.filter((term) => term !== correctTerm),
    correctChoice: correctTerm,
  });
  const forced = [];
  if (category === "equations") {
    if (correctTerm.includes("aerobic") && pool.includes("anaerobic respiration")) {
      forced.push("anaerobic respiration");
    }
    if (correctTerm.includes("anaerobic") && pool.includes("aerobic respiration")) {
      forced.push("aerobic respiration");
    }
  }
  if (category === "genetics") {
    if (correctTerm === "dominant" && pool.includes("recessive")) {
      forced.push("recessive");
    }
    if (correctTerm === "recessive" && pool.includes("dominant")) {
      forced.push("dominant");
    }
  }
  const remaining = pool.filter((term) => !forced.includes(term));
  const shuffled = shuffleDeterministic(remaining, rng);
  const picks = [...forced, ...shuffled].slice(0, 3);
  const choiceObjs = [{ choice: correctTerm, isCorrect: true }].concat(
    picks.map((choice) => ({ choice, isCorrect: false }))
  );
  if (choiceObjs.length < 4) {
    return null;
  }
  const shuffledChoices = shuffleDeterministic(choiceObjs, rng).slice(0, 4);
  const answerIndex = shuffledChoices.findIndex((item) => item.isCorrect);
  return {
    choices: shuffledChoices.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: correctTerm,
  };
};

const buildMathChoiceSet = ({ category, concept, sentenceText, rng }) => {
  if (!category || !concept) {
    return null;
  }
  const terms = MATH_CATEGORY_TERMS[category] || [];
  if (!terms.length) {
    return null;
  }
  const localTerms = terms.filter((term) =>
    termAppearsInContext(term, sentenceText, concept?.name)
  );
  if (!localTerms.length) {
    return null;
  }
  const correctTerm =
    matchMathCategoryTerm(concept.name, category) ||
    findMathTermInText(sentenceText, category);
  if (!correctTerm) {
    return null;
  }
  const pool = filterDistractorCandidates({
    choices: localTerms.filter((term) => term !== correctTerm),
    correctChoice: correctTerm,
  });
  const shuffled = shuffleDeterministic(pool, rng);
  const picks = shuffled.slice(0, 3);
  const choiceObjs = [{ choice: correctTerm, isCorrect: true }].concat(
    picks.map((choice) => ({ choice, isCorrect: false }))
  );
  if (choiceObjs.length < 4) {
    return null;
  }
  const shuffledChoices = shuffleDeterministic(choiceObjs, rng).slice(0, 4);
  const answerIndex = shuffledChoices.findIndex((item) => item.isCorrect);
  return {
    choices: shuffledChoices.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: correctTerm,
  };
};

const buildEnglishTermChoiceSet = ({ category, concept, rng }) => {
  if (!category || !concept) {
    return null;
  }
  const correctTerm = matchEnglishCategoryTerm(concept.name, category);
  if (!correctTerm) {
    return null;
  }
  const terms = ENGLISH_CATEGORY_TERMS[category] || [];
  if (!terms.length) {
    return null;
  }
  const localTerms = terms.filter((term) =>
    termAppearsInContext(term, concept?.name)
  );
  if (!localTerms.length) {
    return null;
  }
  const pool = filterDistractorCandidates({
    choices: localTerms.filter((term) => term !== correctTerm),
    correctChoice: correctTerm,
  });
  const shuffled = shuffleDeterministic(pool, rng);
  const picks = shuffled.slice(0, 3);
  const choiceObjs = [{ choice: correctTerm, isCorrect: true }].concat(
    picks.map((choice) => ({ choice, isCorrect: false }))
  );
  if (choiceObjs.length < 4) {
    return null;
  }
  const shuffledChoices = shuffleDeterministic(choiceObjs, rng).slice(0, 4);
  const answerIndex = shuffledChoices.findIndex((item) => item.isCorrect);
  return {
    choices: shuffledChoices.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: correctTerm,
  };
};

const buildGrammarRevisionChoiceSet = ({ sentenceText, rng }) => {
  const base = ensureSentence(normalizeWhitespace(sentenceText));
  if (!base || base.split(" ").length < 4) {
    return null;
  }
  const variants = new Set();
  const addVariant = (value) => {
    const normalized = normalizeWhitespace(value);
    if (!normalized || normalized.toLowerCase() === base.toLowerCase()) {
      return;
    }
    variants.add(ensureSentence(normalized));
  };

  addVariant(base.replace(/\b(is|are)\b/i, (match) => (match.toLowerCase() === "is" ? "are" : "is")));
  addVariant(base.replace(/\b(was|were)\b/i, (match) => (match.toLowerCase() === "was" ? "were" : "was")));
  addVariant(base.replace(/,/, ""));
  addVariant(base.replace(/\b(and|but|or)\b/i, ", $1"));

  const shuffled = shuffleDeterministic([...variants], rng).slice(0, 3);
  if (shuffled.length < 3) {
    return null;
  }
  const choiceObjs = [{ choice: base, isCorrect: true }].concat(
    shuffled.map((choice) => ({ choice, isCorrect: false }))
  );
  const shuffledChoices = shuffleDeterministic(choiceObjs, rng).slice(0, 4);
  const answerIndex = shuffledChoices.findIndex((item) => item.isCorrect);
  return {
    choices: shuffledChoices.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: base,
  };
};

const scenarioHasRequiredStructure = (prompt) =>
  /\b(if|when)\b/i.test(String(prompt || "")) ||
  /\bwhich\s+(system|process)\b/i.test(String(prompt || ""));

const hasPromptBannedPhrase = (prompt) =>
  BANNED_PROMPT_PHRASE_REGEXES.some((pattern) => pattern.test(String(prompt || "")));

const isCommaBagStem = (prompt) => {
  const cleaned = normalizeWhitespace(
    String(prompt || "")
      .replace(/true\s+or\s+false\s*:\s*/i, "")
      .replace(/["'`]/g, "")
  );
  const commaCount = (cleaned.match(/,/g) || []).length;
  if (commaCount < 2) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 12) {
    return false;
  }
  const hasVerbCue =
    /\b(is|are|was|were|has|have|had|do|does|did|can|should|would|will|cause|causes|caused|explain|describe|identify|determine|shows|show|means|refers)\b/i.test(
      cleaned
    );
  return !hasVerbCue;
};

const isAppliedMcq = (question) => {
  if (!question || question.type !== "mcq") {
    return false;
  }
  const family = question.meta?.templateFamily;
  if (family && MCQ_SCENARIO_FAMILIES.has(family)) {
    return true;
  }
  if (family && String(family).startsWith("english")) {
    return true;
  }
  const prompt = String(question.prompt || "");
  return (
    scenarioHasRequiredStructure(prompt) ||
    /\b(in a|in the|during|while|if|when|as|given)\b/i.test(prompt)
  );
};

const isScenarioFamilyMcq = (question) =>
  Boolean(question && question.type === "mcq" && MCQ_SCENARIO_FAMILIES.has(question.meta?.templateFamily));

const jaccardSimilarity = (aTokens, bTokens) => {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  if (!aSet.size || !bSet.size) {
    return 0;
  }
  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) {
      intersection += 1;
    }
  });
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
};

const hasBannedStem = (prompt) =>
  BANNED_STEM_REGEXES.some((pattern) => pattern.test(String(prompt || "")));

const isMcqTemplateCompatible = ({ template, concept, sentenceText, subjectCategory }) => {
  if (!template || template.type !== "mcq") {
    return true;
  }
  const normalizedSubject = normalizeSubjectKey(subjectCategory);
  const canonicalSubject = canonicalSubjectKey(subjectCategory);
  if (template.subjectAllowList && template.subjectAllowList.length) {
    if (!template.subjectAllowList.includes(canonicalSubject)) {
      return false;
    }
  }
  const requiredSubject = FAMILY_SUBJECT_MAP.get(template.family);
  if (requiredSubject && requiredSubject !== canonicalSubject) {
    return false;
  }
  if (template.requiresEvidenceRegex) {
    const regexes = Array.isArray(template.requiresEvidenceRegex)
      ? template.requiresEvidenceRegex
      : [template.requiresEvidenceRegex];
    const sentence = String(sentenceText || "");
    if (!regexes.some((regex) => regex.test(sentence))) {
      return false;
    }
  }
  if (template.requiresScenarioContext) {
    if (!buildScenarioContext({ sentenceText, concept })) {
      return false;
    }
  }
  const combined = `${concept?.name || ""} ${sentenceText || ""}`;
  if (template.family === "history-reliability") {
    return RELIABILITY_CRITERIA_REGEX.test(combined);
  }
  if (template.family === "history-government") {
    return GOVERNMENT_FORM_REGEX.test(combined);
  }
  if (template.family === "history-chronology") {
    return CHRONOLOGY_CONTEXT_REGEX.test(combined);
  }
  return true;
};

const hasBannedPhrase = (text) =>
  BANNED_PHRASE_REGEXES.some((pattern) => pattern.test(String(text || "")));

const hasAdjacentDuplicateWords = (text) =>
  /\b([A-Za-z0-9]+)\s+\1\b/i.test(normalizeWhitespace(text));

const hasUnresolvedPlaceholder = (text, type) => {
  const raw = String(text || "");
  if (!raw) {
    return true;
  }
  if (type !== "fillBlank" && raw.includes(BLANK_TOKEN)) {
    return true;
  }
  return UNRESOLVED_PLACEHOLDER_REGEXES.some((regex) => regex.test(raw));
};

const hasMinimumPromptStructure = (text, type) => {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) {
    return false;
  }
  const tokens = tokenize(trimmed);
  const minWords = type === "fillBlank" ? PROMPT_MIN_WORDS.fillBlank : PROMPT_MIN_WORDS.default;
  if (tokens.length < minWords) {
    if (type === "mcq" && hasContextClause(trimmed)) {
      // allow shorter stems when context is present
    } else {
      return false;
    }
  }
  if (type === "fillBlank") {
    const hasBlankToken = /_{4,}/.test(trimmed);
    const hasFillBlankLead = /^Fill in the blank:\s+\S.*_{4,}/i.test(trimmed);
    const hasMinimumTokens = tokens.length >= 8;
    return hasFillBlankLead || (hasMinimumTokens && hasBlankToken);
  }
  const hasEndingPunct = /[.!?]["')\]]?$/.test(trimmed) || /\?/.test(trimmed);
  const hasGrammarCue =
    /\b(what|which|why|how|when|where|if|when|solve|calculate|determine|choose|select|complete|fill|write|explain|identify|decide|does|do|did|is|are|was|were|can|should|would|will|has|have|had)\b/i.test(
      trimmed
    );
  const hasTrueFalseCue = /\btrue\s+or\s+false\b/i.test(trimmed);
  return hasEndingPunct && (hasGrammarCue || (type === "trueFalse" && hasTrueFalseCue));
};

const promptSanityIssues = (prompt, type) => {
  const issues = [];
  if ((type === "trueFalse" || type === "mcq") && hasPromptBannedPhrase(prompt)) {
    issues.push("Prompt contains awkward filler phrase.");
  }
  if ((type === "trueFalse" || type === "mcq") && isCommaBagStem(prompt)) {
    issues.push("Prompt reads like a comma-separated fragment.");
  }
  if (hasAdjacentDuplicateWords(prompt)) {
    issues.push("Prompt has repeated words.");
  }
  if (hasUnresolvedPlaceholder(prompt, type)) {
    issues.push("Prompt has unresolved placeholder.");
  }
  const structurePrompt =
    type === "trueFalse" ? rewriteTrueFalseStatementForStructure(prompt) : prompt;
  if (!hasMinimumPromptStructure(structurePrompt, type)) {
    issues.push("Prompt lacks minimal structure.");
  }
  return issues;
};

const removeAdjacentDuplicateWords = (text) =>
  normalizeWhitespace(String(text || "")).replace(/\b([A-Za-z0-9]+)\s+\1\b/gi, "$1");

const sanitizeStatement = (text) => {
  if (!text) {
    return "";
  }
  let cleaned = normalizeWhitespace(String(text || ""));
  cleaned = cleaned.replace(/\b(in a|during a)\s+field study,?\s*/i, "");
  cleaned = cleaned.replace(/\bappears\b/gi, "is");
  cleaned = cleaned.replace(/\boccurs\b/gi, "happens");
  return cleaned;
};

const rewritePromptForSanity = ({
  question,
  concept,
  sentenceText,
  category,
  sectionTitle,
  subjectCategory,
  rng,
}) => {
  if (!question) {
    return null;
  }
  let prompt = question.prompt || "";
  if (question.type === "mcq") {
    prompt = buildScenarioPrompt({
      concept,
      sentenceText,
      category,
      sectionTitle,
      rng,
      subjectCategory,
    });
  } else if (question.type === "shortAnswer") {
    const contextLead = buildContextIntro({ sentenceText, concept, rng });
    prompt = `${contextLead} explain ${concept.name} in your own words.`;
  } else if (question.type === "fillBlank") {
    const statement = extractFillBlankStatement(prompt);
    const blanked = statement.includes(BLANK_TOKEN) ? statement : ensureSentence(statement);
    const formatted = formatFillBlankPrompt({ blankedSentence: blanked, topic: question.topic });
    if (formatted) {
      prompt = formatted;
    }
  } else if (question.type === "trueFalse") {
    let statement = extractTrueFalseStatement(prompt);
    if (hasPromptBannedPhrase(statement) || isCommaBagStem(statement)) {
      statement = sanitizeStatement(statement);
    }
    prompt = `True or False: ${ensureSentence(statement)}`;
  }
  prompt = removeAdjacentDuplicateWords(prompt);
  return {
    ...question,
    prompt,
    meta: {
      ...question.meta,
      rewrittenFrom: question.meta?.templateId || question.meta?.templateFamily || null,
      subjectCategory: subjectCategory || question.meta?.subjectCategory || null,
    },
  };
};

const tokenOverlapRatio = (a, b, stopwords) =>
  jaccardSimilarity(normalizePromptTokens(a, stopwords), normalizePromptTokens(b, stopwords));

const buildTokenSet = (text, stopwords) => {
  const set = new Set();
  tokenize(text).forEach((t) => {
    if (!isStopword(t, stopwords) && t.length >= 3) {
      set.add(t);
    }
  });
  return set;
};

const buildRawTokenSet = (text) => {
  const set = new Set();
  tokenize(text).forEach((t) => {
    if (t) {
      set.add(t);
    }
  });
  return set;
};

const addTokensToSet = (text, stopwords, set) => {
  tokenize(text).forEach((token) => {
    if (!isStopword(token, stopwords) && token.length >= 3) {
      set.add(token);
    }
  });
};

const countKeywordMatches = (text, tokenSet, stopwords) => {
  const tokens = normalizePromptTokens(text, stopwords).filter((t) => t.length >= 3);
  if (!tokens.length) {
    return 0;
  }
  const unique = new Set(tokens);
  let matches = 0;
  unique.forEach((token) => {
    if (tokenSet.has(token)) {
      matches += 1;
    }
  });
  return matches;
};

const extractTrueFalseStatement = (prompt) => {
  const raw = String(prompt || "");
  if (!raw) {
    return "";
  }
  const idx = raw.indexOf(":");
  if (idx !== -1) {
    return normalizeWhitespace(raw.slice(idx + 1));
  }
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("true or false")) {
    return normalizeWhitespace(raw.slice("true or false".length));
  }
  return normalizeWhitespace(raw);
};

const translateMathOperatorsToWords = (text) => {
  if (!text) {
    return "";
  }
  const replacements = [
    [/!=/g, " does not equal "],
    [/≠/g, " does not equal "],
    [/>=/g, " is greater than or equal to "],
    [/<=/g, " is less than or equal to "],
    [/≤/g, " is less than or equal to "],
    [/≥/g, " is greater than or equal to "],
    [/</g, " is less than "],
    [/>/g, " is greater than "],
    [/\+/g, " plus "],
    [/-/g, " minus "],
    [/\*/g, " times "],
    [/×/g, " multiplied by "],
    [/÷/g, " divided by "],
    [/\^/g, " to the power of "],
    [/=/g, " equals "],
  ];
  let translated = text;
  replacements.forEach(([pattern, replacement]) => {
    translated = translated.replace(pattern, replacement);
  });
  return normalizeWhitespace(translated);
};

const formatMathEvidenceStatement = (sentence) => {
  const cleaned = normalizeWhitespace(sentence);
  if (!cleaned) {
    return "";
  }
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    const head = parts.shift();
    const tail = parts.join(":").trim();
    if (head && tail) {
      const combined = `${normalizeWhitespace(head)} means ${tail}`;
      return ensureSentence(translateMathOperatorsToWords(combined));
    }
  }
  return ensureSentence(translateMathOperatorsToWords(cleaned));
};

const rewriteTrueFalseStatementForStructure = (prompt) => {
  const statement = extractTrueFalseStatement(prompt);
  if (isFormulaLike(statement)) {
    return `True or False: ${formatMathEvidenceStatement(statement)}`;
  }
  return prompt;
};

const applyControlledTermSwap = (statement, terms, rng) => {
  const lower = String(statement || "").toLowerCase();
  const candidates = terms.filter((term) => lower.includes(term));
  if (!candidates.length) {
    return null;
  }
  const shuffled = shuffleDeterministic(candidates, rng);
  for (const term of shuffled) {
    const replacements = terms.filter((t) => t !== term);
    if (!replacements.length) {
      continue;
    }
    const replacement = replacements[Math.floor(rng() * replacements.length)];
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (regex.test(statement)) {
      return ensureSentence(statement.replace(regex, replacement));
    }
  }
  return null;
};

const forceMathTermReplacement = (statement, terms, stopwords, rng) => {
  if (!terms || !terms.length) {
    return null;
  }
  const tokens = normalizePromptTokens(statement, stopwords);
  if (!tokens.length) {
    return null;
  }
  const target = tokens[Math.floor(rng() * tokens.length)];
  const replacementPool = terms.filter((term) => term !== target);
  const pool = replacementPool.length ? replacementPool : terms;
  const replacement = pool[Math.floor(rng() * pool.length)];
  if (!target || !replacement) {
    return null;
  }
  const regex = new RegExp(`\\b${escapeRegex(target)}\\b`, "i");
  if (regex.test(statement)) {
    return ensureSentence(statement.replace(regex, replacement));
  }
  return null;
};

const hasMeaningfulMutation = (statement, evidenceText, stopwords) => {
  const statementTokens = normalizePromptTokens(statement, stopwords);
  const evidenceTokens = normalizePromptTokens(evidenceText, stopwords);
  const statementSet = new Set(statementTokens);
  const evidenceSet = new Set(evidenceTokens);
  for (const token of statementSet) {
    if (!evidenceSet.has(token)) {
      return true;
    }
  }
  for (const token of evidenceSet) {
    if (!statementSet.has(token)) {
      return true;
    }
  }
  return false;
};

const getConceptSectionId = (concept, sentenceIdToSectionId) => {
  const ids = Array.isArray(concept?.sentenceIds) ? concept.sentenceIds : [];
  for (const id of ids) {
    const sectionId = sentenceIdToSectionId.get(id);
    if (sectionId) {
      return sectionId;
    }
  }
  return null;
};

const extractCandidates = (tokens, stopwords, maxGram = 3) => {
  const candidates = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let n = 1; n <= maxGram; n += 1) {
      const slice = tokens.slice(i, i + n);
      if (slice.length !== n) {
        continue;
      }
      if (slice.some((t) => isStopword(t, stopwords) || t.length < 3)) {
        continue;
      }
      if (slice.every((t) => /^\d+$/.test(t))) {
        continue;
      }
      const phrase = slice.join(" ");
      candidates.push(phrase);
    }
  }
  return candidates;
};

const inferConceptType = (name, sentenceText) => {
  const s = String(sentenceText || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  if (s.includes("for example") || s.includes("such as") || s.includes("e.g.")) {
    return "example";
  }
  if (s.includes("step") || s.includes("process") || s.includes("procedure") || s.includes("method")) {
    return "process";
  }
  if (s.includes(`${n} is`) || s.includes(`${n} are`) || s.includes("refers to") || s.includes("defined as")) {
    return "definition";
  }
  return "concept";
};

const buildPhraseRegex = (phrase) => {
  const clean = escapeRegex(phrase);
  return new RegExp(`\\b${clean}\\b`, "i");
};

const isGenericPhrase = (phrase) => {
  const tokens = tokenize(phrase);
  if (!tokens.length) {
    return true;
  }
  if (tokens.length === 1) {
    return GENERIC_TOKENS.has(tokens[0]);
  }
  return tokens.every((t) => GENERIC_TOKENS.has(t));
};

const isDefinitionSentence = (conceptName, sentenceText) => {
  const name = String(conceptName || "").toLowerCase();
  const text = String(sentenceText || "").toLowerCase();
  if (!name || !text) {
    return false;
  }
  if (text.startsWith(`${name}:`)) {
    return true;
  }
  if (
    text.includes(`${name} is`) ||
    text.includes(`${name} are`) ||
    text.includes("defined as") ||
    text.includes("refers to")
  ) {
    return true;
  }
  return false;
};

const getDefinitionBody = (sentenceText, conceptName) => {
  const text = String(sentenceText || "");
  const term = getColonTerm(text);
  if (term && conceptName && term.toLowerCase() === conceptName.toLowerCase()) {
    return normalizeWhitespace(text.split(":").slice(1).join(":"));
  }
  return text;
};
const buildDefinitionSnippet = (sentenceText, conceptName) => {
  const definition = getDefinitionBody(sentenceText, conceptName);
  const tokens = extractKeyTokens(definition, DEFAULT_STOPWORDS, 6);
  if (!tokens.length) {
    return "";
  }
  return tokens.join(" ");
};

const extractConcepts = ({ text, sentences, stopwords = DEFAULT_STOPWORDS, limit = 24 }) => {
  const tokens = tokenize(text);
  const candidatePhrases = extractCandidates(tokens, stopwords, 3);
  const freq = new Map();
  const tokenCounts = new Map();
  const sentenceLookup = new Map(sentences.map((sentence) => [sentence.id, sentence]));

  tokens.forEach((token) => {
    if (!isStopword(token, stopwords) && token.length >= 3) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
  });

  candidatePhrases.forEach((phrase) => {
    freq.set(phrase, (freq.get(phrase) || 0) + 1);
  });

  sentences.forEach((sentence) => {
    const term = getColonTerm(sentence.text);
    if (term) {
      const key = term.toLowerCase();
      freq.set(key, (freq.get(key) || 0) + 3);
    }
  });

  const topTokens = new Set(
    [...tokenCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([token]) => token)
  );

  const scored = [...freq.entries()]
    .map(([phrase, count]) => {
      const tokensInPhrase = phrase.split(" ");
      const lengthBoost = tokensInPhrase.length >= 2 ? 1.4 : 1;
      const penalty = isGenericPhrase(phrase) ? 0.1 : 1;
      const commonPenalty =
        tokensInPhrase.length === 1 && topTokens.has(tokensInPhrase[0]) ? 0.7 : 1;
      return { phrase, count, score: count * lengthBoost * penalty * commonPenalty };
    })
    .sort((a, b) => b.score - a.score);

  const concepts = [];
  const used = new Set();

  for (const item of scored) {
    if (concepts.length >= limit) {
      break;
    }
    const name = normalizeWhitespace(item.phrase);
    if (!name) {
      continue;
    }
    if (used.has(name)) {
      continue;
    }
    if (isGenericPhrase(name)) {
      continue;
    }
    if (name.split(" ").every((t) => isStopword(t, stopwords))) {
      continue;
    }

    const sentenceIds = [];
    const evidence = [];
    const definitionSentenceIds = [];
    sentences.forEach((sentence) => {
      const hay = sentence.text.toLowerCase();
      const regex = buildPhraseRegex(name);
      if (regex.test(hay)) {
        sentenceIds.push(sentence.id);
        if (isDefinitionSentence(name, sentence.text)) {
          definitionSentenceIds.push(sentence.id);
        }
        if (evidence.length < 2 && !sentence.isHeading) {
          evidence.push(sentence.text);
        }
      }
    });

    if (!sentenceIds.length) {
      continue;
    }

    const sampleEvidence = evidence.length
      ? evidence[0]
      : sentenceLookup.get(sentenceIds[0])?.text;
    const type = inferConceptType(name, sampleEvidence);

    concepts.push({
      id: `c_${hashId(name)}`,
      name,
      type,
      sentenceIds,
      definitionSentenceIds,
    });
    used.add(name);
  }

  if (!concepts.length) {
    const fallback = tokens.filter((t) => !isStopword(t, stopwords) && t.length >= 4).slice(0, 8);
    fallback.forEach((word) => {
      concepts.push({
        id: `c_${hashId(word)}`,
        name: word,
        type: "concept",
        sentenceIds: sentences.length ? [sentences[0].id] : [],
      });
    });
  }

  return concepts;
};

const buildBlueprint = ({ text, seed, stopwords = DEFAULT_STOPWORDS, conceptLimit = 24 }) => {
  const extractStartedAt = Date.now();
  const sentences = splitIntoSentences(text);
  const sections = splitIntoSections(text, sentences);
  const concepts = extractConcepts({ text, sentences, stopwords, limit: conceptLimit });

  return {
    apiVersion: API_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    seed: seed == null ? null : String(seed),
    sourceText: {
      sentences,
    },
    blueprint: {
      concepts,
      sections,
    },
    timingsMs: {
      extract: Date.now() - extractStartedAt,
    },
  };
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rngFromString = (value) => mulberry32(Number.parseInt(hashId(value), 16));

const shuffleDeterministic = (arr, rng) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const pickEvidenceForConcept = (
  concept,
  sentenceMap,
  { preferDefinition = false, sentenceFilter = null } = {}
) => {
  const ids = Array.isArray(concept?.sentenceIds) ? concept.sentenceIds : [];
  const definitionIds = Array.isArray(concept?.definitionSentenceIds)
    ? concept.definitionSentenceIds
    : [];
  const baseIds = preferDefinition && definitionIds.length ? definitionIds : ids;
  let resolved = baseIds.map((id) => sentenceMap.get(id)).filter(Boolean);
  const nonHeading = resolved.filter((sentence) => !sentence.isHeading);
  if (nonHeading.length) {
    resolved = nonHeading;
  }
  if (sentenceFilter) {
    const filtered = resolved.filter((sentence) => sentenceFilter(sentence));
    if (!filtered.length) {
      return null;
    }
    resolved = filtered;
  }
  if (!resolved.length) {
    return null;
  }
  const first = resolved[0];
  return {
    sourceSentenceIds: [first.id],
    sourceOffsets: [{ start: first.start, end: first.end }],
    evidenceSnippets: [normalizeWhitespace(first.text)],
  };
};

const choiceLabels = ["A", "B", "C", "D"];

const extractKeyTokens = (sentence, stopwords, limit = 8) => {
  const tokens = normalizePromptTokens(sentence, stopwords);
  const unique = [];
  tokens.forEach((token) => {
    if (!unique.includes(token)) {
      unique.push(token);
    }
  });
  return unique.slice(0, limit);
};

const pickScenarioKeywords = (sentenceText, rng, limit = 3) => {
  const tokens = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 6);
  if (!tokens.length) {
    return [];
  }
  const shuffled = shuffleDeterministic(tokens, rng);
  const max = Math.min(limit, shuffled.length);
  const count = max >= 3 ? 3 : max >= 2 ? 2 : 1;
  return shuffled.slice(0, count);
};

const dedupeKeywords = (keywords, conceptName) => {
  if (!keywords.length) {
    return [];
  }
  const conceptNormalized = normalizeTerm(conceptName);
  return keywords.filter((keyword) => normalizeTerm(keyword) !== conceptNormalized);
};

const pickContextPhrase = ({ sentenceText, concept, rng, limit = 2 }) => {
  const keywords = dedupeKeywords(pickScenarioKeywords(sentenceText, rng, limit), concept?.name);
  if (keywords.length) {
    return keywords.join(" and ");
  }
  return concept?.name || "this topic";
};

const buildContextIntro = ({ sentenceText, concept, rng }) => {
  const phrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  const options = [
    `In a real-world case involving ${phrase},`,
    `In the context of ${phrase},`,
    `Imagine a situation with ${phrase},`,
  ];
  const picker = rng || Math.random;
  return options[Math.floor(picker() * options.length)];
};

const ENGLISH_DEVICE_EXAMPLES = {
  metaphor: [
    "The library was a quiet ocean of ideas.",
    "Time is a thief that steals our moments.",
  ],
  simile: [
    "The lake shimmered like glass under the sun.",
    "Her smile was as bright as a flashlight.",
  ],
  personification: [
    "The wind whispered through the trees.",
    "The alarm clock screamed at dawn.",
  ],
  hyperbole: [
    "I could run a million miles today.",
    "The backpack weighs a ton.",
  ],
  alliteration: [
    "Busy bees buzzed by the blooming bushes.",
    "Sally sold shiny shells by the shore.",
  ],
  imagery: [
    "Golden leaves drifted across the crisp, cool sidewalk.",
    "The spicy aroma filled the warm kitchen.",
  ],
  onomatopoeia: [
    "The door slammed with a loud bang.",
    "The bacon sizzled in the pan.",
  ],
  irony: [
    "The fire station burned down last night.",
    "A traffic cop got a speeding ticket.",
  ],
  foreshadowing: [
    "Dark clouds gathered as the hikers stepped onto the trail.",
    "He checked the life jacket twice before the storm rolled in.",
  ],
  symbolism: [
    "The white dove soared above the crowd.",
    "The broken chain lay on the courthouse steps.",
  ],
};

const buildEnglishDeviceSentence = ({ concept, sentenceText, rng }) => {
  const conceptKey = singularizeTerm(normalizeTerm(concept?.name));
  const examples = ENGLISH_DEVICE_EXAMPLES[conceptKey];
  if (examples && examples.length) {
    const picker = rng || Math.random;
    return examples[Math.floor(picker() * examples.length)];
  }
  const phrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  return `The scene with ${phrase} stood out in the passage.`;
};

const buildEnglishBaseSentence = ({ sentenceText, concept }) => {
  const cleaned = normalizeWhitespace(sentenceText);
  if (cleaned && cleaned.length >= 20) {
    return cleaned;
  }
  const fallback = concept?.name ? `The paragraph about ${concept.name} needs clear wording.` : "The sentence needs clearer wording.";
  return ensureSentence(fallback);
};

const paraphraseFromSentence = (sentence, concept, stopwords) => {
  const cleaned = normalizeWhitespace(sentence);
  if (!cleaned) {
    return concept?.name ? `${concept.name} is mentioned in the source text.` : "";
  }
  return ensureSentence(cleaned);
};

const buildTfParaphraseStatement = ({ sentence, concept, stopwords, rng }) => {
  const keywords = extractKeyTokens(sentence, stopwords, 4);
  const conceptName = concept?.name || (keywords.length ? keywords.shift() : "the concept");
  const filtered = keywords.filter(
    (keyword) => normalizeTerm(keyword) !== normalizeTerm(conceptName)
  );
  const phrases = [
    "is related to",
    "is connected with",
    "is associated with",
    "works alongside",
  ];
  const verb = phrases[Math.floor((rng || Math.random)() * phrases.length)];
  if (filtered.length >= 2) {
    return ensureSentence(`The text explains that ${conceptName} ${verb} ${filtered.join(" and ")}.`);
  }
  if (filtered.length === 1) {
    return ensureSentence(`The text explains that ${conceptName} ${verb} ${filtered[0]}.`);
  }
  const softened = String(sentence || "").trim();
  if (!softened) {
    return conceptName ? ensureSentence(`The text discusses ${conceptName}.`) : "";
  }
  const lowered = softened.charAt(0).toLowerCase() + softened.slice(1);
  return ensureSentence(`The text states that ${lowered}`);
};

const buildTfScenarioStatement = ({ sentence, concept, replacements, truthy, rng }) => {
  const keywords = pickScenarioKeywords(sentence, rng, 2);
  const keywordPhrase = keywords.length ? keywords.join(" and ") : "a key process";
  const alternate =
    replacements && replacements.length ? replacements[0] : truthy ? concept?.name : null;
  if (!truthy && !alternate) {
    return ensureSentence(
      `In a scenario, ${keywordPhrase} occurs, which does not indicate ${concept?.name}.`
    );
  }
  const conceptName = truthy ? concept?.name : alternate || concept?.name;
  return ensureSentence(`In a scenario, ${keywordPhrase} occurs, which indicates ${conceptName}.`);
};

const buildCauseEffectPrompt = ({ sentenceText, concept }) => {
  const keywords = dedupeKeywords(extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 4), concept?.name);
  if (keywords.length >= 2) {
    return `When ${keywords[0]} changes, what happens to ${keywords[1]}?`;
  }
  if (keywords.length === 1) {
    return `When ${keywords[0]} shifts, what is the most likely effect?`;
  }
  return `When ${concept.name} changes, what is the most likely effect?`;
};

const buildOrganellePrompt = ({ sentenceText, rng }) => {
  const keywords = pickScenarioKeywords(sentenceText, rng, 2);
  const keywordPhrase = keywords.length ? keywords.join(" and ") : "a key cell function";
  if (rng() < 0.5) {
    return `When a cell needs ${keywordPhrase}, which organelle is responsible?`;
  }
  return `When a cell cannot complete ${keywordPhrase}, which organelle is most likely missing?`;
};

const buildEquationsPrompt = ({ sentenceText, rng }) => {
  const keywords = pickScenarioKeywords(sentenceText, rng, 2);
  const keywordPhrase = keywords.length ? keywords.join(" and ") : "energy release";
  if (rng() < 0.5) {
    return `When ${keywordPhrase} occurs, which process fits best?`;
  }
  return `When ${keywordPhrase} happens, which set of reactants and products is correct?`;
};

const buildGeneticsPrompt = ({ sentenceText, rng }) => {
  const keywords = pickScenarioKeywords(sentenceText, rng, 2);
  const keywordPhrase = keywords.length ? keywords.join(" and ") : "a trait";
  if (rng() < 0.5) {
    return `If ${keywordPhrase} occurs with one copy of an allele, which pattern is shown?`;
  }
  return `When ${keywordPhrase} occurs only with two copies of an allele, which pattern is shown?`;
};

const buildEcologyPrompt = ({ sentenceText, rng }) => {
  const keywords = pickScenarioKeywords(sentenceText, rng, 2);
  const keywordPhrase = keywords.length ? keywords.join(" and ") : "energy flow";
  if (rng() < 0.5) {
    return `When ${keywordPhrase} moves from producers to consumers, which relationship is shown?`;
  }
  return `When producers are removed and ${keywordPhrase} changes, what happens next?`;
};

const buildScenarioPrompt = ({
  sentenceText,
  concept,
  category,
  sectionTitle,
  rng,
  subjectCategory,
}) => {
  if (normalizeSubjectKey(subjectCategory) === "other") {
    const context = buildScenarioContext({ sentenceText, concept });
    const safePrompt = renderSafeScenarioPrompt({ context, rng });
    if (safePrompt) {
      return safePrompt;
    }
  }
  const keywords = pickScenarioKeywords(sentenceText, rng, 3);
  const keywordPhrase = keywords.length
    ? keywords.length > 2
      ? `${keywords[0]}, ${keywords[1]} and ${keywords[2]}`
      : keywords.join(" and ")
    : concept?.name || "this topic";
  if (category === "organelles") {
    return `When a cell needs ${keywordPhrase}, which organelle is most responsible?`;
  }
  if (category === "body_systems") {
    return `When ${keywordPhrase} is involved, which system is primarily responsible?`;
  }
  if (category === "genetics") {
    return `When ${keywordPhrase} occurs with just one copy of an allele, which pattern is shown?`;
  }
  if (category === "ecology") {
    return `When energy moves through ${keywordPhrase}, which process is illustrated?`;
  }
  if (category === "equations") {
    return `When ${keywordPhrase} occurs and energy is released, which process fits best?`;
  }
  return `When a situation involves ${keywordPhrase}, which process or system is involved?`;
};

const buildSciencePrompt = ({ sentenceText, concept, rng }) => {
  const roll = rng ? rng() : Math.random();
  const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  if (roll < 0.34) {
    return `In a lab investigation, ${keywordPhrase} changes. Which outcome is most likely?`;
  }
  if (roll < 0.67) {
    return `In this system, what role does ${concept.name} play?`;
  }
  return `Given the situation with ${keywordPhrase}, which description best fits ${concept.name}?`;
};

const buildEnglishPrompt = ({ concept, sentenceText, rng }) => {
  const roll = rng ? rng() : Math.random();
  const baseSentence = buildEnglishBaseSentence({ sentenceText, concept });
  const deviceSentence = buildEnglishDeviceSentence({ concept, sentenceText, rng });
  if (roll < 0.25) {
    return `Choose the best revision to fix the grammar in this sentence: "${baseSentence}"?`;
  }
  if (roll < 0.5) {
    return `Which literary device is used in this NEW sentence: "${deviceSentence}"?`;
  }
  if (roll < 0.75) {
    return `Which option uses active voice to express the idea in: "${baseSentence}"?`;
  }
  return `Which option most improves clarity while keeping the meaning of: "${baseSentence}"?`;
};

const buildGeographyPrompt = ({ sentenceText, concept, rng }) => {
  const roll = rng ? rng() : Math.random();
  const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  if (roll < 0.34) {
    return `A location has ${keywordPhrase} year after year. Which statement best describes the climate?`;
  }
  if (roll < 0.67) {
    return `A map uses latitude and longitude for ${keywordPhrase}. Which statement best interprets the coordinates?`;
  }
  return `After ${keywordPhrase} reshapes the land, which geographic process is occurring?`;
};

const inferHistorySourceType = (sentenceText) => {
  const text = String(sentenceText || "").toLowerCase();
  if (!text) {
    return null;
  }
  const hasPrimary = HISTORY_SOURCE_PRIMARY_MARKERS.some((token) => text.includes(token));
  const hasSecondary = HISTORY_SOURCE_SECONDARY_MARKERS.some((token) => text.includes(token));
  if (hasPrimary && !hasSecondary) {
    return "primary";
  }
  if (hasSecondary && !hasPrimary) {
    return "secondary";
  }
  return null;
};

const extractYearFromText = (text) => {
  const match = String(text || "").match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
};

const formatCenturyLabel = (year) => {
  const century = Math.floor((year - 1) / 100) + 1;
  const mod100 = century % 100;
  const mod10 = century % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${century}${suffix} century`;
};

const buildHistorySourceChoiceSet = ({ sentenceText, rng }) => {
  const type = inferHistorySourceType(sentenceText);
  if (!type) {
    return null;
  }
  const keyword = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 2)[0] || "source";
  const primaryLabel = `Primary source (${keyword})`;
  const secondaryLabel = `Secondary source (${keyword})`;
  const choices =
    type === "primary"
      ? [primaryLabel, "Secondary source", "Opinion piece", "Timeline"]
      : [secondaryLabel, "Primary source", "Opinion piece", "Timeline"];
  const shuffled = shuffleDeterministic(choices, rng || Math.random);
  const answerIndex = shuffled.findIndex((choice) =>
    type === "primary" ? choice.startsWith("Primary source") : choice.startsWith("Secondary source")
  );
  return {
    choices: shuffled,
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: shuffled[Math.max(0, answerIndex)],
    choiceFormat: "term-list",
  };
};

const pickHistoryReliabilityCriterion = (sentenceText) => {
  const hash = Number.parseInt(hashId(sentenceText || "history"), 16);
  const index = Math.abs(hash) % HISTORY_RELIABILITY_CRITERIA.length;
  return HISTORY_RELIABILITY_CRITERIA[index];
};

const buildHistoryReliabilityChoiceSet = ({ sentenceText, rng }) => {
  const criterion = pickHistoryReliabilityCriterion(sentenceText);
  const choices = shuffleDeterministic([...HISTORY_RELIABILITY_DISTRACTORS], rng || Math.random);
  const answerIndex = choices.findIndex((choice) => choice === criterion.answer);
  return {
    choices,
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: criterion.answer,
    choiceFormat: "term-list",
  };
};

const buildHistoryChronologyChoiceSet = ({ sentenceText, rng }) => {
  const year = extractYearFromText(sentenceText);
  if (!year) {
    return null;
  }
  const correctCentury = formatCenturyLabel(year);
  const baseCentury = Math.floor((year - 1) / 100) + 1;
  const distractors = [
    formatCenturyLabel((baseCentury - 1) * 100),
    formatCenturyLabel((baseCentury + 1) * 100),
    formatCenturyLabel((baseCentury + 2) * 100),
  ];
  const choices = shuffleDeterministic([correctCentury, ...distractors], rng || Math.random).slice(0, 4);
  const answerIndex = choices.findIndex((choice) => choice === correctCentury);
  return {
    choices,
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: correctCentury,
    choiceFormat: "term-list",
  };
};

const findHistoryGovernmentForm = (text) => {
  const haystack = normalizeTerm(text);
  return HISTORY_GOVERNMENT_FORMS.find((form) => haystack.includes(normalizeTerm(form))) || null;
};

const buildHistoryGovernmentChoiceSet = ({ sentenceText, concept, rng }) => {
  const match = findHistoryGovernmentForm(`${concept?.name || ""} ${sentenceText || ""}`);
  if (!match) {
    return null;
  }
  const choices = shuffleDeterministic(
    HISTORY_GOVERNMENT_FORMS.map((form) => form.charAt(0).toUpperCase() + form.slice(1)),
    rng || Math.random
  );
  const correctLabel = match.charAt(0).toUpperCase() + match.slice(1);
  const answerIndex = choices.findIndex((choice) => choice === correctLabel);
  return {
    choices,
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: correctLabel,
    choiceFormat: "term-list",
  };
};

const buildHistorySourcePrompt = ({ concept, sentenceText, rng }) => {
  const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  return `A source about ${keywordPhrase} is described. Which type of source is it?`;
};

const buildHistoryReliabilityPrompt = ({ sentenceText }) => {
  const criterion = pickHistoryReliabilityCriterion(sentenceText);
  return criterion.prompt;
};

const buildHistoryChronologyPrompt = ({ sentenceText, concept }) => {
  const year = extractYearFromText(sentenceText);
  if (year) {
    return `An event happened in ${year}. Which century does it belong to?`;
  }
  return `In a timeline about ${concept?.name || "this topic"}, which placement makes the most sense?`;
};

const buildHistoryGovernmentPrompt = ({ concept, sentenceText, rng }) => {
  const contextLead = buildContextIntro({ sentenceText, concept, rng });
  return `${contextLead} which form of government is described?`;
};

const buildHistoryPrompt = ({ sentenceText, concept, rng }) => {
  const roll = rng ? rng() : Math.random();
  const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  if (roll < 0.34) {
    return `You are researching ${keywordPhrase}. Which option would be a primary source?`;
  }
  if (roll < 0.67) {
    return `Based on ${keywordPhrase}, what is the most likely cause or effect?`;
  }
  return `In a civics scenario about ${concept.name}, which option is a right rather than a responsibility?`;
};

const buildCsPrompt = ({ sentenceText, concept, rng }) => {
  const roll = rng ? rng() : Math.random();
  const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
  if (roll < 0.25) {
    return `In an input-process-output (IPO) flow for ${keywordPhrase}, which step is the processing stage?`;
  }
  if (roll < 0.5) {
    return `For ${concept.name}, which option is hardware rather than software?`;
  }
  if (roll < 0.75) {
    return `While improving ${concept.name}, which algorithmic step should happen next?`;
  }
  return `In ${keywordPhrase}, which statement best distinguishes data from information?`;
};

const buildMathPrompt = ({ mathCategory, sentenceText, concept, rng }) => {
  const roll = rng ? rng() : Math.random();
  const contextLead = buildContextIntro({ sentenceText, concept, rng });
  if (mathCategory === "geometry_formulas") {
    if (roll < 0.34) {
      return `${contextLead} which formula gives the area of a circle?`;
    }
    if (roll < 0.67) {
      return `${contextLead} which formula gives the circumference of a circle?`;
    }
    return `${contextLead} which formula gives the volume of a cylinder?`;
  }
  if (mathCategory === "number_types") {
    if (roll < 0.5) {
      return `${contextLead} which number type fits best?`;
    }
    return `${contextLead} which option names a number type?`;
  }
  if (mathCategory === "fraction_percent") {
    if (roll < 0.5) {
      return `${contextLead} a fraction has a smaller numerator than denominator. What type is it?`;
    }
    return `${contextLead} which term best names a quantity written as a percent?`;
  }
  if (mathCategory === "averages_ratio") {
    if (roll < 0.5) {
      return `${contextLead} which measure gives the arithmetic average?`;
    }
    return `${contextLead} which term compares two quantities as a ratio?`;
  }
  return `${contextLead} which statement about the math concept is correct?`;
};

const buildMathDefinitionPrompt = ({ concept, sentenceText, rng }) => {
  const roll = rng ? rng() : Math.random();
  const contextLead = buildContextIntro({ sentenceText, concept, rng });
  if (roll < 0.33) {
    return `${contextLead} which description best defines ${concept.name}?`;
  }
  if (roll < 0.66) {
    return `${contextLead} which option correctly explains ${concept.name}?`;
  }
  return `${contextLead} which statement accurately defines ${concept.name}?`;
};
const buildMathDefinitionFallbackPrompt = ({ concept, sentenceText }) => {
  const operatorToken = findMathOperatorToken(sentenceText);
  if (operatorToken) {
    return `A formula uses "${operatorToken}". Which term best names this idea?`;
  }
  const snippet = buildDefinitionSnippet(sentenceText, concept.name);
  if (snippet) {
    return `The description "${snippet}" refers to which term?`;
  }
  return `In this context, which statement correctly describes ${concept.name}?`;
};

const buildMathFallbackChoiceSet = ({ concept, sentenceText, rng }) => {
  const tokens = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 8);
  const conceptTokens = extractKeyTokens(concept?.name || "", DEFAULT_STOPWORDS, 4);
  const pool = [...new Set([...tokens, ...conceptTokens])].filter(Boolean);
  if (pool.length < 4) {
    return null;
  }
  const choicePool = pool.slice(0, 4);
  const choiceObjs = choicePool.map((choice, index) => ({
    choice,
    isCorrect: index === 0,
  }));
  const choiceRng = rng || Math.random;
  const shuffled = shuffleDeterministic(choiceObjs, choiceRng);
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    choices: shuffled.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: choicePool[0],
  };
};

const MISCONCEPTION_SWAP_PAIRS = [
  ["increase", "decrease"],
  ["increases", "decreases"],
  ["more", "less"],
  ["higher", "lower"],
  ["cause", "effect"],
  ["causes", "is caused by"],
  ["input", "output"],
  ["hardware", "software"],
  ["renewable", "non-renewable"],
  ["weather", "climate"],
  ["latitude", "longitude"],
  ["erosion", "deposition"],
  ["aerobic", "anaerobic"],
  ["dominant", "recessive"],
  ["producer", "consumer"],
];

const buildMisconceptionStatements = ({ sentenceText, concept, siblingConcepts, rng }) => {
  const base = normalizeWhitespace(sentenceText);
  if (!base) {
    return [];
  }
  const results = [];
  const addResult = (text) => {
    const cleaned = ensureSentence(normalizeWhitespace(text));
    if (!cleaned || cleaned.toLowerCase() === base.toLowerCase()) {
      return;
    }
    if (results.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      return;
    }
    results.push(cleaned);
  };

  MISCONCEPTION_SWAP_PAIRS.forEach(([from, to]) => {
    const swapped = replaceTerm(base, from, to);
    if (swapped) {
      addResult(swapped);
    }
  });

  if (concept?.name) {
    const shuffled = shuffleDeterministic(siblingConcepts || [], rng || Math.random);
    for (const sibling of shuffled) {
      const swapped = replaceTerm(base, concept.name, sibling.name);
      if (swapped) {
        addResult(swapped);
      }
      if (results.length >= 3) {
        break;
      }
    }
  }

  return results.slice(0, 3);
};

const gatherGroundedStatements = ({ sentenceText, concept, rng }) => {
  if (!sentenceText || !concept?.name) {
    return null;
  }
  const correctChoice = paraphraseFromSentence(sentenceText, concept, DEFAULT_STOPWORDS);
  if (!correctChoice || hasBannedPhrase(correctChoice)) {
    return null;
  }
  const seen = new Set([correctChoice.toLowerCase()]);
  const distractors = [];
  const misconceptions = buildMisconceptionStatements({ sentenceText, concept, rng });
  (misconceptions || []).forEach((item) => {
    const normalized = String(item || "").toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    const candidate = ensureSentence(item);
    distractors.push(candidate);
    seen.add(normalized);
  });
  if (distractors.length < 3) {
    const tokens = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 6);
    tokens.forEach((token) => {
      if (distractors.length >= 3) {
        return;
      }
      const candidate = ensureSentence(`The text also mentions ${token}.`);
      const normalized = candidate.toLowerCase();
      if (seen.has(normalized)) {
        return;
      }
      distractors.push(candidate);
      seen.add(normalized);
    });
  }
  if (distractors.length < 3) {
    return null;
  }
  return {
    correct: ensureSentence(correctChoice),
    distractors: distractors.slice(0, 3),
  };
};

const buildOtherTermChoiceSet = ({ sentenceText, concept, rng, additionalTokens = [] }) => {
  if (!sentenceText || !concept?.name) {
    return null;
  }
  const normalizedConcept = normalizeTerm(concept.name);
  const candidates = [];
  const phrases = extractCandidates(tokenize(sentenceText), DEFAULT_STOPWORDS, 3);
  phrases.forEach((phrase) => {
    const normalized = normalizeTerm(phrase);
    if (!normalized || normalized === normalizedConcept) {
      return;
    }
    if (candidates.some((item) => item.normalized === normalized)) {
      return;
    }
    const matched = findTermMatch(sentenceText, phrase) || phrase;
  candidates.push({ normalized, original: normalizeWhitespace(matched) });
  });
  if (candidates.length < 3 && additionalTokens.length) {
    additionalTokens.forEach((token) => {
      if (candidates.length >= 3) {
        return;
      }
      const normalized = normalizeTerm(token);
      if (!normalized || normalized === normalizedConcept) {
        return;
      }
      if (candidates.some((item) => item.normalized === normalized)) {
        return;
      }
      candidates.push({ normalized, original: normalizeWhitespace(String(token || "")) });
    });
  }
  if (candidates.length < 3) {
    const tokens = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 6);
    tokens.forEach((token) => {
      if (candidates.length >= 3) {
        return;
      }
      const normalized = normalizeTerm(token);
      if (!normalized || normalized === normalizedConcept) {
        return;
      }
      if (candidates.some((item) => item.normalized === normalized)) {
        return;
      }
      candidates.push({ normalized, original: token });
    });
  }
  if (candidates.length < 3) {
    return null;
  }
  const choiceObjs = [
    { choice: ensureSentence(concept.name), isCorrect: true },
    ...candidates.slice(0, 3).map((entry) => ({ choice: entry.original, isCorrect: false })),
  ];
  const shuffled = shuffleDeterministic(choiceObjs, rng || Math.random).slice(0, 4);
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    choices: shuffled.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: shuffled[answerIndex].choice,
    choiceFormat: "term-list",
  };
};

const collectOtherDefinitionTokens = ({
  sentenceMap,
  sentenceIdToSectionId,
  sectionSentenceIdsMap,
  currentSentenceId,
  concept,
  limit = 8,
}) => {
  if (!sentenceMap || !concept) {
    return [];
  }
  const tokens = new Set();
  const addTokensFromText = (text) => {
    if (!text) {
      return;
    }
    extractKeyTokens(String(text), DEFAULT_STOPWORDS, limit).forEach((token) => {
      if (tokens.size >= limit) {
        return;
      }
      tokens.add(token);
    });
  };
  const addSentenceIds = (ids) => {
    const list = Array.isArray(ids) ? ids : [];
    list.forEach((id) => {
      if (tokens.size >= limit) {
        return;
      }
      const sentence = sentenceMap.get(id);
      addTokensFromText(sentence?.text);
    });
  };
  const sectionId = sentenceIdToSectionId?.get(currentSentenceId);
  if (sectionId) {
    addSentenceIds(sectionSentenceIdsMap?.get(sectionId));
  }
  addSentenceIds(concept.sentenceIds);
  if (tokens.size < limit) {
    const currentSentence = sentenceMap.get(currentSentenceId);
    addTokensFromText(currentSentence?.text);
  }
  if (tokens.size < limit && concept.name) {
    extractKeyTokens(concept.name, DEFAULT_STOPWORDS, limit).forEach((token) => {
      if (tokens.size >= limit) {
        return;
      }
      tokens.add(token);
    });
  }
  return [...tokens];
};

const extractClassificationListFromSentence = (sentenceText) => {
  if (!sentenceText) {
    return [];
  }
  const match = CLASSIFICATION_MARKER_REGEX.exec(sentenceText);
  if (!match) {
    return [];
  }
  const tail = sentenceText.slice(match.index + match[0].length);
  const truncated = tail.split(/[.!?]/)[0];
  if (!truncated) {
    return [];
  }
  const candidates = truncated
    .split(/,|;/)
    .flatMap((segment) => segment.split(/\band\b|\bor\b/i))
    .map((segment) => normalizeWhitespace(segment))
    .map((segment) => segment.replace(/\b(for example|such as|including)\b/gi, "").trim())
    .filter(Boolean);
  return [...new Set(candidates)];
};

const buildOtherClassificationChoiceSet = ({ sentenceText, concept, rng }) => {
  if (!sentenceText || !concept) {
    return null;
  }
  const items = extractClassificationListFromSentence(sentenceText);
  if (items.length < 4) {
    return null;
  }
  const choiceObjs = [{ choice: ensureSentence(items[0]), isCorrect: true }];
  for (let i = 1; i < Math.min(items.length, 4); i += 1) {
    choiceObjs.push({ choice: ensureSentence(items[i]), isCorrect: false });
  }
  if (choiceObjs.length < 4) {
    return null;
  }
  const shuffled = shuffleDeterministic(choiceObjs, rng || Math.random).slice(0, 4);
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    choices: shuffled.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: shuffled[answerIndex].choice,
    choiceFormat: "term-list",
  };
};

const buildOtherParaphraseChoiceSet = ({ sentenceText, concept, rng }) => {
  const set = gatherGroundedStatements({ sentenceText, concept, rng });
  if (!set) {
    return null;
  }
  const choiceObjs = [{ choice: set.correct, isCorrect: true }].concat(
    set.distractors.map((choice) => ({ choice, isCorrect: false }))
  );
  const shuffled = shuffleDeterministic(choiceObjs, rng || Math.random).slice(0, 4);
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    choices: shuffled.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: shuffled[answerIndex].choice,
    choiceFormat: "sentence",
  };
};

const buildOtherExampleChoiceSet = ({ sentenceText, concept, rng }) => {
  const set = gatherGroundedStatements({ sentenceText, concept, rng });
  if (!set) {
    return null;
  }
  const choiceObjs = [{ choice: set.correct, isCorrect: true }].concat(
    set.distractors.map((choice) => ({ choice, isCorrect: false }))
  );
  const shuffled = shuffleDeterministic(choiceObjs, rng || Math.random).slice(0, 4);
  const answerIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    choices: shuffled.map((item) => item.choice),
    answerKey: choiceLabels[Math.max(0, answerIndex)],
    correctChoice: shuffled[answerIndex].choice,
    choiceFormat: "sentence",
  };
};

const replaceTerm = (sentence, target, replacement) => {
  if (!sentence || !target || !replacement) {
    return null;
  }
  const pattern = new RegExp(`\\b${escapeRegex(target)}\\b`, "i");
  if (!pattern.test(sentence)) {
    return null;
  }
  const updated = sentence.replace(pattern, replacement);
  return ensureSentence(updated);
};

const mutateSentenceDetail = ({ sentence, targets, replacements }) => {
  for (const target of targets) {
    for (const replacement of replacements) {
      if (!replacement || replacement.toLowerCase() === String(target || "").toLowerCase()) {
        continue;
      }
      const mutated = replaceTerm(sentence, target, replacement);
      if (mutated && mutated !== sentence) {
        return mutated;
      }
    }
  }
  return null;
};

const SWAP_PAIRS = [
  ["oxygen", "carbon dioxide"],
  ["carbon dioxide", "oxygen"],
  ["dna", "rna"],
  ["rna", "dna"],
  ["aerobic", "anaerobic"],
  ["anaerobic", "aerobic"],
  ["increase", "decrease"],
  ["increases", "decreases"],
  ["more", "less"],
  ["less", "more"],
  ["higher", "lower"],
  ["lower", "higher"],
  ["produces", "consumes"],
  ["consumes", "produces"],
];

const applySwapPair = (sentence) => {
  const lower = String(sentence || "").toLowerCase();
  for (const [from, to] of SWAP_PAIRS) {
    if (lower.includes(from)) {
      return replaceTerm(sentence, from, to);
    }
  }
  return null;
};

const negateStatement = (sentence) => {
  const str = String(sentence || "");
  if (/\bis\b/i.test(str)) {
    return ensureSentence(str.replace(/\bis\b/i, "is not"));
  }
  if (/\bare\b/i.test(str)) {
    return ensureSentence(str.replace(/\bare\b/i, "are not"));
  }
  return null;
};

const buildTfFalseStatement = ({
  sentence,
  concept,
  concepts,
  sentenceIdToSectionId,
  grounding,
  subjectCategory,
  resolvedMathCategory,
  template,
  seedSalt,
  index,
}) => {
  const sentenceId = grounding?.sourceSentenceIds?.[0];
  const sectionId = sentenceId ? sentenceIdToSectionId.get(sentenceId) : null;
  const siblingConcepts = sectionId
    ? concepts.filter((c) => getConceptSectionId(c, sentenceIdToSectionId) === sectionId)
    : concepts;
  const replacementTerms = siblingConcepts
    .map((c) => c.name)
    .filter((name) => !sentence.toLowerCase().includes(String(name || "").toLowerCase()));
  const targets = [concept.name, ...extractKeyTokens(sentence, DEFAULT_STOPWORDS, 6)];
  const mutationRng = rngFromString(`${seedSalt || concept.id}|tf-mutation|${index}`);
  const controlledSwap =
    subjectCategory === "math" && resolvedMathCategory
      ? applyControlledTermSwap(
          sentence,
          MATH_TF_MUTATION_TERMS[resolvedMathCategory] || [],
          mutationRng
        )
      : null;
  const useMathMutation =
    subjectCategory === "math" && (template?.id === "tf_math_mutated" || isFormulaLike(sentence));
  return (
    (useMathMutation ? mutateMathStatement(sentence) : null) ||
    controlledSwap ||
    mutateSentenceDetail({ sentence, targets, replacements: replacementTerms }) ||
    applySwapPair(sentence) ||
    negateStatement(sentence)
  );
};

const CORE_SUBJECT_DOMAINS = ["math", "science", "english", "history", "geography", "cs", "mixed"];
const ALL_SUBJECT_DOMAINS = [...CORE_SUBJECT_DOMAINS, "other"];

const TEMPLATE_REGISTRY = [
  {
    id: "mcq_math_category",
    type: "mcq",
    family: "math-core",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory, mathCategory }) =>
      subjectCategory === "math" && Boolean(mathCategory),
    buildPrompt: ({ mathCategory, sentenceText, concept, rng }) =>
      buildMathPrompt({ mathCategory, sentenceText, concept, rng }),
  },
  {
    id: "mcq_math_definition",
    type: "mcq",
    family: "math-definition",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept, sentenceText, rng }) =>
      buildMathDefinitionPrompt({ concept, sentenceText, rng }),
  },  {
    id: "mcq_math_definition_fallback",
    type: "mcq",
    family: "math-definition",
    fallbackOnly: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept, sentenceText }) =>
      buildMathDefinitionFallbackPrompt({ concept, sentenceText }),
  },
  {
    id: "mcq_math_solve_step",
    type: "mcq",
    family: "math-application",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const contextLead = buildContextIntro({ sentenceText, concept, rng });
      return `${contextLead} what is the next step to solve a problem about ${concept.name}?`;
    },
  },
  {
    id: "mcq_math_apply_formula",
    type: "mcq",
    family: "math-application",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept, sentenceText }) => {
      const operatorToken = findMathOperatorToken(sentenceText);
      if (operatorToken) {
        return `A problem uses "${operatorToken}". Which formula should be applied to ${concept.name}?`;
      }
      return `Which formula should be applied to solve a problem about ${concept.name}?`;
    },
  },
  {
    id: "mcq_math_property_classify",
    type: "mcq",
    family: "math-classify",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const contextLead = buildContextIntro({ sentenceText, concept, rng });
      return `${contextLead} which property best classifies ${concept.name}?`;
    },
  },
  {
    id: "mcq_math_error_spotting",
    type: "mcq",
    family: "math-error",
    core: true,
    subjectAllowList: ["math"],
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ concept }) =>
      `While solving a problem about ${concept.name}, which option contains the error?`,
  },
  {
    id: "mcq_science_cause_effect",
    type: "mcq",
    family: "science-cause",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ subjectCategory }) => subjectCategory === "science",
    buildPrompt: ({ concept, sentenceText }) => buildCauseEffectPrompt({ concept, sentenceText }),
  },
  {
    id: "mcq_science_function",
    type: "mcq",
    family: "science-function",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ subjectCategory }) => subjectCategory === "science",
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const contextLead = buildContextIntro({ sentenceText, concept, rng });
      return `${contextLead} what role does ${concept.name} play?`;
    },
  },
  {
    id: "mcq_science_classification",
    type: "mcq",
    family: "science-classify",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ subjectCategory }) => subjectCategory === "science",
    buildPrompt: ({ concept, sentenceText, rng }) => buildSciencePrompt({ concept, sentenceText, rng }),
  },
  {
    id: "mcq_english_grammar",
    type: "mcq",
    family: "english-grammar",
    core: true,
    subjectAllowList: ["english"],
    applies: ({ subjectCategory, concept }) =>
      subjectCategory === "english" &&
      Boolean(matchEnglishCategoryTerm(concept?.name, "grammar")),
    buildPrompt: ({ concept, sentenceText }) => {
      const baseSentence = buildEnglishBaseSentence({ sentenceText, concept });
      return `Choose the best revision to fix the grammar in this sentence: "${baseSentence}"?`;
    },
  },
  {
    id: "mcq_english_literary_device",
    type: "mcq",
    family: "english-device",
    core: true,
    subjectAllowList: ["english"],
    applies: ({ subjectCategory, concept }) =>
      subjectCategory === "english" &&
      Boolean(matchEnglishCategoryTerm(concept?.name, "device")),
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const deviceSentence = buildEnglishDeviceSentence({ concept, sentenceText, rng });
      return `Which literary device is used in this NEW sentence: "${deviceSentence}"?`;
    },
  },
  {
    id: "mcq_english_active_passive",
    type: "mcq",
    family: "english-voice",
    core: true,
    subjectAllowList: ["english"],
    applies: ({ subjectCategory }) => subjectCategory === "english",
    buildPrompt: ({ concept, sentenceText }) => {
      const baseSentence = buildEnglishBaseSentence({ sentenceText, concept });
      return `Which option uses active voice to express the idea in: "${baseSentence}"?`;
    },
  },
  {
    id: "mcq_english_sentence_improvement",
    type: "mcq",
    family: "english-improvement",
    core: true,
    subjectAllowList: ["english"],
    applies: ({ subjectCategory, concept }) =>
      subjectCategory === "english" &&
      Boolean(matchEnglishCategoryTerm(concept?.name, "writing")),
    buildPrompt: ({ concept, sentenceText }) => {
      const baseSentence = buildEnglishBaseSentence({ sentenceText, concept });
      return `Which option most improves clarity while keeping the meaning of: "${baseSentence}"?`;
    },
  },
  {
    id: "mcq_geography_scenario",
    type: "mcq",
    family: "geography-scenario",
    core: true,
    subjectAllowList: ["geography"],
    applies: ({ subjectCategory }) => subjectCategory === "geography",
    buildPrompt: ({ concept, sentenceText, rng }) => buildGeographyPrompt({ concept, sentenceText, rng }),
  },
  {
    id: "mcq_geography_climate_weather",
    type: "mcq",
    family: "geography-climate",
    core: true,
    subjectAllowList: ["geography"],
    applies: ({ subjectCategory }) => subjectCategory === "geography",
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const keywordPhrase = pickContextPhrase({ sentenceText, concept, rng, limit: 2 });
      return `A location shows ${keywordPhrase} year after year. Which statement best describes the climate?`;
    },
  },
  {
    id: "mcq_geography_resource_classify",
    type: "mcq",
    family: "geography-resources",
    core: true,
    subjectAllowList: ["geography"],
    applies: ({ subjectCategory }) => subjectCategory === "geography",
    buildPrompt: ({ concept }) =>
      `Which option best classifies the resource in ${concept.name} as renewable or non-renewable?`,
  },
  {
    id: "mcq_history_primary_secondary",
    type: "mcq",
    family: "history-sources",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory }) => isHistorySubject(subjectCategory),
    buildPrompt: ({ concept, sentenceText, rng }) => buildHistoryPrompt({ concept, sentenceText, rng }),
  },
  {
    id: "mcq_history_source_type_classification",
    type: "mcq",
    family: "history-sources",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory, sentenceText }) =>
      isHistorySubject(subjectCategory) && Boolean(inferHistorySourceType(sentenceText)),
    buildPrompt: ({ concept, sentenceText, rng }) =>
      buildHistorySourcePrompt({ concept, sentenceText, rng }),
    buildChoices: ({ sentenceText, rng }) =>
      buildHistorySourceChoiceSet({ sentenceText, rng }),
  },
  {
    id: "mcq_history_reliability_criteria",
    type: "mcq",
    family: "history-reliability",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory }) => isHistorySubject(subjectCategory),
    buildPrompt: ({ sentenceText }) => buildHistoryReliabilityPrompt({ sentenceText }),
    buildChoices: ({ sentenceText, rng }) =>
      buildHistoryReliabilityChoiceSet({ sentenceText, rng }),
  },
  {
    id: "mcq_history_chronology_century",
    type: "mcq",
    family: "history-chronology",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory, sentenceText }) =>
      isHistorySubject(subjectCategory) && Boolean(extractYearFromText(sentenceText)),
    buildPrompt: ({ sentenceText, concept }) =>
      buildHistoryChronologyPrompt({ sentenceText, concept }),
    buildChoices: ({ sentenceText, rng }) =>
      buildHistoryChronologyChoiceSet({ sentenceText, rng }),
  },
  {
    id: "mcq_history_government_forms",
    type: "mcq",
    family: "history-government",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory, concept, sentenceText }) =>
      isHistorySubject(subjectCategory) &&
      Boolean(findHistoryGovernmentForm(`${concept?.name || ""} ${sentenceText || ""}`)),
    buildPrompt: ({ concept, sentenceText, rng }) =>
      buildHistoryGovernmentPrompt({ concept, sentenceText, rng }),
    buildChoices: ({ concept, sentenceText, rng }) =>
      buildHistoryGovernmentChoiceSet({ concept, sentenceText, rng }),
  },
  {
    id: "mcq_history_cause_effect",
    type: "mcq",
    family: "history-cause",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory }) => isHistorySubject(subjectCategory),
    buildPrompt: ({ concept, sentenceText }) => buildCauseEffectPrompt({ concept, sentenceText }),
  },
  {
    id: "mcq_history_rights_responsibilities",
    type: "mcq",
    family: "history-rights",
    core: true,
    subjectAllowList: ["history"],
    applies: ({ subjectCategory }) => isHistorySubject(subjectCategory),
    buildPrompt: ({ concept }) =>
      `In a civics scenario about ${concept.name}, which option is a right rather than a responsibility?`,
  },
  {
    id: "mcq_cs_ipo",
    type: "mcq",
    family: "cs-ipo",
    core: true,
    subjectAllowList: ["cs"],
    applies: ({ subjectCategory }) => subjectCategory === "cs",
    buildPrompt: ({ concept, sentenceText, rng }) => buildCsPrompt({ concept, sentenceText, rng }),
  },
  {
    id: "mcq_cs_hardware_software",
    type: "mcq",
    family: "cs-hardware",
    core: true,
    subjectAllowList: ["cs"],
    applies: ({ subjectCategory }) => subjectCategory === "cs",
    buildPrompt: ({ concept }) => `For ${concept.name}, which option is hardware rather than software?`,
  },
  {
    id: "mcq_cs_algorithm_reasoning",
    type: "mcq",
    family: "cs-algorithm",
    core: true,
    subjectAllowList: ["cs"],
    applies: ({ subjectCategory }) => subjectCategory === "cs",
    buildPrompt: ({ concept }) =>
      `While improving ${concept.name}, which algorithmic step should happen next?`,
  },
  {
    id: "mcq_cs_data_information",
    type: "mcq",
    family: "cs-data",
    core: true,
    subjectAllowList: ["cs"],
    applies: ({ subjectCategory }) => subjectCategory === "cs",
    buildPrompt: ({ concept }) =>
      `Which statement best distinguishes data from information in ${concept.name}?`,
  },
  {
    id: "mcq_function_role",
    type: "mcq",
    family: "function-role",
    core: true,
    subjectAllowList: CORE_SUBJECT_DOMAINS,
    applies: ({ sentenceText }) =>
      /function|role|responsible for|serves|purpose/.test(String(sentenceText || "").toLowerCase()),
    buildPrompt: ({ concept, sentenceText, rng }) => {
      const contextLead = buildContextIntro({ sentenceText, concept, rng });
      return `${contextLead} what role does ${concept.name} play?`;
    },
  },
  {
    id: "mcq_organelle_function",
    type: "mcq",
    family: "organelles",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ concept, sentenceText, sectionTitle }) =>
      inferCategory({ concept, sentenceText, sectionTitle }) === "organelles",
    buildPrompt: ({ sentenceText, rng }) => buildOrganellePrompt({ sentenceText, rng }),
  },
  {
    id: "mcq_equation_process",
    type: "mcq",
    family: "equations",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ concept, sentenceText, sectionTitle }) =>
      inferCategory({ concept, sentenceText, sectionTitle }) === "equations",
    buildPrompt: ({ sentenceText, rng }) => buildEquationsPrompt({ sentenceText, rng }),
  },
  {
    id: "mcq_genetics_dominance",
    type: "mcq",
    family: "genetics",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ concept, sentenceText, sectionTitle }) =>
      inferCategory({ concept, sentenceText, sectionTitle }) === "genetics",
    buildPrompt: ({ sentenceText, rng }) => buildGeneticsPrompt({ sentenceText, rng }),
  },
  {
    id: "mcq_ecology_energy",
    type: "mcq",
    family: "ecology",
    core: true,
    subjectAllowList: ["science"],
    applies: ({ concept, sentenceText, sectionTitle }) =>
      inferCategory({ concept, sentenceText, sectionTitle }) === "ecology",
    buildPrompt: ({ sentenceText, rng }) => buildEcologyPrompt({ sentenceText, rng }),
  },
  {
    id: "mcq_statement_correct",
    type: "mcq",
    family: "statement-correct",
    core: true,
    subjectAllowList: CORE_SUBJECT_DOMAINS,
    applies: () => true,
    buildPrompt: ({ concept, sentenceText }) => {
      const keywords = extractKeyTokens(sentenceText, DEFAULT_STOPWORDS, 3);
      if (keywords.length) {
        return `In a situation involving ${keywords.join(", ")}, which statement about ${concept.name} is correct?`;
      }
      return `In this context, which statement about ${concept.name} is correct?`;
    },
  },
  {
    id: "mcq_scenario_application",
    type: "mcq",
    family: "scenario-application",
    core: true,
    subjectAllowList: ALL_SUBJECT_DOMAINS,
    requiresScenarioContext: true,
    applies: () => true,
    buildPrompt: ({ concept, sentenceText, category, sectionTitle, rng, subjectCategory }) =>
      buildScenarioPrompt({
        concept,
        sentenceText,
        category,
        sectionTitle,
        rng,
        subjectCategory,
      }),
  },
  {
    id: "mcq_cause_effect",
    type: "mcq",
    family: "cause-effect",
    subjectAllowList: CORE_SUBJECT_DOMAINS,
    requiresEvidenceRegex: CAUSE_MARKER_REGEX,
    applies: ({ sentenceText }) =>
      /because|leads to|results in|causes|effect|impact/.test(String(sentenceText || "").toLowerCase()),
    buildPrompt: ({ concept, sentenceText }) => buildCauseEffectPrompt({ concept, sentenceText }),
  },
  {
    id: "mcq_comparison",
    type: "mcq",
    family: "comparison",
    subjectAllowList: CORE_SUBJECT_DOMAINS,
    requiresEvidenceRegex: COMPARISON_MARKER_REGEX,
    applies: ({ sentenceText }) =>
      /whereas|while|contrast|compared to|vs|versus/.test(String(sentenceText || "").toLowerCase()),
    buildPrompt: ({ concept }) =>
      `In the same section, which statement highlights a key difference involving ${concept.name}?`,
  },
  {
    id: "mcq_error_spotting",
    type: "mcq",
    family: "error-spotting",
    applies: () => true,
    subjectAllowList: CORE_SUBJECT_DOMAINS,
    buildPrompt: ({ concept }) =>
      `In this scenario, which option does NOT fit how ${concept.name} works?`,
  },
  {
    id: "mcq_other_definition_in_context",
    type: "mcq",
    family: "other-definition",
    core: true,
    subjectAllowList: ["other"],
    applies: () => true,
    buildPrompt: ({ concept, sentenceText }) => {
      const snippet = ensureSentence(normalizeWhitespace(sentenceText));
      if (snippet) {
        return `According to "${snippet}", which term best describes ${concept?.name || "this idea"}?`;
      }
      return `Which term best describes ${concept?.name || "this idea"}?`;
    },
    buildChoices: ({ sentenceText, concept, rng }) =>
      buildOtherTermChoiceSet({ sentenceText, concept, rng }),
  },
  {
    id: "mcq_other_best_paraphrase",
    type: "mcq",
    family: "other-paraphrase",
    core: true,
    subjectAllowList: ["other"],
    applies: () => true,
    buildPrompt: ({ concept, sentenceText }) => {
      const snippet = normalizeWhitespace(sentenceText);
      if (snippet) {
        return `Which option best paraphrases the sentence "${snippet}" about ${concept?.name || "this topic"}?`;
      }
      return `Which option best restates the idea about ${concept?.name || "this topic"}?`;
    },
    buildChoices: ({ sentenceText, concept, rng }) =>
      buildOtherParaphraseChoiceSet({ sentenceText, concept, rng }),
  },
  {
    id: "mcq_other_example_nonexample",
    type: "mcq",
    family: "other-example",
    core: true,
    subjectAllowList: ["other"],
    applies: () => true,
    buildPrompt: ({ concept, sentenceText }) => {
      const snippet = normalizeWhitespace(sentenceText);
      if (snippet) {
        return `Which option describes an example of ${concept?.name || "this idea"} from the sentence "${snippet}"?`;
      }
      return `Which option describes an example of ${concept?.name || "this idea"}?`;
    },
    buildChoices: ({ sentenceText, concept, rng }) =>
      buildOtherExampleChoiceSet({ sentenceText, concept, rng }),
  },
  {
    id: "mcq_other_cause_effect",
    type: "mcq",
    family: "other-cause",
    core: true,
    subjectAllowList: ["other"],
    requiresEvidenceRegex: CAUSE_MARKER_REGEX,
    applies: ({ sentenceText }) =>
      Boolean(String(sentenceText || "").toLowerCase().match(CAUSE_MARKER_REGEX)),
    buildPrompt: ({ concept, sentenceText }) => buildCauseEffectPrompt({ concept, sentenceText }),
  },
  {
    id: "mcq_other_classification",
    type: "mcq",
    family: "other-classify",
    core: true,
    subjectAllowList: ["other"],
    applies: () => true,
    requiresEvidenceRegex: CLASSIFICATION_MARKER_REGEX,
    buildPrompt: ({ concept, sentenceText }) => {
      const snippet = normalizeWhitespace(sentenceText);
      if (snippet) {
        return `Which of the following characteristics of ${concept?.name || "this concept"} is listed in "${snippet}"?`;
      }
      return `Which of the following characteristics of ${concept?.name || "this concept"} is listed in the text?`;
    },
    buildChoices: ({ sentenceText, concept, rng }) =>
      buildOtherClassificationChoiceSet({ sentenceText, concept, rng }),
  },
  {
    id: "tf_paraphrase",
    type: "trueFalse",
    family: "tf_paraphrase",
    applies: () => true,
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "tf_mutated_detail",
    type: "trueFalse",
    family: "tf_mutated_detail",
    applies: () => true,
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "tf_scenario",
    type: "trueFalse",
    family: "tf_scenario",
    applies: ({ subjectCategory }) => subjectCategory !== "math",
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "tf_math_direct",
    type: "trueFalse",
    family: "math-core",
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },  {
    id: "tf_math_mutated",
    type: "trueFalse",
    family: "math-mutation",
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "tf_math_fallback_safe",
    type: "trueFalse",
    family: "math-fallback",
    fallbackOnly: true,
    applies: ({ subjectCategory }) => subjectCategory === "math",
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "tf_check",
    type: "trueFalse",
    family: "tf_paraphrase",
    applies: () => true,
    buildPrompt: ({ statement }) => `True or False: ${statement}`,
  },
  {
    id: "sa_scenario",
    type: "shortAnswer",
    family: "scenario",
    applies: () => true,
    buildPrompt: ({ concept }) =>
      `In a real-world situation, how would "${concept.name}" show up?`,
  },
  {
    id: "sa_define_meaning",
    type: "shortAnswer",
    family: "definition",
    applies: ({ subjectCategory, sentenceText }) =>
      subjectCategory === "math" || isFormulaLike(sentenceText),
    buildPrompt: ({ concept, sentenceText }) =>
      isFormulaLike(sentenceText)
        ? `Explain what the formula "${normalizeWhitespace(sentenceText)}" represents in context.`
        : `In your own words, explain what "${concept.name}" means in this context.`,
  },
  {
    id: "sa_cause_effect",
    type: "shortAnswer",
    family: "cause-effect",
    applies: ({ sentenceText, concept }) =>
      !isFormulaLike(sentenceText) && concept?.type !== "definition",
    buildPrompt: ({ concept }) =>
      `Describe the cause-and-effect relationship involving "${concept.name}".`,
  },
  {
    id: "sa_comparison",
    type: "shortAnswer",
    family: "comparison",
    applies: () => true,
    buildPrompt: ({ concept }) =>
      `How does "${concept.name}" differ from a closely related idea?`,
  },
  {
    id: "sa_function_role",
    type: "shortAnswer",
    family: "function-role",
    applies: () => true,
    buildPrompt: ({ concept }) =>
      `In this topic, what role does "${concept.name}" play?`,
  },
  {
    id: "fb_statement",
    type: "fillBlank",
    family: "definition",
    applies: () => true,
    buildPrompt: ({ blanked }) => `Fill in the blank: ${blanked}`,
  },
  {
    id: "fb_missing_term",
    type: "fillBlank",
    family: "component",
    applies: () => true,
    buildPrompt: ({ blanked }) => `Fill in the blank: ${blanked}`,
  },
];

const TEMPLATE_BY_ID = new Map(TEMPLATE_REGISTRY.map((template) => [template.id, template]));

const getTemplatesForType = (type) => TEMPLATE_REGISTRY.filter((template) => template.type === type);

const buildTemplateState = (questionCount, plannedMcqCount = 0) => ({
  maxTemplateCount: Math.max(1, Math.floor(questionCount * MAX_TEMPLATE_SHARE)),
  minFamilyCount: questionCount >= 8 ? 4 : Math.min(3, TEMPLATE_REGISTRY.length),
  templateCounts: new Map(),
  familyCounts: new Map(),
  usedConceptTemplate: new Set(),
  promptTokenSets: [],
  lastFamily: null,
  plannedMcqCount,
  mcqTotal: 0,
  mcqCoreTotal: 0,
});

const pickNextConcept = ({ concepts, startIndex, attemptedConceptIds }) => {
  if (!concepts.length) {
    return null;
  }
  if (attemptedConceptIds.size >= concepts.length) {
    return concepts[startIndex % concepts.length];
  }
  for (let offset = 0; offset < concepts.length; offset += 1) {
    const candidate = concepts[(startIndex + offset) % concepts.length];
    if (!attemptedConceptIds.has(candidate.id)) {
      return candidate;
    }
  }
  return concepts[startIndex % concepts.length];
};

const recordTemplateUse = (state, template, questionType) => {
  if (!template || !template.id || !template.family) {
    return;
  }
  state.templateCounts.set(template.id, (state.templateCounts.get(template.id) || 0) + 1);
  state.familyCounts.set(template.family, (state.familyCounts.get(template.family) || 0) + 1);
  state.lastFamily = template.family;
  if (questionType === "mcq") {
    state.mcqTotal += 1;
    if (template.core) {
      state.mcqCoreTotal += 1;
    }
  }
};

const OTHER_MCQ_TEMPLATE_IDS = new Set([
  "mcq_other_definition_in_context",
  "mcq_other_best_paraphrase",
  "mcq_other_example_nonexample",
  "mcq_other_cause_effect",
  "mcq_other_classification",
  "mcq_scenario_application",
]);

const pickTemplate = ({
    type,
    sentenceText,
    concept,
    sectionTitle,
    subjectCategory,
    mathCategory,
    includeFallbackTemplates,
    rng,
    state,
    remainingSlots,
    excludeTemplateIds,
    excludeFamilies,
    includeFamilies,
    preferredFamilies = null,
  }) => {
  let candidates = getTemplatesForType(type);
  if (type === "trueFalse" && subjectCategory === "math") {
    const mathFiltered = candidates.filter((template) => MATH_TF_TEMPLATE_IDS.has(template.id));
    if (mathFiltered.length) {
      candidates = mathFiltered;
    }
  }
  if (type === "mcq" && normalizeSubjectKey(subjectCategory) === "other") {
    const filteredOther = candidates.filter((template) => OTHER_MCQ_TEMPLATE_IDS.has(template.id));
    if (filteredOther.length) {
      candidates = filteredOther;
    }
  }
  if (!includeFallbackTemplates) {
    const filteredFallback = candidates.filter((template) => !template.fallbackOnly);
    if (filteredFallback.length) {
      candidates = filteredFallback;
    }
  }
  if (excludeTemplateIds && excludeTemplateIds.size) {
    const filtered = candidates.filter((template) => !excludeTemplateIds.has(template.id));
    if (filtered.length) {
      candidates = filtered;
    }
  }
  if (excludeFamilies && excludeFamilies.size) {
    const filtered = candidates.filter((template) => !excludeFamilies.has(template.family));
    if (filtered.length) {
      candidates = filtered;
    }
  }
  if (includeFamilies && includeFamilies.size) {
    const filtered = candidates.filter((template) => includeFamilies.has(template.family));
    if (filtered.length) {
      candidates = filtered;
    }
  }
    if (type === "mcq") {
      const compatible = candidates.filter((template) =>
        isMcqTemplateCompatible({ template, concept, sentenceText, subjectCategory })
      );
    if (compatible.length) {
      candidates = compatible;
    } else {
      return null;
    }
  }
  if (!candidates.length) {
    return null;
  }
  let coreNeeded = 0;
  if (type === "mcq" && state.plannedMcqCount > 0) {
    const coreTarget = Math.ceil(CORE_MCQ_TARGET_SHARE * state.plannedMcqCount);
    coreNeeded = Math.max(0, coreTarget - state.mcqCoreTotal);
    const remainingMcq = Math.max(0, state.plannedMcqCount - state.mcqTotal);
    const coreCandidates = candidates.filter((template) => template.core);
    if (coreCandidates.length) {
      if (coreNeeded >= remainingMcq) {
        candidates = coreCandidates;
      }
    }
  }
  const familiesUsed = state.familyCounts.size;
  const familiesNeeded = Math.max(0, state.minFamilyCount - familiesUsed);
  const mustUseNewFamily = familiesNeeded > 0 && remainingSlots <= familiesNeeded + 1;
  const avoidFamily =
    state.lastFamily &&
    (state.familyCounts.get(state.lastFamily) || 0) / Math.max(1, state.promptTokenSets.length) >= 0.5;

  const scored = candidates.map((template) => {
    let score = 0;
    const appliesFn =
      typeof template?.applies === "function"
        ? template.applies
        : () => true;
    if (appliesFn({ sentenceText, concept, sectionTitle, subjectCategory, mathCategory })) {
      score += 2;
    }
    if (subjectCategory === "math" && String(template.family || "").startsWith("math")) {
      score += 2;
    }
    if (mustUseNewFamily && !state.familyCounts.has(template.family)) {
      score += 3;
    }
    if (!state.familyCounts.has(template.family)) {
      score += 1;
    }
    if (avoidFamily && template.family === state.lastFamily) {
      score -= 2;
    }
      if (type === "shortAnswer" && template.family === "function-role") {
        const roleCount = state.familyCounts.get("function-role") || 0;
        if (roleCount >= 1) {
          score -= 2;
        }
      }
      if (type === "mcq" && template.core && coreNeeded > 0) {
        score += 2;
      }
      if (preferredFamilies && template.family && preferredFamilies.has(template.family)) {
        score += 3;
      }
      return { template, score };
    });

  const maxCount = state.maxTemplateCount;
  let filtered = scored.filter(
    ({ template }) => (state.templateCounts.get(template.id) || 0) < maxCount
  );
  if (!filtered.length) {
    filtered = scored;
  }
  filtered.sort((a, b) => b.score - a.score);
  const topScore = filtered[0]?.score ?? 0;
  const top = filtered.filter((item) => item.score === topScore);
  const pick = top[Math.floor(rng() * top.length)];
  return pick ? pick.template : null;
};

const isPromptTooSimilar = (prompt, promptTokenSets, stopwords) => {
  const tokens = normalizePromptTokens(prompt, stopwords);
  if (!tokens.length) {
    return false;
  }
  return promptTokenSets.some(
    (existing) => jaccardSimilarity(tokens, existing) >= PROMPT_SIMILARITY_THRESHOLD
  );
};

const extractPromptStem = (prompt) => {
  const normalized = normalizeWhitespace(String(prompt || "").toLowerCase()).replace(/["'`]/g, "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.slice(0, 5).join(" ");
};

const buildSubjectPlan = ({ subjects, totalQuestions, weights, rng }) => {
  const normalized = subjects.map(normalizeSubjectKey).filter(Boolean);
  if (!normalized.length) {
    return Array.from({ length: totalQuestions }, () => "other");
  }
  const unique = [...new Set(normalized)];
  if (totalQuestions <= unique.length) {
    const shuffled = shuffleDeterministic(unique, rng);
    return shuffled.slice(0, totalQuestions);
  }
  const counts = new Map();
  unique.forEach((subject) => counts.set(subject, 1));
  let remaining = totalQuestions - unique.length;
  const weightMap = new Map();
  unique.forEach((subject) => {
    const weight = weights && Number.isFinite(weights[subject]) ? weights[subject] : 1;
    weightMap.set(subject, Math.max(1, weight));
  });
  const totalWeight = [...weightMap.values()].reduce((sum, value) => sum + value, 0);
  unique.forEach((subject) => {
    if (remaining <= 0) {
      return;
    }
    const share = Math.floor((weightMap.get(subject) / totalWeight) * remaining);
    counts.set(subject, counts.get(subject) + share);
    remaining -= share;
  });
  const sorted = [...unique].sort((a, b) => (weightMap.get(b) || 1) - (weightMap.get(a) || 1));
  let idx = 0;
  while (remaining > 0) {
    const subject = sorted[idx % sorted.length];
    counts.set(subject, counts.get(subject) + 1);
    remaining -= 1;
    idx += 1;
  }
  const plan = [];
  counts.forEach((count, subject) => {
    for (let i = 0; i < count; i += 1) {
      plan.push(subject);
    }
  });
  return shuffleDeterministic(plan, rng);
};

const mapSentencesToSubjects = (sentences, subjectSections) => {
  const map = new Map();
  if (!subjectSections.length) {
    return map;
  }
  const ordered = [...subjectSections].sort((a, b) => a.start - b.start);
  let index = 0;
  sentences.forEach((sentence) => {
    while (index < ordered.length && sentence.start > ordered[index].end) {
      index += 1;
    }
    if (index < ordered.length) {
      const section = ordered[index];
      if (sentence.start >= section.start && sentence.start <= section.end) {
        map.set(sentence.id, section.subject);
      }
    }
  });
  return map;
};

const resolveConceptSubject = (concept, sentenceSubjectMap, fallbackSubject) => {
  const counts = {};
  (concept?.sentenceIds || []).forEach((id) => {
    const subject = sentenceSubjectMap.get(id);
    if (!subject) {
      return;
    }
    counts[subject] = (counts[subject] || 0) + 1;
  });
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ordered[0]?.[0] || fallbackSubject || "other";
};

const groupConceptsBySubject = (concepts, sentenceSubjectMap, fallbackSubject) => {
  const groups = new Map();
  concepts.forEach((concept) => {
    const subject = resolveConceptSubject(concept, sentenceSubjectMap, fallbackSubject);
    if (!groups.has(subject)) {
      groups.set(subject, []);
    }
    groups.get(subject).push(concept);
  });
  return groups;
};

const buildKnowledgeAppendText = (chunks) => {
  if (!chunks.length) {
    return "";
  }
  const grouped = new Map();
  chunks.forEach((chunk) => {
    const subject = normalizeSubjectKey(chunk.subject || "other");
    if (!grouped.has(subject)) {
      grouped.set(subject, []);
    }
    grouped.get(subject).push(chunk);
  });
  let combined = "";
  grouped.forEach((entries, subject) => {
    combined += `\n\n${subject.toUpperCase()}\n`;
    entries.forEach((entry) => {
      combined += `${entry.text}\n`;
    });
  });
  return combined.trim();
};

const collectRepetitionIssues = (questions, { allowRepeatedConcepts } = {}) => {
  const stemMap = new Map();
  const topicMap = new Map();
  const failing = new Set();
  const promptTokenSets = questions.map((question) =>
    normalizePromptTokens(question.prompt, DEFAULT_STOPWORDS)
  );

  questions.forEach((question, index) => {
    const stem = extractPromptStem(question.prompt);
    if (stem) {
      const list = stemMap.get(stem) || [];
      list.push(index);
      stemMap.set(stem, list);
    }
    if (!allowRepeatedConcepts) {
      const topic = question.topicConceptId || "";
      if (topic) {
        const list = topicMap.get(topic) || [];
        list.push(index);
        topicMap.set(topic, list);
      }
    }
  });

  stemMap.forEach((indexes) => {
    if (indexes.length > 1) {
      indexes.slice(1).forEach((idx) => failing.add(idx));
    }
  });

  topicMap.forEach((indexes) => {
    if (indexes.length > 1) {
      indexes.slice(1).forEach((idx) => failing.add(idx));
    }
  });

  for (let i = 0; i < promptTokenSets.length; i += 1) {
    for (let j = i + 1; j < promptTokenSets.length; j += 1) {
      if (jaccardSimilarity(promptTokenSets[i], promptTokenSets[j]) >= 0.9) {
        failing.add(j);
      }
    }
  }

  return {
    failingIndexes: [...failing],
  };
};

const buildMcq = ({
  concept,
  concepts,
  sentenceMap,
  difficulty,
  seedSalt,
  template,
  subjectCategory,
  mathCategory,
  sentenceIdToSectionId,
  sectionSentenceIdsMap,
  sectionTokenSets,
  sectionTitleMap,
  forceScenarioPrompt = false,
}) => {
  const grounding = pickEvidenceForConcept(concept, sentenceMap, { preferDefinition: concept.type === "definition" });
  if (!grounding) {
    return null;
  }

  const correct = grounding.evidenceSnippets[0];
  const rng = rngFromString(`${seedSalt || ""}|${concept.id}|mcq|distractors`);
  const sectionId = getConceptSectionId(concept, sentenceIdToSectionId);
  const sectionTitle = sectionId ? sectionTitleMap?.get(sectionId) : "";
  const category = inferCategory({ concept, sectionTitle, sentenceText: correct });
  const resolvedMathCategory =
    subjectCategory === "math"
      ? mathCategory || inferMathCategory({ concept, sectionTitle, sentenceText: correct })
      : null;

  let choices = null;
  let answerKey = null;
  let correctChoice = null;
  let choiceFormat = "statement";
  const resolvedTemplateFamily = forceScenarioPrompt
    ? template?.family && MCQ_SCENARIO_FAMILIES.has(template.family)
      ? template.family
      : "scenario-application"
    : template?.family || null;

  const templateChoiceSet = template?.buildChoices
    ? template.buildChoices({
        concept,
        sentenceText: correct,
        rng,
        subjectCategory,
        sectionTitle,
      })
    : null;

  const useMathFallbackChoices = template?.id === "mcq_math_definition_fallback";
  if (templateChoiceSet) {
    if (!Array.isArray(templateChoiceSet.choices) || templateChoiceSet.choices.length < 4) {
      return null;
    }
    choices = templateChoiceSet.choices.slice(0, 4);
    answerKey = templateChoiceSet.answerKey;
    correctChoice = templateChoiceSet.correctChoice;
    choiceFormat = templateChoiceSet.choiceFormat || "term-list";
  } else if (useMathFallbackChoices) {
    const fallbackChoiceSet = buildMathFallbackChoiceSet({
      concept,
      sentenceText: correct,
      rng,
    });
    if (!fallbackChoiceSet) {
      return null;
    }
    choices = fallbackChoiceSet.choices;
    answerKey = fallbackChoiceSet.answerKey;
    correctChoice = fallbackChoiceSet.correctChoice;
    choiceFormat = "term-list";
  } else {
    const mathChoiceSet =
      subjectCategory === "math"
        ? buildMathChoiceSet({
            category: resolvedMathCategory,
            concept,
            sentenceText: correct,
            rng,
          })
        : null;
    if (mathChoiceSet) {
      choices = mathChoiceSet.choices;
      answerKey = mathChoiceSet.answerKey;
      correctChoice = mathChoiceSet.correctChoice;
      choiceFormat = "term-list";
    }

    const englishChoiceSet = !choices && subjectCategory === "english"
      ? template?.family === "english-grammar"
        ? buildGrammarRevisionChoiceSet({ sentenceText: correct, rng })
        : template?.family === "english-device"
          ? buildEnglishTermChoiceSet({ category: "device", concept, rng })
          : template?.family === "english-improvement"
            ? buildEnglishTermChoiceSet({ category: "writing", concept, rng })
            : null
      : null;
    if (englishChoiceSet) {
      choices = englishChoiceSet.choices;
      answerKey = englishChoiceSet.answerKey;
      correctChoice = englishChoiceSet.correctChoice;
      choiceFormat = template?.family === "english-grammar" ? "sentence-revision" : "term-list";
    }

    const evidenceTokens = new Set(normalizePromptTokens(correct, DEFAULT_STOPWORDS));
    const sharesEvidenceToken = (text) => {
      if (!text) {
        return false;
      }
      if (!evidenceTokens.size) {
        return true;
      }
      const tokens = normalizePromptTokens(text, DEFAULT_STOPWORDS);
      return tokens.some((token) => evidenceTokens.has(token));
    };

    const categoryChoiceSet = !choices ? buildCategoryChoiceSet({ category, concept, rng }) : null;
    if (categoryChoiceSet) {
      choices = categoryChoiceSet.choices;
      answerKey = categoryChoiceSet.answerKey;
      correctChoice = categoryChoiceSet.correctChoice;
      choiceFormat = "term-list";
    } else {
      correctChoice = paraphraseFromSentence(correct, concept, DEFAULT_STOPWORDS);
      if (!correctChoice || hasBannedPhrase(correctChoice)) {
        return null;
      }
      const choiceSet = new Set([String(correctChoice || "").toLowerCase()]);
      const distractors = [];
      const siblingConcepts = sectionId
        ? concepts.filter(
            (other) =>
              other.id !== concept.id &&
              getConceptSectionId(other, sentenceIdToSectionId) === sectionId
          )
        : [];
      const siblingShuffled = shuffleDeterministic(siblingConcepts, rng);

      const addDistractor = (sentenceText, relatedConcept) => {
        const normalizedSentence = normalizeWhitespace(sentenceText || "");
        if (!normalizedSentence || !sharesEvidenceToken(normalizedSentence)) {
          return false;
        }
        const choice = paraphraseFromSentence(
          normalizedSentence,
          relatedConcept || concept,
          DEFAULT_STOPWORDS
        );
        const normalized = String(choice || "").toLowerCase();
        if (!choice || choiceSet.has(normalized) || hasBannedPhrase(choice)) {
          return false;
        }
        distractors.push({ choice, isCorrect: false });
        choiceSet.add(normalized);
        return true;
      };

      const misconceptionStatements = buildMisconceptionStatements({
        sentenceText: correct,
        concept,
        siblingConcepts,
        rng,
      });
      misconceptionStatements.forEach((statement) => {
        if (distractors.length < 3) {
          addDistractor(statement, concept);
        }
      });

      for (const other of siblingShuffled) {
        const otherGrounding = pickEvidenceForConcept(other, sentenceMap);
        const option = otherGrounding?.evidenceSnippets?.[0];
        if (option && option !== correct) {
          addDistractor(option, other);
        }
        if (distractors.length >= 3) {
          break;
        }
      }

      if (sectionId && distractors.length < 3) {
        const sectionSentenceIds = sectionSentenceIdsMap.get(sectionId) || [];
        const shuffledSectionIds = shuffleDeterministic(sectionSentenceIds, rng);
        for (const id of shuffledSectionIds) {
          const sentence = sentenceMap.get(id);
          const option = normalizeWhitespace(sentence?.text);
          if (!option || option === correct) {
            continue;
          }
          addDistractor(option, concept);
          if (distractors.length >= 3) {
            break;
          }
        }
      }

      const choiceObjs = [{ choice: correctChoice, isCorrect: true }, ...distractors].slice(0, 4);
      if (choiceObjs.length < 4) {
        return null;
      }
      const choiceRng = rngFromString(`${seedSalt || ""}|${concept.id}|mcq|choices`);
      const shuffled = shuffleDeterministic(choiceObjs, choiceRng);
      const answerIndex = shuffled.findIndex((item) => item.isCorrect);
      answerKey = choiceLabels[Math.max(0, answerIndex)];
      choices = shuffled.map((item) => item.choice);
    }
  }

  const prompt = forceScenarioPrompt
    ? buildScenarioPrompt({ concept, sentenceText: correct, category, sectionTitle, rng, subjectCategory })
    : template?.buildPrompt
      ? template.buildPrompt({
          concept,
          sentenceText: correct,
          category,
          mathCategory: resolvedMathCategory,
          sectionTitle,
          rng,
        })
      : `In this context, which option best applies "${concept.name}"?`;

  return {
    id: hashToUuid(`${seedSalt || concept.id}|mcq|${concept.id}|${template?.id || "default"}`),
    type: "mcq",
    topic: concept.name,
    topicConceptId: concept.id,
    bloomLevel: difficulty === "easy" ? "L2" : "L3",
    prompt,
    choices,
    answerKey,
    explanation: correct,
    grounding,
    points: POINTS_BY_TYPE.mcq,
    meta: {
      difficulty,
      tags: [concept.type],
      regeneratedFrom: seedSalt || null,
      templateId: template?.id || null,
      templateFamily: resolvedTemplateFamily,
      choiceFormat,
      category,
      mathCategory: resolvedMathCategory,
      subjectCategory: subjectCategory || null,
    },
  };
};

const stripFillBlankTopicLine = (prompt) =>
  String(prompt || "").replace(/\s*\(Topic:[^)]+\)\s*[.!?]?\s*$/i, "");

const countFillBlankContextWords = (statement) =>
  countWords(String(statement || "").replace(BLANK_TOKEN, ""));

const isFillBlankStatementAcceptable = (statement) => {
  const wordCount = countFillBlankContextWords(statement);
  if (wordCount < MIN_FILLBLANK_WORDS_AFTER_BLANK) {
    return false;
  }
  if (wordCount >= MIN_FILLBLANK_CONTEXT_WORDS) {
    return true;
  }
  return hasContextClause(statement);
};

const formatFillBlankPrompt = ({ blankedSentence, topic }) => {
  const cleaned = ensureSentence(blankedSentence);
  if (!cleaned || cleaned === BLANK_TOKEN) {
    return "";
  }
  if (!cleaned.includes(BLANK_TOKEN)) {
    return "";
  }
  if (countFillBlankContextWords(cleaned) < MIN_FILLBLANK_WORDS_AFTER_BLANK) {
    return "";
  }
  let prompt = `Fill in the blank: ${cleaned}`;
  if (topic) {
    prompt = `${prompt}\n(Topic: ${topic})`;
  }
  if (!hasTerminalPunctuation(prompt)) {
    prompt = `${prompt}.`;
  }
  return prompt;
};

const extractFillBlankStatement = (prompt) => {
  const raw = stripFillBlankTopicLine(prompt);
  const hintMatch = raw.match(/^(.*?)(?:\s*\(?hint:)/i);
  const trimmedRaw = hintMatch ? hintMatch[1] : raw;
  if (!trimmedRaw.includes(BLANK_TOKEN)) {
    return normalizeWhitespace(trimmedRaw);
  }
  const firstColon = trimmedRaw.indexOf(":");
  if (firstColon !== -1) {
    const afterFirst = trimmedRaw.slice(firstColon + 1);
    if (afterFirst.includes(BLANK_TOKEN)) {
      return normalizeWhitespace(afterFirst);
    }
  }
  const lastColon = trimmedRaw.lastIndexOf(":");
  if (lastColon !== -1) {
    const afterLast = trimmedRaw.slice(lastColon + 1);
    if (afterLast.includes(BLANK_TOKEN)) {
      return normalizeWhitespace(afterLast);
    }
  }
  return normalizeWhitespace(trimmedRaw);
};

const isTrivialBlankTerm = (term, stopwords) => {
  const cleaned = normalizeWhitespace(term);
  if (!cleaned) {
    return true;
  }
  if (/^[=+\-*/^]+$/.test(cleaned)) {
    return true;
  }
  if (/^[\W_]+$/.test(cleaned)) {
    return true;
  }
  if (/^\d+$/.test(cleaned)) {
    return true;
  }
  const tokens = tokenize(cleaned);
  if (!tokens.length) {
    return true;
  }
  const meaningful = tokens.filter((t) => !isStopword(t, stopwords) && t.length >= 2);
  if (!meaningful.length) {
    return true;
  }
  if (tokens.length === 1 && isStopword(tokens[0], stopwords)) {
    return true;
  }
  return false;
};

const findBlankSpanInSentence = (text, term) => {
  if (!term) {
    return null;
  }
  const pattern = buildPhraseRegex(term);
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const spanStart = match.index;
  const spanEnd = match.index + match[0].length;
  const answerKey = text.slice(spanStart, spanEnd);
  const blanked = normalizeWhitespace(
    `${text.slice(0, spanStart)}${BLANK_TOKEN}${text.slice(spanEnd)}`
  );
  return { blanked, spanStart, spanEnd, answerKey };
};

const pickFillBlankFromSentence = ({ sentenceText, concept, subjectCategory, stopwords }) => {
  const text = String(sentenceText || "");
  if (!isValidTfFbSentence(text)) {
    return null;
  }
  const candidates = [];
  const addCandidate = (term, priority) => {
    if (!term || isTrivialBlankTerm(term, stopwords)) {
      return;
    }
    const span = findBlankSpanInSentence(text, term);
    if (!span) {
      return;
    }
    const blankedSentence = ensureSentence(span.blanked);
    if (!isFillBlankStatementAcceptable(blankedSentence)) {
      return;
    }
    candidates.push({
      term,
      blanked: blankedSentence,
      priority,
      spanStart: span.spanStart,
      spanEnd: span.spanEnd,
      answerKey: span.answerKey,
    });
  };

  if (subjectCategory === "math") {
    const numberMatch = text.match(/\b([A-Za-z][A-Za-z-]{2,})\s+numbers\b/i);
    if (numberMatch) {
      addCandidate(numberMatch[1], 4);
    }
    if (/[=]/.test(text)) {
      const parts = text.split("=");
      const rhs = parts.slice(1).join("=");
      const rhsTokens = rhs.match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
      const lhsTokens = parts[0]?.match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
      const tokenPool = rhsTokens.length ? rhsTokens : text.match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
      const picked = tokenPool.find(
        (token) =>
          !isStopword(token.toLowerCase(), stopwords) &&
          !lhsTokens.some((lhs) => lhs.toLowerCase() === token.toLowerCase())
      );
      if (picked) {
        addCandidate(picked, 3);
      }
    }
  }

  const conceptPattern = buildPhraseRegex(concept.name);
  const match = text.match(conceptPattern);
  if (match) {
    addCandidate(match[0], 2);
  }

  const phraseCandidates = extractCandidates(tokenize(text), stopwords, 3)
    .map((phrase) => normalizeWhitespace(phrase))
    .filter(Boolean)
    .sort((a, b) => {
      const lenDiff = b.split(" ").length - a.split(" ").length;
      if (lenDiff !== 0) {
        return lenDiff;
      }
      return b.length - a.length;
    });
  phraseCandidates.forEach((phrase) => addCandidate(phrase, 1));

  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => b.priority - a.priority || b.term.length - a.term.length);
  return candidates[0];
};

const buildFillBlank = ({ concept, sentenceMap, difficulty, seedSalt, template, subjectCategory }) => {
  const grounding = pickEvidenceForConcept(concept, sentenceMap, {
    preferDefinition: true,
    sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text),
  });
  if (!grounding) {
    return null;
  }
  const evidenceSnippets = Array.isArray(grounding.evidenceSnippets)
    ? grounding.evidenceSnippets
    : [];
  let selection = null;
  let sentence = evidenceSnippets[0] || "";
  for (let i = 0; i < evidenceSnippets.length; i += 1) {
    const candidateSentence = evidenceSnippets[i];
    const candidateSelection = pickFillBlankFromSentence({
      sentenceText: candidateSentence,
      concept,
      subjectCategory,
      stopwords: DEFAULT_STOPWORDS,
    });
    if (candidateSelection) {
      selection = candidateSelection;
      sentence = candidateSentence;
      break;
    }
  }
  if (!selection) {
    return null;
  }
  const blanked = selection.blanked;
  const prompt = formatFillBlankPrompt({ blankedSentence: blanked, topic: concept?.name });
  const answerText = String(selection.answerKey || selection.term || "").trim();
  const statementForContext = extractFillBlankStatementForComparison(prompt);
  const filledEvidence = statementForContext.replace(BLANK_TOKEN, answerText);

  return {
    id: hashToUuid(`${seedSalt || concept.id}|fillBlank|${concept.id}|${template?.id || "default"}`),
    type: "fillBlank",
    topic: concept.name,
    topicConceptId: concept.id,
    bloomLevel: difficulty === "easy" ? "L1" : "L2",
    prompt,
    answerKey: answerText,
    answerKeyBlank: answerText,
    explanation: filledEvidence,
    grounding,
    points: POINTS_BY_TYPE.fillBlank,
    meta: {
      difficulty,
      tags: [concept.type],
      regeneratedFrom: seedSalt || null,
      templateId: template?.id || null,
      templateFamily: template?.family || null,
      subjectCategory: subjectCategory || null,
      blankSpanStart: selection.spanStart,
      blankSpanEnd: selection.spanEnd,
      removedSpanRaw: selection.answerKey,
      removedSpanNormalized: normalizeWhitespace(selection.answerKey),
    },
  };
};

const getWordSpans = (text) => {
  const spans = [];
  if (!text) {
    return spans;
  }
  const regex = /[A-Za-z][A-Za-z'-]*/g;
  let match = regex.exec(text);
  while (match) {
    spans.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
    match = regex.exec(text);
  }
  return spans;
};

const isLikelyProperName = (word, isSentenceStart) => {
  if (!word) {
    return false;
  }
  if (isSentenceStart) {
    return false;
  }
  const first = word[0];
  if (first !== first.toUpperCase()) {
    return false;
  }
  const rest = word.slice(1);
  if (!rest) {
    return false;
  }
  const isTitleCase = rest === rest.toLowerCase();
  const isAllCaps = word === word.toUpperCase();
  return isTitleCase || isAllCaps;
};

const pickDeterministicBlankSpan = ({ sentenceText, stopwords, relaxContext = false }) => {
  if (!sentenceText) {
    return null;
  }
  const spans = getWordSpans(sentenceText);
  if (!spans.length) {
    return null;
  }
  const buildCandidates = (allowProperNames) => {
    const candidates = [];
    for (let i = 0; i < spans.length; i += 1) {
      for (let length = 3; length >= 1; length -= 1) {
        const endIndex = i + length - 1;
        if (endIndex >= spans.length) {
          continue;
        }
        const phraseSpans = spans.slice(i, endIndex + 1);
        const words = phraseSpans.map((span) => span.word);
        if (words.some((word) => isStopword(word, stopwords) || word.length < 3)) {
          continue;
        }
        const isSentenceStart = i === 0;
        if (
          !allowProperNames &&
          words.some((word, idx) => isLikelyProperName(word, isSentenceStart && idx === 0))
        ) {
          continue;
        }
        const spanStart = phraseSpans[0].start;
        const spanEnd = phraseSpans[phraseSpans.length - 1].end;
        const blanked = normalizeWhitespace(
          `${sentenceText.slice(0, spanStart)}${BLANK_TOKEN}${sentenceText.slice(spanEnd)}`
        );
        const blankedSentence = ensureSentence(blanked);
        const wordCount = countFillBlankContextWords(blankedSentence);
        const hasMinimumContext = relaxContext
          ? wordCount >= MIN_FILLBLANK_WORDS_AFTER_BLANK
          : isFillBlankStatementAcceptable(blankedSentence);
        if (!hasMinimumContext) {
          continue;
        }
        const phraseText = normalizeWhitespace(sentenceText.slice(spanStart, spanEnd));
        const priority = length * 3 + phraseText.length;
        candidates.push({
          answerKey: phraseText,
          blanked: blankedSentence,
          spanStart,
          spanEnd,
          priority,
        });
      }
    }
    return candidates;
  };

  let candidates = buildCandidates(false);
  if (!candidates.length && relaxContext) {
    candidates = buildCandidates(true);
  }
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
};

const buildFillBlankFallbackFromSentence = ({
  sentence,
  difficulty,
  seedSalt,
  subjectCategory,
  stopwords,
  relaxContext = false,
}) => {
  if (!sentence || sentence.isHeading) {
    return null;
  }
  if (!isValidTfFbSentence(sentence.text)) {
    return null;
  }
  const selection = pickDeterministicBlankSpan({
    sentenceText: sentence.text,
    stopwords,
    relaxContext,
  });
  if (!selection) {
    return null;
  }
  const prompt = formatFillBlankPrompt({
    blankedSentence: selection.blanked,
    topic: selection.answerKey,
  });
  if (!prompt) {
    return null;
  }
  const statementForContext = extractFillBlankStatementForComparison(prompt);
  const contextWords = countWords(statementForContext.replace(BLANK_TOKEN, ""));
  if (contextWords < 10) {
    return null;
  }
  const answerText = String(selection.answerKey || "").trim();
  const topicId = `fallback_${hashId(`${sentence.id}|${answerText}`)}`;
  const filledEvidence = statementForContext.replace(BLANK_TOKEN, answerText);
  return {
    id: hashToUuid(`${seedSalt}|fillBlankFallback|${sentence.id}|${answerText}`),
    type: "fillBlank",
    topic: answerText,
    topicConceptId: topicId,
    bloomLevel: difficulty === "easy" ? "L1" : "L2",
    prompt,
    answerKey: answerText,
    answerKeyBlank: answerText,
    explanation: filledEvidence,
    grounding: {
      sourceSentenceIds: [sentence.id],
      evidenceSnippets: [sentence.text],
    },
    points: POINTS_BY_TYPE.fillBlank,
    meta: {
      difficulty,
      tags: ["fallback"],
      regeneratedFrom: seedSalt || null,
      templateId: "fillBlank_fallback_deterministic",
      templateFamily: "fallback",
      subjectCategory: subjectCategory || null,
      blankSpanStart: selection.spanStart,
      blankSpanEnd: selection.spanEnd,
      removedSpanRaw: answerText,
      removedSpanNormalized: normalizeWhitespace(answerText),
    },
  };
};


const mutateMathStatement = (sentence) => {
  const str = String(sentence || "");
  if (!str) {
    return null;
  }
  const swaps = [
    { pattern: /\+/, replace: "-" },
    { pattern: /-/, replace: "+" },
    { pattern: /\*/, replace: "/" },
    { pattern: /\//, replace: "*" },
    { pattern: />/, replace: "<" },
    { pattern: /</, replace: ">" },
  ];
  for (const swap of swaps) {
    if (swap.pattern.test(str)) {
      return ensureSentence(str.replace(swap.pattern, swap.replace));
    }
  }
  if (str.includes("=") && !str.includes("!=")) {
    return ensureSentence(str.replace("=", "!="));
  }
  const numberMatch = str.match(/\b\d+(?:\.\d+)?\b/);
  if (numberMatch) {
    const num = Number(numberMatch[0]);
    if (!Number.isNaN(num)) {
      return ensureSentence(str.replace(numberMatch[0], String(num + 1)));
    }
  }
  return null;
};

const buildTrueFalse = ({
  concept,
  concepts,
  sentenceMap,
  difficulty,
  seedSalt,
  index,
  template,
  subjectCategory,
  mathCategory,
  sentenceIdToSectionId,
}) => {
  const grounding = pickEvidenceForConcept(concept, sentenceMap, {
    sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text),
  });
  if (!grounding) {
    return null;
  }

  const truthy = index % 2 === 0;
  const sentence = grounding.evidenceSnippets[0];
  const resolvedMathCategory =
    subjectCategory === "math"
      ? mathCategory || inferMathCategory({ concept, sectionTitle: "", sentenceText: sentence })
      : null;
  const sentenceId = grounding.sourceSentenceIds?.[0];
  const sectionId = sentenceId ? sentenceIdToSectionId.get(sentenceId) : null;
  const siblingConcepts = sectionId
    ? concepts.filter((c) => getConceptSectionId(c, sentenceIdToSectionId) === sectionId)
    : concepts;
  const replacementTerms = siblingConcepts
    .map((c) => c.name)
    .filter((name) => !sentence.toLowerCase().includes(String(name || "").toLowerCase()));
  const templateFamily = template?.family || null;
  const wantsScenario = templateFamily === "tf_scenario";
  const wantsParaphrase =
    templateFamily === "tf_paraphrase" || template?.id === "tf_paraphrase" || template?.id === "tf_check";
  const wantsMutation = templateFamily === "tf_mutated_detail";
  const styleRng = rngFromString(`${seedSalt || concept.id}|tf-style|${index}`);

  let statement = ensureSentence(sentence);
  if (truthy) {
    if (wantsScenario) {
      statement = buildTfScenarioStatement({
        sentence,
        concept,
        replacements: replacementTerms,
        truthy: true,
        rng: styleRng,
      });
    } else if (wantsParaphrase || wantsMutation) {
      statement = buildTfParaphraseStatement({
        sentence,
        concept,
        stopwords: DEFAULT_STOPWORDS,
        rng: styleRng,
      });
    }
  } else if (wantsScenario) {
    statement = buildTfScenarioStatement({
      sentence,
      concept,
      replacements: replacementTerms,
      truthy: false,
      rng: styleRng,
    });
  } else {
    const mutated = buildTfFalseStatement({
      sentence,
      concept,
      concepts,
      sentenceIdToSectionId,
      grounding,
      subjectCategory,
      resolvedMathCategory,
      template,
      seedSalt,
      index,
    });
    if (mutated) {
      statement = mutated;
    } else {
      return null;
    }
  }

  const prompt = template?.buildPrompt
    ? template.buildPrompt({ statement, concept })
    : `True or False: ${statement}`;

  return {
    id: hashToUuid(
      `${seedSalt || concept.id}|trueFalse|${concept.id}|${index}|${template?.id || "default"}`
    ),
    type: "trueFalse",
    topic: concept.name,
    topicConceptId: concept.id,
    bloomLevel: "L2",
    prompt,
    answerKey: truthy,
    answerKeyBool: truthy,
    classification:
      concept.type === "definition"
        ? "Definition"
        : concept.type === "process"
          ? "Application"
          : "Concept",
    explanation: truthy
      ? `${ensureSentence(sentence)} This matches the source text.`
      : `${ensureSentence(sentence)} This statement changes one detail from the source.`,
    grounding,
    points: POINTS_BY_TYPE.trueFalse,
    meta: {
      difficulty,
      tags: [concept.type],
      regeneratedFrom: seedSalt || null,
      templateId: template?.id || null,
      templateFamily: template?.family || null,
      mathCategory: resolvedMathCategory,
      subjectCategory: subjectCategory || null,
    },
  };
};

const shouldRewriteTrueFalse = (issues) =>
  Array.isArray(issues) &&
  issues.some(
    (issue) =>
      issue === "Prompt copies evidence text." || issue === "Prompt overlaps evidence too closely."
  );

const rewriteTrueFalseQuestion = ({
  question,
  concept,
  concepts,
  sentenceIdToSectionId,
  subjectCategory,
  attempt,
}) => {
  const sentence = question?.grounding?.evidenceSnippets?.[0] || "";
  if (!sentence) {
    return null;
  }
  const truthy = Boolean(question.answerKey);
  const familyPlan = truthy ? ["tf_paraphrase", "tf_scenario"] : ["tf_mutated_detail", "tf_scenario"];
  const family = familyPlan[Math.min(attempt, familyPlan.length - 1)];
  const template = TEMPLATE_BY_ID.get(family) || null;
  const rewriteRng = rngFromString(`${question.id}|tf-rewrite|${attempt}`);
  let statement = null;

  if (family === "tf_scenario") {
    const sentenceId = question.grounding?.sourceSentenceIds?.[0];
    const sectionId = sentenceId ? sentenceIdToSectionId.get(sentenceId) : null;
    const siblingConcepts = sectionId
      ? concepts.filter((c) => getConceptSectionId(c, sentenceIdToSectionId) === sectionId)
      : concepts;
    const replacementTerms = siblingConcepts
      .map((c) => c.name)
      .filter((name) => !sentence.toLowerCase().includes(String(name || "").toLowerCase()));
    statement = buildTfScenarioStatement({
      sentence,
      concept,
      replacements: replacementTerms,
      truthy,
      rng: rewriteRng,
    });
  } else if (family === "tf_mutated_detail") {
    statement = buildTfFalseStatement({
      sentence,
      concept,
      concepts,
      sentenceIdToSectionId,
      grounding: question.grounding,
      subjectCategory,
      resolvedMathCategory: question.meta?.mathCategory || null,
      template,
      seedSalt: question.id,
      index: attempt,
    });
  } else {
    statement = buildTfParaphraseStatement({
      sentence,
      concept,
      stopwords: DEFAULT_STOPWORDS,
      rng: rewriteRng,
    });
  }

  if (!statement) {
    return null;
  }

  const prompt = template?.buildPrompt
    ? template.buildPrompt({ statement, concept })
    : `True or False: ${statement}`;
  return {
    ...question,
    prompt,
    explanation: truthy
      ? `${ensureSentence(sentence)} This matches the source text.`
      : `${ensureSentence(sentence)} This statement changes one detail from the source.`,
    meta: {
      ...question.meta,
      templateId: template?.id || family,
      templateFamily: template?.family || family,
      rewrittenFrom: question.meta?.templateId || null,
    },
  };
};

const buildTrueFalseFallbackSafe = ({
  concept,
  sentenceMap,
  difficulty,
  seedSalt,
  index,
  subjectCategory,
  mathCategory,
}) => {
  const grounding = pickEvidenceForConcept(concept, sentenceMap, {
    preferDefinition: true,
    sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text),
  });
  if (!grounding) {
    return null;
  }

  const truthy = index % 2 === 0;
  const sentence = grounding.evidenceSnippets[0];
  const resolvedMathCategory =
    subjectCategory === "math"
      ? mathCategory || inferMathCategory({ concept, sectionTitle: "", sentenceText: sentence })
      : null;
  const rng = rngFromString(`${seedSalt || concept.id}|tf-safe|${index}`);

  let statement = formatMathEvidenceStatement(sentence);
  if (!statement) {
    return null;
  }

  if (!truthy) {
    const categoryTerms = resolvedMathCategory ? MATH_TF_MUTATION_TERMS[resolvedMathCategory] : null;
    const mutated =
      (categoryTerms ? applyControlledTermSwap(statement, categoryTerms, rng) : null) ||
      (categoryTerms
        ? forceMathTermReplacement(statement, categoryTerms, DEFAULT_STOPWORDS, rng)
        : null) ||
      applyControlledTermSwap(statement, MATH_TF_MUTATION_TERMS.number_types, rng) ||
      forceMathTermReplacement(
        statement,
        MATH_TF_MUTATION_TERMS.number_types,
        DEFAULT_STOPWORDS,
        rng
      ) ||
      mutateMathStatement(statement);
    if (mutated) {
      statement = mutated;
    } else {
      return null;
    }
  }

  const prompt = `True or False: ${statement}`;

  return {
    id: hashToUuid(
      `${seedSalt || concept.id}|trueFalse|${concept.id}|${index}|tf_math_fallback_safe`
    ),
    type: "trueFalse",
    topic: concept.name,
    topicConceptId: concept.id,
    bloomLevel: "L2",
    prompt,
    answerKey: truthy,
    answerKeyBool: truthy,
    classification:
      concept.type === "definition"
        ? "Definition"
        : concept.type === "process"
          ? "Application"
          : "Concept",
    explanation: truthy
      ? `${ensureSentence(sentence)} This matches the source text.`
      : `${ensureSentence(sentence)} This statement changes one detail from the source.`,
    grounding,
    points: POINTS_BY_TYPE.trueFalse,
    meta: {
      difficulty,
      tags: [concept.type],
      regeneratedFrom: seedSalt || null,
      templateId: "tf_math_fallback_safe",
      templateFamily: "math-fallback",
      mathCategory: resolvedMathCategory,
      subjectCategory: subjectCategory || null,
    },
  };
};

const keywordize = (text, stopwords) => {
  const tokens = tokenize(text).filter((t) => !isStopword(t, stopwords) && t.length >= 4);
  return [...new Set(tokens)].slice(0, 8);
};

const buildShortAnswer = ({
  concept,
  sentenceMap,
  difficulty,
  seedSalt,
  stopwords,
  template,
  subjectCategory,
}) => {
  const grounding = pickEvidenceForConcept(concept, sentenceMap, { preferDefinition: true });
  if (!grounding) {
    return null;
  }

  const sentence = grounding.evidenceSnippets[0];
  const definitionText = getDefinitionBody(sentence, concept.name);
  const requiredKeywords = keywordize(definitionText, stopwords);
  const optionalKeywords = keywordize(concept.name, stopwords);
  const prompt = template?.buildPrompt
    ? template.buildPrompt({ concept, sentenceText: sentence })
    : `In your own words, explain "${concept.name}" based on the notes.`;

  return {
    id: hashToUuid(
      `${seedSalt || concept.id}|shortAnswer|${concept.id}|${template?.id || "default"}`
    ),
    type: "shortAnswer",
    topic: concept.name,
    topicConceptId: concept.id,
    bloomLevel: difficulty === "hard" ? "L3" : "L2",
    prompt,
    answerKey: {
      rubricPoints: [
        { id: "r1", label: "Uses key terms from the text", points: 1 },
        { id: "r2", label: "Accurately describes the concept/process", points: 1 },
      ],
      requiredKeywords,
      optionalKeywords,
    },
    answerKeyText: requiredKeywords,
    explanation: sentence,
    grounding,
    points: POINTS_BY_TYPE.shortAnswer,
    meta: {
      difficulty,
      tags: [concept.type],
      regeneratedFrom: seedSalt || null,
      templateId: template?.id || null,
      templateFamily: template?.family || null,
      subjectCategory: subjectCategory || null,
    },
  };
};

const validateQuestion = ({
  question,
  sentenceIdSet,
  tokenSet,
  stopwords,
  sentenceIdToSectionId,
  sectionTokenSets,
  sectionTitleMap,
  subjectCategory,
  relaxFillBlank = false,
  relaxMathMcqOverlap = false,
  relaxMcqOverlap = false,
  strictTypes = false,
}) => {
  const issues = [];
  if (!question || !question.type) {
    issues.push("Missing type.");
    return issues;
  }
  const isMathTrueFalse = question.type === "trueFalse" && subjectCategory === "math";
  const isFillBlank = question.type === "fillBlank";
  const relaxHistoryEvidence =
    question.type === "mcq" && MCQ_RELAXED_EVIDENCE_FAMILIES.has(question.meta?.templateFamily);
  const isStrictFillBlankFallback =
    strictTypes &&
    isFillBlank &&
    question.meta?.templateFamily === "fallback";

  const grounding = question.grounding;
  if (!grounding || !Array.isArray(grounding.sourceSentenceIds) || !grounding.sourceSentenceIds.length) {
    issues.push("Missing grounding sourceSentenceIds.");
  } else {
    grounding.sourceSentenceIds.forEach((id) => {
      if (!sentenceIdSet.has(id)) {
        issues.push(`Invalid sourceSentenceId ${id}.`);
      }
    });
  }

  if (hasBannedPhrase(question.prompt)) {
    issues.push("Prompt contains banned filler phrase.");
  }
  if (hasBannedStem(question.prompt)) {
    issues.push("Prompt contains banned stem.");
  }
  const sanityIssues = promptSanityIssues(question.prompt, question.type);
  if (sanityIssues.length) {
    sanityIssues.forEach((issue) => issues.push(issue));
  }

  const evidenceText = grounding?.evidenceSnippets?.join(" ") || "";
  const evidenceTokenSet = buildTokenSet(evidenceText, stopwords);
  if (evidenceText && !isFillBlank) {
    const promptLower = String(question.prompt || "").toLowerCase();
    const evidenceLower = evidenceText.toLowerCase();
    const promptEqualsEvidence = normalizeWhitespace(promptLower) === normalizeWhitespace(evidenceLower);
    const allowRelaxedMcq = relaxMcqOverlap && question.type === "mcq";
    if (question.type === "trueFalse") {
      if (promptEqualsEvidence) {
        issues.push("Prompt copies evidence text.");
      } else {
        const similarity = normalizedLevenshteinSimilarity(question.prompt, evidenceText);
        if (similarity >= TF_PROMPT_EVIDENCE_SIMILARITY_LIMIT) {
          issues.push("Prompt overlaps evidence too closely.");
        }
      }
    } else if (!isMathTrueFalse) {
      if (allowRelaxedMcq) {
        if (promptEqualsEvidence || promptLower.includes(evidenceLower)) {
          issues.push("Prompt copies evidence text.");
        }
      } else {
      const overlap = tokenOverlapRatio(question.prompt, evidenceText, stopwords);
      const relaxMathMcq = isMathMcqOverlapRelaxed({
        question,
        subjectCategory,
        evidenceText,
      });
      const overlapLimit = relaxMathMcq
        ? isFormulaLike(evidenceText)
          ? MATH_MCQ_FORMULA_OVERLAP_LIMIT
          : MATH_MCQ_OVERLAP_LIMIT
        : ANSWER_EVIDENCE_OVERLAP_LIMIT;
      if (overlap >= overlapLimit) {
        const similarity = relaxMathMcq
          ? normalizedLevenshteinSimilarity(question.prompt, evidenceText)
          : 0;
        const allowHighOverlap = relaxMathMcq && hasTaskFraming(question.prompt);
        if (
          !relaxMathMcqOverlap ||
          !relaxMathMcq ||
          (!allowHighOverlap && similarity >= MATH_MCQ_NEAR_IDENTICAL_THRESHOLD)
        ) {
          issues.push("Prompt overlaps evidence too closely.");
        }
      }
      const similarity = normalizedLevenshteinSimilarity(question.prompt, evidenceText);
      const similarityLimit = relaxMathMcq
        ? MATH_MCQ_NEAR_IDENTICAL_THRESHOLD
        : PROMPT_EVIDENCE_SIMILARITY_STRICT;
      if (similarity >= similarityLimit) {
        issues.push("Prompt overlaps evidence too closely.");
      }
      if (promptEqualsEvidence) {
        issues.push("Prompt copies evidence text.");
      } else {
        const relaxMathMcqCopy = isMathMcqOverlapRelaxed({
          question,
          subjectCategory,
          evidenceText,
        });
        if (
          (subjectCategory !== "math" && promptLower.includes(evidenceLower)) ||
          (!relaxMathMcqCopy && promptLower.includes(evidenceLower))
        ) {
          issues.push("Prompt copies evidence text.");
        }
      }
      }
    }
  }
  const primarySentenceId = grounding?.sourceSentenceIds?.[0];
  const sectionId = primarySentenceId ? sentenceIdToSectionId.get(primarySentenceId) : null;
  const sectionTokenSet = sectionId ? sectionTokenSets.get(sectionId) : null;
  let allowedTokens = null;
  if (isMathTrueFalse) {
    const statementText = extractTrueFalseStatement(question.prompt);
    const overlap = tokenOverlapRatio(
      statementText,
      `${evidenceText} ${question.topic || ""}`,
      stopwords
    );
    if (overlap < MATH_TF_MIN_OVERLAP) {
      issues.push("Math TF statement lacks evidence overlap.");
    }
    allowedTokens = new Set([
      ...buildRawTokenSet(evidenceText),
      ...buildRawTokenSet(question.topic || ""),
      ...MATH_TF_GLUE_TOKENS,
    ]);
    if (question.answerKey === false) {
      const category = question.meta?.mathCategory;
      const terms = category ? MATH_TF_MUTATION_TERMS[category] : null;
      if (terms) {
        terms.forEach((term) => allowedTokens.add(term));
      }
      if (
        question.meta?.templateId === "tf_math_fallback_safe" &&
        !hasMeaningfulMutation(statementText, evidenceText, stopwords)
      ) {
        issues.push("False statement does not alter a key token.");
      }
    }
    const statementTokens = tokenize(statementText);
    const unseen = statementTokens.filter((t) => t && !allowedTokens.has(t));
    if (unseen.length) {
      issues.push("Prompt contains out-of-text terms.");
    }
  } else {
    allowedTokens = new Set([
      ...evidenceTokenSet,
      ...(sectionTokenSet ? sectionTokenSet : tokenSet),
      ...ALLOWED_GLUE_TOKENS,
    ]);
    if (isHistorySubject(subjectCategory) && relaxHistoryEvidence) {
      HISTORY_ALLOWED_TOKENS.forEach((token) => allowedTokens.add(token));
    }

    const promptTokens = tokenize(question.prompt).filter(
      (t) => !isStopword(t, stopwords) && t.length >= 4
    );
    const isScenarioFamily =
      question.type === "mcq" && MCQ_SCENARIO_FAMILIES.has(question.meta?.templateFamily);
    if (isScenarioFamily) {
      const unseenTokens = promptTokens.filter((token) => !allowedTokens.has(token));
      const wrapperTokens = unseenTokens.filter((token) => SCENARIO_WRAPPER_TOKENS.has(token));
      const evidenceMatchCount = promptTokens.filter((token) => evidenceTokenSet.has(token)).length;
      const evidenceRatio = promptTokens.length
        ? evidenceMatchCount / promptTokens.length
        : 1;
      if (
        promptTokens.length &&
        evidenceRatio < SCENARIO_EVIDENCE_TOKEN_RATIO_THRESHOLD &&
        wrapperTokens.length > MAX_SCENARIO_WRAPPER_TOKENS
      ) {
        issues.push("Scenario prompt contains too many wrapper tokens.");
      }
    } else {
      const unseen = promptTokens.filter((t) => !allowedTokens.has(t));
      const maxUnseen = relaxHistoryEvidence ? MAX_PROMPT_UNSEEN_TOKENS + 6 : MAX_PROMPT_UNSEEN_TOKENS;
      if (unseen.length > maxUnseen && !(isFillBlank && relaxFillBlank)) {
        issues.push("Prompt contains too many out-of-text terms.");
      }
    }
  }

  if (!allowedTokens || !(allowedTokens instanceof Set)) {
    return { ok: false, reason: "missing-allowedTokens" };
  }

  if (question.type === "mcq") {
    if (!Array.isArray(question.choices) || question.choices.length !== 4) {
      issues.push("MCQ must have 4 choices.");
    } else {
      const unique = new Set(question.choices);
      if (unique.size !== question.choices.length) {
        issues.push("MCQ choices must be unique.");
      }
      const isTermList = question.meta?.choiceFormat === "term-list";
      question.choices.forEach((choice) => {
        if (hasBannedPhrase(choice)) {
          issues.push("Choice contains banned filler phrase.");
          return;
        }
        if (isTermList) {
          return;
        }
        if (!relaxHistoryEvidence) {
          const matches = countKeywordMatches(choice, allowedTokens, stopwords);
          if (matches < MIN_CHOICE_KEYWORD_MATCHES) {
            issues.push("MCQ choice lacks evidence keywords.");
          }
        }
      });
      if (isTermList) {
        if (!relaxHistoryEvidence) {
          const answerIndex = choiceLabels.indexOf(question.answerKey);
          const answerChoice = question.choices[answerIndex] || "";
          const matches = countKeywordMatches(answerChoice, allowedTokens, stopwords);
          if (matches < 1) {
            issues.push("MCQ term-list answer lacks evidence keywords.");
          }
        }
      } else {
        for (let i = 0; i < question.choices.length; i += 1) {
          for (let j = i + 1; j < question.choices.length; j += 1) {
            const overlap = tokenOverlapRatio(question.choices[i], question.choices[j], stopwords);
            if (overlap >= 0.8) {
              issues.push("MCQ choices are too similar.");
              i = question.choices.length;
              break;
            }
          }
        }
      }
    }
    if (!choiceLabels.includes(question.answerKey)) {
      issues.push("MCQ answerKey must be A-D.");
    }
  }

  if (question.type === "trueFalse") {
    if (typeof question.answerKey !== "boolean") {
      issues.push("TrueFalse answerKey must be boolean.");
    }
  }

  if (question.type === "fillBlank") {
    const answerKey = String(question.answerKey || "").trim();
    const normalizedAnswerKey = normalizeWhitespace(answerKey);
    const normalizedAnswerKeyLower = normalizedAnswerKey.toLowerCase();
    const statement = extractFillBlankStatement(question.prompt);
    if (isStrictFillBlankFallback) {
      if (!statement.includes(BLANK_TOKEN)) {
        issues.push("FillBlank prompt missing blank token.");
      }
      if (!answerKey) {
        issues.push("FillBlank answerKey required.");
      }
      const removedSpanNormalized = question.meta?.removedSpanNormalized;
      const removedSpanNormalizedLower = removedSpanNormalized
        ? String(removedSpanNormalized).toLowerCase()
        : null;
      if (!removedSpanNormalized) {
        issues.push("FillBlank fallback missing removed span normalized.");
      } else if (normalizedAnswerKeyLower !== removedSpanNormalizedLower) {
        issues.push("FillBlank answerKey does not match removed span normalized.");
      }
      if (evidenceText && answerKey) {
        const filled = normalizeWhitespace(statement.replace(BLANK_TOKEN, answerKey)).toLowerCase();
        const evidenceNorm = normalizeWhitespace(evidenceText).toLowerCase();
        if (filled !== evidenceNorm) {
          issues.push("FillBlank answerKey does not match removed span.");
        }
      }
      return issues;
    }
    if (!answerKey || answerKey.length < 2) {
      issues.push("FillBlank answerKey required.");
    }
    if (isTrivialBlankTerm(answerKey, stopwords)) {
      issues.push("FillBlank answerKey is too trivial.");
    }
    if (evidenceText) {
      const evidenceLower = evidenceText.toLowerCase();
      const answerLower = answerKey.toLowerCase();
      if (!evidenceLower.includes(answerLower)) {
        issues.push("FillBlank answerKey not found in evidence.");
      }
    }
    if (!statement.includes(BLANK_TOKEN)) {
      issues.push("FillBlank prompt missing blank token.");
    } else {
      const statementBody = statement.replace(BLANK_TOKEN, "");
      const promptHasHint = /\bhint:/i.test(String(question.prompt || ""));
      const minWords = relaxFillBlank ? 10 : 12;
      if (countWords(statementBody) < minWords && !hasContextClause(statement) && !promptHasHint) {
        issues.push("FillBlank prompt lacks enough context.");
      }
      if (evidenceText && answerKey) {
        const filled = normalizeWhitespace(statement.replace(BLANK_TOKEN, answerKey)).toLowerCase();
        const evidenceNorm = normalizeWhitespace(evidenceText).toLowerCase();
        if (filled !== evidenceNorm) {
          issues.push("FillBlank answerKey does not match removed span.");
        }
      }
    }
    const removedSpanRaw = question.meta?.removedSpanRaw;
    const removedSpanNormalized = question.meta?.removedSpanNormalized;
    const removedSpanNormalizedLower = removedSpanNormalized
      ? String(removedSpanNormalized).toLowerCase()
      : null;
    if (removedSpanRaw && removedSpanRaw.trim() !== answerKey) {
      issues.push("FillBlank answerKey does not match removed span raw.");
    }
    if (removedSpanNormalized && normalizedAnswerKeyLower !== removedSpanNormalizedLower) {
      issues.push("FillBlank answerKey does not match removed span normalized.");
    }
  }

  if (question.type === "shortAnswer") {
    const ak = question.answerKey;
    if (!ak || !Array.isArray(ak.rubricPoints) || !Array.isArray(ak.requiredKeywords)) {
      issues.push("ShortAnswer answerKey must include rubricPoints and requiredKeywords.");
    }
  }

  if (question.type === "mcq") {
    const scenarioFamilies = new Set([
      "scenario-application",
      "organelles",
      "equations",
      "genetics",
      "ecology",
    ]);
    if (
      subjectCategory !== "math" &&
      scenarioFamilies.has(question.meta?.templateFamily) &&
      !scenarioHasRequiredStructure(question.prompt)
    ) {
      issues.push("Scenario prompt lacks required if/when/system/process structure.");
    }
  }

  return issues;
};

const computeMissingCounts = (config, questions) => {
  const requested = config?.types || {};
  const actual = questions.reduce((acc, q) => {
    const key = q.type;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const missing = {};
  Object.entries(requested).forEach(([type, count]) => {
    const needed = Math.max(0, Number(count) || 0);
    const got = Math.max(0, Number(actual[type]) || 0);
    const gap = needed - got;
    if (gap > 0) {
      missing[type] = gap;
    }
  });
  return missing;
};

const countQuestionTypes = (questions) =>
  questions.reduce((acc, q) => {
    const key = q.type;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const summarizeValidationFailures = (failureCountsByType) => {
  const summary = {};
  Object.entries(failureCountsByType).forEach(([type, failures]) => {
    const top = Object.entries(failures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));
    if (top.length) {
      summary[type] = top;
    }
  });
  return summary;
};

const getMcqFamilySequence = (subjectCategory) => {
  switch (subjectCategory) {
    case "history":
      return [
        "history-sources",
        "history-reliability",
        "history-chronology",
        "history-government",
        "history-cause",
        "history-rights",
        "scenario-application",
      ];
    case "math":
      return [
        "math-application",
        "math-core",
        "math-classify",
        "math-error",
        "equations",
        "math-definition",
        "statement-correct",
      ];
    case "science":
      return ["science-cause", "science-function", "science-classify", "scenario-application"];
    case "geography":
      return ["geography-scenario", "geography-climate", "geography-resources", "scenario-application"];
    case "english":
      return ["english-grammar", "english-device", "english-improvement", "english-voice"];
    case "cs":
      return ["cs-ipo", "cs-hardware", "cs-algorithm", "cs-data"];
    default:
      return ["scenario-application"];
  }
};

const getScenarioFamiliesForSubject = (subject) => {
  const normalized = canonicalSubjectKey(subject);
  if (normalized === "civics") {
    return new Set(["scenario-application"]);
  }
  const families = SUBJECT_SCENARIO_FAMILY_LOOKUP.get(normalized);
  if (!families) {
    return null;
  }
  const augmented = new Set(families);
  augmented.add("scenario-application");
  return augmented;
};

const generateGroundedExam = ({ text, title, config, seed }) => {
  const startedAt = Date.now();
  const resolvedSeed = seed == null ? crypto.randomBytes(8).toString("hex") : String(seed);
  const initialSubjectInfo = detectSubjects(text);
  const fallbackSubject = detectSubjectCategory(text);
  const detectedSubjects = initialSubjectInfo.subjects;
  const subjectCategory =
    detectedSubjects.length > 1
      ? "mixed"
      : detectedSubjects[0] || fallbackSubject || "other";
  const subjectPlanSubjects = detectedSubjects.length
    ? detectedSubjects
    : fallbackSubject !== "other"
      ? [fallbackSubject]
      : [];
  const knowledgeChunks = retrieveRelevantChunks(
    text,
    subjectPlanSubjects,
    KNOWLEDGE_LIMIT_PER_SUBJECT
  );
  const knowledgeAppendText = buildKnowledgeAppendText(knowledgeChunks);
  const augmentedText = knowledgeAppendText ? `${text}\n\n${knowledgeAppendText}` : text;
  const detectedAugmented = detectSubjects(augmentedText);
  let subjectSections = detectedAugmented.sections;
  if (!subjectSections.length && subjectPlanSubjects.length === 1) {
    subjectSections = [
      { subject: subjectPlanSubjects[0], start: 0, end: augmentedText.length },
    ];
  }
  const blueprintBundle = buildBlueprint({ text: augmentedText, seed: resolvedSeed });
  const sentences = blueprintBundle.sourceText.sentences;
  const sentenceMap = new Map(sentences.map((s) => [s.id, s]));
  const sentenceIdSet = new Set(sentences.map((s) => s.id));
  const tokenSet = buildTokenSet(augmentedText, DEFAULT_STOPWORDS);
  const sections = blueprintBundle.blueprint.sections || [];
  const sentenceIdToSectionId = new Map();
  const sectionTokenSets = new Map();
  const sectionSentenceIdsMap = new Map();
  const sectionTitleMap = new Map();
  sections.forEach((section) => {
    const tokenSetForSection = new Set();
    const sentenceIds = Array.isArray(section.sentenceIds) ? section.sentenceIds : [];
    sectionTitleMap.set(section.id, section.title || "");
    sentenceIds.forEach((id) => {
      sentenceIdToSectionId.set(id, section.id);
      const sentence = sentenceMap.get(id);
      if (sentence?.text) {
        addTokensToSet(sentence.text, DEFAULT_STOPWORDS, tokenSetForSection);
      }
    });
    sectionTokenSets.set(section.id, tokenSetForSection);
    sectionSentenceIdsMap.set(section.id, sentenceIds);
  });

  const rng = rngFromString(resolvedSeed);
  const sentenceSubjectMap = mapSentencesToSubjects(sentences, subjectSections);
  const concepts = shuffleDeterministic(blueprintBundle.blueprint.concepts, rng);
  const fallbackSubjectKey = subjectPlanSubjects[0] || fallbackSubject || "other";
  const conceptsBySubject = groupConceptsBySubject(concepts, sentenceSubjectMap, fallbackSubjectKey);
  const subjectWeights = {};
  conceptsBySubject.forEach((list, subject) => {
    subjectWeights[subject] = list.length;
  });
  const resolvedConfig = { ...config, strictTypes: config?.strictTypes === true };
  const difficulty = resolvedConfig?.difficulty || "medium";
  const strictTypes = resolvedConfig.strictTypes;
  const allowDeterministicFallbacks =
    strictTypes && String(augmentedText || "").trim().length >= 200;

  const examId = hashToUuid(
    `${resolvedSeed}|${normalizeWhitespace(title || "")}|${JSON.stringify(resolvedConfig)}`
  );

  const questionPlan = [];
  let plannedMcqCount = 0;
  Object.entries(resolvedConfig.types).forEach(([type, count]) => {
    for (let i = 0; i < count; i += 1) {
      questionPlan.push(type);
      if (type === "mcq") {
        plannedMcqCount += 1;
      }
    }
  });
  const shuffledPlan = shuffleDeterministic(questionPlan, rng);
  const subjectPlan = buildSubjectPlan({
    subjects: subjectPlanSubjects.length ? subjectPlanSubjects : [fallbackSubjectKey],
    totalQuestions: shuffledPlan.length,
    weights: subjectWeights,
    rng,
  });
  const planWithSubjects = shuffledPlan.map((type, index) => ({
    type,
    subject: subjectPlan[index] || fallbackSubjectKey,
  }));
  const templateState = buildTemplateState(planWithSubjects.length, plannedMcqCount);
  const subjectPlanCounts = planWithSubjects.reduce((acc, entry) => {
    acc[entry.subject] = (acc[entry.subject] || 0) + 1;
    return acc;
  }, {});
  const subjectConceptCounts = {};
  conceptsBySubject.forEach((list, subject) => {
    subjectConceptCounts[subject] = list.length;
  });
  const allowGlobalRepeats = concepts.length < planWithSubjects.length;

  const generationStartedAt = Date.now();
  const questions = [];
  const flagged = [];
  const attemptsByType = {};
  const validationFailureCountsByType = {};
  const templateFailures = {};
  const templateFamilyFailures = {};
  const tfCandidateFailures = [];
  const mcqCandidateFailures = [];
  const fillBlankCandidateFailures = [];
  const usedStems = new Set();
  const usedConceptIds = new Set();
  const usedTfConceptIds = new Set();
  let termMatchesStemCount = 0;

  const recordAttempt = (type) => {
    attemptsByType[type] = (attemptsByType[type] || 0) + 1;
  };

  const recordValidationFailures = (type, issues) => {
    if (!issues || !issues.length) {
      return;
    }
    if (!validationFailureCountsByType[type]) {
      validationFailureCountsByType[type] = {};
    }
    issues.forEach((issue) => {
      validationFailureCountsByType[type][issue] =
        (validationFailureCountsByType[type][issue] || 0) + 1;
    });
  };

  const recordTemplateFailure = (template) => {
    if (!template?.id) {
      return;
    }
    templateFailures[template.id] = (templateFailures[template.id] || 0) + 1;
    if (template.family) {
      templateFamilyFailures[template.family] =
        (templateFamilyFailures[template.family] || 0) + 1;
    }
  };

  const recordMcqCandidateFailure = (question, issues) => {
    if (!question || question.type !== "mcq") {
      return;
    }
    if (mcqCandidateFailures.length >= 6) {
      return;
    }
    mcqCandidateFailures.push({
      templateId: question.meta?.templateId || null,
      templateFamily: question.meta?.templateFamily || null,
      prompt: question.prompt,
      choices: question.choices,
      answerKey: question.answerKey,
      issues,
    });
  };

  const recordFillBlankCandidateFailure = ({ question, issues, evidenceSnippet, templateId }) => {
    if (!question || question.type !== "fillBlank") {
      return;
    }
    if (fillBlankCandidateFailures.length >= 5) {
      return;
    }
    fillBlankCandidateFailures.push({
      type: "fillBlank",
      templateId: templateId || question.meta?.templateId || null,
      prompt: question.prompt,
      evidenceSnippet: evidenceSnippet || question.explanation || null,
      issues,
    });
  };

  const getExcludedTfFamilies = () =>
    new Set(
      Object.entries(templateFamilyFailures)
        .filter(([family, count]) => family && count >= MAX_TF_FAMILY_FAILURES)
        .map(([family]) => family)
    );

  const buildQuestionCandidate = ({
    type,
    subjectForQuestion,
    startIndex,
    excludeFamilies,
    includeFamilies,
    forceScenarioPrompt,
    relaxMcqOverlap,
    preferredFamilies = null,
  }) => {
    const resolvedForceScenarioPrompt =
      Boolean(forceScenarioPrompt) || normalizeSubjectKey(subjectForQuestion) === "civics";
    let q = null;
    let attempts = 0;
    const attemptedTemplateIds = new Set();
    const attemptedTemplateFamilies = new Set(excludeFamilies || []);
    if (type === "trueFalse") {
      getExcludedTfFamilies().forEach((family) => attemptedTemplateFamilies.add(family));
    }
    const attemptedConceptIds = new Set();
    const subjectConcepts = conceptsBySubject.get(subjectForQuestion) || concepts;
    const allowRepeatedConceptsLocal =
      (subjectConceptCounts[subjectForQuestion] || 0) <
      (subjectPlanCounts[subjectForQuestion] || 0);
    const maxAttempts =
      type === "fillBlank"
        ? MAX_GENERATION_ATTEMPTS + EXTRA_FILLBLANK_ATTEMPTS
        : MAX_GENERATION_ATTEMPTS;

    while (!q && attempts < maxAttempts) {
      recordAttempt(type);
      const concept = pickNextConcept({
        concepts: subjectConcepts,
        startIndex: startIndex + attempts,
        attemptedConceptIds,
      });
      if (!concept) {
        attempts += 1;
        continue;
      }
      if (!allowRepeatedConceptsLocal && usedConceptIds.has(concept.id)) {
        attempts += 1;
        continue;
      }
      if (type === "trueFalse" && usedTfConceptIds.has(concept.id)) {
        attempts += 1;
        continue;
      }
      attemptedConceptIds.add(concept.id);
      const grounding = pickEvidenceForConcept(
        concept,
        sentenceMap,
        type === "trueFalse" || type === "fillBlank"
          ? { sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text) }
          : {}
      );
      if ((type === "trueFalse" || type === "fillBlank") && !grounding) {
        attempts += 1;
        continue;
      }
      const sentenceText = grounding?.evidenceSnippets?.[0] || "";
      const primarySentenceId = grounding?.sourceSentenceIds?.[0];
      const sectionId = primarySentenceId ? sentenceIdToSectionId.get(primarySentenceId) : null;
      const sectionTitle = sectionId ? sectionTitleMap.get(sectionId) : "";
      const mathCategory =
        subjectForQuestion === "math"
          ? inferMathCategory({ concept, sectionTitle, sentenceText })
          : null;
      const remainingSlots = planWithSubjects.length - questions.length;
      const blockedTemplateIds = new Set(attemptedTemplateIds);
      if (type === "fillBlank") {
        Object.entries(templateFailures).forEach(([templateId, count]) => {
          if (count >= MAX_FILLBLANK_TEMPLATE_FAILURES) {
            blockedTemplateIds.add(templateId);
          }
        });
      }
      Object.entries(templateFailures).forEach(([templateId, count]) => {
        if (count >= MAX_TEMPLATE_FAILURES) {
          blockedTemplateIds.add(templateId);
        }
      });
        const template = pickTemplate({
          type,
          sentenceText,
          concept,
          sectionTitle,
          subjectCategory: subjectForQuestion,
          mathCategory,
          includeFallbackTemplates: false,
          rng,
          state: templateState,
          remainingSlots,
          excludeTemplateIds: blockedTemplateIds,
          excludeFamilies: attemptedTemplateFamilies.size ? attemptedTemplateFamilies : null,
          includeFamilies,
          preferredFamilies,
        });
      if (type === "mcq" && includeFamilies && includeFamilies.size && !template) {
        attempts += 1;
        continue;
      }
      if (template?.id) {
        attemptedTemplateIds.add(template.id);
      }
      if (template?.family) {
        attemptedTemplateFamilies.add(template.family);
      }

      if (type === "mcq") {
        q = buildMcq({
          concept,
          concepts: subjectConcepts,
          sentenceMap,
          difficulty,
          template,
          subjectCategory: subjectForQuestion,
          mathCategory,
          seedSalt: `${resolvedSeed}|regen|${startIndex}|${attempts}`,
          sentenceIdToSectionId,
          sectionSentenceIdsMap,
          sectionTokenSets,
          sectionTitleMap,
          forceScenarioPrompt: resolvedForceScenarioPrompt,
        });
        if (!q && strictTypes && normalizeSubjectKey(subjectForQuestion) === "other") {
          const extraTokens = collectOtherDefinitionTokens({
            sentenceMap,
            sentenceIdToSectionId,
            sectionSentenceIdsMap,
            currentSentenceId: primarySentenceId,
            concept,
          });
          const baseTemplate = TEMPLATE_BY_ID.get("mcq_other_definition_in_context");
          if (baseTemplate) {
            const fallbackTemplate = {
              ...baseTemplate,
              buildChoices: ({ sentenceText: fallbackSentence, concept: fallbackConcept, rng: fallbackRng }) =>
                buildOtherTermChoiceSet({
                  sentenceText: fallbackSentence,
                  concept: fallbackConcept,
                  rng: fallbackRng,
                  additionalTokens: extraTokens,
                }),
            };
            q = buildMcq({
              concept,
              concepts: subjectConcepts,
              sentenceMap,
              difficulty,
              template: fallbackTemplate,
              subjectCategory: subjectForQuestion,
              mathCategory,
              seedSalt: `${resolvedSeed}|regen|${startIndex}|${attempts}|fallback`,
              sentenceIdToSectionId,
              sectionSentenceIdsMap,
              sectionTokenSets,
              sectionTitleMap,
              forceScenarioPrompt: resolvedForceScenarioPrompt,
            });
          }
        }
      } else if (type === "trueFalse") {
        q = buildTrueFalse({
          concept,
          concepts: subjectConcepts,
          sentenceMap,
          difficulty,
          index: startIndex,
          template,
          seedSalt: `${resolvedSeed}|regen|${startIndex}|${attempts}`,
          subjectCategory: subjectForQuestion,
          mathCategory,
          sentenceIdToSectionId,
        });
      } else if (type === "shortAnswer") {
        q = buildShortAnswer({
          concept,
          sentenceMap,
          difficulty,
          stopwords: DEFAULT_STOPWORDS,
          template,
          seedSalt: `${resolvedSeed}|regen|${startIndex}|${attempts}`,
          subjectCategory: subjectForQuestion,
        });
      } else if (type === "fillBlank") {
        q = buildFillBlank({
          concept,
          sentenceMap,
          difficulty,
          template,
          seedSalt: `${resolvedSeed}|regen|${startIndex}|${attempts}`,
          subjectCategory: subjectForQuestion,
        });
      }

      if (!q) {
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      if (hasBannedStem(q.prompt)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const promptStem = extractPromptStem(q.prompt);
      if (promptStem && usedStems.has(promptStem)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }
      if (/which term matches/i.test(String(q.prompt || "")) && termMatchesStemCount >= 1) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const conceptTemplateKey = `${q.topicConceptId}|${q.meta?.templateId || "none"}`;
      if (templateState.usedConceptTemplate.has(conceptTemplateKey)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      if (isPromptTooSimilar(q.prompt, templateState.promptTokenSets, DEFAULT_STOPWORDS)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const validation = validateQuestion({
        question: q,
        sentenceIdSet,
        tokenSet,
        stopwords: DEFAULT_STOPWORDS,
        sentenceIdToSectionId,
        sectionTokenSets,
        sectionTitleMap,
        subjectCategory: subjectForQuestion,
        relaxMcqOverlap,
        strictTypes,
      });
      if (!Array.isArray(validation)) {
        recordValidationFailures(type, [validation.reason || "missing-allowedTokens"]);
        recordMcqCandidateFailure(q, [validation.reason || "missing-allowedTokens"]);
        if (type === "fillBlank") {
          recordFillBlankCandidateFailure({
            question: q,
            issues: [validation.reason || "missing-allowedTokens"],
            evidenceSnippet: sentenceText,
            templateId: template?.id || null,
          });
        }
        recordTemplateFailure(template);
        q = null;
        attempts += 1;
        continue;
      }
      const issues = validation;
      if (issues.length) {
        let hasIssues = issues.length;
        recordValidationFailures(type, issues);
        const hasPromptSanity = issues.some((issue) => issue.startsWith("Prompt "));
        if (hasPromptSanity) {
          const rewritten = rewritePromptForSanity({
            question: q,
            concept,
            sentenceText,
            category: q.meta?.category,
            sectionTitle,
            subjectCategory: subjectForQuestion,
            rng,
          });
          if (rewritten) {
            const rewriteValidation = validateQuestion({
              question: rewritten,
              sentenceIdSet,
              tokenSet,
              stopwords: DEFAULT_STOPWORDS,
              sentenceIdToSectionId,
              sectionTokenSets,
              sectionTitleMap,
              subjectCategory: subjectForQuestion,
              relaxMcqOverlap,
              strictTypes,
            });
            if (Array.isArray(rewriteValidation) && rewriteValidation.length === 0) {
              q = rewritten;
              hasIssues = 0;
            }
          }
        }
        if (type === "trueFalse" && shouldRewriteTrueFalse(issues)) {
          for (let rewriteAttempt = 0; rewriteAttempt < MAX_TF_REWRITE_ATTEMPTS; rewriteAttempt += 1) {
            const rewritten = rewriteTrueFalseQuestion({
              question: q,
              concept,
              concepts: subjectConcepts,
              sentenceIdToSectionId,
              subjectCategory: subjectForQuestion,
              attempt: rewriteAttempt,
            });
            if (!rewritten) {
              continue;
            }
            const rewriteValidation = validateQuestion({
              question: rewritten,
              sentenceIdSet,
              tokenSet,
              stopwords: DEFAULT_STOPWORDS,
              sentenceIdToSectionId,
              sectionTokenSets,
              sectionTitleMap,
              subjectCategory: subjectForQuestion,
              strictTypes,
            });
            if (Array.isArray(rewriteValidation) && rewriteValidation.length === 0) {
              q = rewritten;
              hasIssues = 0;
              break;
            }
          }
        }
        if (!q || hasIssues) {
          recordMcqCandidateFailure(q, issues);
          if (type === "fillBlank") {
            recordFillBlankCandidateFailure({
              question: q,
              issues,
              evidenceSnippet: sentenceText,
              templateId: template?.id || null,
            });
          }
          recordTemplateFailure(template);
          q = null;
          attempts += 1;
          continue;
        }
      }

      templateState.usedConceptTemplate.add(conceptTemplateKey);
      templateState.promptTokenSets.push(normalizePromptTokens(q.prompt, DEFAULT_STOPWORDS));
      recordTemplateUse(templateState, template || TEMPLATE_BY_ID.get(q.meta?.templateId), q.type);
      usedConceptIds.add(concept.id);
      if (q.type === "trueFalse") {
        usedTfConceptIds.add(concept.id);
      }
      if (promptStem) {
        usedStems.add(promptStem);
      }
      if (/which term matches/i.test(String(q.prompt || ""))) {
        termMatchesStemCount += 1;
      }
    }

    return q;
  };

  const rebuildUsageState = () => {
    usedStems.clear();
    usedConceptIds.clear();
    usedTfConceptIds.clear();
    termMatchesStemCount = 0;
    questions.forEach((question) => {
      if (!question) {
        return;
      }
      const stem = extractPromptStem(question.prompt);
      if (stem) {
        usedStems.add(stem);
      }
      if (question.topicConceptId) {
        usedConceptIds.add(question.topicConceptId);
      }
      if (question.type === "trueFalse" && question.topicConceptId) {
        usedTfConceptIds.add(question.topicConceptId);
      }
      if (/which term matches/i.test(String(question.prompt || ""))) {
        termMatchesStemCount += 1;
      }
    });
  };

  for (let i = 0; i < planWithSubjects.length; i += 1) {
    const { type, subject: questionSubject } = planWithSubjects[i];
    const subjectForQuestion = normalizeSubjectKey(questionSubject) || fallbackSubjectKey;
    const subjectConcepts = conceptsBySubject.get(subjectForQuestion) || concepts;
    const allowRepeatedConcepts =
      (subjectConceptCounts[subjectForQuestion] || 0) <
      (subjectPlanCounts[subjectForQuestion] || 0);
    let q = null;
    let attempts = 0;
    const attemptedTemplateIds = new Set();
    const attemptedTemplateFamilies = new Set();
    if (type === "trueFalse") {
      getExcludedTfFamilies().forEach((family) => attemptedTemplateFamilies.add(family));
    }
    const attemptedConceptIds = new Set();

    const maxAttempts =
      type === "fillBlank" ? MAX_GENERATION_ATTEMPTS + EXTRA_FILLBLANK_ATTEMPTS : MAX_GENERATION_ATTEMPTS;
    while (!q && attempts < maxAttempts) {
      recordAttempt(type);
      const concept = pickNextConcept({
        concepts: subjectConcepts,
        startIndex: i + attempts,
        attemptedConceptIds,
      });
      if (!concept) {
        attempts += 1;
        continue;
      }
      if (!allowRepeatedConcepts && usedConceptIds.has(concept.id)) {
        attempts += 1;
        continue;
      }
      if (type === "trueFalse" && usedTfConceptIds.has(concept.id)) {
        attempts += 1;
        continue;
      }
      attemptedConceptIds.add(concept.id);
      const grounding = pickEvidenceForConcept(
        concept,
        sentenceMap,
        type === "trueFalse" || type === "fillBlank"
          ? { sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text) }
          : {}
      );
      if ((type === "trueFalse" || type === "fillBlank") && !grounding) {
        attempts += 1;
        continue;
      }
      const sentenceText = grounding?.evidenceSnippets?.[0] || "";
      const primarySentenceId = grounding?.sourceSentenceIds?.[0];
      const sectionId = primarySentenceId ? sentenceIdToSectionId.get(primarySentenceId) : null;
      const sectionTitle = sectionId ? sectionTitleMap.get(sectionId) : "";
      const mathCategory =
        subjectForQuestion === "math"
          ? inferMathCategory({ concept, sectionTitle, sentenceText })
          : null;
      const remainingSlots = planWithSubjects.length - questions.length;
      const blockedTemplateIds = new Set(attemptedTemplateIds);
      if (type === "fillBlank") {
        Object.entries(templateFailures).forEach(([templateId, count]) => {
          if (count >= MAX_FILLBLANK_TEMPLATE_FAILURES) {
            blockedTemplateIds.add(templateId);
          }
        });
      }
      const template = pickTemplate({
        type,
        sentenceText,
        concept,
        sectionTitle,
        subjectCategory: subjectForQuestion,
        mathCategory,
        includeFallbackTemplates: false,
        rng,
        state: templateState,
        remainingSlots,
        excludeTemplateIds: blockedTemplateIds,
        excludeFamilies: attemptedTemplateFamilies.size ? attemptedTemplateFamilies : null,
      });
      if (template?.id) {
        attemptedTemplateIds.add(template.id);
      }
      if (template?.family) {
        attemptedTemplateFamilies.add(template.family);
      }

      if (type === "mcq") {
        q = buildMcq({
          concept,
          concepts: subjectConcepts,
          sentenceMap,
          difficulty,
          template,
          subjectCategory: subjectForQuestion,
          mathCategory,
          seedSalt: `${resolvedSeed}|${i}`,
          sentenceIdToSectionId,
          sectionSentenceIdsMap,
          sectionTokenSets,
          sectionTitleMap,
        });
      } else if (type === "trueFalse") {
        q = buildTrueFalse({
          concept,
          concepts: subjectConcepts,
          sentenceMap,
          difficulty,
          index: i,
          template,
          seedSalt: `${resolvedSeed}|${i}`,
          subjectCategory: subjectForQuestion,
          mathCategory,
          sentenceIdToSectionId,
        });
      } else if (type === "shortAnswer") {
        q = buildShortAnswer({
          concept,
          sentenceMap,
          difficulty,
          stopwords: DEFAULT_STOPWORDS,
          template,
          seedSalt: `${resolvedSeed}|${i}`,
          subjectCategory: subjectForQuestion,
        });
      } else if (type === "fillBlank") {
        q = buildFillBlank({
          concept,
          sentenceMap,
          difficulty,
          template,
          seedSalt: `${resolvedSeed}|${i}`,
          subjectCategory: subjectForQuestion,
        });
      }

      if (!q) {
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      if (hasBannedStem(q.prompt)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const promptStem = extractPromptStem(q.prompt);
      if (promptStem && usedStems.has(promptStem)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }
      if (/which term matches/i.test(String(q.prompt || "")) && termMatchesStemCount >= 1) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const conceptTemplateKey = `${q.topicConceptId}|${q.meta?.templateId || "none"}`;
      if (templateState.usedConceptTemplate.has(conceptTemplateKey)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      if (isPromptTooSimilar(q.prompt, templateState.promptTokenSets, DEFAULT_STOPWORDS)) {
        q = null;
        recordTemplateFailure(template);
        attempts += 1;
        continue;
      }

      const validation = validateQuestion({
        question: q,
        sentenceIdSet,
        tokenSet,
        stopwords: DEFAULT_STOPWORDS,
        sentenceIdToSectionId,
        sectionTokenSets,
        sectionTitleMap,
        subjectCategory: subjectForQuestion,
        strictTypes,
      });
      if (!Array.isArray(validation)) {
        recordValidationFailures(type, [validation.reason || "missing-allowedTokens"]);
        recordMcqCandidateFailure(q, [validation.reason || "missing-allowedTokens"]);
        recordTemplateFailure(template);
        q = null;
        attempts += 1;
        continue;
      }
      const issues = validation;
      if (issues.length) {
        let hasIssues = issues.length;
        recordValidationFailures(type, issues);
        const hasPromptSanity = issues.some((issue) => issue.startsWith("Prompt "));
        if (hasPromptSanity) {
          const rewritten = rewritePromptForSanity({
            question: q,
            concept,
            sentenceText,
            category: q.meta?.category,
            sectionTitle,
            subjectCategory: subjectForQuestion,
            rng,
          });
          if (rewritten) {
            const rewriteValidation = validateQuestion({
              question: rewritten,
              sentenceIdSet,
              tokenSet,
              stopwords: DEFAULT_STOPWORDS,
              sentenceIdToSectionId,
              sectionTokenSets,
              sectionTitleMap,
              subjectCategory: subjectForQuestion,
              strictTypes,
            });
            if (Array.isArray(rewriteValidation) && rewriteValidation.length === 0) {
              q = rewritten;
              hasIssues = 0;
            }
          }
        }
        if (type === "trueFalse" && shouldRewriteTrueFalse(issues)) {
          for (let rewriteAttempt = 0; rewriteAttempt < MAX_TF_REWRITE_ATTEMPTS; rewriteAttempt += 1) {
            const rewritten = rewriteTrueFalseQuestion({
              question: q,
              concept,
              concepts: subjectConcepts,
              sentenceIdToSectionId,
              subjectCategory: subjectForQuestion,
              attempt: rewriteAttempt,
            });
            if (!rewritten) {
              continue;
            }
            const rewriteValidation = validateQuestion({
              question: rewritten,
              sentenceIdSet,
              tokenSet,
              stopwords: DEFAULT_STOPWORDS,
              sentenceIdToSectionId,
              sectionTokenSets,
              sectionTitleMap,
              subjectCategory: subjectForQuestion,
              strictTypes,
            });
            if (Array.isArray(rewriteValidation) && rewriteValidation.length === 0) {
              q = rewritten;
              hasIssues = 0;
              break;
            }
          }
        }
        if (hasIssues && type === "trueFalse" && tfCandidateFailures.length < 10) {
          tfCandidateFailures.push({
            templateId: q.meta?.templateId || null,
            prompt: q.prompt,
            statement: extractTrueFalseStatement(q.prompt),
            issues,
          });
        }
        if (hasIssues) {
          recordMcqCandidateFailure(q, issues);
          recordTemplateFailure(template);
          q = null;
          attempts += 1;
          continue;
        }
      }

      templateState.usedConceptTemplate.add(conceptTemplateKey);
      templateState.promptTokenSets.push(normalizePromptTokens(q.prompt, DEFAULT_STOPWORDS));
      recordTemplateUse(templateState, template || TEMPLATE_BY_ID.get(q.meta?.templateId), q.type);
      questions.push(q);
      usedConceptIds.add(concept.id);
      if (q.type === "trueFalse") {
        usedTfConceptIds.add(concept.id);
      }
      if (promptStem) {
        usedStems.add(promptStem);
      }
      if (/which term matches/i.test(String(q.prompt || ""))) {
        termMatchesStemCount += 1;
      }
    }

    if (!q) {
      const fallbackTemplate =
        type === "mcq"
          ? subjectForQuestion === "math"
            ? TEMPLATE_BY_ID.get("mcq_math_definition_fallback")
            : TEMPLATE_BY_ID.get("mcq_statement_correct")
          : type === "trueFalse"
            ? subjectForQuestion === "math"
              ? TEMPLATE_BY_ID.get("tf_math_fallback_safe")
              : TEMPLATE_BY_ID.get("tf_paraphrase")
            : null;
      const fallbackMax =
        type === "fillBlank" ? MAX_FILLBLANK_COMPLETION_ATTEMPTS : subjectForQuestion === "math" ? 6 : 3;
      let fallbackAttempts = 0;
      const fallbackConceptIds = new Set();
      while (!q && fallbackAttempts < fallbackMax) {
        recordAttempt(type);
        const fallbackConcept = pickNextConcept({
          concepts: subjectConcepts,
          startIndex: i + fallbackAttempts + 1,
          attemptedConceptIds: fallbackConceptIds,
        });
        if (!fallbackConcept) {
          fallbackAttempts += 1;
          continue;
        }
        if (!allowRepeatedConcepts && usedConceptIds.has(fallbackConcept.id)) {
          fallbackAttempts += 1;
          continue;
        }
        if (type === "trueFalse" && usedTfConceptIds.has(fallbackConcept.id)) {
          fallbackAttempts += 1;
          continue;
        }
        fallbackConceptIds.add(fallbackConcept.id);
        if (type === "mcq") {
          q = buildMcq({
            concept: fallbackConcept,
            concepts: subjectConcepts,
            sentenceMap,
            difficulty,
            template: fallbackTemplate,
            subjectCategory: subjectForQuestion,
            mathCategory:
              subjectForQuestion === "math"
                ? inferMathCategory({
                    concept: fallbackConcept,
                    sectionTitle: sectionTitleMap.get(
                      getConceptSectionId(fallbackConcept, sentenceIdToSectionId)
                    ) || "",
                    sentenceText: pickEvidenceForConcept(fallbackConcept, sentenceMap)
                      ?.evidenceSnippets?.[0],
                  })
                : null,
            seedSalt: `${resolvedSeed}|${i}|fallback${fallbackAttempts}`,
            sentenceIdToSectionId,
            sectionSentenceIdsMap,
            sectionTokenSets,
            sectionTitleMap,
          });
        } else if (type === "trueFalse") {
          if (subjectForQuestion === "math") {
            q = buildTrueFalseFallbackSafe({
              concept: fallbackConcept,
              sentenceMap,
              difficulty,
              index: i,
              seedSalt: `${resolvedSeed}|${i}|fallback${fallbackAttempts}`,
              subjectCategory: subjectForQuestion,
            });
          } else {
            q = buildTrueFalse({
              concept: fallbackConcept,
              concepts: subjectConcepts,
              sentenceMap,
              difficulty,
              index: i,
              template: fallbackTemplate,
              seedSalt: `${resolvedSeed}|${i}|fallback${fallbackAttempts}`,
              subjectCategory: subjectForQuestion,
              sentenceIdToSectionId,
            });
          }
        } else if (type === "shortAnswer") {
          q = buildShortAnswer({
            concept: fallbackConcept,
            sentenceMap,
            difficulty,
            stopwords: DEFAULT_STOPWORDS,
            template: fallbackTemplate,
            seedSalt: `${resolvedSeed}|${i}|fallback${fallbackAttempts}`,
            subjectCategory: subjectForQuestion,
          });
        } else if (type === "fillBlank") {
          q = buildFillBlank({
            concept: fallbackConcept,
            sentenceMap,
            difficulty,
            template: fallbackTemplate,
            seedSalt: `${resolvedSeed}|${i}|fallback${fallbackAttempts}`,
            subjectCategory: subjectForQuestion,
          });
        }

        if (!q) {
          recordTemplateFailure(fallbackTemplate);
          fallbackAttempts += 1;
          continue;
        }

        const fallbackStem = extractPromptStem(q.prompt);
        if (fallbackStem && usedStems.has(fallbackStem)) {
          q = null;
          recordTemplateFailure(fallbackTemplate);
          fallbackAttempts += 1;
          continue;
        }
        if (/which term matches/i.test(String(q.prompt || "")) && termMatchesStemCount >= 1) {
          q = null;
          recordTemplateFailure(fallbackTemplate);
          fallbackAttempts += 1;
          continue;
        }

        const fallbackValidation = validateQuestion({
          question: q,
          sentenceIdSet,
          tokenSet,
          stopwords: DEFAULT_STOPWORDS,
          sentenceIdToSectionId,
          sectionTokenSets,
          sectionTitleMap,
          subjectCategory: subjectForQuestion,
          strictTypes,
        });
        if (!Array.isArray(fallbackValidation)) {
          recordValidationFailures(type, [fallbackValidation.reason || "missing-allowedTokens"]);
          recordMcqCandidateFailure(q, [fallbackValidation.reason || "missing-allowedTokens"]);
          recordTemplateFailure(fallbackTemplate);
          q = null;
          fallbackAttempts += 1;
          continue;
        }
        const fallbackIssues = fallbackValidation;
        if (fallbackIssues.length) {
          let hasIssues = fallbackIssues.length;
          recordValidationFailures(type, fallbackIssues);
          if (type === "trueFalse" && shouldRewriteTrueFalse(fallbackIssues)) {
            for (let rewriteAttempt = 0; rewriteAttempt < MAX_TF_REWRITE_ATTEMPTS; rewriteAttempt += 1) {
              const rewritten = rewriteTrueFalseQuestion({
                question: q,
                concept: fallbackConcept,
                concepts: subjectConcepts,
                sentenceIdToSectionId,
                subjectCategory: subjectForQuestion,
                attempt: rewriteAttempt,
              });
              if (!rewritten) {
                continue;
              }
              const rewriteValidation = validateQuestion({
                question: rewritten,
                sentenceIdSet,
                tokenSet,
                stopwords: DEFAULT_STOPWORDS,
                sentenceIdToSectionId,
                sectionTokenSets,
                sectionTitleMap,
                subjectCategory: subjectForQuestion,
                strictTypes,
              });
              if (Array.isArray(rewriteValidation) && rewriteValidation.length === 0) {
                q = rewritten;
                hasIssues = 0;
                break;
              }
            }
          }
          if (hasIssues && type === "trueFalse" && tfCandidateFailures.length < 10) {
            tfCandidateFailures.push({
              templateId: q.meta?.templateId || null,
              prompt: q.prompt,
              statement: extractTrueFalseStatement(q.prompt),
              issues: fallbackIssues,
            });
          }
          if (hasIssues) {
            recordMcqCandidateFailure(q, fallbackIssues);
            recordTemplateFailure(fallbackTemplate);
            flagged.push({ questionId: q.id, issues: fallbackIssues });
            q = null;
          }
        }
        if (q) {
          const fallbackKey = `${q.topicConceptId}|${q.meta?.templateId || "none"}`;
          templateState.usedConceptTemplate.add(fallbackKey);
          templateState.promptTokenSets.push(normalizePromptTokens(q.prompt, DEFAULT_STOPWORDS));
          recordTemplateUse(
            templateState,
            fallbackTemplate || TEMPLATE_BY_ID.get(q.meta?.templateId),
            q.type
          );
          questions.push(q);
          usedConceptIds.add(fallbackConcept.id);
          if (q.type === "trueFalse") {
            usedTfConceptIds.add(fallbackConcept.id);
          }
          if (fallbackStem) {
            usedStems.add(fallbackStem);
          }
          if (/which term matches/i.test(String(q.prompt || ""))) {
            termMatchesStemCount += 1;
          }
        }

        fallbackAttempts += 1;
      }
    }
  }

  const fillBlankNeeded = Math.max(
    0,
    (resolvedConfig?.types?.fillBlank || 0) - questions.filter((q) => q.type === "fillBlank").length
  );
  if (fillBlankNeeded > 0) {
    for (let i = 0; i < fillBlankNeeded; i += 1) {
      let q = null;
      let attempts = 0;
      const attemptedTemplateIds = new Set();
      const attemptedConceptIds = new Set();

      while (!q && attempts < MAX_FILLBLANK_COMPLETION_ATTEMPTS) {
        recordAttempt("fillBlank");
        const concept = pickNextConcept({
          concepts,
          startIndex: questions.length + i + attempts,
          attemptedConceptIds,
        });
        if (!concept) {
          attempts += 1;
          continue;
        }
        if (!allowGlobalRepeats && usedConceptIds.has(concept.id)) {
          attempts += 1;
          continue;
        }
        attemptedConceptIds.add(concept.id);
        const grounding = pickEvidenceForConcept(concept, sentenceMap, {
          sentenceFilter: (sentence) => isValidTfFbSentence(sentence.text),
        });
        if (!grounding) {
          attempts += 1;
          continue;
        }
        const sentenceText = grounding.evidenceSnippets?.[0] || "";
        const primarySentenceId = grounding?.sourceSentenceIds?.[0];
        const sectionId = primarySentenceId ? sentenceIdToSectionId.get(primarySentenceId) : null;
        const sectionTitle = sectionId ? sectionTitleMap.get(sectionId) : "";
        const subjectFromPlan =
          subjectPlanSubjects.length
            ? normalizeSubjectKey(
                subjectPlanSubjects[(questions.length + i + attempts) % subjectPlanSubjects.length]
              )
            : null;
        const subjectForCompletion = subjectFromPlan || fallbackSubjectKey;
        const mathCategory =
          subjectForCompletion === "math"
            ? inferMathCategory({ concept, sectionTitle, sentenceText })
            : null;
        const remainingSlots = fillBlankNeeded - i;
        const blockedTemplateIds = new Set(attemptedTemplateIds);
        Object.entries(templateFailures).forEach(([templateId, count]) => {
          if (count >= MAX_FILLBLANK_TEMPLATE_FAILURES) {
            blockedTemplateIds.add(templateId);
          }
        });
        const template = pickTemplate({
          type: "fillBlank",
          sentenceText,
          concept,
          sectionTitle,
          subjectCategory: subjectForCompletion,
          mathCategory,
          includeFallbackTemplates: false,
          rng,
          state: templateState,
          remainingSlots,
          excludeTemplateIds: blockedTemplateIds,
          excludeFamilies: null,
        });
        if (template?.id) {
          attemptedTemplateIds.add(template.id);
        }

        q = buildFillBlank({
          concept,
          sentenceMap,
          difficulty,
          template,
          seedSalt: `${resolvedSeed}|fillBlankCompletion|${i}|${attempts}`,
          subjectCategory: subjectForCompletion,
        });
        if (!q) {
          recordTemplateFailure(template);
          attempts += 1;
          continue;
        }

        const completionStem = extractPromptStem(q.prompt);
        if (completionStem && usedStems.has(completionStem)) {
          q = null;
          recordTemplateFailure(template);
          attempts += 1;
          continue;
        }
        if (/which term matches/i.test(String(q.prompt || "")) && termMatchesStemCount >= 1) {
          q = null;
          recordTemplateFailure(template);
          attempts += 1;
          continue;
        }

        if (isPromptTooSimilar(q.prompt, templateState.promptTokenSets, DEFAULT_STOPWORDS)) {
          q = null;
          recordTemplateFailure(template);
          attempts += 1;
          continue;
        }

        const validation = validateQuestion({
          question: q,
          sentenceIdSet,
          tokenSet,
          stopwords: DEFAULT_STOPWORDS,
          sentenceIdToSectionId,
          sectionTokenSets,
          sectionTitleMap,
          subjectCategory: subjectForCompletion,
          relaxFillBlank: true,
          strictTypes,
        });
        if (!Array.isArray(validation)) {
          recordValidationFailures("fillBlank", [validation.reason || "missing-allowedTokens"]);
          recordFillBlankCandidateFailure({
            question: q,
            issues: [validation.reason || "missing-allowedTokens"],
            evidenceSnippet: sentenceText,
            templateId: template?.id || null,
          });
          recordTemplateFailure(template);
          q = null;
          attempts += 1;
          continue;
        }
        const issues = validation;
        if (issues.length) {
          recordValidationFailures("fillBlank", issues);
          recordFillBlankCandidateFailure({
            question: q,
            issues,
            evidenceSnippet: sentenceText,
            templateId: template?.id || null,
          });
          recordTemplateFailure(template);
          q = null;
          attempts += 1;
          continue;
        }

        const conceptTemplateKey = `${q.topicConceptId}|${q.meta?.templateId || "none"}`;
        templateState.usedConceptTemplate.add(conceptTemplateKey);
        templateState.promptTokenSets.push(normalizePromptTokens(q.prompt, DEFAULT_STOPWORDS));
        recordTemplateUse(templateState, template || TEMPLATE_BY_ID.get(q.meta?.templateId), q.type);
        questions.push(q);
        usedConceptIds.add(concept.id);
        if (completionStem) {
          usedStems.add(completionStem);
        }
        if (/which term matches/i.test(String(q.prompt || ""))) {
          termMatchesStemCount += 1;
        }
      }
    }
  }

  const mcqNeeded = Math.max(
    0,
    (resolvedConfig?.types?.mcq || 0) - questions.filter((q) => q.type === "mcq").length
  );
  if (mcqNeeded > 0) {
    const usedSentenceIds = new Set();
    questions.forEach((q) => {
      (q?.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
    });
    for (let i = 0; i < mcqNeeded; i += 1) {
      let q = null;
      let attempts = 0;
      let subjectForQuestion = fallbackSubjectKey;
      while (!q && attempts < MAX_MCQ_COMPLETION_ATTEMPTS) {
        subjectForQuestion =
          subjectPlanSubjects.length
            ? normalizeSubjectKey(
                subjectPlanSubjects[(questions.length + i + attempts) % subjectPlanSubjects.length]
              )
            : fallbackSubjectKey;
        const familySequence = getMcqFamilySequence(subjectForQuestion);
        const family = familySequence.length ? familySequence[attempts % familySequence.length] : null;
        const includeFamilies = family ? new Set([family]) : null;
        const forceScenarioPrompt = family === "scenario-application";
        q = buildQuestionCandidate({
          type: "mcq",
          subjectForQuestion,
          startIndex: questions.length + i + attempts,
          includeFamilies,
          forceScenarioPrompt,
          relaxMcqOverlap: true,
        });
        attempts += 1;
      }
      if (!q) {
        if (allowDeterministicFallbacks) {
          q = buildDeterministicScenarioMcqFallback({
            sentences,
            subjectCategory: subjectForQuestion,
            seedSalt: `${resolvedSeed}|mcqCompletionFallback|${i}`,
            usedSentenceIds,
            startIndex: questions.length + i,
          });
        }
      }
      if (q) {
        questions.push(q);
      }
    }
  }

  const computeScenarioShare = (questionPool) => {
    const questionsSnapshot = questionPool.filter((q) => q && q.type === "mcq");
    const countedFamilies = {};
    let appliedCount = 0;
    questionsSnapshot.forEach((q) => {
      const family = q.meta?.templateFamily;
      if (family && MCQ_SCENARIO_FAMILIES.has(family)) {
        appliedCount += 1;
        countedFamilies[family] = (countedFamilies[family] || 0) + 1;
      }
    });
    const totalMcq = questionsSnapshot.length;
    const plannedMcq = resolvedConfig?.types?.mcq || 0;
    const requiredApplied = strictTypes
      ? Math.ceil(Math.max(totalMcq, plannedMcq) * 0.5)
      : Math.ceil(totalMcq * 0.5);
    const deficit = Math.max(0, requiredApplied - appliedCount);
    return {
      totalMcq,
      requiredApplied,
      appliedCount,
      deficit,
      countedFamilies,
    };
  };

  const enforceScenarioMcqShare = () => {
    const initialShare = computeScenarioShare(questions);
    if (initialShare.deficit <= 0) {
      return initialShare;
    }
    let deficit = initialShare.deficit;
    const generatedFamilies = {};
    const usedSentenceIds = new Set();
    questions.forEach((q) => {
      (q?.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
    });
    const candidateIndexes = questions
      .map((q, idx) => ({ q, idx }))
      .filter((entry) => entry.q?.type === "mcq" && !isScenarioFamilyMcq(entry.q))
      .map((entry) => entry.idx);
    for (const index of candidateIndexes) {
      if (deficit <= 0) {
        break;
      }
      const existing = questions[index];
      if (!existing) {
        continue;
      }
      const subjectForQuestion =
        normalizeSubjectKey(existing.meta?.subjectCategory) || fallbackSubjectKey;
      questions[index] = null;
      rebuildUsageState();
      const scenarioFamilies =
        getScenarioFamiliesForSubject(subjectForQuestion) || MCQ_SCENARIO_FAMILIES;
      const replacement = buildQuestionCandidate({
        type: "mcq",
        subjectForQuestion,
        startIndex: index + questions.length,
        includeFamilies: scenarioFamilies,
        forceScenarioPrompt: true,
        relaxMcqOverlap: true,
        preferredFamilies: new Set(scenarioFamilies),
      });
      const fallbackReplacement =
        !replacement && allowDeterministicFallbacks
          ? buildDeterministicScenarioMcqFallback({
              sentences,
              subjectCategory: subjectForQuestion,
              seedSalt: `${resolvedSeed}|scenarioRepairFallback|${index}`,
              usedSentenceIds,
              startIndex: index,
            })
          : null;
      questions[index] = replacement || fallbackReplacement || existing;
      rebuildUsageState();
      const finalReplacement = questions[index];
      if (finalReplacement && isScenarioFamilyMcq(finalReplacement)) {
        deficit -= 1;
        const family = finalReplacement.meta?.templateFamily;
        if (family) {
          generatedFamilies[family] = (generatedFamilies[family] || 0) + 1;
        }
      }
    }
    const finalShare = computeScenarioShare(questions);
    return {
      ...finalShare,
      countedFamiliesBeforeRepair: initialShare.countedFamilies,
      generatedFamilies,
    };
  };

  const attemptStrictFill = ({ scenarioOnlyMcq = false } = {}) => {
    const missing = computeMissingCounts(resolvedConfig, questions);
    const totalMissing = Object.values(missing).reduce((sum, count) => sum + count, 0);
    if (!strictTypes || totalMissing === 0) {
      return;
    }
    const usedSentenceIds = new Set();
    questions.forEach((q) => {
      (q?.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
    });
    let offset = 0;
    Object.entries(missing).forEach(([type, count]) => {
      for (let i = 0; i < count; i += 1) {
        const subjectForQuestion =
          subjectPlanSubjects.length
            ? normalizeSubjectKey(subjectPlanSubjects[(offset + i) % subjectPlanSubjects.length])
            : fallbackSubjectKey;
        const startIndex = questions.length + offset + i;
        let extra = null;
        if (type === "mcq") {
          const scenarioFamilies =
            getScenarioFamiliesForSubject(subjectForQuestion) || MCQ_SCENARIO_FAMILIES;
          const scenarioPreferred = new Set(scenarioFamilies);
          const scenarioCandidate = buildQuestionCandidate({
            type: "mcq",
            subjectForQuestion,
            startIndex,
            includeFamilies: scenarioFamilies,
            forceScenarioPrompt: true,
            relaxMcqOverlap: true,
            preferredFamilies: scenarioPreferred,
          });
          if (scenarioCandidate) {
            extra = scenarioCandidate;
          } else if (!scenarioOnlyMcq) {
            const forceScenario = subjectForQuestion !== "english";
            extra =
              buildQuestionCandidate({
                type: "mcq",
                subjectForQuestion,
                startIndex,
                forceScenarioPrompt: forceScenario,
                relaxMcqOverlap: true,
                preferredFamilies: scenarioPreferred,
              }) ||
              buildQuestionCandidate({
                type: "mcq",
                subjectForQuestion,
                startIndex,
                relaxMcqOverlap: true,
                preferredFamilies: scenarioPreferred,
              });
          }
          if (!extra && allowDeterministicFallbacks) {
            extra = buildDeterministicScenarioMcqFallback({
              sentences,
              subjectCategory: subjectForQuestion,
              seedSalt: `${resolvedSeed}|strictFillMcqFallback|${startIndex}`,
              usedSentenceIds,
              startIndex,
            });
          }
        } else {
          extra = buildQuestionCandidate({
            type,
            subjectForQuestion,
            startIndex,
          });
        }
        if (extra) {
          questions.push(extra);
        }
      }
      offset += count;
    });
  };

  const runDeterministicFillBlankFallback = () => {
    if (!strictTypes || !allowDeterministicFallbacks) {
      return;
    }
    const missing = computeMissingCounts(resolvedConfig, questions);
    const needed = missing.fillBlank || 0;
    if (needed <= 0) {
      return;
    }
    const usedSentenceIds = new Set();
    questions
      .filter((q) => q.type === "fillBlank")
      .forEach((q) => {
        (q.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
      });
    const fallbackQuestions = [];
    const seedSalt = `${resolvedSeed}|fillBlankFallback`;
    const tryBuildFallbacks = (relaxContext) => {
      for (const sentence of sentences) {
        if (fallbackQuestions.length >= needed) {
          break;
        }
        if (!relaxContext && usedSentenceIds.has(sentence.id)) {
          continue;
        }
        if (countWords(sentence.text) < 6) {
          continue;
        }
        const fallback = buildFillBlankFallbackFromSentence({
          sentence,
          difficulty,
          seedSalt: `${seedSalt}|${fallbackQuestions.length}|${relaxContext ? "relaxed" : "strict"}`,
          subjectCategory,
          stopwords: DEFAULT_STOPWORDS,
          relaxContext,
        });
        if (fallback) {
          fallbackQuestions.push(fallback);
          usedSentenceIds.add(sentence.id);
          continue;
        }
        const ultra = buildFillBlankUltraFallbackFromSentence({
          sentence,
          seedSalt: `${seedSalt}|ultra|${fallbackQuestions.length}`,
          subjectCategory,
        });
        if (ultra) {
          fallbackQuestions.push(ultra);
          usedSentenceIds.add(sentence.id);
        }
      }
    };
    tryBuildFallbacks(false);
    if (fallbackQuestions.length < needed) {
      tryBuildFallbacks(true);
    }
    fallbackQuestions.forEach((fallback) => questions.push(fallback));
  };

  const runDeterministicTrueFalseFallback = () => {
    if (!strictTypes) {
      return;
    }
    const missing = computeMissingCounts(resolvedConfig, questions);
    const needed = missing.trueFalse || 0;
    if (needed <= 0) {
      return;
    }
    const usedSentenceIds = new Set();
    questions.forEach((q) => {
      (q?.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
    });
    for (let i = 0; i < needed; i += 1) {
      let fallback = buildDeterministicTrueFalseFallback({
        sentences,
        subjectCategory,
        seedSalt: `${resolvedSeed}|tfFallback|${i}`,
        usedSentenceIds,
        startIndex: questions.length + i,
      });
      if (!fallback) {
        fallback = buildDeterministicTrueFalseFallback({
          sentences,
          subjectCategory,
          seedSalt: `${resolvedSeed}|tfFallbackReuse|${i}`,
          usedSentenceIds: new Set(),
          startIndex: questions.length + i,
        });
      }
      if (fallback) {
        questions.push(fallback);
      }
    }
  };

  const preStrictScenarioShare = computeScenarioShare(questions);
  const scenarioOnlyMode = strictTypes && preStrictScenarioShare.deficit > 0;
  attemptStrictFill({ scenarioOnlyMcq: scenarioOnlyMode });

  runDeterministicFillBlankFallback();

  runDeterministicTrueFalseFallback();

  const scenarioShare = enforceScenarioMcqShare();

  const missingBeforeFill = computeMissingCounts(resolvedConfig, questions);
  const missingTotal = Object.values(missingBeforeFill).reduce((sum, count) => sum + count, 0);
  let distributionAdjustment = null;
  if (missingTotal > 0 && !strictTypes) {
    const mcqFamilies = getTemplatesForType("mcq")
      .map((template) => template.family)
      .filter(Boolean);
    const mcqNonScenarioFamilies = new Set(
      mcqFamilies.filter((family) => family !== "scenario-application")
    );
    const usedSentenceIds = new Set();
    questions.forEach((q) => {
      (q?.grounding?.sourceSentenceIds || []).forEach((id) => usedSentenceIds.add(id));
    });
    const fillCounts = {};
    for (let i = 0; i < missingTotal; i += 1) {
      const subjectForQuestion =
        subjectPlanSubjects.length
          ? normalizeSubjectKey(subjectPlanSubjects[i % subjectPlanSubjects.length])
          : fallbackSubjectKey;
      const startIndex = questions.length + i;
      let extra =
        buildQuestionCandidate({
          type: "mcq",
          subjectForQuestion,
          startIndex,
          excludeFamilies: mcqNonScenarioFamilies,
        }) ||
        buildQuestionCandidate({
          type: "shortAnswer",
          subjectForQuestion,
          startIndex,
        }) ||
        buildQuestionCandidate({
          type: "mcq",
          subjectForQuestion,
          startIndex,
        }) ||
        buildQuestionCandidate({
          type: "fillBlank",
          subjectForQuestion,
          startIndex,
        }) ||
        buildQuestionCandidate({
          type: "trueFalse",
          subjectForQuestion,
          startIndex,
        });
      if (!extra) {
        extra =
          buildDeterministicScenarioMcqFallback({
            sentences,
            subjectCategory: subjectForQuestion,
            seedSalt: `${resolvedSeed}|nonStrictFallback|mcq|${startIndex}`,
            usedSentenceIds,
            startIndex,
          }) ||
          buildDeterministicTrueFalseFallback({
            sentences,
            subjectCategory: subjectForQuestion,
            seedSalt: `${resolvedSeed}|nonStrictFallback|tf|${startIndex}`,
            usedSentenceIds,
            startIndex,
          }) ||
          (() => {
            const sentence = sentences[startIndex % sentences.length];
            return buildFillBlankUltraFallbackFromSentence({
              sentence,
              seedSalt: `${resolvedSeed}|nonStrictFallback|fb|${startIndex}`,
              subjectCategory: subjectForQuestion,
            });
          })();
      }
      if (!extra) {
        break;
      }
      questions.push(extra);
      fillCounts[extra.type] = (fillCounts[extra.type] || 0) + 1;
    }
    distributionAdjustment = {
      requested: resolvedConfig?.types || {},
      missing: missingBeforeFill,
      filledWith: fillCounts,
      actual: countQuestionTypes(questions),
    };
  }

  const repetitionCheck = collectRepetitionIssues(questions, {
    allowRepeatedConcepts: allowGlobalRepeats,
  });
  if (repetitionCheck.failingIndexes.length) {
    repetitionCheck.failingIndexes.forEach((index) => {
      const existing = questions[index];
      if (!existing) {
        return;
      }
      const subjectForQuestion =
        normalizeSubjectKey(existing.meta?.subjectCategory) || fallbackSubjectKey;
      const excludeFamilies = existing.meta?.templateFamily
        ? new Set([existing.meta.templateFamily])
        : new Set();
      questions[index] = null;
      rebuildUsageState();
      const replacement = buildQuestionCandidate({
        type: existing.type,
        subjectForQuestion,
        startIndex: index + questions.length,
        excludeFamilies,
      });
      questions[index] = replacement || existing;
      rebuildUsageState();
    });
  }

  const validateStartedAt = Date.now();

  const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const knowledgeSources = [];
  const knowledgeSourceSet = new Set();
  knowledgeChunks.forEach((chunk) => {
    const key = `${chunk.source}|${chunk.license}`;
    if (knowledgeSourceSet.has(key)) {
      return;
    }
    knowledgeSourceSet.add(key);
    knowledgeSources.push({ source: chunk.source, license: chunk.license });
  });

  const exam = {
    id: examId,
    apiVersion: API_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    createdAt: new Date().toISOString(),
    title: title || "Generated Exam",
    config: resolvedConfig,
    blueprint: blueprintBundle.blueprint,
    sourceText: blueprintBundle.sourceText,
    questions,
    totalPoints,
    quality: {
      groundedQuestionsCount: questions.filter((q) => q.grounding?.sourceSentenceIds?.length).length,
      flaggedQuestionsCount: flagged.length,
      flagged,
    },
    meta: {
      seed: blueprintBundle.seed,
      subjectCategory,
      subjects: subjectPlanSubjects.length ? subjectPlanSubjects : [fallbackSubjectKey],
      knowledgeSources,
      timingsMs: {
        extract: blueprintBundle.timingsMs.extract,
        generate: Date.now() - generationStartedAt,
        validate: Date.now() - validateStartedAt,
        total: Date.now() - startedAt,
      },
      distributionAdjustment: distributionAdjustment || undefined,
    },
  };

  const scenarioCandidateFailures = mcqCandidateFailures.filter((candidate) =>
    MCQ_SCENARIO_FAMILIES.has(candidate.templateFamily)
  );
  const exampleFailedCandidates =
    scenarioShare?.deficit > 0 && scenarioCandidateFailures.length
      ? scenarioCandidateFailures.slice(0, 5)
      : [...fillBlankCandidateFailures, ...mcqCandidateFailures].slice(0, 5);
  const missing = computeMissingCounts(resolvedConfig, questions);
  if (strictTypes && scenarioShare?.deficit > 0) {
    const error = new Error("Exam generation failed to meet scenario MCQ share.");
    error.statusCode = 422;
    error.code = "EXAM_GENERATION_FAILED";
    error.missing = missing;
    error.reason = "scenario-share";
    error.debug = {
      subjectCategory,
      attemptsByType,
      scenarioShare,
      lastErrorsByType: summarizeValidationFailures(validationFailureCountsByType),
      templateFailures,
      tfCandidateFailures,
      exampleFailedCandidates,
    };
    throw error;
  }
  if (!questions.length) {
    const error = new Error("Exam generation failed to produce any questions.");
    error.statusCode = 422;
    error.code = "EXAM_GENERATION_FAILED";
    error.missing = missing;
    error.reason = "validation-too-strict";
    error.debug = {
      subjectCategory,
      attemptsByType,
      lastErrorsByType: summarizeValidationFailures(validationFailureCountsByType),
      templateFailures,
      tfCandidateFailures,
      exampleFailedCandidates,
    };
    throw error;
  }
  if (strictTypes && Object.keys(missing).length) {
    const error = new Error("Exam generation failed to meet strict type quotas.");
    error.statusCode = 422;
    error.code = "EXAM_GENERATION_FAILED";
    error.missing = missing;
    error.reason = "strict-types";
    error.debug = {
      subjectCategory,
      attemptsByType,
      lastErrorsByType: summarizeValidationFailures(validationFailureCountsByType),
      templateFailures,
      tfCandidateFailures,
      exampleFailedCandidates,
    };
    throw error;
  }
  if (Object.keys(missing).length) {
    exam.meta.distributionAdjustment =
      exam.meta.distributionAdjustment || {
        requested: resolvedConfig?.types || {},
        missing,
        actual: countQuestionTypes(questions),
      };
  }
  if (!strictTypes && scenarioShare?.deficit > 0) {
    exam.meta.distributionAdjustment = exam.meta.distributionAdjustment || {};
    exam.meta.distributionAdjustment.scenarioShare = scenarioShare;
  }

  return exam;
};

module.exports = {
  API_VERSION,
  PIPELINE_VERSION,
  DEFAULT_STOPWORDS,
  splitIntoSentences,
  buildBlueprint,
  generateGroundedExam,
  validateQuestion,
  SCENARIO_WRAPPER_TOKENS,
  SCENARIO_EVIDENCE_TOKEN_RATIO_THRESHOLD,
  MAX_SCENARIO_WRAPPER_TOKENS,
  CHRONOLOGY_CONTEXT_REGEX,
  RELIABILITY_CRITERIA_REGEX,
  GOVERNMENT_FORM_REGEX,
};



















