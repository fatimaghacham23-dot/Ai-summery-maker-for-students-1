import { initSummaryFlow } from "./summary.js";
import { initToolsWorkspace } from "./toolsWorkspace.js";
import { initExamFlow } from "./exams.js";
import { requestJson } from "./api.js";

const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const pageViews = Array.from(document.querySelectorAll(".page-view"));
const viewBreadcrumb = document.getElementById("viewBreadcrumb");
const apiStatusIndicator = document.getElementById("apiStatusIndicator");
const footerVersion = document.getElementById("footerVersion");
const versionMeta = document.querySelector("meta[name=app-version]");

const viewLabels = {
  summary: "Summary Maker",
  exam: "Exam Maker",
};

const setActiveView = (target) => {
  const viewName = target || "summary";
  navLinks.forEach((link) => {
    const isActive = link.dataset.navTarget === viewName;
    link.classList.toggle("active", isActive);
    link.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  pageViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.view === viewName);
  });
  if (viewBreadcrumb) {
    viewBreadcrumb.textContent = `Workspace / ${viewLabels[viewName] || viewLabels.summary}`;
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
  initToolsWorkspace();
  initExamFlow();
  applyVersion();
  checkApiHealth();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
