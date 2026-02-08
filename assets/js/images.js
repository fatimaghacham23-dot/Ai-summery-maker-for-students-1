import { showToast } from "./ui.js";

const STORAGE_KEY = "saved-visuals";

const imagePrompt = document.getElementById("imagePrompt");
const imageStyle = document.getElementById("imageStyle");
const imageCanvas = document.getElementById("imageCanvas");
const imageStatusText = document.getElementById("imageStatusText");
const generateBtn = document.querySelector("[data-action=generate-image]");

let viewLoading = false;
let latestImageUrl = "";
let scanIntervalId = null;
let scanTimeoutId = null;
let currentBackdrop = null;

const setStatus = (text) => {
  if (!imageStatusText) return;
  imageStatusText.textContent = `Status: ${text}`;
};

const setLoadingState = (isLoading) => {
  viewLoading = Boolean(isLoading);
  if (generateBtn) {
    generateBtn.disabled = viewLoading;
    generateBtn.textContent = viewLoading ? "Generating..." : "Generate Visual";
  }
};

const renderSkeleton = () => {
  if (!imageCanvas) return;
  imageCanvas.innerHTML = `
    <div class="image-skeleton">
      <div class="image-skeleton-stage">
        <div class="skeleton" style="height: 320px; width: 100%;"></div>
        <div class="scan-overlay" aria-live="polite">
          <p class="scan-text">Analyzing prompt...</p>
        </div>
      </div>
      <div class="image-actions">
        <div class="skeleton" style="height: 44px; width: 160px;"></div>
        <div class="skeleton" style="height: 44px; width: 180px;"></div>
      </div>
    </div>
  `;
};

const stopScanOverlay = () => {
  if (scanIntervalId) {
    window.clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  if (scanTimeoutId) {
    window.clearTimeout(scanTimeoutId);
    scanTimeoutId = null;
  }
};

const startScanOverlay = () => {
  stopScanOverlay();
  const phrases = ["Analyzing prompt...", "Sketching outlines...", "Rendering textures..."];
  let index = 0;
  const textEl = imageCanvas?.querySelector(".scan-text");
  if (textEl) {
    textEl.textContent = phrases[index];
  }
  scanIntervalId = window.setInterval(() => {
    index = (index + 1) % phrases.length;
    const nextEl = imageCanvas?.querySelector(".scan-text");
    if (nextEl) nextEl.textContent = phrases[index];
  }, 900);
};

const loadSavedVisuals = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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

const handleDownload = (url) => {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = "visual.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const handleCopy = async (url) => {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied", "success");
  } catch (error) {
    console.error(error);
    showToast("Unable to copy", "error");
  }
};

const triggerSuccessPop = (button) => {
  if (!button) return;
  button.classList.remove("is-success-pop");
  void button.offsetWidth;
  button.classList.add("is-success-pop");
  window.setTimeout(() => button.classList.remove("is-success-pop"), 700);
};

const handleSave = ({ prompt, style, url }) => {
  if (!url) {
    showToast("Nothing to save", "error");
    return;
  }
  const now = new Date();
  const entry = {
    id: `${now.getTime()}`,
    createdAt: now.toISOString(),
    prompt,
    style,
    url,
  };
  const existing = loadSavedVisuals();
  const next = [entry, ...existing].slice(0, 50);
  saveVisuals(next);
  showToast("Saved to history", "success");
};

const ensureBackdrop = () => {
  if (currentBackdrop && document.body.contains(currentBackdrop)) {
    return currentBackdrop;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "image-backdrop";
  backdrop.addEventListener("click", () => {
    const expanded = document.querySelector(".generated-image.is-expanded");
    expanded?.classList.remove("is-expanded");
    document.body.classList.remove("image-lightbox");
    backdrop.remove();
    currentBackdrop = null;
  });
  currentBackdrop = backdrop;
  return backdrop;
};

const toggleLightbox = (figure) => {
  if (!figure) return;
  const next = !figure.classList.contains("is-expanded");
  const backdrop = ensureBackdrop();
  if (next) {
    document.body.appendChild(backdrop);
    document.body.classList.add("image-lightbox");
    figure.classList.add("is-expanded");
    return;
  }
  figure.classList.remove("is-expanded");
  document.body.classList.remove("image-lightbox");
  backdrop.remove();
  currentBackdrop = null;
};

const getStyleLabel = (style) => {
  if (style === "academic") return "Scientific Diagram";
  if (style === "minimal") return "Minimal Line Art";
  if (style === "infographic") return "Infographic";
  if (style === "sketch") return "Sketch Notebook";
  return "Visual";
};

const renderImage = ({ prompt, style, url }) => {
  if (!imageCanvas) return;
  latestImageUrl = url;
  const styleLabel = getStyleLabel(style);

  imageCanvas.innerHTML = `
    <figure class="generated-image">
      <img class="generated-image__img" src="${url}" alt="Generated visual" loading="lazy" />
      <div class="generated-image__overlay" aria-hidden="true">
        <div class="overlay-actions">
          <button type="button" class="overlay-btn" data-overlay-action="download" aria-label="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button type="button" class="overlay-btn" data-overlay-action="copy" aria-label="Copy link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
      <figcaption class="generated-image__meta">
        <strong>${style === "academic" ? "Modern Academic" : style}</strong>
        <span class="helper-text">${prompt ? String(prompt).slice(0, 140) : ""}</span>
        <div class="prompt-tags">
          <span class="prompt-tag">${styleLabel}</span>
          <span class="prompt-tag secondary">Simulation</span>
        </div>
      </figcaption>
    </figure>
    <div class="image-actions">
      <button type="button" class="btn secondary" data-image-action="download">Download</button>
      <button type="button" class="btn ghost" data-image-action="save">Save to History</button>
    </div>
  `;

  const img = imageCanvas.querySelector("img");
  img?.addEventListener("load", () => {
    img.classList.add("is-loaded");
  });

  const figure = imageCanvas.querySelector(".generated-image");
  figure?.addEventListener("click", (event) => {
    const overlayClick = event.target.closest("[data-overlay-action]");
    if (overlayClick) return;
    toggleLightbox(figure);
  });

  imageCanvas.querySelectorAll("[data-overlay-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = button.dataset.overlayAction;
      if (action === "download") {
        handleDownload(url);
        return;
      }
      if (action === "copy") {
        handleCopy(url);
      }
    });
  });

  imageCanvas.querySelectorAll("[data-image-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.imageAction;
      if (action === "download") {
        handleDownload(url);
        return;
      }
      if (action === "save") {
        handleSave({ prompt, style, url });
        const btn = imageCanvas.querySelector('[data-image-action="save"]');
        if (btn) {
          if (!btn.querySelector(".success-pop")) {
            btn.insertAdjacentHTML(
              "beforeend",
              `<svg class="success-pop" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            );
          }
          triggerSuccessPop(btn);
        }
      }
    });
  });
};

const simulateGeneration = () => {
  if (!imagePrompt || !imageStyle || !imageCanvas) return;
  const prompt = String(imagePrompt.value || "").trim();
  if (!prompt) {
    showToast("Enter a prompt first", "error");
    return;
  }

  const style = String(imageStyle.value || "academic");
  setStatus("Generating...");
  setLoadingState(true);
  renderSkeleton();
  startScanOverlay();

  scanTimeoutId = window.setTimeout(() => {
    stopScanOverlay();
    const seed = `${Math.random()}`.replace("0.", "");
    const url = `https://picsum.photos/seed/${seed}/800/600`;
    renderImage({ prompt, style, url });
    setStatus("Ready");
    setLoadingState(false);
    showToast("Visual generated", "success");
  }, 3000);
};

const bindEvents = () => {
  generateBtn?.addEventListener("click", () => {
    if (viewLoading) return;
    simulateGeneration();
  });
};

const initImagesFlow = () => {
  setStatus("Idle");
  setLoadingState(false);
  bindEvents();
};

export { initImagesFlow };
