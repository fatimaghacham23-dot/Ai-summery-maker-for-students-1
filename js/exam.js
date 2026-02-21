const API_BASE = "http://localhost:3000";

const examText = document.getElementById("examText");
const examCountBadge = document.getElementById("examCountBadge");
const difficultySelect = document.getElementById("difficultySelect");
const questionCountInput = document.getElementById("questionCount");
const strictTypesToggle = document.getElementById("strictTypesToggle");
const mcqCountInput = document.getElementById("mcqCount");
const tfCountInput = document.getElementById("tfCount");
const shortCountInput = document.getElementById("shortCount");
const fillCountInput = document.getElementById("fillCount");
const typeStatus = document.getElementById("typeStatus");
const generateExamBtn = document.getElementById("generateExamBtn");
const clearExamBtn = document.getElementById("clearExamBtn");
const examStatus = document.getElementById("examStatus");
const examMeta = document.getElementById("examMeta");
const examForm = document.getElementById("examForm");
const submitExamBtn = document.getElementById("submitExamBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportHtmlBtn = document.getElementById("exportHtmlBtn");
const resultsPanel = document.getElementById("resultsPanel");
const examsList = document.getElementById("examsList");
const attemptsList = document.getElementById("attemptsList");

let currentExam = null;
let isLoading = false;

const showToast = (message) => {
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
};

const getWordCount = (text) => {
  if (!text.trim()) {
    return 0;
  }
  return text.trim().split(/\s+/).length;
};

const updateCounts = () => {
  const text = examText.value;
  const words = getWordCount(text);
  examCountBadge.textContent = `${words} words • ${text.length} chars`;
};

const getTypeCounts = () => ({
  mcq: Number(mcqCountInput.value || 0),
  trueFalse: Number(tfCountInput.value || 0),
  shortAnswer: Number(shortCountInput.value || 0),
  fillBlank: Number(fillCountInput.value || 0),
});

const updateTypeStatus = () => {
  const questionCount = Number(questionCountInput.value || 0);
  const types = getTypeCounts();
  const total = Object.values(types).reduce((sum, value) => sum + value, 0);
  const isValid = total === questionCount;
  typeStatus.textContent = `Types total: ${total} / ${questionCount}`;
  typeStatus.classList.toggle("type-status-error", !isValid);
};

const setLoadingState = (loading) => {
  isLoading = loading;
  generateExamBtn.disabled = loading;
  submitExamBtn.disabled = loading;
  exportJsonBtn.disabled = !currentExam;
  exportHtmlBtn.disabled = !currentExam;
  generateExamBtn.textContent = loading ? "Generating..." : "Generate Exam";
};

const setExamStatus = (status) => {
  examStatus.textContent = status;
};

const renderExamMeta = () => {
  if (!currentExam) {
    examMeta.innerHTML = `<p class="placeholder">Generate or select an exam to begin.</p>`;
    return;
  }
  const blueprintText = (() => {
    const bp = currentExam.blueprint;
    if (Array.isArray(bp)) {
      return bp.join(", ");
    }
    if (bp && Array.isArray(bp.concepts)) {
      return bp.concepts
        .map((c) => c && c.name)
        .filter(Boolean)
        .slice(0, 10)
        .join(", ");
    }
    return "";
  })();
  examMeta.innerHTML = `
    <div class="exam-meta-grid">
      <div>
        <strong>${currentExam.title}</strong>
        <p class="subtext">Created ${new Date(currentExam.createdAt).toLocaleString()}</p>
        ${
          blueprintText
            ? `<p class="subtext">Blueprint: ${blueprintText}</p>`
            : ""
        }
        </div>
      <div class="exam-meta-stats">
        <span>${currentExam.config.difficulty.toUpperCase()}</span>
        <span>${currentExam.config.questionCount} questions</span>
        <span>${currentExam.totalPoints} points</span>
      </div>
    </div>
  `;
};

const renderExamQuestions = () => {
  if (!currentExam) {
    examForm.innerHTML = "";
    return;
  }
  const html = currentExam.questions
    .map((question, index) => {
      const questionHeader = `<div class="question-header"><span>Q${index + 1}</span><span>${
        question.points
      } pts</span></div>`;
      if (question.type === "mcq") {
        const choices = question.choices
          .map(
            (choice, idx) => `
              <label class="choice-option">
                <input type="radio" name="${question.id}" value="${String.fromCharCode(
                  65 + idx
                )}" />
                <span>${String.fromCharCode(65 + idx)}. ${choice}</span>
              </label>
            `
          )
          .join("");
        return `
          <div class="exam-question">
            ${questionHeader}
            <p>${question.prompt}</p>
            <div class="choice-list">${choices}</div>
          </div>
        `;
      }
      if (question.type === "trueFalse") {
        return `
          <div class="exam-question">
            ${questionHeader}
            <p>${question.prompt}</p>
            <p class="question-meta">Classification: ${
              question.classification || "Unspecified"
            }</p>
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
          </div>
        `;
      }
      if (question.type === "shortAnswer") {
        return `
          <div class="exam-question">
            ${questionHeader}
            <p>${question.prompt}</p>
            <textarea data-question="${question.id}" rows="3" placeholder="Write your answer..."></textarea>
          </div>
        `;
      }
      return `
        <div class="exam-question">
          ${questionHeader}
          <p>${question.prompt}</p>
          <input data-question="${question.id}" type="text" placeholder="Type your answer" />
        </div>
      `;
    })
    .join("");
  examForm.innerHTML = html;
};

const renderResults = (payload) => {
  if (!payload) {
    resultsPanel.innerHTML = `<p class="placeholder">Submit an attempt to see results.</p>`;
    return;
  }
  const questionMap = new Map(
    (currentExam?.questions || []).map((question) => [question.id, question])
  );
  const summary = `
    <div class="results-summary">
      <h3>Score: ${payload.score.earned} / ${payload.score.total} (${payload.score.percent}%)</h3>
    </div>
  `;
  const list = payload.results
    .map((result, index) => {
      const question = questionMap.get(result.questionId) || result;
      const isTrueFalse =
        question.questionType === "trueFalse" || question.type === "trueFalse";
      const classification = isTrueFalse
        ? question.classification || result.classification
        : null;
      const explanation = isTrueFalse ? question.explanation || result.explanation : null;
      return `
        <div class="result-item ${result.correct ? "correct" : "incorrect"}">
          <strong>Q${index + 1}</strong>
          <span>${result.correct ? "Correct" : "Incorrect"}</span>
          <span>${result.earnedPoints}/${result.maxPoints} pts</span>
          ${
            classification
              ? `<p class="result-meta">Classification: ${classification}</p>`
              : ""
          }
          ${explanation ? `<p class="result-meta">${explanation}</p>` : ""}
          <p>${result.feedback}</p>
        </div>
      `;
    })
    .join("");
  resultsPanel.innerHTML = `${summary}<div class="results-list">${list}</div>`;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, { credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
      const message = data?.message || data?.error?.message || data?.reason || "Request failed";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

const formatMissingCounts = (missing) =>
  Object.entries(missing || {})
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

const renderGenerationFailure = (payload) => {
  const missingText = formatMissingCounts(payload?.missing);
  examMeta.innerHTML = `
    <div class="results-summary">
      <h3>Couldn't generate full exam</h3>
      <p class="subtext">${
        missingText
          ? `Missing: ${missingText}`
          : "We couldn't meet the requested question mix."
      }</p>
      <div class="exam-actions">
        <button class="secondary-btn" id="retryGenerateBtn" type="button">Try again</button>
      </div>
      <p class="subtext">Tip: reduce difficulty or request fewer questions.</p>
    </div>
  `;
  examForm.innerHTML = "";
  currentExam = null;
  exportJsonBtn.disabled = true;
  exportHtmlBtn.disabled = true;
  const retryBtn = document.getElementById("retryGenerateBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", handleGenerateExam);
  }
};

const loadExams = async () => {
  try {
    const data = await fetchJson(`${API_BASE}/api/exams`, { cache: "no-store" });
    examsList.innerHTML = data
      .map(
        (exam) => `
        <li>
          <button class="history-btn" data-exam-id="${exam.id}">
            <strong>${exam.title}</strong>
            <span>${exam.difficulty} • ${exam.questionCount} Qs</span>
          </button>
        </li>
      `
      )
      .join("");
  } catch (err) {
    console.error(err);
    showToast("Unable to load exam history");
  }
};

const loadAttempts = async (examId) => {
  try {
    const data = await fetchJson(`${API_BASE}/api/exams/${examId}/attempts`);
    attemptsList.innerHTML = data
      .map(
        (attempt) => `
        <li>
          <button class="history-btn" data-attempt-id="${attempt.attemptId}">
            <strong>${attempt.scorePercent}% score</strong>
            <span>${new Date(attempt.createdAt).toLocaleString()}</span>
          </button>
        </li>
      `
      )
      .join("");
  } catch (err) {
    console.error(err);
    showToast("Unable to load attempts");
  }
};

const handleGenerateExam = async () => {
  const text = examText.value.trim();
  if (!text) {
    showToast("Please add study text first");
    return;
  }
  const questionCount = Number(questionCountInput.value || 0);
  const types = getTypeCounts();
  const totalTypes = Object.values(types).reduce((sum, value) => sum + value, 0);
  if (questionCount < 5 || questionCount > 30) {
    showToast("Question count must be between 5 and 30");
    return;
  }
  if (totalTypes !== questionCount) {
    showToast("Types total must equal question count");
    return;
  }

  setLoadingState(true);
  setExamStatus("Generating...");
  try {
    const generateUrl = `${API_BASE}/api/exams/generate`;
    const method = "POST";
    console.log(`[exam] generate fetch -> ${method} ${generateUrl}`);
    const exam = await fetchJson(generateUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        difficulty: difficultySelect.value,
        questionCount,
        types,
        strictTypes: strictTypesToggle ? strictTypesToggle.checked : true,
      }),
    });
    currentExam = exam;
    renderExamMeta();
    renderExamQuestions();
    renderResults(null);
    setExamStatus("Ready");
    showToast("Exam generated ✅");
    await loadExams();
    await loadAttempts(exam.id);
  } catch (err) {
    if (err.status === 422) {
      renderGenerationFailure(err.data || {});
      setExamStatus("Incomplete");
      showToast("Couldn't generate a full exam");
    } else {
      console.error(err);
      setExamStatus("Error");
      showToast(err.message);
    }
  } finally {
    setLoadingState(false);
  }
};

const handleSubmitExam = async () => {
  if (!currentExam) {
    showToast("Generate or select an exam first");
    return;
  }
  setLoadingState(true);
  setExamStatus("Submitting...");
  try {
    const answers = currentExam.questions.map((question) => {
      let value = "";
      if (question.type === "mcq" || question.type === "trueFalse") {
        const selected = examForm.querySelector(`input[name="${question.id}"]:checked`);
        value = selected ? selected.value : "";
      } else {
        const input = examForm.querySelector(`[data-question="${question.id}"]`);
        value = input ? input.value : "";
      }
      return {
        questionId: question.id,
        type: question.type,
        value,
      };
    });

    const data = await fetchJson(`${API_BASE}/api/exams/${currentExam.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId: currentExam.id,
        answers,
      }),
    });
    renderResults(data);
    setExamStatus("Graded");
    showToast("Exam submitted ✅");
    await loadAttempts(currentExam.id);
  } catch (err) {
    console.error(err);
    setExamStatus("Error");
    showToast(err.message);
  } finally {
    setLoadingState(false);
  }
};

const handleExamClick = async (examId) => {
  try {
    const exam = await fetchJson(`${API_BASE}/api/exams/${examId}`);
    currentExam = exam;
    renderExamMeta();
    renderExamQuestions();
    renderResults(null);
    setExamStatus("Loaded");
    setLoadingState(false);
    await loadAttempts(examId);
  } catch (err) {
    console.error(err);
    showToast("Failed to load exam");
  }
};

const handleAttemptClick = async (attemptId) => {
  try {
    const attempt = await fetchJson(`${API_BASE}/api/attempts/${attemptId}`);
    renderResults(attempt);
    setExamStatus("Attempt loaded");
  } catch (err) {
    console.error(err);
    showToast("Failed to load attempt");
  }
};

const handleExport = (format) => {
  if (!currentExam) {
    showToast("Select an exam first");
    return;
  }
  const url = `${API_BASE}/api/exams/${currentExam.id}/export?format=${format}`;
  window.open(url, "_blank", "noopener");
};

const clearForm = () => {
  examText.value = "";
  updateCounts();
  setExamStatus("Idle");
};

examText.addEventListener("input", updateCounts);
questionCountInput.addEventListener("input", updateTypeStatus);
mcqCountInput.addEventListener("input", updateTypeStatus);
tfCountInput.addEventListener("input", updateTypeStatus);
shortCountInput.addEventListener("input", updateTypeStatus);
fillCountInput.addEventListener("input", updateTypeStatus);
generateExamBtn.addEventListener("click", handleGenerateExam);
submitExamBtn.addEventListener("click", handleSubmitExam);
clearExamBtn.addEventListener("click", clearForm);
exportJsonBtn.addEventListener("click", () => handleExport("json"));
exportHtmlBtn.addEventListener("click", () => handleExport("html"));

examsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-exam-id]");
  if (button) {
    handleExamClick(button.dataset.examId);
  }
});

attemptsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-attempt-id]");
  if (button) {
    handleAttemptClick(button.dataset.attemptId);
  }
});

updateCounts();
updateTypeStatus();
setLoadingState(false);
setExamStatus("Idle");
loadExams();






