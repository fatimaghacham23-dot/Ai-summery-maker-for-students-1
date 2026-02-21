const capitalizeSentences = (text) => {
  let changed = false;
  const normalized = text.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, letter) => {
    if (letter !== letter.toUpperCase()) {
      changed = true;
    }
    return `${prefix}${letter.toUpperCase()}`;
  });
  return { text: normalized, changed };
};

const summarizeSnippet = (value) => {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (trimmed.length <= 140) return trimmed;
  return `${trimmed.slice(0, 140)}…`;
};

const SNIPPET_CONTEXT = 80;
const EXPLANATION_MAX_ENTRIES = 5;

const findFirstDiffIndex = (before = "", after = "") => {
  const minLength = Math.min(before.length, after.length);
  for (let index = 0; index < minLength; index += 1) {
    if (before[index] !== after[index]) {
      return index;
    }
  }
  if (before.length !== after.length) {
    return minLength;
  }
  return null;
};

const sliceAroundDiff = (text, index) => {
  if (!text) return "";
  if (typeof index !== "number" || Number.isNaN(index)) {
    return text.slice(0, SNIPPET_CONTEXT * 2);
  }
  const start = Math.max(0, index - SNIPPET_CONTEXT);
  const end = Math.min(text.length, index + SNIPPET_CONTEXT);
  return text.slice(start, end);
};

const buildDiffSnippets = (before, after) => {
  const normalizedBefore = String(before || "");
  const normalizedAfter = String(after || "");
  const diffIndex = findFirstDiffIndex(normalizedBefore, normalizedAfter);
  if (diffIndex === null) {
    return {
      before: summarizeSnippet(normalizedBefore),
      after: summarizeSnippet(normalizedAfter),
    };
  }
  return {
    before: summarizeSnippet(sliceAroundDiff(normalizedBefore, diffIndex)),
    after: summarizeSnippet(sliceAroundDiff(normalizedAfter, diffIndex)),
  };
};

const aggregateSequentialCorrections = (changeLog = []) => {
  const aggregated = [];
  changeLog.forEach((entry) => {
    if (!entry || !entry.type) return;
    const { type, before, after, reason } = entry;
    const last = aggregated[aggregated.length - 1];
    if (last && last.type === type) {
      last.after = after || last.after;
      if (reason) {
        last.reasons.push(reason);
      }
    } else {
      aggregated.push({
        type,
        before,
        after,
        reasons: reason ? [reason] : [],
      });
    }
  });
  return aggregated;
};

const buildReasonSentence = (reasons = []) => {
  const fragments = reasons
    .map((reason) => String(reason || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((fragment) => fragment.replace(/[.?!]+$/, ""));
  if (!fragments.length) {
    return "Updated text for clarity.";
  }
  if (fragments.length === 1) {
    return `${fragments[0]}.`;
  }
  if (fragments.length === 2) {
    return `${fragments[0]} and ${fragments[1]}.`;
  }
  const lastFragment = fragments[fragments.length - 1];
  const leadFragments = fragments.slice(0, -1);
  return `${leadFragments.join(", ")}, and ${lastFragment}.`;
};

const buildInstructionEntry = ({ original, corrected, instructions }) => {
  const beforeAfter = buildDiffSnippets(original, corrected);
  const instructionSnippet = summarizeSnippet(String(instructions || "").trim());
  const sanitizedInstruction = instructionSnippet.replace(/[.?!]+$/, "");
  const reasonText = sanitizedInstruction
    ? `Applied instruction: ${sanitizedInstruction}.`
    : "Applied instruction.";
  return {
    type: "instruction",
    before: beforeAfter.before,
    after: beforeAfter.after,
    reason: reasonText,
  };
};

const normalizeSegment = (value, preserveFormatting, changeTracker) => {
  let normalized = value;
  normalized = normalized.replace(/ {2,}/g, () => {
    changeTracker.spacing = true;
    return " ";
  });
  normalized = normalized.replace(/\s+([.,!?;:])/g, (_, char) => {
    changeTracker.spacing = true;
    return char;
  });
  normalized = normalized.replace(/([.,!?;:])(?=\S)/g, (match) => {
    changeTracker.spacing = true;
    return `${match} `;
  });

  if (preserveFormatting) {
    normalized = normalized.replace(/\s+$/g, "");
  } else {
    normalized = normalized.trim().replace(/\s+/g, " ");
  }

  return normalized;
};

const irregularVerbCorrections = [
  { pattern: "\\bhas went\\b", flags: "gi", replacement: "went" },
  { pattern: "\\bbuyed\\b", flags: "gi", replacement: "bought" },
  { pattern: "\\bgoed\\b", flags: "gi", replacement: "went" },
  { pattern: "\\bdidnt\\b", flags: "gi", replacement: "didn't" },
];

const sentenceBoundaryStarters = [
  "also",
  "after",
  "because",
  "before",
  "finally",
  "he",
  "here",
  "however",
  "it",
  "meanwhile",
  "now",
  "she",
  "there",
  "they",
  "then",
  "this",
  "we",
  "when",
  "where",
  "you",
];

const sentenceBoundaryRegex = new RegExp(
  `(?<=[A-Za-z0-9])\\s+(${sentenceBoundaryStarters.join("|")})\\b`,
  "gi"
);

const createChangeEntry = (changeLog, type, before, after, reason) => {
  if (!Array.isArray(changeLog)) return;
  changeLog.push({
    type,
    before: summarizeSnippet(before),
    after: summarizeSnippet(after),
    reason,
  });
};

const applyIrregularVerbCorrections = (text, changeTracker, changeLog) => {
  const before = text;
  let updated = before;
  irregularVerbCorrections.forEach(({ pattern, flags, replacement }) => {
    updated = updated.replace(new RegExp(pattern, flags), replacement);
  });
  if (before !== updated) {
    changeTracker.verbTense = true;
    createChangeEntry(
      changeLog,
      "verb-tense",
      before,
      updated,
      "Corrected irregular verbs (has went -> went, buyed -> bought, goed -> went, didnt -> didn't)."
    );
  }
  return updated;
};

const fixStandaloneLowercaseI = (text, changeTracker, changeLog) => {
  const before = text;
  const updated = before.replace(/(?<![A-Za-z0-9_])i(?!['A-Za-z0-9_])/g, "I");
  if (before !== updated) {
    changeTracker.capitalization = true;
    createChangeEntry(
      changeLog,
      "capitalization",
      before,
      updated,
      'Capitalized standalone "i" pronouns for consistency.'
    );
  }
  return updated;
};

const insertMissingSentenceBoundaries = (text, changeTracker, changeLog) => {
  const before = text;
  sentenceBoundaryRegex.lastIndex = 0;
  let matchFound = false;
  const updated = before.replace(sentenceBoundaryRegex, (match, word) => {
    matchFound = true;
    return `. ${word}`;
  });
  if (matchFound) {
    changeTracker.punctuation = true;
    createChangeEntry(
      changeLog,
      "punctuation",
      before,
      updated,
      "Inserted a period between clauses that ran together without punctuation."
    );
  }
  return updated;
};

const ensureFinalPeriod = (text, changeTracker, changeLog) => {
  const before = text.replace(/\s+$/, "");
  if (!before) {
    return { text: before, changed: false };
  }
  if (/[.!?]$/.test(before)) {
    return { text: before, changed: false };
  }
  const after = `${before}.`;
  changeTracker.punctuation = true;
  createChangeEntry(
    changeLog,
    "punctuation",
    before,
    after,
    "Appended a final period to complete the last sentence."
  );
  return { text: after, changed: true };
};

const buildCorrections = (text, options = {}) => {
  const { preserveFormatting = true } = options;
  const changeTracker = {
    spacing: false,
    capitalization: false,
    punctuation: false,
    verbTense: false,
  };
  const changeLog = [];
  let normalized = "";

  if (preserveFormatting) {
    const lines = String(text)
      .split(/\r?\n/)
      .map((line) => normalizeSegment(line, true, changeTracker));
    normalized = lines.join("\n");
  } else {
    const flattened = String(text).replace(/\r?\n+/g, " ");
    normalized = normalizeSegment(flattened, false, changeTracker);
  }

  if (changeTracker.spacing) {
    createChangeEntry(
      changeLog,
      "punctuation",
      text,
      normalized,
      "Normalized spacing and punctuation spacing while keeping the meaning intact."
    );
  }

  normalized = applyIrregularVerbCorrections(normalized, changeTracker, changeLog);
  normalized = fixStandaloneLowercaseI(normalized, changeTracker, changeLog);
  normalized = insertMissingSentenceBoundaries(normalized, changeTracker, changeLog);

  const preCapitalized = normalized;
  const { text: capitalized, changed: capitalizedChanged } = capitalizeSentences(normalized);
  normalized = capitalized;
  if (capitalizedChanged) {
    changeTracker.capitalization = true;
    createChangeEntry(
      changeLog,
      "capitalization",
      preCapitalized,
      capitalized,
      "Capitalized the beginning of each sentence."
    );
  }

  const { text: punctuated } = ensureFinalPeriod(normalized, changeTracker, changeLog);
  normalized = punctuated;

  return { corrected: normalized, changes: changeTracker, changeLog };
};

const buildExplanations = ({ changeLog = [], original, corrected, instructions }) => {
  const aggregated = aggregateSequentialCorrections(changeLog);
  const hasInstructions = Boolean(String(instructions || "").trim());
  const maxChangeEntries = Math.max(0, EXPLANATION_MAX_ENTRIES - (hasInstructions ? 1 : 0));
  const formattedChanges = aggregated
    .slice(0, maxChangeEntries)
    .map(({ type, before, after, reasons }) => {
      const snippets = buildDiffSnippets(before, after);
      return {
        type,
        before: snippets.before,
        after: snippets.after,
        reason: buildReasonSentence(reasons),
      };
    });
  const explanations = [...formattedChanges];
  if (hasInstructions) {
    explanations.push(
      buildInstructionEntry({
        original,
        corrected,
        instructions,
      })
    );
  }
  return explanations;
};

const buildMetadata = () => ({
  provider: "mock",
  providerUsed: "mock",
  model: "mock",
});

const fix = async (payload = {}) => {
  const {
    text = "",
    explainChanges = false,
    preserveFormatting = true,
    instructions = "",
  } = payload;
  const includeExplanations = Boolean(explainChanges);
  const original = String(text || "");
  if (!original) {
    return {
      corrected: "",
      explanations: [],
      meta: buildMetadata(),
    };
  }

  const { corrected, changes, changeLog } = buildCorrections(original, { preserveFormatting });
  const trimmed = corrected.trimEnd();

  const response = {
    corrected: trimmed,
    explanations: includeExplanations
      ? buildExplanations({
          changeLog,
          original,
          corrected: trimmed,
          instructions: String(instructions || "").trim(),
        })
      : [],
    meta: buildMetadata(),
  };
  return response;
};

const refine = async (payload = {}) => {
  const base = await fix(payload);
  if (payload.instructions) {
    const instructionSnippet = summarizeSnippet(String(payload.instructions || "").trim());
    const sanitizedInstruction = instructionSnippet.replace(/[.?!]+$/, "");
    const instructionReason = sanitizedInstruction
      ? `Refinement instruction: ${sanitizedInstruction}.`
      : "Refinement instruction.";
    const instructionNote = {
      type: "instruction",
      before: summarizeSnippet(payload.text),
      after: summarizeSnippet(base.corrected),
      reason: instructionReason,
    };
    if (Array.isArray(base.explanations)) {
      base.explanations = [...base.explanations, instructionNote];
    } else {
      base.explanations = [instructionNote];
    }
    if (Array.isArray(base.explanations) && base.explanations.length > EXPLANATION_MAX_ENTRIES) {
      base.explanations = base.explanations.slice(-EXPLANATION_MAX_ENTRIES);
    }
  }
  return base;
};

module.exports = {
  fix,
  refine,
};
