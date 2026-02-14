import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

const STORAGE_KEY = "saved-visuals";

const imagePrompt = document.getElementById("imagePrompt");
const imageStyle = document.getElementById("imageStyle");
const imageSize = document.getElementById("imageSize");
const imageQuality = document.getElementById("imageQuality");
const imageCanvas = document.getElementById("imageCanvas");
const imageStatusText = document.getElementById("imageStatusText");
const imageProviderBadge = document.getElementById("imageProviderBadge");
const errorContainer = document.getElementById("imageError");
const generateBtn = document.querySelector("[data-action=generate-image]");
const cancelBtn = document.querySelector("[data-action=cancel-image-generation]");

let isGenerating = false;
let currentController = null;
let cancelRequested = false;
let latestImages = [];
let latestMeta = null;

const defaultGenerateLabel = generateBtn?.textContent?.trim() || "Generate Visual";

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const extractBase64FromDataUrl = (dataUrl) => {
  const match = String(dataUrl || "").match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : "";
};

const loadSavedVisuals = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(error);
    return [];
  }
};

const saveVisuals = (items) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error(error);
  }
};

const renderPlaceholder = () => {
  if (!imageCanvas) return;
  setProviderBadge(null);
  imageCanvas.innerHTML = `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="8.5" cy="8.5" r="1.5" fill="none" stroke="currentColor" stroke-width="2" />
        <polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <p class="empty-state-title">No visual yet</p>
      <p class="empty-state-subtitle">Write a prompt and generate a visual to preview it here.</p>
    </div>
  `;
};

const setStatus = (text) => {
  if (!imageStatusText) return;
  imageStatusText.textContent = `Status: ${text}`;
};

const setProviderBadge = (provider) => {
  if (!imageProviderBadge) return;
  if (!provider) {
    imageProviderBadge.hidden = true;
    imageProviderBadge.textContent = "";
    return;
  }
  imageProviderBadge.textContent = `Provider: ${provider}`;
  imageProviderBadge.hidden = false;
};

const clearError = () => {
  if (!errorContainer) return;
  errorContainer.hidden = true;
  errorContainer.textContent = "";
};

const showInlineError = (message) => {
  if (!errorContainer) return;
  errorContainer.textContent = message;
  errorContainer.hidden = !message;
};

const setLoadingState = (loading) => {
  isGenerating = Boolean(loading);
  if (generateBtn) {
    generateBtn.disabled = isGenerating;
    generateBtn.textContent = isGenerating ? "Generating…" : defaultGenerateLabel;
  }
  if (cancelBtn) {
    cancelBtn.hidden = !isGenerating;
  }
};

const bindTileActions = () => {
  if (!imageCanvas) return;
  imageCanvas.querySelectorAll("[data-image-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.imageAction;
      const index = Number(button.dataset.index);
      if (action === "save") {
        handleSave(index);
        return;
      }
      if (action === "copy") {
        await handleCopy(index);
      }
    });
  });
};

const handleSave = (index) => {
  const candidate = latestImages[index];
  if (!candidate || !latestMeta) {
    showToast("Nothing to save yet", "error");
    return;
  }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      prompt: latestMeta.prompt,
      usedPrompt: latestMeta.usedPrompt,
      style: latestMeta.style,
      size: latestMeta.size,
      quality: latestMeta.quality,
      mimeType: candidate.mimeType,
      imageBase64: candidate.imageBase64 || candidate.b64,
    };
  const existing = loadSavedVisuals();
  const next = [entry, ...existing].slice(0, 50);
  saveVisuals(next);
  showToast("Saved to history", "success");
  window.dispatchEvent(new CustomEvent("library:updated"));
};

const handleCopy = async (index) => {
  const candidate = latestImages[index];
  if (!candidate || !latestMeta) {
    showToast("Nothing to copy", "error");
    return;
  }
  const textToCopy = candidate.revisedPrompt || latestMeta.usedPrompt || latestMeta.prompt;
  if (!textToCopy) {
    showToast("Prompt is empty", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(textToCopy);
    showToast("Prompt copied", "success");
  } catch (error) {
    console.error(error);
    showToast("Unable to copy", "error");
  }
};

const renderImageGrid = (payload, originalPrompt) => {
  if (!imageCanvas) return;
  const usedPrompt = payload.usedPrompt || originalPrompt;
  latestMeta = {
    prompt: originalPrompt,
    usedPrompt,
    style: payload.style || "prompt-only",
    size: payload.size || "1024x1024",
    quality: payload.quality || "standard",
  };

  setProviderBadge(payload.provider || null);

  latestImages = Array.isArray(payload.images)
    ? payload.images
        .map((image) => {
          const dataUrl = String(image?.dataUrl || "");
          if (!dataUrl) {
            return null;
          }
          const base64 =
            image.imageBase64 || image.b64 || extractBase64FromDataUrl(dataUrl);
          const mimeType =
            image.mimeType ||
            dataUrl
              .split(";")[0]
              .replace("data:", "")
              .trim() ||
            "image/png";
          return {
            dataUrl,
            mimeType,
            imageBase64: base64,
            b64: image.b64 || base64,
            revisedPrompt: image.revisedPrompt || null,
          };
        })
        .filter((image) => Boolean(image))
    : [];

  if (!latestImages.length) {
    renderPlaceholder();
    return;
  }

  const tiles = latestImages
    .map((image, index) => {
      const promptText = escapeHtml(image.revisedPrompt || usedPrompt || "");
      const styleLabel = escapeHtml(latestMeta.style);
      const sizeLabel = escapeHtml(latestMeta.size);
      const qualityLabel = escapeHtml(latestMeta.quality);
      return `
        <article class="visual-card" data-index="${index}">
          <div class="visual-image-wrap">
            <img
              class="visual-image"
              src="${escapeHtml(image.dataUrl)}"
              alt="Generated visual ${index + 1}"
              loading="lazy"
            />
          </div>
          <div class="visual-meta">
            <div class="visual-prompt">${promptText}</div>
            <div class="visual-tags">
              <span class="visual-tag">Style: ${styleLabel}</span>
              <span class="visual-tag">Size: ${sizeLabel}</span>
              <span class="visual-tag">Quality: ${qualityLabel}</span>
            </div>
            <div class="visual-actions">
              <button type="button" class="btn secondary" data-image-action="save" data-index="${index}">
                Save
              </button>
              <button type="button" class="btn ghost" data-image-action="copy" data-index="${index}">
                Copy prompt
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  imageCanvas.innerHTML = `<div class="visual-grid">${tiles}</div>`;
  bindTileActions();
};

const generateVisuals = async () => {
  if (!imagePrompt) return;
  if (isGenerating) return;
  const promptValue = String(imagePrompt.value || "").trim();
  if (!promptValue) {
    showToast("Enter a prompt first", "error");
    return;
  }

  clearError();
  setProviderBadge(null);
  setLoadingState(true);
  setStatus("Generating…");
  cancelRequested = false;

  const controller = new AbortController();
  currentController = controller;

  try {
    const payload = {
      prompt: promptValue,
      style: imageStyle?.value || "prompt-only",
      size: imageSize?.value || "1024x1024",
      quality: imageQuality?.value || "standard",
      format: "png",
      n: 4,
    };

    const result = await requestJson("/api/images/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    renderImageGrid(result, promptValue);
    setStatus("Ready");
    showToast("Visual generated", "success");
  } catch (error) {
    if (cancelRequested) {
      setStatus("Canceled");
      showToast("Generation canceled", "neutral");
    } else {
      const message =
        error?.data?.error?.message || error?.message || "Failed to generate visual";
      setStatus("Error");
      setProviderBadge(null);
      showInlineError(message);
      showToast(message, "error");
    }
  } finally {
    setLoadingState(false);
    currentController = null;
    cancelRequested = false;
  }
};

const handleCancel = () => {
  if (!currentController || !isGenerating) return;
  cancelRequested = true;
  currentController.abort();
  setStatus("Canceling…");
};

const bindEvents = () => {
  generateBtn?.addEventListener("click", generateVisuals);
  cancelBtn?.addEventListener("click", handleCancel);
};

const initImagesFlow = () => {
  setStatus("Idle");
  setLoadingState(false);
  clearError();
  renderPlaceholder();
  bindEvents();
};

export { initImagesFlow };
