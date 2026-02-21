const GOAL_HINTS = {
  grammar: "Correct grammar, punctuation, and basic clarity issues without rewriting entire sentences.",
  clarity: "Improve clarity and readability while keeping the author’s ideas unchanged.",
  formal: "Recast the text in a formal, professional tone without sounding stiff.",
  friendly: "Keep the tone warm and approachable while still being accurate.",
  concise: "Trim extra words and tighten phrasing while preserving facts.",
  academic: "Elevate the language to sound academic and precise while staying grounded in the original meaning.",
};

const TONE_HINTS = {
  neutral: "Use a neutral, balanced voice.",
  formal: "Use a formal, polished voice.",
  friendly: "Use a friendly, human voice with minor colloquial touches.",
  professional: "Use a professional, confident voice appropriate for business or academic audiences.",
};

const LEVEL_HINTS = {
  light: "Only fix the most obvious grammar and punctuation mistakes; avoid rephrasing.",
  standard: "Correct grammar, punctuation, and phrasing in a natural way while preserving structure.",
  strict: "Rewrite sentences aggressively to maximize correctness and clarity while safeguarding meaning.",
};

const formatMetaLine = ({ goal, dialect, tone, level }) => {
  return [
    `Goal: ${goal}. ${GOAL_HINTS[goal] || GOAL_HINTS.grammar}`,
    `Dialect: ${dialect} English.`,
    `Tone: ${tone}. ${TONE_HINTS[tone] || TONE_HINTS.neutral}`,
    `Level: ${level}. ${LEVEL_HINTS[level] || LEVEL_HINTS.standard}`,
  ].join(" ");
};

const describeMeaning = (preserveMeaning) =>
  preserveMeaning
    ? "Do not change the original meaning or add facts that were not present."
    : "You may adjust wording more freely, but avoid inventing new facts.";

const describeFormatting = (preserveFormatting) =>
  preserveFormatting
    ? "Preserve line breaks, bullets, and paragraph structure as much as possible."
    : "You may reflow the text and adjust paragraphs if it helps readability.";

const buildInternalPrompt = ({
  goal,
  dialect,
  tone,
  level,
  preserveMeaning,
  preserveFormatting,
  explainChanges,
  instructions,
  languageInstruction,
}) => {
  const lines = [
    "You are StudySummarize's Grammar Fixer. Your job is to correct grammar, punctuation, and readability while honoring the user's settings.",
    languageInstruction,
    formatMetaLine({ goal, dialect, tone, level }),
    describeMeaning(preserveMeaning),
    describeFormatting(preserveFormatting),
    "Do not add new metadata, headers, or commentary around the output.",
    explainChanges
      ? "Return a JSON object with `corrected` (string) and, when applicable, `explanations` (array of {type, before, after, reason})."
      : "Return a JSON object with only `corrected` (string).",
    instructions
      ? `When refining, apply this instruction: ${instructions}.`
      : "Focus on the provided text and goal without extra external instructions.",
    "Always keep the corrected text free of extra labels like “Corrected text:” or “Result:”.",
  ];
  return lines.filter(Boolean).join("\n");
};

const buildUserPrompt = ({ text, instructions, isRefine = false, languageInstruction }) => {
  const lines = ["User input:", text || "", ""];
  if (languageInstruction) {
    lines.push(`Language guidance: ${languageInstruction}`, "");
  }
  if (isRefine) {
    lines.push("This is a refinement pass on an already corrected draft.");
  }
  if (instructions) {
    lines.push(`Additional instruction: ${instructions}`);
  }
  lines.push(
    "",
    "Return the JSON object described in the system prompt.",
    "Do not include any explanations unless the system prompt explicitly asks for them."
  );
  return lines.join("\n");
};

module.exports = {
  buildInternalPrompt,
  buildUserPrompt,
};
