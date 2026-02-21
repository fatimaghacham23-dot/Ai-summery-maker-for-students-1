const MODE_GUIDANCE = {
  essay:
    "Deliver an essay that starts with a standout title, includes a focused introduction, has three to five body sections with clear headings, and ends with a concise conclusion.",
  outline:
    "Return a nested bullet outline that surfaces the central ideas and supporting points with clear labels for each section.",
  paraphrase:
    "Rephrase the core ideas to preserve accuracy while removing repetitive wording and keeping the flow natural.",
  expand:
    "Expand on the notes by adding examples, context, and connective sentences that deepen understanding.",
  shorten:
    "Condense the key ideas, trimming redundant details while keeping accuracy intact.",
  explain:
    "Explain concepts in a teaching tone that could help a new learner grasp the core ideas.",
  flashcards:
    "Create clearly labeled flashcards (question + answer) that highlight the most important points.",
  email:
    "Draft a concise professional email with a subject, greeting, body, and closing that reflects the notes.",
  "cover-letter":
    "Compose a cover letter-style response linking the notes to qualifications and closing politely.",
  "notes-to-study-guide":
    "Transform the notes into a study guide with section headers, bullet summaries, and quick review cues.",
};

const LENGTH_HINTS = {
  short: "Short: ~1-2 paragraphs or 2-4 bullets.",
  medium: "Medium: ~3-4 paragraphs or 5-8 bullets.",
  long: "Long: Detailed response with supporting points and illustrative phrasing.",
};

const TONE_INSTRUCTIONS = {
  academic: "Use an academic, formal tone with precise language.",
  neutral: "Use a neutral, professional tone.",
  simple: "Use simple, clear language appropriate for beginners.",
  persuasive: "Use a persuasive, confident tone that highlights value.",
};

const LEVEL_LABELS = {
  high_school: "High school",
  bachelor: "Bachelor",
  master: "Master",
  phd: "PhD",
};

const CITATION_INSTRUCTIONS = {
  apa: "When citing sources, use inline APA-style citations (Author, Year).",
  mla: "When citing sources, use MLA-style citations.",
  chicago: "When citing sources, use Chicago author-date style.",
};

const REFINE_INSTRUCTIONS = {
  clarity: "Improve clarity, smooth transitions, and fix awkward phrasing.",
  academic: "Raise academic rigor, add precise terminology, and polish the tone.",
  structure: "Improve the structure by adding headings, ordered lists, or clearer sections.",
  concise: "Trim redundant language so the response stays focused.",
};

const formatKeywords = (keywords) => {
  if (!keywords || !keywords.length) {
    return "";
  }
  const filtered = keywords.map((kw) => String(kw || "").trim()).filter(Boolean);
  if (!filtered.length) {
    return "";
  }
  return `Keywords to include when relevant: ${filtered.join(", ")}.`;
};

const buildInternalPrompt = ({
  mode,
  tone,
  length,
  level,
  citationStyle,
  keywords,
  instruction,
  languageInstruction,
}) => {
  const lines = [
    "You are StudySummarize's Writer Studio assistant. Produce polished academic writing that follows the requested mode, tone, length, level, citation style, and keywords.",
    languageInstruction,
    "Do not invent statistics or fabricate references. When a citation style is requested but no sources are provided, insert [citation needed] in place of the missing reference and mention the limitation.",
    `Mode guidance: ${mode}. ${MODE_GUIDANCE[mode] || MODE_GUIDANCE.essay}`,
    `Length target: ${LENGTH_HINTS[length] || LENGTH_HINTS.medium}`,
    `Tone target: ${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.neutral}`,
    `Audience level: ${LEVEL_LABELS[level] || "Intermediate"}.`,
    citationStyle && citationStyle !== "none" ? CITATION_INSTRUCTIONS[citationStyle] : null,
    formatKeywords(keywords),
    instruction ? `Refine goal: ${REFINE_INSTRUCTIONS[instruction] || instruction}.` : null,
    "Use Markdown headings when helpful, include a title for essays, and never prepend metadata headers such as “Summary” or “Based on the provided notes”.",
    "Deliver only the final response text (title, headings, paragraphs, lists) without metadata, internal notes, or JSON wrappers.",
  ].filter(Boolean);
  return lines.join("\n");
};

const buildUserPrompt = ({
  text,
  mode,
  tone,
  length,
  level,
  citationStyle,
  keywords,
  previousOutput,
  instruction,
  languageInstruction,
}) => {
  const constraintLines = [
    `Mode: ${mode}. ${MODE_GUIDANCE[mode] || MODE_GUIDANCE.essay}`,
    `Tone: ${tone}. ${TONE_INSTRUCTIONS[tone] || ""}`,
    `Length: ${length}. ${LENGTH_HINTS[length] || ""}`,
    `Level: ${LEVEL_LABELS[level] || "Academic"}.`,
    citationStyle && citationStyle !== "none" ? `Citation style: ${citationStyle}. ${CITATION_INSTRUCTIONS[citationStyle]}` : null,
    keywords && keywords.length ? `Keywords: ${keywords.join(", ")}` : null,
    instruction ? `Refinement focus: ${REFINE_INSTRUCTIONS[instruction] || instruction}.` : null,
    languageInstruction ? `Language guidance: ${languageInstruction}` : null,
  ].filter(Boolean);

  const lines = ["User input:", text, "", "Constraints:", ...constraintLines];

  if (previousOutput) {
    lines.push("", "Existing draft:", previousOutput, "Revise it according to the constraints above.");
  } else {
    lines.push("", "Please craft the response now using the constraints above.");
  }

  lines.push("", "Provide the response as plain text or Markdown only.");

  return lines.join("\n");
};

module.exports = {
  buildInternalPrompt,
  buildUserPrompt,
};
