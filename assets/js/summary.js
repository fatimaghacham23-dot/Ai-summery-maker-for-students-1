import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

const summaryView = document.querySelector(".summary-view");
const summaryText = document.getElementById("summaryText");
const summaryLength = document.getElementById("summaryLength");
const summaryLengthSlider = document.getElementById("summaryLengthSlider");
const summaryLengthValue = document.getElementById("summaryLengthValue");
const summaryFormat = document.getElementById("summaryFormat");
const summaryCounter = document.getElementById("summaryCounter");
const summaryStatus = document.getElementById("summaryStatus");
const summaryPreview = document.getElementById("summaryPreview");
const summaryOutput = document.getElementById("summaryOutput");
const summaryHighlights = document.getElementById("summaryHighlights");
const summaryError = document.getElementById("summaryError");
const summaryValidation = document.getElementById("summaryValidation");
const previewStatus = document.getElementById("previewStatus");

let summaryPayload = null;
let highlightSourceText = "";

const SAVED_SUMMARIES_STORAGE_KEY = "saved-summaries";

const getSavedSummaries = () => {
  try {
    const raw = window.localStorage.getItem(SAVED_SUMMARIES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveSummaries = (items) => {
  try {
    window.localStorage.setItem(SAVED_SUMMARIES_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error(error);
  }
};

const getWordCount = (text = "") => {
  if (!text.trim()) {
    return 0;
  }
  return text.trim().split(/\s+/).length;
};

const updateCounter = () => {
  if (!summaryCounter || !summaryText) return;
  const text = summaryText.value || "";
  summaryCounter.textContent = `${getWordCount(text)} words - ${text.length} chars`;
};

const setStatus = (text, statusClass = "online") => {
  if (!summaryStatus) return;
  summaryStatus.textContent = text;
  summaryStatus.className = `status-chip ${statusClass}`;
};

const renderPlaceholder = () => {
  if (summaryError) summaryError.hidden = true;
  if (summaryValidation) summaryValidation.textContent = "";
  if (previewStatus) previewStatus.textContent = "Waiting for generation";
  if (summaryOutput) {
    summaryOutput.innerHTML = `<p class="placeholder">Start with a summary request to see results here.</p>`;
  }
  renderHighlights([]);
  summaryPreview?.classList.remove("loading");
};

const setPreviewLoading = () => {
  if (summaryError) summaryError.hidden = true;
  renderHighlights([]);
  if (previewStatus) previewStatus.textContent = "Generating summary";
  summaryPreview?.classList.add("loading");
  if (summaryOutput) {
    summaryOutput.innerHTML = `
      <div class="loading-placeholder">
        <div class="skeleton" style="height: 16px;"></div>
        <div class="skeleton" style="height: 16px;"></div>
        <div class="skeleton" style="height: 16px; width: 70%;"></div>
        <div class="skeleton" style="height: 16px; width: 85%;"></div>
      </div>
    `;
  }
};

function stripBulletPrefix(line) {
  if (!line) {
    return "";
  }
  return line.replace(/^[•\-\*]\s*/, "").trim();
}

function renderEmptyState() {
  if (!summaryOutput) return;
  const placeholder = document.createElement("p");
  placeholder.className = "placeholder";
  placeholder.textContent = "No content returned.";
  summaryOutput.appendChild(placeholder);
}

function renderTextContent(value) {
  if (!summaryOutput) return;
  if (Array.isArray(value)) {
    if (!value.length) {
      renderEmptyState();
      return;
    }
    value.forEach((item) => renderTextContent(item));
    return;
  }
  if (value && typeof value === "object") {
    const pre = document.createElement("pre");
    pre.className = "summary-text";
    pre.textContent = JSON.stringify(value, null, 2);
    summaryOutput.appendChild(pre);
    return;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    renderEmptyState();
    return;
  }

  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    renderEmptyState();
    return;
  }

  paragraphs.forEach((paragraph) => {
    const paragraphEl = document.createElement("p");
    paragraphEl.className = "summary-text";
    paragraphEl.textContent = paragraph;
    summaryOutput.appendChild(paragraphEl);
  });
}

function renderBullets(value) {
  if (!summaryOutput) return;
  const rawLines = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const items = rawLines.map((line) => stripBulletPrefix(line)).filter(Boolean);
  if (!items.length) {
    renderEmptyState();
    return;
  }
  const list = document.createElement("ul");
  list.className = "summary-list";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  summaryOutput.appendChild(list);
}

function renderJsonData(value) {
  if (!summaryOutput) return;
  if (Array.isArray(value)) {
    if (!value.length) {
      renderEmptyState();
      return;
    }
    const list = document.createElement("ul");
    list.className = "summary-list";
    value.forEach((item) => {
      const li = document.createElement("li");
      if (item && typeof item === "object") {
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(item, null, 2);
        li.appendChild(pre);
      } else {
        li.textContent = String(item);
      }
      list.appendChild(li);
    });
    summaryOutput.appendChild(list);
    return;
  }
  if (value && typeof value === "object") {
    const pre = document.createElement("pre");
    pre.className = "summary-text";
    pre.textContent = JSON.stringify(value, null, 2);
    summaryOutput.appendChild(pre);
    return;
  }
  renderTextContent(value);
}

function renderSummary(output) {
  if (!summaryOutput) return;
  if (summaryError) summaryError.hidden = true;
  summaryValidation?.setAttribute("aria-hidden", "true");
  summaryOutput.innerHTML = "";

  const type = output?.type || "text";
  const data = output?.data;

  if (type === "bullets") {
    renderBullets(data);
    return;
  }

  if (type === "json") {
    renderJsonData(data);
    return;
  }

  renderTextContent(data);
}

function getHighlightSnippet(highlight) {
  if (!highlight) return "";
  if (typeof highlight.text === "string" && highlight.text.trim()) {
    return highlight.text.trim();
  }
  const start = Number(highlight.start);
  const end = Number(highlight.end);
  if (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    highlightSourceText &&
    end > start
  ) {
    return highlightSourceText.slice(start, end).trim();
  }
  return "";
}

function renderHighlights(highlights = []) {
  if (!summaryHighlights) return;
  summaryHighlights.innerHTML = "";
  if (!highlights.length) {
    summaryHighlights.hidden = true;
    return;
  }
  summaryHighlights.hidden = false;
  const title = document.createElement("p");
  title.className = "helper-text";
  title.textContent = "Highlighted sentences";
  summaryHighlights.appendChild(title);
  const list = document.createElement("ul");
  list.className = "summary-list summary-highlight-list";
  highlights.forEach((highlight) => {
    const snippet = getHighlightSnippet(highlight);
    const li = document.createElement("li");
    const textSpan = document.createElement("span");
    textSpan.className = "summary-highlight-text";
    textSpan.textContent = snippet || `Offsets ${highlight.start ?? 0}-${highlight.end ?? 0}`;
    li.appendChild(textSpan);
    if (highlight.reason) {
      const reason = document.createElement("span");
      reason.className = "summary-highlight-reason";
      reason.textContent = ` (${highlight.reason})`;
      li.appendChild(reason);
    }
    list.appendChild(li);
  });
  summaryHighlights.appendChild(list);
}

function normalizePayload(payload) {
  if (!payload) {
    return { output: { type: "text", data: "" }, highlights: [] };
  }
  if (payload.output) {
    return {
      output: payload.output,
      highlights: Array.isArray(payload.highlights) ? payload.highlights : [],
    };
  }
  if (payload.type && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return { output: payload, highlights: [] };
  }
  return { output: { type: "text", data: payload }, highlights: [] };
}

const getPrintableSummary = (payload = summaryPayload) => {
  if (!payload) return "";
  if (Array.isArray(payload)) return payload.join("\n");
  if (typeof payload === "object") {
    return JSON.stringify(payload, null, 2);
  }
  return String(payload);
};

const lengthLabels = ["Short", "Medium", "Detailed", "Unlimited"];
const lengthValues = ["short", "medium", "detailed", "unlimited"];

const syncLengthControls = () => {
  if (!summaryLengthSlider || !summaryLength) return;
  const index = Math.max(0, Math.min(lengthValues.length - 1, Number(summaryLengthSlider.value || 0)));
  const selectedValue = lengthValues[index];
  summaryLength.value = selectedValue;
  if (summaryLengthValue) {
    summaryLengthValue.textContent = lengthLabels[index] || "Medium";
  }
};

const handleSave = async () => {
  const content = getPrintableSummary();
  if (!content) {
    showToast("Nothing to save", "error");
    return;
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const id = `${now.getTime()}`;
  const title = `Summary ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  const preview = content.replace(/\s+/g, " ").trim().slice(0, 160);

  const existing = getSavedSummaries();
  const next = [{ id, title, createdAt, preview, content }, ...existing].slice(0, 50);
  saveSummaries(next);
  showToast("Saved to history", "success");
};

const handleError = (message) => {
  renderHighlights([]);
  if (summaryError) {
    summaryError.hidden = false;
    summaryError.textContent = message;
  }
  if (summaryValidation) {
    summaryValidation.textContent = message;
    summaryValidation.setAttribute("aria-hidden", "false");
  }
  setStatus("Error", "offline");
  if (previewStatus) {
    previewStatus.textContent = "Issue generating summary";
  }
  showToast(message, "error");
};

function setHighlightSource(text) {
  highlightSourceText = text || "";
}

const setSummaryText = (value) => {
  if (!summaryText) return;
  summaryText.value = value || "";
  updateCounter();
};

const getSummaryInput = () => {
  if (!summaryText) return "";
  return summaryText.value || "";
};

const handlePaste = async () => {
  if (!summaryText) return;
  try {
    const text = await navigator.clipboard.readText();
    setSummaryText(text);
    setStatus("Ready");
  } catch (error) {
    console.error(error);
    showToast("Unable to access clipboard", "error");
  }
};

const handleCopy = async () => {
  const content = getPrintableSummary();
  if (!content) {
    showToast("Nothing to copy", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    showToast("Copied summary", "success");
  } catch (error) {
    console.error(error);
    showToast("Copy failed", "error");
  }
};

const handleDownload = () => {
  const content = getPrintableSummary();
  if (!content) {
    showToast("Nothing to download", "error");
    return;
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "summary.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Summary downloaded", "success");
};

const renderSummaryPayload = (payload) => {
  summaryPayload = payload;
  const { output, highlights } = normalizePayload(payload);
  renderSummary(output);
  renderHighlights(highlights);
};

const generateSummary = async () => {
  const text = getSummaryInput().trim();
  if (!text) {
    handleError("Paste your study text first");
    summaryText?.focus();
    return;
  }
  setStatus("Summarizing...");
  setPreviewLoading();

  try {
    const data = await requestJson("/api/summarize", {
      method: "POST",
      body: JSON.stringify({
        text,
        length: summaryLength?.value,
        format: summaryFormat?.value,
      }),
    });
    setStatus("Ready", "online");
    renderSummaryPayload(data.summary);
    if (previewStatus) {
      previewStatus.textContent = "Summary generated";
    }
    showToast("Summary ready", "success");
  } catch (error) {
    console.error(error);
    handleError(error.message || "Failed to summarize");
  } finally {
    summaryPreview?.classList.remove("loading");
  }
};

const handleAction = async (action) => {
  switch (action) {
    case "summarize":
      await generateSummary();
      break;
    case "paste":
      await handlePaste();
      break;
    case "clear":
      setSummaryText("");
      summaryPayload = null;
      updateCounter();
      renderPlaceholder();
      setStatus("Ready");
      break;
    case "copy":
      await handleCopy();
      break;
    case "download":
      handleDownload();
      break;
    case "save":
      await handleSave();
      break;
    default:
      break;
  }
};

const bindSummaryActions = () => {
  const buttons = summaryView?.querySelectorAll("[data-action]") || [];
  buttons.forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });
};

const initSummaryFlow = () => {
  updateCounter();
  setStatus("Ready", "online");
  renderPlaceholder();
  summaryText?.addEventListener("input", updateCounter);
  summaryLengthSlider?.addEventListener("input", syncLengthControls);
  syncLengthControls();
  bindSummaryActions();
};

export {
  initSummaryFlow,
  renderSummaryPayload,
  setStatus,
  getPrintableSummary,
  getSummaryInput,
  setSummaryText,
  setPreviewLoading,
  handleError,
  setHighlightSource,
};
