const DEFAULT_META = {
  provider: "mock",
  model: "mock-writer",
};

const capitalizeLabel = (value) => {
  if (!value) {
    return "Writer";
  }
  return value
    .split(/[-_ ]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const sanitizeTopic = (text) => {
  if (!text) {
    return "the topic";
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "the topic";
  }
  return cleaned.length <= 60 ? cleaned : `${cleaned.slice(0, 60).trim()}...`;
};

const buildEssaySections = (topic) => [
  {
    heading: "Foundations",
    body: `Define the central thesis and provide context around ${topic} so the reader understands why it matters.`,
  },
  {
    heading: "Evidence & Insights",
    body: `Present supporting ideas, examples, or data that illustrate the depth of ${topic}.`,
  },
  {
    heading: "Implications",
    body: `Discuss the consequences or broader implications that follow from ${topic}.`,
  },
];

const buildEssayOutput = ({ topic, tone, keywords, previousOutput, instruction }) => {
  const title = `Essay Title: Exploring ${topic}`;
  const intro = `Introduction\nThe following essay tackles ${topic} with a ${tone} tone, balancing clarity and academic depth.`;
  const sectionStrings = buildEssaySections(topic).map(
    (section) => `## ${section.heading}\n${section.body}`
  );
  const conclusion = [
    "Conclusion",
    `In summary, the prior sections reinforce the main argument about ${topic} and leave the reader ready to apply the ideas.`,
  ].join("\n");
  const keywordLine = keywords && keywords.length ? `Keywords: ${keywords.join(", ")}.` : null;
  const revisionLine = previousOutput
    ? `Revision note: Builds on the previous draft and follows the ${instruction || "requested refinements"}.`
    : null;

  return [
    title,
    "",
    intro,
    "",
    ...sectionStrings,
    "",
    conclusion,
    revisionLine,
    keywordLine,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildGeneralOutput = ({ mode, topic, tone, keywords, previousOutput, instruction }) => {
  const label = capitalizeLabel(mode);
  const opening = `${label} Response\nThis version explores ${topic} with a ${tone} tone and focuses on the ${instruction || "requested"} goal.`;
  const keywordLine = keywords && keywords.length ? `Keywords: ${keywords.join(", ")}.` : null;
  const previousLine = previousOutput ? "Revision note: Strengthens the prior draft while following the defined constraints." : null;
  return [opening, previousLine, keywordLine].filter(Boolean).join("\n\n");
};

const buildMockOutput = ({ mode, text, tone = "neutral", keywords = [], previousOutput, instruction }) => {
  const topic = sanitizeTopic(text);
  if (mode === "essay") {
    return buildEssayOutput({ topic, tone, keywords, previousOutput, instruction });
  }
  return buildGeneralOutput({ mode, topic, tone, keywords, previousOutput, instruction });
};

const generate = async (params) => {
  const output = buildMockOutput(params);
  return {
    output,
    meta: DEFAULT_META,
  };
};

const refine = async (params) => {
  const output = buildMockOutput({ ...params, previousOutput: params.previousOutput });
  return {
    output,
    meta: DEFAULT_META,
  };
};

module.exports = {
  generate,
  refine,
};
