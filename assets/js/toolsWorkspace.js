import { buildApiUrl, requestJson } from "./api.js";
import { showToast } from "./ui.js";
import {
  renderSummaryPayload,
  setStatus,
  getSummaryInput,
  setSummaryText,
  setPreviewLoading,
  handleError,
  setHighlightSource,
} from "./summary.js";

const previewPanel = document.querySelector(".summary-preview");
const slider = document.getElementById("toolsLengthSlider");
const sliderValue = document.getElementById("toolsLengthValue");
const toneSelect = document.getElementById("toolsToneSelect");
const languageInput = document.getElementById("toolsLanguageInput");
const focusSelect = document.getElementById("toolsFocusSelect");
const sectionedLimitInput = document.getElementById("toolsSectionedLimit");
const toolButtons = Array.from(document.querySelectorAll("[data-tool]")).filter(
  (button) => !button.dataset.rewriteMode
);
const rewriteButtons = Array.from(document.querySelectorAll("[data-tool='rewrite']"));
const exportButtons = Array.from(document.querySelectorAll("[data-export]"));
const shareLinkInput = document.getElementById("toolsShareLink");
const shareButton = document.getElementById("toolsShareBtn");
const savedList = document.getElementById("savedList");
const savedTitleInput = document.getElementById("savedTitleInput");
const savedTagsInput = document.getElementById("savedTagsInput");
const savedFolderInput = document.getElementById("savedFolderInput");
const savedActionBtn = document.getElementById("savedActionBtn");
const savedSearchInput = document.getElementById("savedSearchInput");
const savedSearchButton = document.getElementById("savedSearchBtn");
const compareLeft = document.getElementById("compareLeft");
const compareRight = document.getElementById("compareRight");
const compareButton = document.getElementById("compareBtn");
const comparePanel = document.getElementById("comparePanel");
const pdfInput = document.getElementById("pdfUploadInput");
const docxInput = document.getElementById("docxUploadInput");
const txtInput = document.getElementById("txtUploadInput");
const ocrInput = document.getElementById("ocrUploadInput");
const pdfBtn = document.getElementById("pdfUploadBtn");
const docxBtn = document.getElementById("docxUploadBtn");
const txtBtn = document.getElementById("txtUploadBtn");
const ocrBtn = document.getElementById("ocrUploadBtn");
const urlInput = document.getElementById("toolsUrlInput");
const urlFetchBtn = document.getElementById("toolsUrlFetch");
const youtubeInput = document.getElementById("toolsYouTubeInput");
const youtubeFetchBtn = document.getElementById("toolsYouTubeFetch");
const audioBtn = document.getElementById("toolsAudioBtn");

let lastRunId = null;
let currentDocumentId = null;

const controls = () => ({
  length: parseFloat(slider?.value || 0.5),
  tone: toneSelect?.value || "professional",
  language: languageInput?.value || "en",
  focus: focusSelect?.value || "student",
});

const updateSlider = () => {
  if (sliderValue && slider) {
    sliderValue.textContent = `${Math.round((slider.value || 0) * 100)}%`;
  }
};

const runTool = async (tool, extra = {}) => {
  const rawText = getSummaryInput();
  const text = rawText?.trim();
  if (!text) {
    showToast("Paste study text first", "error");
    return;
  }

  setHighlightSource(text);
  setStatus("Running tool...");
  setPreviewLoading();
  const payload = {
    tool,
    text,
    controls: controls(),
    options: extra.options || {},
  };
  if (currentDocumentId) {
    payload.documentId = currentDocumentId;
  }

  try {
    const response = await requestJson("/api/tools/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    lastRunId = response.runId;
    setStatus("Ready", "online");
    renderSummaryPayload({
      output: response.output,
      highlights: response.highlights || [],
    });
    showToast("Tool complete", "success");
    if (extra.onComplete) {
      extra.onComplete(response);
    }
  } catch (error) {
    console.error(error);
    handleError(error.message || "Tool execution failed");
  } finally {
    previewPanel?.classList.remove("loading");
  }
};

const handleToolButton = (button) => {
  const tool = button.dataset.tool;
  if (!tool) return;
  const rewriteMode = button.dataset.rewriteMode;
  const options = {};

  if (tool === "summary.sectioned") {
    const parsedLimit = Number.parseInt(sectionedLimitInput?.value, 10);
    options.sectioned = {
      maxSectionChars: Number.isFinite(parsedLimit) ? parsedLimit : 3500,
    };
  }

  if (rewriteMode) {
    options.rewrite = { mode: rewriteMode };
  }

  runTool(tool, Object.keys(options).length ? { options } : undefined);
};

const fetchDocument = async (url, endpoint) => {
  const response = await fetch(buildApiUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || "Unable to fetch content");
  }
  return body;
};

const uploadFile = async (file, endpoint) => {
  if (!file) return null;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(buildApiUrl(endpoint), {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || "Upload failed");
  }
  return body;
};

const handleFileInput = (input, endpoint) => {
  input?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile(file, endpoint);
      if (result?.text) {
        setSummaryText(result.text);
        currentDocumentId = result.documentId;
        showToast("Document loaded", "success");
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      input.value = "";
    }
  });
};

const populateSavedList = (items = []) => {
  if (!savedList) return;
  savedList.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.title} · ${item.folder || "Default"}`;
    savedList.appendChild(li);
  });
};

const populateCompareOptions = (items = []) => {
  const options = (select) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Choose summary</option>`;
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.runId;
      option.textContent = item.title;
      select.appendChild(option);
    });
    select.value = current;
  };
  options(compareLeft);
  options(compareRight);
};

const loadSavedItems = async (query = "") => {
  try {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    const data = await requestJson(`/api/saved?${params.toString()}`);
    populateSavedList(data);
    populateCompareOptions(data);
  } catch (error) {
    console.error(error);
    showToast("Unable to load saved summaries", "error");
  }
};

const handleCompare = async () => {
  const leftId = compareLeft?.value;
  const rightId = compareRight?.value;
  if (!leftId || !rightId) {
    showToast("Select two saved summaries to compare", "error");
    return;
  }
  try {
    const [left, right] = await Promise.all([
      requestJson(`/api/runs/${leftId}`),
      requestJson(`/api/runs/${rightId}`),
    ]);
    comparePanel.innerHTML = `
      <div>
        <strong>${left.title || left.tool}</strong>
        <pre>${JSON.stringify(left.output?.data || left.output || "", null, 2)}</pre>
      </div>
      <div>
        <strong>${right.title || right.tool}</strong>
        <pre>${JSON.stringify(right.output?.data || right.output || "", null, 2)}</pre>
      </div>
    `;
  } catch (error) {
    console.error(error);
    showToast("Comparison failed", "error");
  }
};

const handleSaveSummary = async () => {
  if (!lastRunId) {
    showToast("Run a tool before saving", "error");
    return;
  }
  try {
    await requestJson("/api/saved", {
      method: "POST",
      body: JSON.stringify({
        runId: lastRunId,
        title: savedTitleInput?.value || "Saved summary",
        tags: savedTagsInput?.value
          ? savedTagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean)
          : [],
        folder: savedFolderInput?.value,
      }),
    });
    loadSavedItems();
    showToast("Summary saved", "success");
  } catch (error) {
    console.error(error);
    showToast("Unable to save summary", "error");
  }
};

const handleShare = async () => {
  if (!lastRunId) {
    showToast("Run a tool before sharing", "error");
    return;
  }
  try {
    const data = await requestJson("/api/share", {
      method: "POST",
      body: JSON.stringify({ runId: lastRunId }),
    });
    if (shareLinkInput) {
      const shareUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
      shareLinkInput.value = shareUrl;
    }
    showToast("Share link ready", "success");
  } catch (error) {
    console.error(error);
    showToast("Unable to create share link", "error");
  }
};

const handleExport = (format) => {
  if (!lastRunId) {
    showToast("Run a tool before exporting", "error");
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = buildApiUrl(`/api/export/${lastRunId}?format=${format}`);
  anchor.setAttribute("download", `summary.${format}`);
  anchor.click();
  anchor.remove();
};

const initToolsWorkspace = () => {
  updateSlider();
  slider?.addEventListener("input", updateSlider);
  toolButtons.forEach((button) => button.addEventListener("click", () => handleToolButton(button)));
  rewriteButtons.forEach((button) => button.addEventListener("click", () => handleToolButton(button)));
  exportButtons.forEach((button) =>
    button.addEventListener("click", () => handleExport(button.dataset.export))
  );
  shareButton?.addEventListener("click", handleShare);
  savedActionBtn?.addEventListener("click", handleSaveSummary);
  savedSearchButton?.addEventListener("click", () => loadSavedItems(savedSearchInput?.value || ""));
  savedSearchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadSavedItems(savedSearchInput.value);
    }
  });
  compareButton?.addEventListener("click", handleCompare);
  pdfBtn?.addEventListener("click", () => pdfInput?.click());
  docxBtn?.addEventListener("click", () => docxInput?.click());
  txtBtn?.addEventListener("click", () => txtInput?.click());
  ocrBtn?.addEventListener("click", () => ocrInput?.click());
  urlFetchBtn?.addEventListener("click", async () => {
    if (!urlInput?.value) {
      showToast("Enter a URL first", "error");
      return;
    }
    try {
      const data = await fetchDocument(urlInput.value, "/api/inputs/url");
      if (data?.text) {
        setSummaryText(data.text);
        currentDocumentId = data.documentId;
        showToast("URL loaded", "success");
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  youtubeFetchBtn?.addEventListener("click", async () => {
    if (!youtubeInput?.value) {
      showToast("Enter a YouTube link", "error");
      return;
    }
    try {
      const data = await fetchDocument(youtubeInput.value, "/api/inputs/youtube");
      if (data?.text) {
        setSummaryText(data.text);
        currentDocumentId = data.documentId;
        showToast("Transcript loaded", "success");
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  audioBtn?.addEventListener("click", async () => {
    try {
      const data = await requestJson("/api/inputs/audio", { method: "POST" });
      showToast(data?.note || "Audio endpoint stubbed", "info");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  handleFileInput(pdfInput, "/api/inputs/upload");
  handleFileInput(docxInput, "/api/inputs/upload");
  handleFileInput(txtInput, "/api/inputs/upload");
  handleFileInput(ocrInput, "/api/inputs/ocr");
  loadSavedItems();
};

export { initToolsWorkspace };
