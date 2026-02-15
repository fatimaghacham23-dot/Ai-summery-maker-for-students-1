const { AppError } = require("../../src/middleware/errorHandler");
const { buildUsedPrompt } = require("../../src/image/promptHelpers");

const generateImages = async ({
  prompt,
  style,
  size,
  quality,
  format,
  n = 1,
}) => {
  try {
    const usedPrompt = buildUsedPrompt({ prompt, style, quality });

    const limit = Math.max(1, Math.min(4, Number(n) || 1));
    const images = [];

    for (let i = 0; i < limit; i++) {
      const response = await fetch(
        "https://api-inference.huggingface.co/models/aiyouthalliance/Free-Image-Generation",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "image/png",
          },
          body: JSON.stringify({
            inputs: usedPrompt,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HF error ${response.status}: ${text}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      images.push({
        dataUrl: `data:image/png;base64,${base64}`,
        mimeType: "image/png",
        imageBase64: base64,
        b64: base64,
        byteLength: buffer.byteLength,
        contentType: "image/png",
        revisedPrompt: null,
      });
    }

    return {
      provider: "huggingface-free",
      model: "aiyouthalliance/Free-Image-Generation",
      usedPrompt,
      style,
      size,
      quality,
      format,
      images,
      raw: {
        contentType: "image/png",
        byteLength: images[0]?.byteLength || 0,
      },
    };
  } catch (error) {
    throw new AppError(
      error.message || "Hugging Face free image generation failed",
      502,
      "hf-free-error"
    );
  }
};

module.exports = {
  generateImages,
};
