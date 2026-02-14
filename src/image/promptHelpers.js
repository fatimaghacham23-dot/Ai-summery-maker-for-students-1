const { STYLE_SUFFIXES, QUALITY_CUES } = require("./constants");

const buildUsedPrompt = ({ prompt, style, quality }) => {
  const normalizedPrompt = String(prompt || "").trim();
  const parts = [normalizedPrompt];
  const styleSuffix = STYLE_SUFFIXES[style] || "";
  const qualityCue = QUALITY_CUES[quality] || "";

  if (styleSuffix) {
    parts.push(styleSuffix);
  }
  if (qualityCue) {
    parts.push(qualityCue);
  }

  return parts.filter(Boolean).join(" ");
};

module.exports = {
  buildUsedPrompt,
};
