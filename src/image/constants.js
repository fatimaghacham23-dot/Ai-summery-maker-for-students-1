const IMAGE_STYLES = ["prompt-only", "photoreal", "anime", "sketch", "3d", "icon"];
const IMAGE_SIZE_OPTIONS = ["512x512", "1024x1024", "1536x1024"];
const IMAGE_QUALITIES = ["standard", "high"];
const IMAGE_FORMATS = ["png", "jpeg", "webp"];

const STYLE_SUFFIXES = {
  "prompt-only": "",
  photoreal: "Photorealistic rendering with crisp lighting, rich textures, and cinematic depth.",
  anime: "Anime-inspired illustration with bold line work, vivid colors, and expressive characters.",
  sketch: "Loose sketch with pencil strokes, soft shading, and a studio-notebook feel.",
  "3d": "3D studio render with volumetric lighting, depth cues, and gentle reflections.",
  icon: "Clean iconography with simplified shapes, solid fills, and subtle gradients.",
};

const QUALITY_CUES = {
  standard: "",
  high: "Enhance quality with fine detail, cinematic lighting, and extra polish.",
};

const MIME_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

module.exports = {
  IMAGE_STYLES,
  IMAGE_SIZE_OPTIONS,
  IMAGE_QUALITIES,
  IMAGE_FORMATS,
  STYLE_SUFFIXES,
  QUALITY_CUES,
  MIME_TYPES,
};
