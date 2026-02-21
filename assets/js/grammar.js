import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

let grammarRoot = null;
let grammarGoal = null;
let grammarTone = null;
let grammarDialect = null;
let grammarLevel = null;
let grammarPreserveMeaning = null;
let grammarPreserveFormatting = null;
let grammarExplainChanges = null;
let grammarInput = null;
let grammarFixBtn = null;
let grammarRefineBtn = null;
let grammarRefineInstruction = null;
let grammarStatusNote = null;
let grammarCorrectedText = null;
let grammarExplanations = null;
let grammarExplanationList = null;
let grammarCopyBtn = null;
let grammarDownloadBtn = null;
let grammarSaveBtn = null;
let grammarShareBtn = null;
let grammarHistoryList = null;
let grammarHistoryPlaceholder = null;

const GRAMMAR_INIT_FLAG = "__grammarFlowInitialized";

let isBusy = false;
let currentRunId = null;
let currentCorrected = "";
let historyItems = [];

const escapeHtml = (value) =>
  String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const captureGrammarElements = () => {
  const root = document.querySelector('[data-tab-panel="grammar"]');
  if (!root) {
    console.error("Grammar panel missing");
    return null;
  }
  const find = (selector, description) => {
    const element = root.querySelector(selector);
    if (!element) {
      console.error(`Missing ${description || selector} in grammar panel`);
    }
    return element;
  };
  grammarRoot = root;
  grammarGoal = find("#grammarGoal", "goal select");
  grammarTone = find("#grammarTone", "tone select");
  grammarDialect = find("#grammarDialect", "dialect select");
  grammarLevel = find("#grammarLevel", "level select");
  grammarPreserveMeaning = find("#grammarPreserveMeaning", "preserve meaning toggle");
  grammarPreserveFormatting = find("#grammarPreserveFormatting", "preserve formatting toggle");
  grammarExplainChanges = find("#grammarExplainChanges", "explain changes toggle");
  grammarInput = find("#grammarInput", "input textarea");
  grammarFixBtn = find("#grammarFixBtn", "fix button");
  grammarRefineBtn = find("#grammarRefineBtn", "refine button");
  grammarRefineInstruction = find("#grammarRefineInstruction", "refine instruction input");
  grammarStatusNote = find("#grammarStatusNote", "status note");
  grammarCorrectedText = find("#grammarCorrectedText", "corrected text");
  grammarExplanations = find("#grammarExplanations", "explanations panel");
  grammarExplanationList = find("#grammarExplanationList", "explanations list");
  grammarCopyBtn = find("#grammarCopyBtn", "copy button");
  grammarDownloadBtn = find("#grammarDownloadBtn", "download button");
  grammarSaveBtn = find("#grammarSaveBtn", "save button");
  grammarShareBtn = find("#grammarShareBtn", "share button");
  grammarHistoryList = find("#grammarHistoryList", "history list");
  grammarHistoryPlaceholder = find("#grammarHistoryPlaceholder", "history placeholder");
  return true;
};

const setStatus = (text, variant = "neutral") => {
  if (!grammarStatusNote) return;
  grammarStatusNote.textContent = text;
  grammarStatusNote.classList.toggle("status-note--error", variant === "error");
};

const setBusy = (loading) => {
  isBusy = loading;
  const toggles = [
    grammarFixBtn,
    grammarRefineBtn,
    grammarCopyBtn,
    grammarDownloadBtn,
    grammarSaveBtn,
    grammarShareBtn,
    grammarRefineInstruction,
  ];
  toggles.forEach((control) => {
    if (control) {
      control.disabled = loading;
    }
  });
};

const renderCorrectedText = (text) => {
  if (!grammarCorrectedText) return;
  grammarCorrectedText.textContent = text || "Corrected text will appear here.";
};

const renderExplanations = (explanations = []) => {
  if (!grammarExplanations || !grammarExplanationList) return;
  if (!Array.isArray(explanations) || !explanations.length) {
    grammarExplanationList.innerHTML = "";
    grammarExplanations.hidden = true;
    return;
  }
  const markup = explanations
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.type || "Change")}</strong>
          <p class="helper-text">Before: ${escapeHtml(item.before || "")}</p>
          <p class="helper-text">After: ${escapeHtml(item.after || "")}</p>
          <p class="helper-text">${escapeHtml(item.reason || "")}</p>
        </li>
      `
    )
    .join("");
  grammarExplanationList.innerHTML = markup;
  grammarExplanations.hidden = false;
};

const prepareFixPayload = () => ({
  text: grammarInput?.value?.trim() || "",
  goal: grammarGoal?.value || "grammar",
  tone: grammarTone?.value || "neutral",
  dialect: grammarDialect?.value || "US",
  level: grammarLevel?.value || "standard",
  preserveMeaning: grammarPreserveMeaning?.checked ?? true,
  preserveFormatting: grammarPreserveFormatting?.checked ?? true,
  explainChanges: grammarExplainChanges?.checked ?? false,
});

const downloadText = (filename, content) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const handleFixGrammar = async () => {
  if (isBusy) return;
  const payload = prepareFixPayload();
  if (!payload.text) {
    showToast("Please paste text before fixing grammar.", "error");
    grammarInput?.focus();
    return;
  }
  setBusy(true);
  setStatus("Fixing grammar...");
  renderExplanations([]);
  try {
    const response = await requestJson("/api/grammar/fix", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentRunId = response.runId;
    currentCorrected = response.corrected || "";
    renderCorrectedText(currentCorrected);
    renderExplanations(response.explanations);
    setStatus("Grammar fixed");
    showToast("Grammar updated", "success");
    await loadHistory();
  } catch (error) {
    console.error(error);
    setStatus("Fix failed", "error");
    showToast(error?.message || "Grammar fix failed", "error");
  } finally {
    setBusy(false);
  }
};

const handleRefineGrammar = async () => {
  if (isBusy) return;
  const instruction = grammarRefineInstruction?.value?.trim() || "";
  if (!instruction) {
    showToast("Add a refinement instruction first.", "error");
    grammarRefineInstruction?.focus();
    return;
  }
  if (!currentRunId) {
    showToast("Run a grammar fix before refining.", "error");
    return;
  }
  setBusy(true);
  setStatus("Refining...");
  try {
    const response = await requestJson("/api/grammar/refine", {
      method: "POST",
      body: JSON.stringify({
        runId: currentRunId,
        instructions: instruction,
      }),
    });
    currentRunId = response.runId;
    currentCorrected = response.corrected || "";
    renderCorrectedText(currentCorrected);
    renderExplanations(response.explanations);
    setStatus("Refinement applied");
    showToast("Refined grammar", "success");
    await loadHistory();
  } catch (error) {
    console.error(error);
    setStatus("Refine failed", "error");
    showToast(error?.message || "Grammar refine failed", "error");
  } finally {
    setBusy(false);
  }
};

const refreshHistoryList = () => {
  if (!grammarHistoryList) return;
  if (!historyItems.length) {
    grammarHistoryList.innerHTML = "";
    grammarHistoryPlaceholder?.removeAttribute("hidden");
    return;
  }
  grammarHistoryPlaceholder?.setAttribute("hidden", "hidden");
  const markup = historyItems
    .map((item) => {
      const dateLabel = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
      const meta = [item.meta.goal, item.meta.tone].filter(Boolean).join(" · ");
      return `
        <li>
          <button type="button" class="history-item-btn" data-run-id="${escapeHtml(item.id)}">
            <div class="history-card-top">
              <strong>${escapeHtml(meta || "Grammar fix")}</strong>
              ${dateLabel ? `<span class="library-meta">${escapeHtml(dateLabel)}</span>` : ""}
            </div>
            <p class="library-preview">${escapeHtml(item.snippet)}</p>
          </button>
        </li>
      `;
    })
    .join("");
  grammarHistoryList.innerHTML = markup;
};

const loadHistory = async () => {
  if (!grammarHistoryList) return;
  try {
    const response = await requestJson("/api/grammar/history", { cache: "no-store" });
    historyItems = Array.isArray(response) ? response : [];
    refreshHistoryList();
  } catch (error) {
    console.error(error);
  }
};

const handleHistorySelection = async (event) => {
  const runId = event;
  if (!runId) return;
  setStatus("Loading run...");
  try {
    const payload = await requestJson(`/api/persistence/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });
    const outputData = payload.output?.data || {};
    grammarInput.value = payload.inputText || "";
    currentRunId = runId;
    currentCorrected = outputData.corrected || "";
    renderCorrectedText(currentCorrected);
    renderExplanations(outputData.explanations || []);
    setStatus("Run loaded");
  } catch (error) {
    console.error(error);
    setStatus("Unable to load run", "error");
    showToast(error?.message || "Failed to load history run", "error");
  }
};

const handleHistoryClick = (event) => {
  const button = event.target.closest("[data-run-id]");
  if (!button) return;
  event.preventDefault();
  handleHistorySelection(button.dataset.runId);
};

const handleCopy = async () => {
  if (!currentCorrected) {
    showToast("Nothing to copy", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(currentCorrected);
    showToast("Copied to clipboard", "success");
  } catch (error) {
    console.error(error);
    showToast("Copy failed", "error");
  }
};

const handleDownload = () => {
  if (!currentCorrected) {
    showToast("Nothing to download", "error");
    return;
  }
  const filename = currentRunId ? `grammar-${currentRunId}.txt` : "grammar-fix.txt";
  downloadText(filename, currentCorrected);
};

const handleSave = async () => {
  if (!currentRunId) {
    showToast("Run an analysis before saving", "error");
    return;
  }
  try {
    await requestJson("/api/grammar/save", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId }),
    });
    showToast("Saved to library", "success");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Save failed", "error");
  }
};

const handleShare = async () => {
  if (!currentRunId) {
    showToast("Run an analysis before sharing", "error");
    return;
  }
  try {
    const response = await requestJson("/api/grammar/share", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId }),
    });
    const shareUrl = `${window.location.origin}${response.urlPath || ""}`;
    await navigator.clipboard.writeText(shareUrl);
    showToast(`Share link copied: ${shareUrl}`, "success");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Share failed", "error");
  }
};

const initGrammarFlow = () => {
  if (window[GRAMMAR_INIT_FLAG]) {
    return;
  }
  if (!captureGrammarElements()) {
    return;
  }
  grammarFixBtn?.addEventListener("click", handleFixGrammar);
  grammarRefineBtn?.addEventListener("click", handleRefineGrammar);
  grammarCopyBtn?.addEventListener("click", handleCopy);
  grammarDownloadBtn?.addEventListener("click", handleDownload);
  grammarSaveBtn?.addEventListener("click", handleSave);
  grammarShareBtn?.addEventListener("click", handleShare);
  grammarHistoryList?.addEventListener("click", handleHistoryClick);
  loadHistory();
  window[GRAMMAR_INIT_FLAG] = true;
};

export { initGrammarFlow };
