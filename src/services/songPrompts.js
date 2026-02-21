const buildInternalPrompt = ({
  genre,
  structure,
  length,
  mood,
  language,
  explicit,
  includeChords,
  includeTitleIdeas,
  rhymeScheme,
  syllablesPerLine,
  referenceArtists,
  instruction,
  languageInstruction,
}) => {
  const lines = [
    "You are StudySummarize's Song Generator. Compose original lyrics that feel modern, optimistic, and student-friendly.",
    languageInstruction,
    "Do not reuse copyrighted lyrics, do not mention or imitate named artists, and do not reference real songs.",
    `Genre: ${genre || "pop"}. Structure: ${structure || "verse-chorus"}. Length: ${length || "medium"}.`,
    `Mood: ${mood || "uplifting"}. Language: ${language || "English"}.`,
    "Use clear section headers exactly as [Verse 1], [Chorus], [Verse 2], and add [Bridge] only when the structure includes it.",
    "Keep each section vivid with natural language; avoid placeholder templates or filler phrases, and keep line counts consistent with the requested length (short ≈2 lines, medium ≈3 lines, long ≈4-5 lines per section).",
    "Chorus sections should be catchy and repeated verbatim whenever [Chorus] appears more than once; only change the chorus if a refine instruction explicitly asks for it.",
    explicit
      ? "Use expressive, candid language that may include mild adult coloring while staying school-friendly."
      : "Keep the language clean and appropriate for a general audience.",
    includeChords
      ? "Add a 'Chords: C G Am F' style chord line before every section when includeChords=true, using simple progressions."
      : null,
    includeTitleIdeas
      ? "Return 3–5 original title ideas under `titleIdeas` and pick the strongest main title."
      : null,
    rhymeScheme ? `Honor this rhyme pattern: ${rhymeScheme}.` : null,
    syllablesPerLine ? `Aim for about ${syllablesPerLine} syllables per line.` : null,
    referenceArtists?.length
      ? "Capture the vibe suggested by the reference artists without naming or mimicking them."
      : null,
    instruction ? `Refinement goal: ${instruction}.` : null,
    "Return clean JSON with keys: title (string), lyrics (string), and optionally titleIdeas (array of strings).",
  ]
    .filter(Boolean)
    .join("\n");
  return lines;
};

const buildUserPrompt = ({
  prompt,
  theme,
  genre,
  structure,
  mood,
  language,
  explicit,
  includeChords,
  includeTitleIdeas,
  rhymeScheme,
  syllablesPerLine,
  referenceArtists,
  previousOutput,
  instruction,
  languageInstruction,
}) => {
  const userTopic = (theme && theme.trim()) || prompt;
  const constraints = [
    `Prompt: ${userTopic}`,
    `Genre: ${genre || "pop"}`,
    `Structure: ${structure || "verse-chorus"}`,
    `Mood: ${mood || "uplifting"}`,
    `Language: ${language || "English"}`,
    `Explicit language allowed: ${explicit ? "yes" : "no"}`,
    `Include chords: ${includeChords ? "yes (add a 'Chords: <progression>' line before every section)" : "no"}`,
    `Include title ideas: ${includeTitleIdeas ? "yes (return 3–5 unique suggestions)" : "no"}`,
    `Length details: short ≈2 lines/section, medium ≈3 lines/section, long ≈4-5 lines/section.`,
    rhymeScheme ? `Rhyme scheme: ${rhymeScheme}` : null,
    syllablesPerLine ? `Syllables per line target: ~${syllablesPerLine}` : null,
    referenceArtists?.length
      ? `Reference artists: ${referenceArtists.join(", ")} (vibe only)`
      : null,
    instruction ? `Refinement focus: ${instruction}` : null,
    previousOutput ? "You are editing the existing lyrics below." : null,
    languageInstruction ? `Language guidance: ${languageInstruction}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "User topic:",
    userTopic,
    "",
    "Constraints:",
    constraints,
    "",
    previousOutput
      ? `Existing lyrics:\n${previousOutput}\nRevise them based on the constraints above.`
      : "Create the lyrics now using the constraints above.",
    "",
    "Return only the JSON object described in the internal instructions.",
  ];

  return lines.join("\n");
};

module.exports = {
  buildInternalPrompt,
  buildUserPrompt,
};
