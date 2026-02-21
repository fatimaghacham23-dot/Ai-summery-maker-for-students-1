const LENGTH_SENTENCE_COUNTS = {
  short: 3,
  medium: 4,
  long: 5,
};

const TONE_DESCRIPTORS = {
  academic: 'formal and evidence-focused',
  neutral: 'balanced and objective',
  simple: 'clear and approachable',
  persuasive: 'confident and persuasive',
};

const LEVEL_DESCRIPTORS = {
  high_school: 'straightforward wording that keeps complex ideas accessible',
  bachelor: 'a measured balance of clarity and depth',
  master: 'nuanced explanations that signal discipline-level thinking',
  phd: 'scholarly language that mirrors advanced academic discourse',
};

const INSTRUCTION_MAP = {
  clarity: 'sharpen clarity',
  academic: 'reinforce an academic tone',
  structure: 'tighten the structure',
  concise: 'trim any redundancy',
};

const capitalizeLabel = (value) => {
  if (!value) {
    return 'Writer';
  }
  return value
    .split(/[-_ ]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const sanitizeTopic = (text) => {
  if (!text) {
    return 'the topic';
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'the topic';
  }
  if (cleaned.length <= 64) {
    return cleaned;
  }
  return cleaned.slice(0, 64).trim() + '...';
};

const extractHighlights = (text, limit = 3) => {
  if (!text) {
    return [];
  }
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const picks = sentences.slice(0, limit);
  if (picks.length) {
    return picks;
  }
  return [sanitizeTopic(text)];
};

const joinLines = (lines, count) => {
  const limited = lines.slice(0, Math.min(count, lines.length));
  return limited.join(' ');
};

const buildParagraph = (heading, lines, sentenceCount) => {
  const body = joinLines(lines, sentenceCount);
  if (!body) {
    return heading;
  }
  return heading + '\n' + body;
};

const buildEssay = ({
  text,
  mode,
  tone,
  length,
  level,
  keywords,
  instruction,
  isRefine,
}) => {
  const topic = sanitizeTopic(text);
  const highlights = extractHighlights(text, 3);
  const focusA = highlights[0] || topic;
  const focusB = highlights[1] || focusA;
  const focusC = highlights[2] || focusB;
  const keywordLine =
    Array.isArray(keywords) && keywords.length
      ? 'Key terms include ' + keywords.join(', ') + '.'
      : null;
  const modeLabel = capitalizeLabel(mode);
  const toneDescriptor = TONE_DESCRIPTORS[tone] || TONE_DESCRIPTORS.neutral;
  const levelDescriptor = LEVEL_DESCRIPTORS[level] || LEVEL_DESCRIPTORS.bachelor;
  const lengthCount = LENGTH_SENTENCE_COUNTS[length] || LENGTH_SENTENCE_COUNTS.medium;
  const instructionNote = instruction
    ? 'This revision focuses on ' + (INSTRUCTION_MAP[instruction] || instruction) + '.'
    : null;
  const refinementHint = isRefine
    ? 'The update builds on the previous draft' +
      (instructionNote ? ' and ' + instructionNote.toLowerCase() : '.')
    : null;

  const title = modeLabel + ' on ' + topic;

  const introLines = [
    'Introduction: ' +
      toneDescriptor +
      ' language anchors this ' +
      modeLabel.toLowerCase() +
      ' reflection on ' +
      topic +
      '.',
    'It draws on the notes such as ' + focusA + ' to clarify the main idea and prepare the reader for structured analysis.',
    'The paragraph lets the reader know the essay will proceed from foundation to implications with ' +
      levelDescriptor +
      '.',
    keywordLine,
    refinementHint,
  ].filter(Boolean);

  const contextLines = [
    'Context and Foundations: Revisit how ' + focusA + ' frames the broader subject and why it merits attention.',
    'The notes highlight ' + focusB + ' as a supporting idea, and this section aligns that insight with the core question.',
    'It keeps the tone ' + toneDescriptor + ' while anchoring each sentence in the student-provided material.',
    'The level of detail mirrors ' + levelDescriptor + ' so the explanation stays grounded.',
    'The content ends by reminding the reader that ' + focusC + ' is part of the same narrative thread.',
  ];

  const analysisLines = [
    'Detailed Analysis: Move deeper into the relationships between the highlighted ideas and the topic.',
    'The paragraph focuses on ' + focusB + ' and explores how it supports or complicates the thesis.',
    (keywordLine || 'Clear transitions') + ' help the reader follow the thread from idea to consequence.',
    'Tone and level remain consistent, allowing ' + toneDescriptor + ' language and ' + levelDescriptor + ' to coexist.',
    'This section frames both the evidence and any tensions that arise from ' + focusA + '.',
  ];

  const implicationsLines = [
    'Implications and Direction: Translate the earlier analysis into guidance or next steps.',
    'It considers what ' +
      topic +
      ' means for the reader\'s studies, habits, or understanding of the subject.',
    'The narrative stays focused on action while the tone keeps ' + toneDescriptor + ' phrasing in play.',
    'The conclusion draws the thread from ' + focusC + ' back to the original notes to keep everything cohesive.',
    'It ends by showing how the chosen length and level help pace the argument for a reader at that stage.',
  ];

  const conclusionLines = [
    'Conclusion: Pull together the foundation, analysis, and implications of ' + topic + '.',
    'This final note reinforces how the provided notes shaped every section while respecting ' +
      modeLabel.toLowerCase() +
      ' expectations.',
    'The writer may now follow the implications or refine further if desired' +
      (instructionNote ? ' - ' + instructionNote : '.'),
    'The essay highlights the importance of engaging with ' + focusA + ' again before moving to the next task.',
    refinementHint,
  ].filter(Boolean);

  const intro = buildParagraph('Introduction', introLines, lengthCount);
  const context = buildParagraph('Context and Foundations', contextLines, lengthCount);
  const analysis = buildParagraph('Detailed Analysis', analysisLines, lengthCount);
  const implications = buildParagraph('Implications and Direction', implicationsLines, lengthCount);
  const conclusion = buildParagraph('Conclusion', conclusionLines, lengthCount);

  return [
    title,
    '',
    intro,
    '',
    context,
    '',
    analysis,
    '',
    implications,
    '',
    conclusion,
  ]
    .filter(Boolean)
    .join('\n');
};

const DEFAULT_META = {
  provider: 'local',
  model: 'local-writer',
  providerUsed: 'local',
};

const generate = async (params) => ({
  output: buildEssay({ ...params, isRefine: false }),
  meta: DEFAULT_META,
});

const refine = async (params) => ({
  output: buildEssay({ ...params, isRefine: true }),
  meta: DEFAULT_META,
});

module.exports = {
  generate,
  refine,
};
