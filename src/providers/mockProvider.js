const crypto = require("crypto");
const { createSummaryText, formatSummary } = require("../utils/summary");
const { POINTS_BY_TYPE } = require("../utils/exams");

const normalizeWords = (text) => {
  const words = text
    .toLowerCase()
    .match(/[a-z]{3,}/g);
  if (!words) {
    return ["concept", "study", "topic", "focus", "detail"];
  }
  const unique = [...new Set(words)];
  return unique.length >= 5 ? unique : unique.concat(["concept", "study", "topic"]);
};

const hashToUuid = (seed) => {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
    16,
    20
  )}-${hash.slice(20, 32)}`;
};

const SUBJECT_HEADING_PATTERNS = [
  { subject: "math", headings: ["mathematics", "math"] },
  { subject: "science", headings: ["science"] },
  { subject: "english", headings: ["english", "language arts", "ela"] },
  { subject: "geography", headings: ["geography"] },
  { subject: "history", headings: ["history", "social studies", "civics"] },
  { subject: "cs", headings: ["computer science", "ict", "information and communication technology"] },
];

const normalizeHeadingLine = (line) =>
  String(line || "")
    .replace(/[:\-–—]+$/g, "")
    .replace(/[^\w\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const detectSubjectsFromHeadings = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const subjects = [];
  lines.forEach((line) => {
    const normalized = normalizeHeadingLine(line);
    if (!normalized || normalized.length > 40) {
      return;
    }
    for (const entry of SUBJECT_HEADING_PATTERNS) {
      if (entry.headings.some((heading) => normalized === heading || normalized.startsWith(`${heading} `))) {
        subjects.push(entry.subject);
        break;
      }
    }
  });
  return [...new Set(subjects)];
};

const detectSubjectCategory = (text) => {
  const str = String(text || "");
  if (!str) {
    return "other";
  }
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
  return hits >= 2 ? "math" : "other";
};

const extractPromptStem = (prompt) =>
  String(prompt || "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

const buildSubjectPlan = (subjects, totalQuestions) => {
  const normalized = subjects.map((s) => String(s || "").toLowerCase()).filter(Boolean);
  if (!normalized.length) {
    return Array.from({ length: totalQuestions }, () => "other");
  }
  const unique = [...new Set(normalized)];
  const plan = [];
  let index = 0;
  while (plan.length < totalQuestions) {
    plan.push(unique[index % unique.length]);
    index += 1;
  }
  return plan;
};

const MCQ_TEMPLATES = {
  math: [
    { id: "math-solve-step", stem: "which step best solves", build: (topic) => `Which step best solves a problem involving ${topic}?` },
    { id: "math-apply-formula", stem: "which formula should be applied", build: (topic) => `Which formula should be applied to ${topic}?` },
    { id: "math-error-spotting", stem: "which option contains the error", build: (topic) => `Which option contains the error when applying ${topic}?` },
    { id: "math-property-classify", stem: "which property best classifies", build: (topic) => `Which property best classifies ${topic}?` },
  ],
  science: [
    { id: "science-cause", stem: "if a change occurs", build: (topic) => `If a change occurs in ${topic}, what happens next?` },
    { id: "science-function", stem: "what is the primary function", build: (topic) => `What is the primary function of ${topic}?` },
    { id: "science-classify", stem: "which option best classifies", build: (topic) => `Which option best classifies ${topic}?` },
    { id: "science-scenario", stem: "in this scenario", build: (topic) => `In this scenario, which idea best explains ${topic}?` },
  ],
  english: [
    { id: "english-grammar", stem: "which revision best corrects", build: (topic) => `Which revision best corrects the grammar in the sentence about ${topic}?` },
    { id: "english-device", stem: "which literary device best fits", build: (topic) => `Which literary device best fits the description of ${topic}?` },
    { id: "english-voice", stem: "which option uses active voice", build: (topic) => `Which option uses active voice to describe ${topic}?` },
    { id: "english-improve", stem: "which revision most improves", build: (topic) => `Which revision most improves clarity while preserving meaning about ${topic}?` },
  ],
  geography: [
    { id: "geo-scenario", stem: "a location with", build: (topic) => `A location with ${topic} is described. Which climate pattern fits best?` },
    { id: "geo-climate", stem: "which example best represents climate", build: (topic) => `Which example best represents climate (not weather) for ${topic}?` },
    { id: "geo-resource", stem: "which option best classifies the resource", build: (topic) => `Which option best classifies the resource in ${topic} as renewable or non-renewable?` },
  ],
  history: [
    { id: "history-primary", stem: "which source would be considered", build: (topic) => `Which source would be considered a primary source for ${topic}?` },
    { id: "history-cause", stem: "what is the most likely cause", build: (topic) => `What is the most likely cause or effect of ${topic}?` },
    { id: "history-rights", stem: "which option best distinguishes a right", build: (topic) => `Which option best distinguishes a right from a responsibility in ${topic}?` },
  ],
  cs: [
    { id: "cs-ipo", stem: "in an input process output", build: (topic) => `In an input-process-output flow for ${topic}, which step is processing?` },
    { id: "cs-hardware", stem: "which option is hardware", build: (topic) => `Which option is hardware (not software) for ${topic}?` },
    { id: "cs-algorithm", stem: "which algorithmic step best improves", build: (topic) => `Which algorithmic step best improves ${topic}?` },
    { id: "cs-data", stem: "which statement best distinguishes data", build: (topic) => `Which statement best distinguishes data from information in ${topic}?` },
  ],
  other: [
    { id: "general-concept", stem: "which option best applies", build: (topic) => `Which option best applies ${topic} to the scenario?` },
    { id: "general-cause", stem: "if a change occurs", build: (topic) => `If a change occurs in ${topic}, what happens next?` },
  ],
};

const TF_TEMPLATES = [
  { id: "tf-direct", stem: "true or false", build: (topic) => `True or False: ${topic} is central to the notes.` },
  { id: "tf-check", stem: "decide whether", build: (topic) => `Decide whether this statement is true or false: ${topic} is emphasized in the notes.` },
];

const SHORT_TEMPLATES = [
  { id: "sa-compare", stem: "compare how", build: (topic) => `Compare how ${topic} influences two ideas from the notes.` },
  { id: "sa-explain", stem: "explain how", build: (topic) => `Explain how ${topic} would appear in a real-world situation.` },
];

const FILL_TEMPLATES = [
  { id: "fb-statement", stem: "complete the statement", build: (topic) => `Complete the statement: The key process of ____ involves ${topic}.` },
  { id: "fb-missing", stem: "fill in the missing term", build: (topic) => `Fill in the missing term: ${topic} depends on ____.` },
];

const pickTemplate = (templates, usedStems, index) => {
  const ordered = [...templates];
  const start = index % ordered.length;
  for (let offset = 0; offset < ordered.length; offset += 1) {
    const candidate = ordered[(start + offset) % ordered.length];
    if (!usedStems.has(candidate.stem)) {
      return candidate;
    }
  }
  return ordered[start];
};

const pickUnusedTopic = (topics, usedSet, startIndex) => {
  if (!topics.length) {
    return "";
  }
  for (let offset = 0; offset < topics.length; offset += 1) {
    const candidate = topics[(startIndex + offset) % topics.length];
    if (!usedSet.has(candidate)) {
      return candidate;
    }
  }
  return topics[startIndex % topics.length];
};

const generateExam = async ({ text, title, config }) => {
  const keywords = normalizeWords(text);
  const seed = `${text}-${JSON.stringify(config)}-${title || ""}`;
  const titleText = title || `Exam on ${keywords[0][0].toUpperCase()}${keywords[0].slice(1)}`;

  const questions = [];
  const typeOrder = ["mcq", "trueFalse", "shortAnswer", "fillBlank"];
  let index = 0;
  const blueprint = keywords.slice(0, Math.min(6, keywords.length, config.questionCount));
  const detectedSubjects = detectSubjectsFromHeadings(text);
  const fallbackSubject = detectSubjectCategory(text);
  const subjects = detectedSubjects.length ? detectedSubjects : fallbackSubject ? [fallbackSubject] : ["other"];
  const subjectPlan = buildSubjectPlan(subjects, config.questionCount);
  const usedStems = new Set();
  const usedTrueFalseConcepts = new Set();
  typeOrder.forEach((type) => {
    const count = config.types[type];
    for (let i = 0; i < count; i += 1) {
      const id = hashToUuid(`${seed}-${type}-${index}`);
      const keyword = keywords[(index + i) % keywords.length];
      const topic = blueprint[index % blueprint.length] || keyword;
      const subject = subjectPlan[index % subjectPlan.length] || "other";
      if (type === "mcq") {
        const templates = MCQ_TEMPLATES[subject] || MCQ_TEMPLATES.other;
        const chosen = pickTemplate(templates, usedStems, index);
        const prompt = chosen.build(topic);
        const choices = Array.from({ length: 4 }, (_, choiceIndex) => {
          const word = keywords[(index + choiceIndex) % keywords.length];
          return `${word} concept`;
        });
        const answerKey = ["A", "B", "C", "D"][index % 4];
        usedStems.add(chosen.stem);
        questions.push({
          id,
          type,
          topic,
          bloomLevel: "L3",
          prompt,
          choices,
          answerKey,
          explanation: `The study notes emphasize applying "${keyword}" to real situations. The correct option aligns with that application.`,
          points: POINTS_BY_TYPE.mcq,
        });
      } else if (type === "trueFalse") {
        const tfTopic = pickUnusedTopic(blueprint, usedTrueFalseConcepts, index);
        const chosen = pickTemplate(TF_TEMPLATES, usedStems, index);
        const prompt = chosen.build(tfTopic);
        usedStems.add(chosen.stem);
        usedTrueFalseConcepts.add(tfTopic);
        const answerKeyBool = index % 2 === 0;
        questions.push({
          id,
          type,
          topic: tfTopic,
          bloomLevel: "L2",
          prompt,
          classification: "Concept",
          answerKeyBool,
          explanation: `This statement is ${answerKeyBool ? "true" : "false"} based on the source text. The relationship described shows how "${keyword}" relates to other ideas.`,
          points: POINTS_BY_TYPE.trueFalse,
        });
      } else if (type === "shortAnswer") {
        const related = keywords.slice(index % keywords.length, index % keywords.length + 3);
        const chosen = pickTemplate(SHORT_TEMPLATES, usedStems, index);
        const prompt = chosen.build(topic);
        usedStems.add(chosen.stem);
        questions.push({
          id,
          type,
          topic,
          bloomLevel: "L2",
          prompt,
          answerKeyText: related,
          explanation: `A strong response compares processes using keywords like ${related.join(", ")}.`,
          points: POINTS_BY_TYPE.shortAnswer,
        });
      } else if (type === "fillBlank") {
        const chosen = pickTemplate(FILL_TEMPLATES, usedStems, index);
        const prompt = chosen.build(topic);
        usedStems.add(chosen.stem);
        questions.push({
          id,
          type,
          topic,
          bloomLevel: "L2",
          prompt,
          answerKeyBlank: keyword,
          explanation: `The missing term is "${keyword}", which anchors the related process described.`,
          points: POINTS_BY_TYPE.fillBlank,
        });
      }
      index += 1;
    }
  });

  return {
    title: titleText,
    blueprint,
    questions,
  };
};
const { runMockTool } = require("../tools/mockExecutor");

const summarize = async ({ text, length, format }) => {
  const summaryText = createSummaryText({ text, length });
  return formatSummary({ summaryText, format });
};

const runTool = async (params) => {
  const result = runMockTool(params);
  const meta = {
    provider: "mock",
    model: "heuristic",
    ...result.meta,
  };
  return {
    output: result.output,
    highlights: result.highlights || [],
    meta,
  };
};

module.exports = {
  summarize,
  generateExam,
  runTool,
};
