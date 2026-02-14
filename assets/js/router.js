import { initSummaryFlow } from "./summary.js";
import { initSummaryInputs } from "./toolsWorkspace.js";
import { initExamFlow } from "./exams.js";
import { initImagesFlow } from "./images.js";
import { requestJson } from "./api.js";
import { showToast } from "./ui.js";

const navLinks = Array.from(document.querySelectorAll(".nav-link[data-nav-target]"));
const pageViews = Array.from(document.querySelectorAll(".page-view"));
const viewBreadcrumb = document.getElementById("viewBreadcrumb");
const apiStatusIndicator = document.getElementById("apiStatusIndicator");
const footerVersion = document.getElementById("footerVersion");
const versionMeta = document.querySelector("meta[name=app-version]");

const viewLabels = {
  summary: "Summary",
  exam: "Exam",
  history: "History",
  images: "Visuals",
};

const SAVED_SUMMARIES_STORAGE_KEY = "saved-summaries";
const SAVED_VISUALS_STORAGE_KEY = "saved-visuals";

const libraryGrid = document.getElementById("learningLibraryGrid");
const libraryFilterButtons = Array.from(document.querySelectorAll("[data-library-filter]"));
let activeLibraryFilter = "all";

const renderEmptyState = ({ title, subtitle }) => `
  <div class="empty-state">
    <svg class="empty-state-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 8v5l3 2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M21 12a9 9 0 1 1-3.2-6.8"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M21 4v5h-5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <p class="empty-state-title">${title}</p>
    <p class="empty-state-subtitle">${subtitle}</p>
  </div>
`;

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

const getSavedVisuals = () => {
  try {
    const raw = window.localStorage.getItem(SAVED_VISUALS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveVisuals = (items) => {
  try {
    window.localStorage.setItem(SAVED_VISUALS_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error(error);
  }
};

const safeDate = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const escapeHtml = (value) =>
  String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const typeIcons = {
  summary: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 4h7l3 3v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M15 4v3a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `,
  exam: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7l9-4 9 4-9 4-9-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M7 10v5c0 2 3 4 5 4s5-2 5-4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M21 7v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `,
  visual: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="none" stroke="currentColor" stroke-width="2" />
      <polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
};

const renderLibraryEmptyState = ({ type }) => {
  if (!libraryGrid) return;
  const labelMap = {
    all: { title: "No library items yet", subtitle: "Generate a summary, exam, or visual to build your library.", cta: "Go to Summary", target: "summary" },
    summary: { title: "No summaries yet", subtitle: "Your saved summaries will appear here.", cta: "Generate a summary", target: "summary" },
    exam: { title: "No exams yet", subtitle: "Your generated exams will appear here.", cta: "Generate an exam", target: "exam" },
    visual: { title: "No visuals yet", subtitle: "Go generate your first diagram.", cta: "Generate a visual", target: "images" },
  };
  const payload = labelMap[type] || labelMap.all;
  libraryGrid.innerHTML = `
    <div class="card library-card">
      ${renderEmptyState({ title: payload.title, subtitle: payload.subtitle })}
      <div class="library-actions" style="justify-content:center;">
        <button type="button" class="btn primary" data-library-cta="${payload.target}">${payload.cta}</button>
      </div>
    </div>
  `;
  const ctaBtn = libraryGrid.querySelector("[data-library-cta]");
  ctaBtn?.addEventListener("click", () => setActiveView(payload.target));
};

const normalizeSummaryItem = (item) => {
  const createdAt = item.createdAt || null;
  return {
    id: String(item.id || ""),
    type: "summary",
    title: item.title || "Saved summary",
    createdAt,
    preview: item.preview || "",
    content: item.content || "",
  };
};

const normalizeVisualItem = (item) => {
  const createdAt = item.createdAt || null;
  const prompt = item.usedPrompt || item.prompt || "";
  const imageUrl =
    item.url ||
    (item.imageBase64 ? `data:${item.mimeType || "image/png"};base64,${item.imageBase64}` : "");
  return {
    id: String(item.id || ""),
    type: "visual",
    title: item.style ? `${item.style} visual` : "Saved visual",
    createdAt,
    prompt,
    style: item.style || "",
    size: item.size || "",
    quality: item.quality || "",
    url: imageUrl,
  };
};

const normalizeExamItem = (exam) => {
  return {
    id: String(exam.id || ""),
    type: "exam",
    title: exam.title || "Untitled exam",
    createdAt: exam.createdAt || null,
    difficulty: exam.difficulty || exam.config?.difficulty || "",
    questionCount: exam.questionCount || exam.config?.questionCount || 0,
  };
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

const downloadImage = (url) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = "visual.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const renderVisualLibraryCard = (item) => {
  const promptText = escapeHtml(item.prompt || "Saved visual");
  const styleLabel = escapeHtml(item.style || "prompt-only");
  const sizeLabel = escapeHtml(item.size || "1024x1024");
  const qualityLabel = escapeHtml(item.quality || "standard");
  const imageSrc = escapeHtml(item.url || "");
  const hasImage = Boolean(item.url);
  const dateLabel = safeDate(item.createdAt)?.toLocaleString() || "";
  const placeholderImage = `<div class="visual-image visual-image--empty">No image</div>`;
  return `
    <article class="card library-card visual-card" data-library-id="${escapeHtml(item.id)}" data-library-type="visual">
      <div class="visual-image-wrap">
        ${hasImage ? `<img class="visual-image" src="${imageSrc}" alt="Saved visual" loading="lazy" />` : placeholderImage}
      </div>
      <div class="visual-meta">
        <div class="visual-prompt">${promptText}</div>
        <div class="visual-tags">
          <span class="visual-tag">Style: ${styleLabel}</span>
          <span class="visual-tag">Size: ${sizeLabel}</span>
          <span class="visual-tag">Quality: ${qualityLabel}</span>
        </div>
        <div class="visual-actions">
          <button type="button" class="btn secondary" data-visual-action="save" data-library-id="${escapeHtml(item.id)}">
            Save
          </button>
          <button type="button" class="btn ghost" data-visual-action="copy" data-library-id="${escapeHtml(item.id)}">
            Copy prompt
          </button>
        </div>
      </div>
      <div class="library-actions">
        ${dateLabel ? `<span class="library-date">${escapeHtml(dateLabel)}</span>` : ""}
        <button type="button" class="btn ghost" data-library-action="open">Open</button>
        <button type="button" class="btn ghost" data-library-action="download">Download</button>
        <button type="button" class="btn ghost" data-library-action="delete">Delete</button>
      </div>
    </article>
  `;
};

const handleVisualAction = async (action, id) => {
  if (!action || !id) return;
  const existingVisuals = getSavedVisuals();
  const entry = existingVisuals.find((visual) => String(visual.id) === String(id));
  if (!entry) return;

  if (action === "save") {
    const next = [entry, ...existingVisuals.filter((visual) => String(visual.id) !== String(id))].slice(0, 50);
    saveVisuals(next);
    showToast("Saved to history", "success");
    await renderLearningLibrary();
    return;
  }

  if (action === "copy") {
    const promptText = entry.usedPrompt || entry.prompt || "";
    if (!promptText) {
      showToast("Prompt is empty", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(promptText);
      showToast("Prompt copied", "success");
    } catch (error) {
      console.error(error);
      showToast("Unable to copy", "error");
    }
  }
};

const renderLibraryCard = (item) => {
  if (item.type === "visual") {
    return renderVisualLibraryCard(item);
  }
  const dateLabel = safeDate(item.createdAt)?.toLocaleString() || "";
  const typeLabel = item.type === "summary" ? "Summary" : item.type === "exam" ? "Exam" : "Visual";
  const meta =
    item.type === "exam"
      ? `${escapeHtml(item.difficulty || "")} · ${escapeHtml(String(item.questionCount || 0))} questions`
      : item.type === "visual"
        ? escapeHtml(item.prompt || "")
        : escapeHtml(item.preview || "");

  const thumb =
    item.type === "visual" && item.url
      ? `<div class="library-thumb"><img src="${escapeHtml(item.url)}" alt="Saved visual" loading="lazy" /></div>`
      : "";

  return `
    <article class="card library-card" data-library-id="${escapeHtml(item.id)}" data-library-type="${escapeHtml(item.type)}">
      <div class="library-card-top">
        <div>
          <div class="library-type">${typeIcons[item.type] || ""}<span>${typeLabel}</span></div>
          <h3 class="library-title">${escapeHtml(item.title)}</h3>
          ${dateLabel ? `<p class="library-meta">${escapeHtml(dateLabel)}</p>` : ""}
        </div>
      </div>
      ${meta ? `<p class="library-preview">${meta}</p>` : ""}
      ${thumb}
      <div class="library-actions">
        <button type="button" class="btn ghost" data-library-action="open">Open</button>
        <button type="button" class="btn ghost" data-library-action="download">Download</button>
        <button type="button" class="btn ghost" data-library-action="delete">Delete</button>
      </div>
    </article>
  `;
};

const applyLibraryFilterUi = (value) => {
  activeLibraryFilter = value;
  libraryFilterButtons.forEach((btn) => {
    const isActive = btn.dataset.libraryFilter === value;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
};

const getLibraryFilter = () => activeLibraryFilter || "all";

const renderLearningLibrary = async () => {
  if (!libraryGrid) return;
  const summaries = getSavedSummaries().map(normalizeSummaryItem);
  const visuals = getSavedVisuals().map(normalizeVisualItem);
  let exams = [];
  try {
    const apiExams = await requestJson("/api/exams", { cache: "no-store" });
    exams = Array.isArray(apiExams) ? apiExams.map(normalizeExamItem) : [];
  } catch (error) {
    console.error(error);
  }

  const all = [...summaries, ...exams, ...visuals]
    .filter((item) => item && item.id)
    .sort((a, b) => {
      const at = safeDate(a.createdAt)?.getTime() ?? 0;
      const bt = safeDate(b.createdAt)?.getTime() ?? 0;
      return bt - at;
    });

  const filter = getLibraryFilter();
  const filtered =
    filter === "all" ? all : all.filter((item) => item.type === filter);

  if (!filtered.length) {
    renderLibraryEmptyState({ type: filter });
    return;
  }

  libraryGrid.innerHTML = filtered.map(renderLibraryCard).join("");

  libraryGrid.querySelectorAll("[data-library-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-library-id]");
      if (!card) return;
      const id = card.dataset.libraryId;
      const type = card.dataset.libraryType;
      const action = button.dataset.libraryAction;

      if (action === "open") {
        if (type === "summary") {
          const item = getSavedSummaries().find((x) => String(x.id) === String(id));
          if (!item?.content) return;
          try {
            await navigator.clipboard.writeText(item.content);
          } catch (error) {
            console.error(error);
          }
          setActiveView("summary");
          return;
        }
        if (type === "exam") {
          setActiveView("exam");
          window.dispatchEvent(new CustomEvent("library:open-exam", { detail: { examId: id } }));
          return;
        }
        if (type === "visual") {
          const item = getSavedVisuals().find((x) => String(x.id) === String(id));
          if (item?.url) {
            window.open(item.url, "_blank", "noopener");
          }
        }
      }

      if (action === "download") {
        if (type === "summary") {
          const item = getSavedSummaries().find((x) => String(x.id) === String(id));
          if (item?.content) {
            downloadText("summary.txt", item.content);
          }
          return;
        }
        if (type === "exam") {
          window.open(`/api/exams/${id}/export?format=html`, "_blank", "noopener");
          return;
        }
        if (type === "visual") {
          const item = getSavedVisuals().find((x) => String(x.id) === String(id));
          if (item?.url) downloadImage(item.url);
        }
      }

      if (action === "delete") {
        if (type === "summary") {
          const next = getSavedSummaries().filter((x) => String(x.id) !== String(id));
          saveSummaries(next);
          renderLearningLibrary();
          return;
        }
        if (type === "visual") {
          const next = getSavedVisuals().filter((x) => String(x.id) !== String(id));
          saveVisuals(next);
          renderLearningLibrary();
          return;
        }
        if (type === "exam") {
          try {
            await requestJson(`/api/exams/${id}`, { method: "DELETE" });
          } catch (error) {
            console.error(error);
          }
          renderLearningLibrary();
        }
      }
    });
  });

  libraryGrid.querySelectorAll("[data-visual-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = button.dataset.visualAction;
      const card = button.closest("[data-library-id]");
      const id = card?.dataset.libraryId;
      if (!action || !id) return;
      handleVisualAction(action, id);
    });
  });
};


const refreshHistoryView = async () => {
  await renderLearningLibrary();
};

const handleLibraryUpdated = () => {
  if (activeViewName === "history") {
    refreshHistoryView();
  }
};

window.addEventListener("library:updated", handleLibraryUpdated);

const bindLibraryFilters = () => {
  if (!libraryFilterButtons.length) return;
  libraryFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.libraryFilter || "all";
      applyLibraryFilterUi(next);
      renderLearningLibrary();
    });
  });
};

let activeViewName = null;

const setActiveView = (target) => {
  const viewName = target || "summary";
  activeViewName = viewName;
  navLinks.forEach((link) => {
    const isActive = link.dataset.navTarget === viewName;
    const isHeaderPill = Boolean(link.closest(".header-nav-pill"));
    const shouldSuppressHeaderActive = isHeaderPill && viewName === "history";
    link.classList.toggle("active", isActive);
    if (shouldSuppressHeaderActive) {
      link.classList.remove("active");
    }
    link.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (shouldSuppressHeaderActive) {
      link.setAttribute("aria-pressed", "false");
    }
  });
  pageViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.view === viewName);
  });
  if (viewBreadcrumb) {
    viewBreadcrumb.textContent = `Workspace / ${viewLabels[viewName] || viewLabels.summary}`;
  }

  if (viewName === "history") {
    refreshHistoryView();
  }
};

const handleNavClick = (event) => {
  const button = event.currentTarget;
  const target = button.dataset.navTarget;
  if (!target) return;
  setActiveView(target);
};

const applyVersion = () => {
  const versionValue = versionMeta?.getAttribute("content")?.trim();
  if (!footerVersion || !versionValue) return;
  footerVersion.textContent = `Version ${versionValue}`;
};

const checkApiHealth = async () => {
  if (!apiStatusIndicator) return;
  try {
    await requestJson("/health", { cache: "no-store" });
    apiStatusIndicator.textContent = "API online";
    apiStatusIndicator.className = "status-chip online";
  } catch (error) {
    console.error(error);
    apiStatusIndicator.textContent = "API offline";
    apiStatusIndicator.className = "status-chip offline";
  }
};

const bootstrap = () => {
  setActiveView("summary");
  navLinks.forEach((link) => link.addEventListener("click", handleNavClick));
  initSummaryFlow();
  initSummaryInputs();
  initExamFlow();
  initImagesFlow();
  bindLibraryFilters();
  applyVersion();
  checkApiHealth();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
