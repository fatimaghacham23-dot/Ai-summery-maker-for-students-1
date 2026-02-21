import { requestJson, ApiError } from "./api.js";
import { showToast } from "./ui.js";

let examRoot = null;
let examText = null;
let examCount = null;
let difficultySelect = null;
let questionCountInput = null;
let strictTypesToggle = null;
let mcqCountInput = null;
let tfCountInput = null;
let shortCountInput = null;
let fillCountInput = null;
let typeStatus = null;
let generateBtn = null;
let clearBtn = null;
let submitBtn = null;
let exportJsonBtn = null;
let exportHtmlBtn = null;
let examMeta = null;
let examQuestions = null;
let resultsPanel = null;
let examStatusText = null;
let examsList = null;
let attemptFilterInput = null;
let attemptSortSelect = null;
let attemptTableBody = null;
let attemptPlaceholder = null;
let knowledgeState = null;
let sourcesList = null;

const captureExamElements = () => {
  const root = document.querySelector('[data-tab-panel="exam"]');
  if (!root) {
    console.error("Exam panel missing");
    return null;
  }
  const find = (selector, description) => {
    const element = root.querySelector(selector);
    if (!element) {
      console.error(`Missing ${description || selector} in exam panel`);
    }
    return element;
  };
  examRoot = root;
  examText = find("#examText", "exam text area");
  examCount = find("#examCountBadge", "exam counter");
  difficultySelect = find("#difficultySelect", "difficulty select");
  questionCountInput = find("#questionCount", "question count input");
  strictTypesToggle = find("#strictTypesToggle", "strict types toggle");
  mcqCountInput = find("#mcqCount", "MCQ count input");
  tfCountInput = find("#tfCount", "true/false count input");
  shortCountInput = find("#shortCount", "short answer count input");
  fillCountInput = find("#fillCount", "fill-in count input");
  typeStatus = find("#typeStatus", "type status indicator");
  generateBtn = find("[data-action=generate-exam]", "generate button");
  clearBtn = find("[data-action=clear-exam]", "clear button");
  submitBtn = find("[data-action=submit-exam]", "submit button");
  exportJsonBtn = find("[data-action=export-json]", "export JSON button");
  exportHtmlBtn = find("[data-action=export-html]", "export HTML button");
  examMeta = find("#examMeta", "exam meta");
  examQuestions = find("#examQuestions", "exam questions");
  resultsPanel = find("#resultsPanel", "results panel");
  examStatusText = find("#examStatusText", "exam status text");
  examsList = find("#examsList", "exam history list");
  attemptFilterInput = find("#attemptFilter", "attempt filter input");
  attemptSortSelect = find("#attemptSort", "attempt sort select");
  attemptTableBody = find("#attemptTableBody", "attempts table body");
  attemptPlaceholder = find("#attemptPlaceholder", "attempt placeholder");
  knowledgeState = find("#knowledgeState", "knowledge state label");
  sourcesList = find("#sourcesList", "knowledge sources list");
  return root;
};

const EXAM_INIT_FLAG = "__examFlowInitialized";

let currentExam = null;
let attemptsHistory = [];
let viewLoading = false;

const setQuietMode = (enabled) => {
  document.body.classList.toggle("quiet-mode", Boolean(enabled));
};

const shouldEnableQuietMode = () => {
  const hasQuestions = Boolean(examQuestions?.children?.length);
  const hasExam = Boolean(currentExam);
  return hasExam && hasQuestions;
};

const syncQuietMode = () => {
  setQuietMode(shouldEnableQuietMode());
};

const escapeHtml = (value) =>
  String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const getTypeCounts = () => ({
  mcq: Number(mcqCountInput?.value || 0),
  trueFalse: Number(tfCountInput?.value || 0),
  shortAnswer: Number(shortCountInput?.value || 0),
  fillBlank: Number(fillCountInput?.value || 0),
});

const updateExamCounter = () => {
  if (!examText || !examCount) return;
  const words = String(examText.value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  examCount.textContent = `${words} words - ${examText.value.length} chars`;
};

const updateTypeStatus = () => {
  if (!typeStatus) return { isValid: true, questionCount: 0, types: getTypeCounts() };
  const questionCount = Number(questionCountInput?.value || 0);
  const types = getTypeCounts();
  const total = Object.values(types).reduce((sum, value) => sum + value, 0);
  const isValid = total === questionCount;
  typeStatus.textContent = `Types total: ${total} / ${questionCount}`;
  typeStatus.classList.toggle("error", !isValid);
  return { isValid, questionCount, types };
};

const setExamStatus = (text) => {
  if (!examStatusText) return;
  examStatusText.textContent = `Status: ${text}`;
};

const setLoadingState = (isLoading) => {
  viewLoading = isLoading;
  if (generateBtn) {
    generateBtn.disabled = isLoading;
    generateBtn.textContent = isLoading ? "Generating..." : "Generate exam";
  }
  if (submitBtn) {
    submitBtn.disabled = isLoading || !currentExam;
  }
  const exportsDisabled = !currentExam;
  if (exportJsonBtn) exportJsonBtn.disabled = exportsDisabled;
  if (exportHtmlBtn) exportHtmlBtn.disabled = exportsDisabled;

  if (isLoading && examQuestions) {
    examQuestions.innerHTML = `
      <div class="loading-placeholder">
        <div class="skeleton" style="height: 18px; width: 55%;"></div>
        <div class="skeleton" style="height: 14px;"></div>
        <div class="skeleton" style="height: 14px; width: 80%;"></div>
        <div class="skeleton" style="height: 14px; width: 90%;"></div>
      </div>
    `;
  }
};

const renderExamMeta = () => {
  if (!examMeta) return;
  if (!currentExam) {
    examMeta.innerHTML = `<p class="placeholder">Generate an exam to unlock the overview.</p>`;
    return;
  }
  const blueprint = (() => {
    const bp = currentExam.blueprint;
    if (Array.isArray(bp)) {
      return bp.join(", ");
    }
    if (bp && Array.isArray(bp.concepts)) {
      return bp.concepts.map((c) => c?.name).filter(Boolean).slice(0, 10).join(", ");
    }
    return "";
  })();

  const dateLabel = new Date(currentExam.createdAt).toLocaleString();
  examMeta.innerHTML = `
    <div class="exam-meta-grid">
      <div>
        <strong>${escapeHtml(currentExam.title || "Untitled exam")}</strong>
        <p class="helper-text">Created ${escapeHtml(dateLabel)}</p>
        ${blueprint ? `<p class="helper-text">Blueprint: ${escapeHtml(blueprint)}</p>` : ""}
      </div>
      <div class="exam-meta-stats">
        <span>${escapeHtml(String(currentExam.config?.difficulty || "N/A")).toUpperCase()}</span>
        <span>${escapeHtml(String(currentExam.config?.questionCount || 0))} questions</span>
        <span>${escapeHtml(String(currentExam.totalPoints || 0))} pts</span>
      </div>
    </div>
  `;
};

const renderExamQuestions = () => {
  if (!examQuestions) return;
  if (!currentExam) {
    examQuestions.innerHTML = "";
    syncQuietMode();
    return;
  }
  const html = currentExam.questions
    .map((question, index) => {
      const header = `
        <div class="question-header">
          <span>Q${index + 1}</span>
          <span>${question.points} pts</span>
        </div>
      `;
      let body = "";
      if (question.type === "mcq") {
        const choices = (question.choices || [])
          .map(
            (choice, idx) => `
              <label class="choice-option">
                <input type="radio" name="${question.id}" value="${String.fromCharCode(65 + idx)}" />
                <span>${String.fromCharCode(65 + idx)}. ${escapeHtml(choice)}</span>
              </label>
            `
          )
          .join("");
        body = `<div class="choice-list">${choices}</div>`;
      } else if (question.type === "trueFalse") {
        body = `
          <p class="question-meta">Classification: ${escapeHtml(question.classification || "Unspecified")}</p>
          <div class="choice-list">
            <label class="choice-option">
              <input type="radio" name="${question.id}" value="true" />
              <span>True</span>
            </label>
            <label class="choice-option">
              <input type="radio" name="${question.id}" value="false" />
              <span>False</span>
            </label>
          </div>
        `;
      } else if (question.type === "shortAnswer") {
        body = `<textarea data-question="${question.id}" rows="3" placeholder="Write your answer..."></textarea>`;
      } else {
        body = `<input data-question="${question.id}" type="text" placeholder="Type your answer" />`;
      }
      return `
        <div class="question-card" data-question-id="${question.id}">
          ${header}
          <p>${escapeHtml(question.prompt)}</p>
          ${body}
        </div>
      `;
    })
    .join("");
  examQuestions.innerHTML = html;
  syncQuietMode();
};

const renderResults = (payload) => {
  if (!resultsPanel) return;
  if (!payload) {
    resultsPanel.innerHTML = `<p class="placeholder">Attempt an exam to see results.</p>`;
    return;
  }
  const questionMap = new Map((currentExam?.questions || []).map((question) => [question.id, question]));
  const summary = `
    <div class="results-summary">
      <h3>Score: ${payload.score?.earned ?? 0} / ${payload.score?.total ?? 0} (${payload.score?.percent ?? 0}%)</h3>
    </div>
  `;
  const list = (payload.results || [])
    .map((result, index) => {
      const question = questionMap.get(result.questionId) || result;
      const isTrueFalse = question?.questionType === "trueFalse" || question?.type === "trueFalse";
      const classification = isTrueFalse ? question?.classification || result.classification : null;
      const explanation = isTrueFalse ? question?.explanation || result.explanation : null;
      return `
        <div class="result-item ${result.correct ? "correct" : "incorrect"}">
          <strong>Q${index + 1}</strong>
          <span>${result.correct ? "Correct" : "Incorrect"}</span>
          <span>${result.earnedPoints}/${result.maxPoints} pts</span>
          ${classification ? `<p class="result-meta">Classification: ${escapeHtml(classification)}</p>` : ""}
          ${explanation ? `<p class="result-meta">${escapeHtml(explanation)}</p>` : ""}
          <p>${escapeHtml(result.feedback || "No feedback provided.")}</p>
        </div>
      `;
    })
    .join("");
  resultsPanel.innerHTML = `${summary}<div class="results-list">${list}</div>`;
};

const renderExamHistory = (items) => {
  if (!examsList) return;
  const listItems = Array.isArray(items) ? items : [];
  examsList.innerHTML = listItems
    .map(
      (exam) => `
        <li>
          <button class="history-btn" type="button" data-exam-id="${exam.id}">
            <strong>${escapeHtml(exam.title || "Untitled")}</strong>
            <span>${escapeHtml(exam.difficulty || "n/a")} - ${escapeHtml(String(exam.questionCount))} Qs</span>
          </button>
        </li>
      `
    )
    .join("");
};

const renderAttemptsTable = () => {
  if (!attemptTableBody) return;
  const filter = attemptFilterInput?.value?.trim().toLowerCase() || "";
  let list = [...attemptsHistory];
  if (filter) {
    list = list.filter(
      (attempt) =>
        attempt.title?.toLowerCase().includes(filter) ||
        attempt.attemptId?.toLowerCase().includes(filter)
    );
  }
  if (attemptSortSelect?.value === "top-score") {
    list.sort((a, b) => (b.scorePercent || 0) - (a.scorePercent || 0));
  } else {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  if (!list.length) {
    attemptTableBody.innerHTML = "";
    if (attemptPlaceholder) attemptPlaceholder.hidden = false;
    return;
  }
  if (attemptPlaceholder) attemptPlaceholder.hidden = true;
  attemptTableBody.innerHTML = list
    .map(
      (attempt) => `
        <tr>
          <td>${escapeHtml(attempt.title || "Exam")}</td>
          <td>${escapeHtml(String(attempt.scorePercent ?? 0))}%</td>
          <td>${escapeHtml(new Date(attempt.createdAt).toLocaleString())}</td>
          <td>
            <button type="button" class="history-btn" data-attempt-id="${attempt.attemptId}">View</button>
          </td>
        </tr>
      `
    )
    .join("");
};

const renderKnowledgeSources = (sources) => {
  if (knowledgeState) {
    knowledgeState.textContent = sources?.length
      ? `${sources.length} source(s) connected.`
      : "No grounding sources available.";
  }
  if (sourcesList) {
    if (!sources?.length) {
      sourcesList.innerHTML = "";
      return;
    }
    sourcesList.innerHTML = sources
      .map(
        (source) => `
          <li><strong>${escapeHtml(source.source)}</strong> - ${escapeHtml(source.license || "License unavailable")}</li>
        `
      )
      .join("");
  }
};

const handleGenerationFailure = (payload) => {
  if (examMeta) {
    const missingText = payload?.missing
      ? Object.entries(payload.missing)
          .map(([type, count]) => `${escapeHtml(type)}: ${escapeHtml(String(count))}`)
          .join(" - ")
      : "We could not satisfy the requested mix.";
    examMeta.innerHTML = `
      <div class="alert">
        <strong>Could not generate full exam</strong>
        <p>${missingText}</p>
        <p class="helper-text">Try lowering difficulty or request fewer questions.</p>
      </div>
    `;
  }
  currentExam = null;
  renderExamQuestions();
  renderResults(null);
  setLoadingState(false);
};

const loadExams = async () => {
  try {
    const data = await requestJson("/api/exams", { cache: "no-store" });
    renderExamHistory(data);
  } catch (error) {
    console.error(error);
    showToast("Unable to load exam history", "error");
  }
};

const loadAttempts = async (examId) => {
  if (!examId) return;
  try {
    const data = await requestJson(`/api/exams/${examId}/attempts`, { cache: "no-store" });
    attemptsHistory = (data || []).map((attempt) => ({
      ...attempt,
      title: currentExam?.title || "Loaded exam",
    }));
    renderAttemptsTable();
  } catch (error) {
    console.error(error);
    showToast("Unable to load attempts", "error");
  }
};

const fetchKnowledgeSources = async () => {
  try {
    const data = await requestJson("/api/knowledge/sources", { cache: "no-store" });
    renderKnowledgeSources(data.sources || []);
  } catch (error) {
    console.error(error);
    if (knowledgeState) {
      knowledgeState.textContent = "Unable to fetch grounding sources.";
    }
  }
};

const gatherAnswers = () => {
  if (!examQuestions || !currentExam) return [];
  return currentExam.questions.map((question) => {
    let value = "";
    if (["mcq", "trueFalse"].includes(question.type)) {
      const selected = examQuestions.querySelector(`input[name="${question.id}"]:checked`);
      value = selected ? selected.value : "";
    } else {
      const input = examQuestions.querySelector(`[data-question="${question.id}"]`);
      value = input ? input.value.trim() : "";
    }
    return {
      questionId: question.id,
      type: question.type,
      value,
    };
  });
};

const handleGenerateExam = async () => {
  if (!examText || !generateBtn) return;
  const text = examText.value.trim();
  if (!text) {
    showToast("Please add study text first", "error");
    return;
  }
  const { isValid, questionCount, types } = updateTypeStatus();
  if (questionCount < 5 || questionCount > 30) {
    showToast("Question count must be between 5 and 30", "error");
    return;
  }
  if (!isValid) {
    showToast("Types total must equal question count", "error");
    return;
  }
  setExamStatus("Generating...");
  setLoadingState(true);
  try {
    const payload = {
      text,
      difficulty: difficultySelect.value,
      questionCount,
      types,
      strictTypes: strictTypesToggle?.checked ?? true,
    };
    const exam = await requestJson("/api/exams/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    currentExam = exam;
    renderExamMeta();
    renderExamQuestions();
    renderResults(null);
    syncQuietMode();
    setExamStatus("Ready");
    showToast("Exam generated", "success");
    await loadExams();
    await loadAttempts(exam.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      handleGenerationFailure(error.data || {});
      setExamStatus("Incomplete");
      showToast("Could not generate full exam", "error");
    } else {
      console.error(error);
      setExamStatus("Error");
      showToast(error.message || "Failed to generate exam", "error");
    }
  } finally {
    setLoadingState(false);
  }
};

const handleSubmitExam = async () => {
  if (!currentExam) {
    showToast("Generate or select an exam first", "error");
    return;
  }
  setExamStatus("Submitting...");
  setLoadingState(true);
  try {
    const answers = gatherAnswers();
    const data = await requestJson(`/api/exams/${currentExam.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ examId: currentExam.id, answers }),
    });
    renderResults(data);
    setQuietMode(false);
    setExamStatus("Graded");
    showToast("Exam submitted", "success");
    await loadAttempts(currentExam.id);
  } catch (error) {
    console.error(error);
    setExamStatus("Error");
    showToast(error.message || "Failed to submit exam", "error");
  } finally {
    setLoadingState(false);
  }
};

const handleExamSelect = async (examId) => {
  if (!examId) return;
  setExamStatus("Loading...");
  try {
    const exam = await requestJson(`/api/exams/${examId}`);
    currentExam = exam;
    renderExamMeta();
    renderExamQuestions();
    renderResults(null);
    syncQuietMode();
    setExamStatus("Ready");
    await loadAttempts(examId);
  } catch (error) {
    console.error(error);
    showToast("Failed to load exam", "error");
    setExamStatus("Error");
  }
};

const handleAttemptView = async (attemptId) => {
  if (!attemptId) return;
  setExamStatus("Loading attempt...");
  try {
    const attempt = await requestJson(`/api/attempts/${attemptId}`);
    renderResults(attempt);
    setExamStatus("Attempt loaded");
  } catch (error) {
    console.error(error);
    showToast("Failed to load attempt", "error");
    setExamStatus("Error");
  }
};

const handleExport = (format) => {
  if (!currentExam) {
    showToast("Select an exam first", "error");
    return;
  }
  const url = `/api/exams/${currentExam.id}/export?format=${format}`;
  window.open(url, "_blank", "noopener");
};

const clearExamInputs = () => {
  if (!examText) return;
  examText.value = "";
  if (questionCountInput) questionCountInput.value = "10";
  if (mcqCountInput) mcqCountInput.value = "4";
  if (tfCountInput) tfCountInput.value = "2";
  if (shortCountInput) shortCountInput.value = "2";
  if (fillCountInput) fillCountInput.value = "2";
  updateExamCounter();
  updateTypeStatus();
  setExamStatus("Idle");
  currentExam = null;
  renderExamMeta();
  renderExamQuestions();
  renderResults(null);
  setQuietMode(false);
};

const bindEvents = () => {
  examText?.addEventListener("input", updateExamCounter);
  [questionCountInput, mcqCountInput, tfCountInput, shortCountInput, fillCountInput].forEach((element) => {
    element?.addEventListener("input", updateTypeStatus);
  });
  [generateBtn, submitBtn, exportJsonBtn, exportHtmlBtn, clearBtn].forEach((button) => {
    button?.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "generate-exam") handleGenerateExam();
      if (action === "submit-exam") handleSubmitExam();
      if (action === "export-json") handleExport("json");
      if (action === "export-html") handleExport("html");
      if (action === "clear-exam") clearExamInputs();
    });
  });
  examsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-exam-id]");
    if (button) {
      handleExamSelect(button.dataset.examId);
    }
  });
  attemptTableBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attempt-id]");
    if (button) {
      handleAttemptView(button.dataset.attemptId);
    }
  });
  attemptFilterInput?.addEventListener("input", renderAttemptsTable);
  attemptSortSelect?.addEventListener("change", renderAttemptsTable);
};

const bindLibraryOpenEvent = () => {
  window.addEventListener("library:open-exam", (event) => {
    const examId = event?.detail?.examId;
    if (!examId) return;
    handleExamSelect(examId);
  });
};

const initExamFlow = () => {
  if (window[EXAM_INIT_FLAG]) return;
  if (!captureExamElements()) return;
  window[EXAM_INIT_FLAG] = true;
  updateExamCounter();
  updateTypeStatus();
  setExamStatus("Idle");
  setLoadingState(false);
  renderResults(null);
  renderExamMeta();
  setQuietMode(false);
  bindEvents();
  bindLibraryOpenEvent();
  loadExams();
  fetchKnowledgeSources();
  if (attemptPlaceholder) {
    attemptPlaceholder.hidden = false;
  }
};

export { initExamFlow };
