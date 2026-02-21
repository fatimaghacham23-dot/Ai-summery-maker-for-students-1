import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

let songRoot = null;
let songPrompt = null;
let songGenre = null;
let songStructure = null;
let songLength = null;
let songMood = null;
let songLanguage = null;
let songExplicit = null;
let songIncludeChords = null;
let songIncludeTitleIdeas = null;
let songGenerateBtn = null;
let songRefineBtn = null;
let songRefineInstruction = null;
let songRhymeScheme = null;
let songSyllables = null;
let songReferenceArtists = null;
let songStatusNote = null;
let songWordCount = null;
let songCopyBtn = null;
let songDownloadBtn = null;
let songSaveBtn = null;
let songShareBtn = null;
let songResultTitle = null;
let songResultLyrics = null;
let songTitleIdeas = null;
let songTitleIdeasList = null;
let songHistoryList = null;
let songHistoryPlaceholder = null;

const SONG_INIT_FLAG = "__songFlowInitialized";

let isBusy = false;
let currentRunId = null;
let currentPrompt = "";
let historyItems = [];

const captureElements = () => {
  const root = document.querySelector('[data-tab-panel="song"]');
  if (!root) {
    console.error("Song panel missing");
    return null;
  }
  const find = (selector) => root.querySelector(selector);
  songRoot = root;
  songPrompt = find("#songPrompt");
  songGenre = find("#songGenre");
  songStructure = find("#songStructure");
  songLength = find("#songLength");
  songMood = find("#songMood");
  songLanguage = find("#songLanguage");
  songExplicit = find("#songExplicit");
  songIncludeChords = find("#songIncludeChords");
  songIncludeTitleIdeas = find("#songIncludeTitleIdeas");
  songGenerateBtn = find("#songGenerateBtn");
  songRefineBtn = find("#songRefineBtn");
  songRefineInstruction = find("#songRefineInstruction");
  songRhymeScheme = find("#songRhymeScheme");
  songSyllables = find("#songSyllables");
  songReferenceArtists = find("#songReferenceArtists");
  songStatusNote = find("#songStatusNote");
  songWordCount = find("#songWordCount");
  songCopyBtn = find("#songCopyBtn");
  songDownloadBtn = find("#songDownloadBtn");
  songSaveBtn = find("#songSaveBtn");
  songShareBtn = find("#songShareBtn");
  songResultTitle = find("#songResultTitle");
  songResultLyrics = find("#songResultLyrics");
  songTitleIdeas = find("#songTitleIdeas");
  songTitleIdeasList = find("#songTitleIdeasList");
  songHistoryList = find("#songHistoryList");
  songHistoryPlaceholder = find("#songHistoryPlaceholder");
  return true;
};

const setStatus = (text, variant = "neutral") => {
  if (!songStatusNote) return;
  songStatusNote.textContent = text;
  songStatusNote.classList.toggle("status-note--error", variant === "error");
};

const setBusy = (loading) => {
  isBusy = loading;
  const controls = [
    songGenerateBtn,
    songRefineBtn,
    songCopyBtn,
    songDownloadBtn,
    songSaveBtn,
    songShareBtn,
    songRefineInstruction,
  ];
  controls.forEach((control) => {
    if (control) {
      control.disabled = loading;
    }
  });
  if (songGenerateBtn) {
    songGenerateBtn.textContent = loading ? "Generating..." : "Generate";
  }
  if (songRefineBtn) {
    songRefineBtn.textContent = loading ? "Refining..." : "Refine";
  }
};

const updateWordCount = (text) => {
  if (!songWordCount) return;
  const words = text
    ? text
        .trim()
        .split(/\\s+/)
        .filter(Boolean).length
    : 0;
  songWordCount.textContent = `${words} words`;
};

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

const setTitleIdeas = (ideas = []) => {
  if (!songTitleIdeas || !songTitleIdeasList) return;
  songTitleIdeasList.innerHTML = "";
  if (!ideas.length) {
    songTitleIdeas.hidden = true;
    return;
  }
  const fragment = document.createDocumentFragment();
  ideas.forEach((idea) => {
    const item = document.createElement("li");
    item.textContent = idea;
    fragment.appendChild(item);
  });
  songTitleIdeasList.appendChild(fragment);
  songTitleIdeas.hidden = false;
};

const renderOutput = ({ title, lyrics, titleIdeas = [] }) => {
  if (songResultTitle) {
    songResultTitle.textContent = title || "Song title";
  }
  if (songResultLyrics) {
    songResultLyrics.textContent = lyrics || "";
  }
  updateWordCount(lyrics);
  setTitleIdeas(titleIdeas);
};

const refreshHistoryList = () => {
  if (!songHistoryList) return;
  if (!historyItems.length) {
    songHistoryList.innerHTML = "";
    if (songHistoryPlaceholder) {
      songHistoryPlaceholder.hidden = false;
    }
    return;
  }
  songHistoryPlaceholder?.setAttribute("hidden", "hidden");
  const markup = historyItems
    .map((item) => {
      const dateLabel = item.createdAt
        ? new Date(item.createdAt).toLocaleString()
        : "";
      const meta = [item.genre, item.length, item.mood].filter(Boolean).join(" · ");
      return `
        <li>
          <button type="button" class="history-item-btn" data-run-id="${item.id}">
            <div class="history-card-top">
              <strong>${item.title}</strong>
              ${dateLabel ? `<span class="library-meta">${dateLabel}</span>` : ""}
              ${meta ? `<p class="library-preview">${meta}</p>` : ""}
            </div>
            <p class="library-preview">${item.snippet || ""}</p>
          </button>
        </li>
      `;
    })
    .join("");
  songHistoryList.innerHTML = markup;
};

const loadHistory = async () => {
  if (!songHistoryList) return;
  try {
    const response = await requestJson("/api/song/history", { cache: "no-store" });
    historyItems = Array.isArray(response) ? response : [];
    refreshHistoryList();
  } catch (error) {
    console.error(error);
  }
};

const getPayload = () => {
  const promptValue = (songPrompt?.value?.trim() || currentPrompt).trim();
  if (!promptValue) {
    return null;
  }
  const syllables = songSyllables?.value ? Number(songSyllables.value) : null;
  return {
    prompt: promptValue,
    genre: songGenre?.value,
    structure: songStructure?.value,
    length: songLength?.value,
    mood: songMood?.value?.trim(),
    language: songLanguage?.value?.trim(),
    explicit: songExplicit?.checked,
    includeChords: songIncludeChords?.checked,
    includeTitleIdeas: songIncludeTitleIdeas?.checked,
    rhymeScheme: songRhymeScheme?.value?.trim(),
    syllablesPerLine: Number.isFinite(syllables) ? Math.round(syllables) : null,
    referenceArtists: songReferenceArtists?.value?.trim(),
  };
};

const applyHistorySelection = (item) => {
  if (!item) return;
  currentRunId = item.id;
  currentPrompt = item.prompt || "";
  if (songPrompt) {
    songPrompt.value = item.prompt || "";
  }
  if (songGenre) songGenre.value = item.genre || "pop";
  if (songStructure) songStructure.value = item.structure || "verse-chorus";
  if (songLength) songLength.value = item.length || "medium";
  if (songMood) songMood.value = item.mood || "";
  if (songLanguage) songLanguage.value = item.language || "";
  if (songExplicit) songExplicit.checked = Boolean(item.explicit);
  if (songIncludeChords) songIncludeChords.checked = Boolean(item.includeChords);
  if (songIncludeTitleIdeas) songIncludeTitleIdeas.checked = Boolean(item.includeTitleIdeas);
  if (songRhymeScheme) songRhymeScheme.value = item.rhymeScheme || "";
  if (songSyllables) songSyllables.value = item.syllablesPerLine || "";
  if (songReferenceArtists) {
    songReferenceArtists.value = (item.referenceArtists || []).join(", ");
  }
  renderOutput({
    title: item.title,
    lyrics: item.lyrics,
    titleIdeas: item.titleIdeas,
  });
  setStatus("Loaded history run");
};

const handleGenerate = async () => {
  if (isBusy) return;
  const payload = getPayload();
  if (!payload?.prompt) {
    setStatus("Prompt required", "error");
    showToast("Enter a prompt to generate a song", "error");
    return;
  }
  setBusy(true);
  setStatus("Generating...");
  try {
    const response = await requestJson("/api/song/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentRunId = response.runId;
    currentPrompt = payload.prompt;
    renderOutput({
      title: response.title,
      lyrics: response.lyrics,
      titleIdeas: response.titleIdeas,
    });
    setStatus("Song ready");
    await loadHistory();
  } catch (error) {
    console.error(error);
    setStatus("Generation failed", "error");
    showToast(error.message || "Unable to generate song", "error");
  } finally {
    setBusy(false);
  }
};

const handleRefine = async () => {
  if (isBusy) return;
  if (!currentRunId) {
    showToast("Generate a song before refining", "error");
    return;
  }
  const instruction = songRefineInstruction?.value;
  if (!instruction) {
    showToast("Select a refine instruction", "error");
    return;
  }
  const payload = getPayload();
  if (!payload?.prompt) {
    showToast("Prompt is required to refine", "error");
    return;
  }
  payload.runId = currentRunId;
  payload.instruction = instruction;
  setBusy(true);
  setStatus("Refining...");
  try {
    const response = await requestJson("/api/song/refine", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentRunId = response.runId;
    currentPrompt = payload.prompt;
    renderOutput({
      title: response.title,
      lyrics: response.lyrics,
      titleIdeas: response.titleIdeas,
    });
    setStatus("Refine complete");
    await loadHistory();
  } catch (error) {
    console.error(error);
    setStatus("Refine failed", "error");
    showToast(error.message || "Unable to refine song", "error");
  } finally {
    setBusy(false);
  }
};

const handleCopy = async () => {
  const lyrics = songResultLyrics?.textContent || "";
  if (!lyrics) {
    showToast("Nothing to copy", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(lyrics);
    showToast("Lyrics copied", "success");
  } catch (error) {
    console.error(error);
    showToast("Copy failed", "error");
  }
};

const handleDownload = () => {
  const title = songResultTitle?.textContent || "song";
  const lyrics = songResultLyrics?.textContent || "";
  if (!lyrics) {
    showToast("Nothing to download", "error");
    return;
  }
  downloadText(`${title.replace(/\\s+/g, "-").toLowerCase() || "song"}.txt`, `${title}\n\n${lyrics}`);
  showToast("Downloaded song", "success");
};

const handleSave = async () => {
  if (!currentRunId) {
    showToast("Generate a song before saving", "error");
    return;
  }
  try {
    await requestJson("/api/song/save", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId, title: songResultTitle?.textContent }),
    });
    showToast("Song saved", "success");
    await loadHistory();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to save song", "error");
  }
};

const handleShare = async () => {
  if (!currentRunId) {
    showToast("Generate a song before sharing", "error");
    return;
  }
  try {
    const response = await requestJson("/api/song/share", {
      method: "POST",
      body: JSON.stringify({ runId: currentRunId }),
    });
    const url = `${window.location.origin}${response.urlPath}`;
    window.open(url, "_blank", "noopener");
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      showToast("Share link copied and opened", "success");
    } else {
      showToast("Share link opened", "success");
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to create share link", "error");
  }
};

const handleHistoryClick = (event) => {
  const button = event.target.closest("[data-run-id]");
  if (!button) return;
  const runId = button.dataset.runId;
  const entry = historyItems.find((item) => item.id === runId);
  applyHistorySelection(entry);
};

const bindEvents = () => {
  songGenerateBtn?.addEventListener("click", handleGenerate);
  songRefineBtn?.addEventListener("click", handleRefine);
  songCopyBtn?.addEventListener("click", handleCopy);
  songDownloadBtn?.addEventListener("click", handleDownload);
  songSaveBtn?.addEventListener("click", handleSave);
  songShareBtn?.addEventListener("click", handleShare);
  songHistoryList?.addEventListener("click", handleHistoryClick);
};

const initSongFlow = async () => {
  if (window[SONG_INIT_FLAG]) return;
  if (!captureElements()) return;
  window[SONG_INIT_FLAG] = true;
  bindEvents();
  setStatus("Ready");
  updateWordCount("");
  await loadHistory();
};

export { initSongFlow };
