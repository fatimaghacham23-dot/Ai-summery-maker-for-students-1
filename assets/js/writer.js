import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

let writerRoot = null;
let writerMode = null;
let writerTone = null;
let writerLength = null;
let writerLevel = null;
let writerCitation = null;
let writerKeywords = null;
let writerInput = null;
let writerCounters = null;
let writerGenerateBtn = null;
let writerRefineBtn = null;
let writerRefineInstruction = null;
let writerClearBtn = null;
let writerStatusNote = null;
let writerWordCount = null;
let writerOutput = null;
let writerCopyBtn = null;
let writerDownloadTxtBtn = null;
let writerDownloadMdBtn = null;
let writerSaveBtn = null;
let writerShareBtn = null;
let writerConfigCard = null;
let writerConfigApiKey = null;
let writerConfigModel = null;
let writerConfigSaveBtn = null;

const captureWriterElements = () => {
  const root = document.querySelector('[data-tab-panel="writer"]');
  if (!root) {
    console.error("Writer panel missing");
    return null;
  }
  const find = (selector, description) => {
    const element = root.querySelector(selector);
    if (!element) {
      console.error(`Missing ${description || selector} in writer panel`);
    }
    return element;
  };
  writerRoot = root;
  writerMode = find("#writerMode", "mode select");
  writerTone = find("#writerTone", "tone select");
  writerLength = find("#writerLength", "length select");
  writerLevel = find("#writerLevel", "level select");
  writerCitation = find("#writerCitation", "citation select");
  writerKeywords = find("#writerKeywords", "keywords input");
  writerInput = find("#writerInput", "input textarea");
  writerCounters = find("#writerCounters", "counters display");
  writerGenerateBtn = find("#writerGenerateBtn", "generate button");
  writerRefineBtn = find("#writerRefineBtn", "refine button");
  writerRefineInstruction = find("#writerRefineInstruction", "refine instruction select");
  writerClearBtn = find("#writerClearBtn", "clear button");
  writerStatusNote = find("#writerStatusNote", "status note");
  writerWordCount = find("#writerWordCount", "word count display");
  writerOutput = find("#writer-output", "writer output");
  writerCopyBtn = find("#writerCopyBtn", "copy button");
  writerDownloadTxtBtn = find("#writerDownloadTxtBtn", "download TXT button");
  writerDownloadMdBtn = find("#writerDownloadMdBtn", "download MD button");
  writerSaveBtn = find("#writerSaveBtn", "save button");
  writerShareBtn = find("#writerShareBtn", "share button");
  writerConfigCard = find("#writerConfigCard", "config card");
  writerConfigApiKey = find("#writerConfigApiKey", "config API key input");
  writerConfigModel = find("#writerConfigModel", "config model input");
  writerConfigSaveBtn = find("#writerConfigSaveBtn", "config save button");
  return root;
};

const WRITER_INIT_FLAG = "__writerFlowInitialized";

let currentRunId = null;
let currentOutput = "";
let isBusy = false;

const formatModeLabel = (value) =>
  value?.replace(/-/g, " ").replace(/\b\w/g, (chr) => chr.toUpperCase()) || "Writer";

const computeWordCount = (text = "") => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

const updateCounters = () => {
  if (!writerCounters || !writerInput) return;
  const raw = writerInput.value || "";
  const chars = raw.length;
  const tokens = chars ? Math.max(1, Math.ceil(chars / 4)) : 0;
  writerCounters.textContent = `${chars} chars · ${tokens} est. tokens`;
};

const setStatus = (text, variant = "neutral") => {
  if (!writerStatusNote) return;
  writerStatusNote.textContent = text;
  writerStatusNote.classList.toggle("writer-status-error", variant === "error");
};

const renderOutput = (text) => {
  if (!writerOutput) return;
  writerOutput.textContent = text || "";
};

const setWordCount = (count) => {
  if (!writerWordCount) return;
  writerWordCount.textContent = `${count ?? 0} words`;
};

const WRITER_CONFIG_ENDPOINT = "/api/settings/openai";
const CONFIG_ERROR_TOAST =
  "Set OPENAI_API_KEY in .env or configure it in settings.";
const INVALID_KEY_TOAST = "Invalid OpenAI key—paste a valid sk- key.";
const isWriterConfigError = (error) =>
  error?.status === 503 && error?.data?.code === "CONFIG_ERROR";
const isInvalidOpenAiKeyError = (error) =>
  error?.status === 401 || error?.data?.code === "INVALID_API_KEY";
const handleInvalidOpenAiKeyError = (error) => {
  if (!isInvalidOpenAiKeyError(error)) {
    return false;
  }
  setStatus("Invalid OpenAI API key", "error");
  showToast(INVALID_KEY_TOAST, "error");
  return true;
};

const handleWriterConfigError = (error) => {
  if (!isWriterConfigError(error)) {
    return false;
  }
  currentOutput = "";
  currentRunId = null;
  renderOutput("");
  setWordCount(0);
  setStatus("Writer not configured", "error");
  showToast(CONFIG_ERROR_TOAST, "error");
  return true;
};

const showWriterConfigCard = () => {
  if (writerConfigCard) {
    writerConfigCard.hidden = false;
  }
};

const hideWriterConfigCard = () => {
  if (writerConfigCard) {
    writerConfigCard.hidden = true;
  }
};

const setWriterConfigSaving = (saving) => {
  if (!writerConfigSaveBtn) return;
  writerConfigSaveBtn.disabled = saving;
  writerConfigSaveBtn.textContent = saving ? "Saving..." : "Save";
};

const loadWriterConfigPanelState = async () => {
  if (!writerConfigCard) {
    return;
  }
  try {
    const response = await requestJson(WRITER_CONFIG_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.configured) {
      if (writerConfigModel) {
        writerConfigModel.value = response.modelWriter || "";
      }
      showWriterConfigCard();
      return;
    }
  } catch (error) {
  }
  hideWriterConfigCard();
};

const handleWriterConfigSave = async () => {
  if (!writerConfigApiKey) {
    showToast("Writer configuration is unavailable", "error");
    return;
  }
  const apiKey = writerConfigApiKey.value?.trim();
  if (!apiKey) {
    showToast("API key is required", "error");
    return;
  }
  const payload = { apiKey };
  const modelValue = writerConfigModel?.value?.trim();
  if (modelValue) {
    payload.modelWriter = modelValue;
  }
  setWriterConfigSaving(true);
  try {
    await requestJson(WRITER_CONFIG_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("Saved. You can generate now.", "success");
    writerConfigApiKey.value = "";
    hideWriterConfigCard();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to save settings", "error");
  } finally {
    setWriterConfigSaving(false);
  }
};

const getKeywordsArray = () => {
  if (!writerKeywords) return [];
  return writerKeywords.value
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
};

const getPayload = () => {
  if (!writerInput || !writerMode || !writerTone || !writerLength || !writerLevel || !writerCitation) {
    return null;
  }
  const payload = {
    mode: writerMode.value,
    tone: writerTone.value,
    length: writerLength.value,
    level: writerLevel.value,
    citationStyle: writerCitation.value,
    text: writerInput.value.trim(),
  };
  const keywords = getKeywordsArray();
  if (keywords.length) {
    payload.keywords = keywords;
  }
  return payload;
};

const setBusy = (loading) => {
  isBusy = loading;
  const controls = [
    writerGenerateBtn,
    writerRefineBtn,
    writerClearBtn,
    writerCopyBtn,
    writerDownloadTxtBtn,
    writerDownloadMdBtn,
    writerSaveBtn,
    writerShareBtn,
    writerRefineInstruction,
  ];
  controls.forEach((control) => {
    if (control) {
      control.disabled = loading;
    }
  });
  if (writerGenerateBtn) {
    writerGenerateBtn.textContent = loading ? "Generating..." : "Generate";
  }
  if (writerRefineBtn) {
    writerRefineBtn.textContent = loading ? "Refining..." : "Refine";
  }
};

const downloadText = (filename, content, mime = "text/plain;charset=utf-8") => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const handleGenerate = async () => {
  if (isBusy) return;
  const payload = getPayload();
  if (!payload || !payload.text) {
    setStatus("Enter notes first", "error");
    showToast("Please enter notes to generate output", "error");
    return;
  }
  setBusy(true);
  setStatus("Generating...");
  try {
    const response = await requestJson("/api/writer/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentRunId = response.runId;
    currentOutput = response.output || "";
    renderOutput(currentOutput);
    setWordCount(response.meta?.wordCount ?? computeWordCount(currentOutput));
    setStatus("Output ready");
  } catch (error) {
    console.error(error);
    if (handleInvalidOpenAiKeyError(error)) {
      return;
    }
    if (!handleWriterConfigError(error)) {
      setStatus("Failed to generate", "error");
      showToast(error.message || "Unable to generate writer output", "error");
    }
  } finally {
    setBusy(false);
  }
};

const handleRefine = async () => {
  if (isBusy) return;
  const instruction = writerRefineInstruction?.value;
  if (!instruction) {
    showToast("Select a refine instruction", "error");
    return;
  }
  const payload = getPayload();
  if (!payload) {
    showToast("Missing inputs", "error");
    return;
  }
  payload.instruction = instruction;
  if (currentRunId) {
    payload.runId = currentRunId;
  }
  setBusy(true);
  setStatus("Refining...");
  try {
    const response = await requestJson("/api/writer/refine", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentOutput = response.output || "";
    renderOutput(currentOutput);
    setWordCount(response.meta?.wordCount ?? computeWordCount(currentOutput));
    setStatus("Refine complete");
  } catch (error) {
    console.error(error);
    if (handleInvalidOpenAiKeyError(error)) {
      return;
    }
    if (!handleWriterConfigError(error)) {
      setStatus("Refine failed", "error");
      showToast(error.message || "Unable to refine output", "error");
    }
  } finally {
    setBusy(false);
  }
};

const handleClear = () => {
  if (writerInput) {
    writerInput.value = "";
  }
  currentOutput = "";
  currentRunId = null;
  renderOutput("");
  setWordCount(0);
  setStatus("Ready");
  updateCounters();
};

const handleCopy = async () => {
  if (!currentOutput) {
    showToast("Nothing to copy", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(currentOutput);
    showToast("Output copied", "success");
  } catch (error) {
    console.error(error);
    showToast("Copy failed", "error");
  }
};

const handleDownload = (format) => {
  if (!currentOutput) {
    showToast("Nothing to download", "error");
    return;
  }
  const filename = `writer-output.${format}`;
  const type = format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
  downloadText(filename, currentOutput, type);
  showToast(`Downloaded ${filename}`, "success");
};

const handleSave = async () => {
  if (!currentRunId) {
    showToast("Generate output before saving", "error");
    return;
  }
  try {
    await requestJson("/api/writer/save", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId }),
    });
    showToast("Saved to history", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to save run", "error");
  }
};

const handleShare = async () => {
  if (!currentRunId) {
    showToast("Generate output before sharing", "error");
    return;
  }
  try {
    const response = await requestJson("/api/writer/share", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId }),
    });
    const shareUrl = `${window.location.origin}${response.urlPath}`;
    window.open(shareUrl, "_blank", "noopener");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Share link opened and copied", "success");
    } else {
      showToast("Share link opened", "success");
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to create share link", "error");
  }
};

const bindEvents = () => {
  writerInput?.addEventListener("input", updateCounters);
  writerGenerateBtn?.addEventListener("click", handleGenerate);
  writerRefineBtn?.addEventListener("click", handleRefine);
  writerClearBtn?.addEventListener("click", handleClear);
  writerCopyBtn?.addEventListener("click", handleCopy);
  writerDownloadTxtBtn?.addEventListener("click", () => handleDownload("txt"));
  writerDownloadMdBtn?.addEventListener("click", () => handleDownload("md"));
  writerSaveBtn?.addEventListener("click", handleSave);
  writerShareBtn?.addEventListener("click", handleShare);
  writerConfigSaveBtn?.addEventListener("click", handleWriterConfigSave);
};

const initWriterFlow = () => {
  if (window[WRITER_INIT_FLAG]) return;
  if (!captureWriterElements()) return;
  window[WRITER_INIT_FLAG] = true;
  updateCounters();
  setStatus("Ready");
  renderOutput("");
  setWordCount(0);
  bindEvents();
  loadWriterConfigPanelState();
};

export { initWriterFlow };
