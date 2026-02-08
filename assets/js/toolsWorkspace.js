import { buildApiUrl, requestJson } from "./api.js";
import { showToast } from "./ui.js";
import {
  setSummaryText,
} from "./summary.js";

const pdfInput = document.getElementById("pdfUploadInput");
const pdfBtn = document.getElementById("pdfUploadBtn");
const urlInput = document.getElementById("toolsUrlInput");
const urlFetchBtn = document.getElementById("toolsUrlFetch");
const youtubeInput = document.getElementById("toolsYouTubeInput");
const youtubeFetchBtn = document.getElementById("toolsYouTubeFetch");
const youtubePastePanel = document.getElementById("youtubePastePanel");
const youtubeTranscriptPaste = document.getElementById("youtubeTranscriptPaste");
const youtubeOpenInstructions = document.getElementById("youtubeOpenInstructions");
const youtubeOpenVideo = document.getElementById("youtubeOpenVideo");
const youtubeSubmitTranscript = document.getElementById("youtubeSubmitTranscript");
let currentDocumentId = null;

const MIN_YOUTUBE_TRANSCRIPT_CHARS = 200;

const extractYouTubeVideoId = (rawUrl) => {
  if (!rawUrl) {
    return null;
  }
  const value = String(rawUrl).trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isYouTube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
    if (!isYouTube) {
      return null;
    }

    const patterns = [
      /(?:youtu\.be\/|\/shorts\/|\/embed\/|\/v\/|v=)([A-Za-z0-9_-]{11})/i,
    ];
    const haystack = `${parsed.href} ${parsed.pathname} ${parsed.search}`;
    for (const pattern of patterns) {
      const match = haystack.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    const v = parsed.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
      return v;
    }
  } catch {
    const match = value.match(/(?:youtu\.be\/|\/shorts\/|\/embed\/|\/v\/|v=)([A-Za-z0-9_-]{11})/i);
    return match?.[1] || null;
  }
  return null;
};

const buildYouTubeWatchUrl = (videoId) =>
  videoId ? `https://www.youtube.com/watch?v=${videoId}` : "https://www.youtube.com";

const showYouTubePastePanel = () => {
  if (!youtubePastePanel) {
    return;
  }
  youtubePastePanel.hidden = false;
  youtubeTranscriptPaste?.focus?.();
};

const hideYouTubePastePanel = () => {
  if (!youtubePastePanel) {
    return;
  }
  youtubePastePanel.hidden = true;
};

const initTabs = () => {
  const roots = Array.from(document.querySelectorAll(".tabs[data-tabs]"));
  roots.forEach((root) => {
    const tabs = Array.from(root.querySelectorAll(".tabs-list [data-tab]"));
    const panels = Array.from(root.querySelectorAll(".tabs-panels [data-panel]"));
    if (!tabs.length || !panels.length) return;

    const activate = (name) => {
      tabs.forEach((tab) => {
        const isActive = tab.dataset.tab === name;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      panels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === name);
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activate(tab.dataset.tab));
    });
  });
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

const initSummaryInputs = () => {
  initTabs();

  pdfBtn?.addEventListener("click", () => pdfInput?.click());
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
    hideYouTubePastePanel();
    try {
      const data = await fetchDocument(youtubeInput.value, "/api/inputs/youtube");
      if (data?.action === "PASTE_TRANSCRIPT") {
        showToast("Paste transcript required", "info");
        showYouTubePastePanel();
        return;
      }
      if (data?.text) {
        setSummaryText(data.text);
        currentDocumentId = data.documentId;
        showToast("Transcript loaded", "success");
        return;
      }
      showToast("Unable to load transcript automatically", "error");
    } catch (error) {
      showToast(error.message, "error");
      showYouTubePastePanel();
    }
  });

  youtubeOpenInstructions?.addEventListener("click", () => {
    const instructions = document.getElementById("youtubeInstructions");
    if (instructions) {
      const nextHidden = !instructions.hidden;
      instructions.hidden = nextHidden;
    }
    showYouTubePastePanel();
  });

  youtubeOpenVideo?.addEventListener("click", () => {
    const videoId = extractYouTubeVideoId(youtubeInput?.value);
    window.open(buildYouTubeWatchUrl(videoId), "_blank", "noopener,noreferrer");
  });

  youtubeSubmitTranscript?.addEventListener("click", async () => {
    const raw = youtubeTranscriptPaste?.value || "";
    const cleaned = String(raw).trim();
    if (cleaned.length < MIN_YOUTUBE_TRANSCRIPT_CHARS) {
      showToast(`Transcript too short (min ${MIN_YOUTUBE_TRANSCRIPT_CHARS} chars)`, "error");
      return;
    }
    const videoId = extractYouTubeVideoId(youtubeInput?.value);
    try {
      const response = await requestJson("/api/inputs/text", {
        method: "POST",
        body: JSON.stringify({
          text: cleaned,
          source: "youtube",
          videoId: videoId || null,
          url: videoId ? buildYouTubeWatchUrl(videoId) : null,
        }),
      });
      if (response?.text) {
        setSummaryText(response.text);
        currentDocumentId = response.documentId;
        showToast("Transcript loaded", "success");
        hideYouTubePastePanel();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  handleFileInput(pdfInput, "/api/inputs/upload");
};

export { initSummaryInputs };
