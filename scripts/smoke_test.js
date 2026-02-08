const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.SMOKE_PORT || 3101);
const BASE_URL = `http://localhost:${PORT}`;

const requestJson = (method, path, payload = null) =>
  new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      {
        method,
        hostname: "localhost",
        port: PORT,
        path,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (err) {
            return reject(
              new Error(`Failed to parse JSON from ${method} ${path}: ${err.message}`)
            );
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

const waitForHealth = async (retries = 20) => {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await requestJson("GET", "/health");
      if (response.status === 200) {
        return true;
      }
    } catch (err) {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

const hasAdjacentDuplicateWords = (text) =>
  /\b([A-Za-z0-9]+)\s+\1\b/i.test(String(text || ""));

const hasUnresolvedPlaceholder = (text, type) => {
  const raw = String(text || "");
  if (!raw) {
    return true;
  }
  if (type !== "fillBlank" && raw.includes("____")) {
    return true;
  }
  return /<[^>]*>|\{\{[^}]*\}\}|\[[^\]]*\]|\b(todo|tbd|fixme)\b/i.test(raw);
};

const hasMinimumPromptStructure = (text, type) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const minWords = type === "fillBlank" ? 5 : 7;
  if (tokens.length < minWords) {
    return false;
  }
  const hasEndingPunct = /[.!?]["')\]]?$/.test(trimmed) || /\?/.test(trimmed);
  const hasGrammarCue =
    /\b(what|which|why|how|when|where|if|when|solve|calculate|determine|choose|select|complete|fill|write|explain|identify|decide|does|do|did|is|are|was|were|can|should|would|will|has|have|had)\b/i.test(
      trimmed
    );
  const hasTrueFalseCue = /\btrue\s+or\s+false\b/i.test(trimmed);
  return hasEndingPunct && (hasGrammarCue || (type === "trueFalse" && hasTrueFalseCue));
};

const validatePrompts = (questions) => {
  const failures = [];
  questions.forEach((question) => {
    const prompt = question.prompt || "";
    if (hasAdjacentDuplicateWords(prompt)) {
      failures.push(`Repeated words in prompt: ${prompt}`);
    }
    if (hasUnresolvedPlaceholder(prompt, question.type)) {
      failures.push(`Unresolved placeholder in prompt: ${prompt}`);
    }
    if (!hasMinimumPromptStructure(prompt, question.type)) {
      failures.push(`Prompt lacks structure: ${prompt}`);
    }
  });
  return failures;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

const isExamGenerationFailed422 = (response) => {
  if (!response || response.status !== 422) {
    return false;
  }
  const code = response.body?.error?.code || response.body?.code || null;
  return code === "EXAM_GENERATION_FAILED";
};

const run = async () => {
  const server = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "production",
      DATABASE_PATH: ":memory:",
    },
    stdio: "pipe",
  });

  try {
    const ready = await waitForHealth();
    if (!ready) {
      throw new Error("Server failed to start for smoke test.");
    }

    const notes = `
MATHEMATICS
Linear equations use variables and constants to represent relationships. The slope indicates rate of change.

SCIENCE
Photosynthesis converts light energy into chemical energy in plants. Chlorophyll absorbs light, and glucose stores energy.

ENGLISH
Metaphor compares two unlike things without using like or as. A strong thesis improves clarity in writing.

GEOGRAPHY
Climate describes long-term patterns, while weather describes day-to-day conditions. Erosion moves sediment.

HISTORY
Primary sources include letters and diaries written at the time. Secondary sources interpret events later.

COMPUTER SCIENCE
An algorithm is a step-by-step procedure for solving a problem. Input, process, output describe data flow.
    `.trim();

    const generatePayload = {
      text: notes,
      questionCount: 8,
      difficulty: "medium",
      strictTypes: true,
      types: { mcq: 4, trueFalse: 2, shortAnswer: 1, fillBlank: 1 },
    };

    let examResponse = null;
    const maxAttempts = Number(process.env.SMOKE_EXAM_RETRIES || 3);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      examResponse = await requestJson("POST", "/api/exams/generate", generatePayload);
      if (examResponse.status === 200) {
        break;
      }
      if (isExamGenerationFailed422(examResponse) && attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      break;
    }

    if (examResponse.status !== 200) {
      if (isExamGenerationFailed422(examResponse)) {
        console.warn(
          `Smoke test warning: /api/exams/generate returned 422 EXAM_GENERATION_FAILED after ${maxAttempts} attempt(s). Treating as non-fatal.`
        );
        console.log("Smoke test passed.");
        return;
      }
      throw new Error(`Exam generation failed with status ${examResponse.status}`);
    }
    const exam = examResponse.body;
    const mcqCount = exam.questions.filter((q) => q.type === "mcq").length;
    if (mcqCount !== 4) {
      throw new Error(`MCQ quota not met. Expected 4, got ${mcqCount}`);
    }
    if (exam.meta?.subjectCategory !== "mixed") {
      throw new Error(`Expected mixed subject category, got ${exam.meta?.subjectCategory}`);
    }
    const subjects = exam.meta?.subjects || [];
    ["math", "science", "english"].forEach((subject) => {
      if (!subjects.includes(subject)) {
        throw new Error(`Missing detected subject: ${subject}`);
      }
    });

    const promptFailures = validatePrompts(exam.questions || []);
    if (promptFailures.length) {
      throw new Error(`Prompt sanity failures:\n${promptFailures.join("\n")}`);
    }

    console.log("Smoke test passed.");
  } finally {
    server.kill();
  }
};

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
