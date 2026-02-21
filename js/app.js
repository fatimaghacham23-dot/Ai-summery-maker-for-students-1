// =======================
// DOM ELEMENTS
// =======================
const inputText = document.getElementById("inputText");
const outputBox = document.getElementById("outputBox");
const summarizeBtn = document.getElementById("summarizeBtn");
const pasteBtn = document.getElementById("pasteBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const lengthSelect = document.getElementById("lengthSelect");
const formatSelect = document.getElementById("formatSelect");
const statusPill = document.getElementById("statusPill");
const countBadge = document.getElementById("countBadge");

// =======================
// CONFIG
// =======================
const API_ENDPOINT = "http://localhost:3000/api/summarize";
// =======================
// STATE
// =======================
let latestSummary = "";

// =======================
// HELPERS
// =======================
function setLoading(isLoading) {
  summarizeBtn.disabled = isLoading;
  pasteBtn.disabled = isLoading;
  clearBtn.disabled = isLoading;
  copyBtn.disabled = isLoading;
  downloadBtn.disabled = isLoading;
  summarizeBtn.textContent = isLoading ? "Summarizing..." : "Summarize";
}

function setStatus(text) {
  statusPill.textContent = text;
}

function escapeHTML(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

function setOutputPlaceholder(message) {
  outputBox.innerHTML = `<p class="placeholder">${message}</p>`;
}

function setOutputLoading() {
  outputBox.innerHTML = `
    <div class="loading">
      <span class="spinner"></span>
      <span>Generating summary...</span>
    </div>
  `;
}

function setOutputSummary(summary) {
  if (Array.isArray(summary)) {
    outputBox.innerHTML = `
      <ul class="bullet-list">
        ${summary.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
      </ul>
    `;
  } else {
    outputBox.innerHTML = `<p class="summary-text">${escapeHTML(summary)}</p>`;
  }
}

function getWordCount(text) {
  if (!text.trim()) {
    return 0;
  }
  return text.trim().split(/\s+/).length;
}

function updateCounts() {
  const text = inputText.value;
  const words = getWordCount(text);
  countBadge.textContent = `${words} words • ${text.length} chars`;
}

function getSummaryForClipboard(summary) {
  if (Array.isArray(summary)) {
    return summary.join("\n");
  }
  return summary;
}

// =======================
// MAIN ACTION
// =======================
async function runSummarize() {
  const text = inputText.value.trim();
  const length = lengthSelect.value;
  const format = formatSelect.value;

  if (!text) {
    setStatus("Empty input");
    showToast("Please paste text first");
    inputText.focus();
    return;
  }

  setLoading(true);
  setStatus("Summarizing...");
  setOutputLoading();

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        length,
        format,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message = data?.message || data?.error?.message || "Backend error";
      throw new Error(message);
    }

    latestSummary = data.summary;
    setOutputSummary(latestSummary);
    setStatus("Done");
    showToast("Summary ready ✅");
  } catch (err) {
    console.error(err);
    latestSummary = "";
    setStatus("Error");
    setOutputPlaceholder("Failed to generate summary.");
    showToast("API error ❌");
  } finally {
    setLoading(false);
  }
}

// =======================
// BUTTON ACTIONS
// =======================
async function handlePaste() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText) {
      showToast("Clipboard is empty");
      return;
    }
    inputText.value = clipboardText;
    updateCounts();
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    showToast("Unable to access clipboard");
  }
}

async function handleCopy() {
  if (!latestSummary) {
    showToast("Nothing to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(getSummaryForClipboard(latestSummary));
    showToast("Summary copied ✅");
  } catch (err) {
    console.error(err);
    showToast("Copy failed");
  }
}

function handleDownload() {
  if (!latestSummary) {
    showToast("Nothing to download");
    return;
  }

  const content = getSummaryForClipboard(latestSummary);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "summary.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clearAll() {
  inputText.value = "";
  latestSummary = "";
  setOutputPlaceholder("Generate a summary to see it here.");
  setStatus("Ready");
  updateCounts();
}

// =======================
// EVENTS
// =======================
inputText.addEventListener("input", updateCounts);

summarizeBtn.addEventListener("click", runSummarize);
pasteBtn.addEventListener("click", handlePaste);
clearBtn.addEventListener("click", clearAll);
copyBtn.addEventListener("click", handleCopy);
downloadBtn.addEventListener("click", handleDownload);

// =======================
// INIT
// =======================
updateCounts();
setOutputPlaceholder("Generate a summary to see it here.");
setStatus("Ready");
