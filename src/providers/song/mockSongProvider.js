const DEFAULT_META = {
  provider: "mock",
  model: "mock-song",
};

const ensureString = (value, fallback = "") => {
  if (!value) {
    return fallback;
  }
  return String(value).trim();
};

const sanitizePromptFocus = (text) => {
  const cleaned = ensureString(text, "new momentum");
  const normalized = cleaned.replace(/\\s+/g, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) {
    return "fresh momentum";
  }
  return tokens.slice(0, 4).join(" ");
};

const createSeededRandom = (seedInput) => {
  const base = ensureString(seedInput, "song");
  let seed = 0;
  for (let i = 0; i < base.length; i += 1) {
    seed = (seed * 31 + base.charCodeAt(i)) >>> 0;
  }
  if (seed === 0) {
    seed = 1;
  }
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
};

const pick = (items, random) => items[Math.floor(random() * items.length)];

const LENGTH_LINE_COUNT = {
  short: { chorus: 2, bridge: 2 },
  medium: { chorus: 3, bridge: 2 },
  long: { chorus: 4, bridge: 3 },
};

const PRE_CHORUS_LINE_COUNT = 2;
const MAX_LINE_WORDS = 12;

const trimLine = (line) =>
  line
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_LINE_WORDS)
    .join(" ");

const CHORUS_ENDINGS = ["tonight", "again", "for us", "alright"];

const STRUCTURE_MAP = {
  "verse-chorus": [
    { header: "[Verse 1]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
    { header: "[Verse 2]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
  ],
  "verse-chorus-bridge": [
    { header: "[Verse 1]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
    { header: "[Verse 2]", type: "verse" },
    { header: "[Bridge]", type: "bridge" },
    { header: "[Chorus]", type: "chorus" },
  ],
  story: [
    { header: "[Verse 1]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
    { header: "[Verse 2]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
  ],
  loop: [
    { header: "[Verse 1]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
  ],
  freeform: [
    { header: "[Verse 1]", type: "verse" },
    { header: "[Chorus]", type: "chorus" },
  ],
};

const SUBJECTS = {
  verse: ["We", "I", "Our crew", "You", "Our circle", "This room"],
  chorus: ["We", "All of us", "This crew", "Our voices", "Every heartbeat", "The room"],
  bridge: ["I", "We", "Our voices", "This moment", "This pause"],
  "pre-chorus": ["We", "You", "Our crew", "This room"],
  generic: ["We", "I", "This room"],
};

const VERBS = {
  verse: ["keep", "share", "ride", "feel", "carry", "hold", "stay", "trace"],
  chorus: ["keep", "hold", "feel", "ride", "breathe", "stay"],
  bridge: ["lean", "glide", "linger", "trace", "stay", "push"],
  "pre-chorus": ["catch", "hold", "feel", "chase", "build"],
  generic: ["keep", "ride", "feel", "carry", "stay"],
};

const OBJECTS = [
  "this glow",
  "the late playlist",
  "our shared beat",
  "the skyline",
  "the open road",
  "the warm light",
  "new coffee cups",
  "tonight's plan",
  "the steady pulse",
  "small wins",
];

const CLEAN_ENDINGS = ["right now", "for us", "in the mix", "soft light", "steady calm"];

const EXPLICIT_ENDINGS = ["say it clear", "push it higher", "speak it real", "go all in"];

const MOOD_TAGS = ["fresh rhythm", "bright calm", "steady sway", "clear morning", "soft rush"];

const CHORUS_TAIL_PHRASES = [
  "let it shine",
  "let it flow",
  "let it show",
  "keep it lit",
];

const CHORD_PROGRESSIONS = [
  "C G Am F",
  "F C G Am",
  "G D Em C",
  "Am F C G",
  "D A Bm G",
];

const TITLE_TEMPLATES = [
  (focus, moodTag) => `${focus} in ${moodTag}`,
  (focus, moodTag) => `${focus} Echoes`,
  (focus, moodTag) => `${moodTag} {focus}`.replace("{focus}", focus),
  (focus, moodTag) => `Colors of ${focus}`,
  (focus, moodTag) => `${focus} Anthem`,
  (focus, moodTag) => `Bright ${focus}`,
];

const capitalize = (value) => {
  if (!value) {
    return "";
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const getHookWord = (promptFocus) => {
  if (!promptFocus) {
    return "Glow";
  }
  const tokens = promptFocus.split(" ").filter(Boolean);
  return capitalize(tokens[0] || "Glow");
};

const describeFocus = ({ promptFocus, random }) => {
  if (promptFocus && random() < 0.35) {
    return promptFocus;
  }
  return pick(MOOD_TAGS, random);
};

const maybeAppendTone = (line, tone, random) => {
  const base = trimLine(line);
  if (!tone) {
    return base;
  }
  const separator = random() < 0.5 ? " " : " - ";
  return trimLine(`${base}${separator}${tone}`);
};

const buildChorusLines = ({ promptFocus, random, lineCount }) => {
  const hookWord = getHookWord(promptFocus);
  const hookPhrase = `${hookWord} pulse`;
  const lines = [];
  for (let i = 0; i < lineCount; i += 1) {
    const tail = pick(CHORUS_TAIL_PHRASES, random);
    const ending = pick(CHORUS_ENDINGS, random);
    lines.push(trimLine(`${hookPhrase} ${tail} ${ending}`));
  }
  return lines;
};

const buildTitle = ({ prompt, genre, mood }) => {
  const focus = sanitizePromptFocus(prompt);
  const moodTag = mood ? mood.split(" ")[0] : "bright";
  const genreTag = genre ? capitalize(genre) : "Song";
  return `${genreTag} Bloom | ${capitalize(focus)} in ${capitalize(moodTag)}`;
};

const buildTitleIdeas = ({ prompt, mood, random }) => {
  const focus = capitalize(sanitizePromptFocus(prompt));
  const moodTag = mood ? capitalize(mood.split(" ")[0]) : "Bright";
  const ideas = new Set();
  let attempts = 0;
  while (ideas.size < 4 && attempts < 12) {
    const template = pick(TITLE_TEMPLATES, random);
    const idea = template(focus, moodTag);
    const normalized = idea.replace(/\s+/g, " ").trim();
    const cleaned = capitalize(normalized);
    if (cleaned) {
      ideas.add(cleaned);
    }
    attempts += 1;
  }
  if (ideas.size < 4) {
    ideas.add(`${focus} Glow`);
  }
  return Array.from(ideas).slice(0, 5);
};

const buildProviderMeta = ({ language, genre, mood, referenceArtists }) => ({
  ...DEFAULT_META,
  language: language || "English",
  genre: genre || "pop",
  mood: mood || MOOD_TAGS[0],
  referenceArtists: Array.isArray(referenceArtists) ? referenceArtists : [],
  providerUsed: DEFAULT_META.provider,
});

const selectChordProgression = ({ type, random, cache }) => {
  if (type === "chorus" && cache.chords) {
    return cache.chords;
  }
  const progression = pick(CHORD_PROGRESSIONS, random);
  if (type === "chorus") {
    cache.chords = progression;
  }
  return progression;
};

const buildLine = ({ type, promptFocus, explicit, random, themeToken }) => {
  const subjectList = SUBJECTS[type] || SUBJECTS.generic;
  const verbList = VERBS[type] || VERBS.generic;
  const subject = pick(subjectList, random);
  const verb = pick(verbList, random);
  const object = pick(OBJECTS, random);
  const tone = explicit ? pick(EXPLICIT_ENDINGS, random) : pick(CLEAN_ENDINGS, random);
  const descriptor = describeFocus({ promptFocus, random });
  const fragments = [subject, verb, object];
  if (themeToken) {
    fragments.push(`about ${themeToken}`);
  } else if (random() < 0.45) {
    fragments.push(descriptor);
  }
  return maybeAppendTone(fragments.join(" "), tone, random);
};

const buildNarrativeLines = ({
  type,
  lineCount,
  promptFocus,
  explicit,
  random,
  maxThemeRefs,
}) => {
  const lines = [];
  let themeRefs = 0;
  const themeToken =
    promptFocus && promptFocus.trim()
      ? promptFocus
          .split(" ")
          .filter(Boolean)
          .slice(0, 3)
          .join(" ")
      : null;
  for (let i = 0; i < lineCount; i += 1) {
    const allowTheme = maxThemeRefs > themeRefs;
    const includeTheme = themeToken && allowTheme && random() < 0.6;
    if (includeTheme) {
      themeRefs += 1;
    }
    lines.push(
      buildLine({
        type,
        promptFocus,
        explicit,
        random,
        themeToken: includeTheme ? themeToken : null,
      })
    );
  }
  return lines;
};

const buildSectionLines = ({ type, lineCount, promptFocus, explicit, random }) => {
  if (type === "chorus") {
    return buildChorusLines({ promptFocus, random, lineCount });
  }
  const safeCount = Math.max(1, lineCount || 2);
  const maxThemeRefs = type === "verse" ? 2 : 0;
  return buildNarrativeLines({
    type,
    lineCount: safeCount,
    promptFocus,
    explicit,
    random,
    maxThemeRefs,
  });
};

const buildLyrics = (options = {}) => {
  const baseStructure = STRUCTURE_MAP[options.structure] || STRUCTURE_MAP["verse-chorus"];
  const structure = baseStructure.map((section) => ({ ...section }));
  const lengthConfig = LENGTH_LINE_COUNT[options.length] || LENGTH_LINE_COUNT.medium;
  const promptInput = options.theme || options.prompt;
  const promptFocus = sanitizePromptFocus(promptInput);
  const seedSource = [
    promptInput,
    options.genre,
    options.mood,
    options.structure,
    options.length,
    options.includeChords,
    options.includeTitleIdeas,
    options.rhymeScheme,
    options.syllablesPerLine,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join("|");
  const random = createSeededRandom(seedSource);
  const chorusState = { lines: null, chords: null };

  if (
    options.length === "long" &&
    !structure.some((section) => section.type === "pre-chorus")
  ) {
    const firstChorusIndex = structure.findIndex((section) => section.type === "chorus");
    if (firstChorusIndex > 0) {
      structure.splice(firstChorusIndex, 0, { header: "[Pre-Chorus]", type: "pre-chorus" });
    }
  }

  const resolveLineCount = (sectionType) => {
    if (sectionType === "verse") {
      return 4;
    }
    if (sectionType === "chorus") {
      return lengthConfig.chorus || 3;
    }
    if (sectionType === "pre-chorus") {
      return PRE_CHORUS_LINE_COUNT;
    }
    return lengthConfig[sectionType] || 2;
  };

  const sections = structure.map((section) => {
    const chordLine =
      options.includeChords && section.type
        ? `Chords: ${selectChordProgression({ type: section.type, random, cache: chorusState })}`
        : null;
    const lineCount = resolveLineCount(section.type);
    const lines =
      section.type === "chorus" && chorusState.lines
        ? chorusState.lines
        : buildSectionLines({
            type: section.type,
            lineCount,
            promptFocus,
            explicit: options.explicit,
            random,
          });
    if (section.type === "chorus" && !chorusState.lines) {
      chorusState.lines = lines;
    }
    const content = [section.header, ...lines].join("\n");
    return [chordLine, content].filter(Boolean).join("\n");
  });

  return sections.join("\n\n");
};

const buildMockOutput = ({
  prompt,
  theme,
  genre,
  structure,
  length,
  mood,
  language,
  explicit,
  includeChords,
  includeTitleIdeas,
  referenceArtists,
  previousOutput,
  instruction,
}) => {
  const focusPrompt = theme || prompt;
  const baseTitle = previousOutput?.title
    ? `${previousOutput.title} (remix)`
    : buildTitle({ prompt: focusPrompt, genre, mood });
  const lyrics = buildLyrics({
    prompt,
    theme: focusPrompt,
    genre,
    structure,
    length,
    mood: mood || "uplifting glow",
    includeChords,
    explicit,
    includeTitleIdeas,
    referenceArtists,
  });
  const woven =
    previousOutput && instruction
      ? `${previousOutput.lyrics}\n\n(Rewritten to focus on ${instruction})\n${lyrics}`
      : lyrics;
  const titleIdeas =
    includeTitleIdeas && typeof includeTitleIdeas === "boolean"
      ? buildTitleIdeas({ prompt: focusPrompt, mood, random: createSeededRandom(`${focusPrompt}|ideas`) })
      : [];

  return {
    title: baseTitle,
    lyrics: woven,
    titleIdeas,
  };
};

const generate = async (params) => {
  const output = buildMockOutput(params);
  return {
    output,
    meta: buildProviderMeta(params),
  };
};

const refine = async (params) => {
  const output = buildMockOutput(params);
  return {
    output,
    meta: buildProviderMeta(params),
  };
};

module.exports = {
  generate,
  refine,
};
