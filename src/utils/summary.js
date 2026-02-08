const splitSentences = (text) => {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
};

const pickSentenceCount = (length) => {
  switch (length) {
    case "short":
      return 2;
    case "medium":
      return 4;
    case "detailed":
      return 6;
    case "unlimited":
      return Number.POSITIVE_INFINITY;
    default:
      return 3;
  }
};

const createSummaryText = ({ text, length }) => {
  const sentences = splitSentences(text);
  if (length === "unlimited") {
    return sentences.join(" ");
  }

  const sentenceCount = Math.min(sentences.length, pickSentenceCount(length));
 
  if (sentenceCount === 0) {
    return text.slice(0, 200);
  }

  const selected = [];
  const step = Math.max(1, Math.floor(sentences.length / sentenceCount));
  for (let i = 0; i < sentences.length && selected.length < sentenceCount; i += step) {
    selected.push(sentences[i]);
  }

  return selected.join(" ");
};

const formatSummary = ({ summaryText, format }) => {
  if (format === "bullets") {
    return summaryText
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .map((sentence) => `- ${sentence}`)
      .join("\n");
  }

  return summaryText;
};

module.exports = {
  createSummaryText,
  formatSummary,
  splitSentences,
};
