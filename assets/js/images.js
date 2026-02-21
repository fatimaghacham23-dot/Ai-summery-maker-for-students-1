import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

const IMAGES_INIT_FLAG = "__imagesFlowInitialized";

let imagePrompt = null;
let imageStyle = null;
let imageSize = null;
let imageQuality = null;
let generateBtn = null;
let cancelBtn = null;
let statusText = null;
let providerBadge = null;
let errorContainer = null;
let previewImage = null;
let previewPlaceholder = null;
let downloadBtn = null;
let copyBtn = null;
let historyList = null;

let isGenerating = false;
let currentController = null;
let historyEntries = [];

const findElement = (root, selector) => {
  const el = root.querySelector(selector);
  if (!el) {
    console.error(`Missing element ${selector} in visual panel`);
  }
  return el;
};

const captureElements = () => {
  const root = document.querySelector('[data-tab-panel="visual"]');
  if (!root) return false;
  imagePrompt = findElement(root, "#imagePrompt");
  imageStyle = findElement(root, "#imageStyle");
  imageSize = findElement(root, "#imageSize");
  imageQuality = findElement(root, "#imageQuality");
  generateBtn = findElement(root, "[data-action=generate-image]");
  cancelBtn = findElement(root, "[data-action=cancel-image-generation]");
  statusText = findElement(root, "#imageStatusText");
  providerBadge = findElement(root, "#imageProviderBadge");
  errorContainer = findElement(root, "#imageError");
  previewImage = findElement(root, "#imagePreview");
  previewPlaceholder = findElement(root, "#imagePlaceholder");
  downloadBtn = findElement(root, "[data-action=download-image]");
  copyBtn = findElement(root, "[data-action=copy-image]");
  historyList = findElement(root, "#imageHistoryList");
  return Boolean(
    imagePrompt &&
      imageStyle &&
      imageSize &&
      imageQuality &&
      generateBtn &&
      statusText &&
      previewImage &&
      downloadBtn &&
      copyBtn &&
      historyList &&
      providerBadge
  );
};

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const setStatus = (text) => {
  if (!statusText) return;
  statusText.textContent = `Status: ${text}`;
};

const setProviderBadge = (provider) => {
  if (!providerBadge) return;
  if (!provider) {
    providerBadge.hidden = true;
    providerBadge.textContent = "";
    return;
  }
  providerBadge.textContent = `Provider: ${provider}`;
  providerBadge.hidden = false;
};

const clearError = () => {
  if (!errorContainer) return;
  errorContainer.hidden = true;
  errorContainer.textContent = "";
};

const showError = (message) => {
  if (!errorContainer) return;
  errorContainer.textContent = message;
  errorContainer.hidden = !message;
};

const setLoadingState = (loading) => {
  isGenerating = Boolean(loading);
  if (generateBtn) {
    generateBtn.disabled = isGenerating;
    generateBtn.textContent = isGenerating ? "Generating…" : "Generate Visual";
  }
  if (cancelBtn) {
    cancelBtn.hidden = !isGenerating;
  }
  if (downloadBtn) downloadBtn.disabled = isGenerating;
  if (copyBtn) copyBtn.disabled = isGenerating;
};

const resetPreview = () => {
  if (previewImage) {
    previewImage.hidden = true;
    previewImage.removeAttribute("src");
  }
  if (previewPlaceholder) {
    previewPlaceholder.hidden = false;
  }
  setProviderBadge(null);
  if (downloadBtn) downloadBtn.disabled = true;
  if (copyBtn) copyBtn.disabled = true;
};

const downloadImage = (src) => {
  if (!src) return;
  const link = document.createElement("a");
  link.href = src;
  link.download = "visual.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const copyImageToClipboard = async (imageUrl) => {
  if (!navigator.clipboard) {
    throw new Error("Clipboard unavailable");
  }
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);
  } catch (error) {
    throw error;
  }
};

const handleCopyImage = async () => {
  if (!previewImage || !previewImage.src) {
    showToast("Generate an image first", "error");
    return;
  }
  try {
    await copyImageToClipboard(previewImage.src);
    showToast("Image copied to clipboard", "success");
  } catch (error) {
    try {
      await navigator.clipboard.writeText(previewImage.src);
      showToast("Image URL copied instead", "success");
    } catch (secondaryError) {
      console.error(secondaryError);
      showToast("Unable to copy image", "error");
    }
  }
};

const renderImage = (payload = {}, prompt = "") => {
  if (!previewImage || !previewPlaceholder) return;
  const imageUrl = payload.imageUrl || "";
  if (!imageUrl) {
    resetPreview();
    return;
  }
  previewImage.src = imageUrl;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
  setProviderBadge(payload.provider || null);
  setStatus("Ready");
  if (downloadBtn) downloadBtn.disabled = false;
  if (copyBtn) copyBtn.disabled = false;
  showToast("Visual generated", "success");
};

const buildHistoryCard = (item) => {
  const promptText = escapeHtml(item.usedPrompt || item.prompt || "");
  const providerText = escapeHtml(item.provider || "Unknown");
  const dateText = formatDate(item.createdAt);
  return `
    <article class="image-history-card" data-history-id="${escapeHtml(item.id)}">
      <img src="${escapeHtml(item.imageUrl)}" alt="Generated visual" loading="lazy" />
      <div class="visual-history-body">
        <p>${promptText}</p>
        <p class="helper-text">${providerText}${dateText ? ` · ${escapeHtml(dateText)}` : ""}</p>
        <div class="image-history-actions">
          <button type="button" class="btn ghost" data-history-action="load">View</button>
          <button type="button" class="btn ghost" data-history-action="copy">Copy prompt</button>
        </div>
      </div>
    </article>
  `;
};

const renderHistory = (items = []) => {
  historyEntries = items || [];
  if (!historyList) return;
  if (!items.length) {
    historyList.innerHTML = `
      <div class="empty-state empty-state--compact">
        <p class="empty-state-title">No history yet</p>
        <p class="empty-state-subtitle">Generate an image to build a history.</p>
      </div>
    `;
    return;
  }
  historyList.innerHTML = items.map(buildHistoryCard).join("");
};

const fetchHistory = async () => {
  if (!historyList) return;
  try {
    const result = await requestJson("/api/image/history", { cache: "no-store" });
    if (Array.isArray(result)) {
      renderHistory(result);
    }
  } catch (error) {
    console.error("Failed to fetch image history", error);
  }
};

const handleHistoryAction = async (event) => {
  const button = event.target.closest("[data-history-action]");
  if (!button) return;
  const card = button.closest("[data-history-id]");
  const historyId = card?.dataset.historyId;
  const action = button.dataset.historyAction;
  const entry = historyEntries.find((item) => String(item.id) === String(historyId));
  if (!entry) return;
  if (action === "load") {
    renderImage(entry, entry.prompt);
    showToast("Loaded from history", "neutral");
  }
  if (action === "copy") {
    const promptToCopy = entry.usedPrompt || entry.prompt || "";
    if (!promptToCopy) {
      showToast("Prompt is empty", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(promptToCopy);
      showToast("Prompt copied", "success");
    } catch (error) {
      console.error(error);
      showToast("Unable to copy prompt", "error");
    }
  }
};

const handleGenerate = async () => {
  if (isGenerating) return;
  if (!imagePrompt) return;
  const prompt = String(imagePrompt.value || "").trim();
  if (!prompt) {
    showToast("Enter a prompt first", "error");
    return;
  }
  clearError();
  setProviderBadge(null);
  setStatus("Generating…");
  setLoadingState(true);
  const controller = new AbortController();
  if (currentController) {
    currentController.abort();
  }
  currentController = controller;

  const payload = {
    prompt,
    style: imageStyle?.value || "prompt-only",
    size: imageSize?.value || "1024x1024",
    quality: imageQuality?.value || "standard",
    format: "png",
    n: 1,
  };

  try {
    const result = await requestJson("/api/image/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    renderImage(result, prompt);
    await fetchHistory();
  } catch (error) {
    if (error.name === "ApiError" && error.status === 408) {
      setStatus("Timed out");
      showToast("Image request timed out", "error");
      return;
    }
    const message =
      error?.data?.message || error?.message || "Failed to generate visual";
    showError(message);
    setStatus("Error");
    showToast(message, "error");
  } finally {
    setLoadingState(false);
    currentController = null;
  }
};

const handleCancel = () => {
  if (!currentController || !isGenerating) return;
  currentController.abort();
  setStatus("Canceling…");
};

const bindEvents = () => {
  generateBtn?.addEventListener("click", handleGenerate);
  cancelBtn?.addEventListener("click", handleCancel);
  downloadBtn?.addEventListener("click", () => {
    if (previewImage?.src) {
      downloadImage(previewImage.src);
    } else {
      showToast("Generate an image first", "error");
    }
  });
  copyBtn?.addEventListener("click", handleCopyImage);
  historyList?.addEventListener("click", handleHistoryAction);
};

const initImagesFlow = () => {
  if (window[IMAGES_INIT_FLAG]) return;
  if (!captureElements()) return;
  window[IMAGES_INIT_FLAG] = true;
  setStatus("Idle");
  setLoadingState(false);
  clearError();
  resetPreview();
  bindEvents();
  fetchHistory();
};

export { initImagesFlow };
