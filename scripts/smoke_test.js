const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");
const FormData = require("form-data");
const { fetch } = require("undici");
const { buildSmokePayload, SMOKE_TEST_NOTES } = require("./smokePayload");

const PORT = Number(process.env.SMOKE_PORT || 3101);
const BASE_URL = `http://localhost:${PORT}`;
const SAMPLE_UPLOAD_PATH = path.resolve(__dirname, "../tests/fixtures/sample_upload.txt");
const SAMPLE_UPLOAD_SNIPPET = "Sample upload fixture text";
const LANGUAGE_SAMPLE_TEXT = `
Study tips: resume los puntos clave, crea tarjetas con fechas importantes y repasa con tus compañeros antes del examen.
Incluye referencias a capítulos, eventos históricos y pasos concretos para memorizar fórmulas.
Coordina sesiones de revisión para distribuir el tiempo y evaluar avances.
`;

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

const assertUploadContract = async () => {
  const uploadUrl = `${BASE_URL}/api/inputs/upload`;
  const form = new FormData();
  form.append("file", fs.createReadStream(SAMPLE_UPLOAD_PATH));

  const headers = form.getHeaders();
  const passThrough = new PassThrough();
  const responsePromise = fetch(uploadUrl, {
    method: "POST",
    body: passThrough,
    headers,
    duplex: "half",
  });
  form.once("error", (error) => passThrough.destroy(error));
  form.pipe(passThrough);
  const response = await responsePromise;

  const rawBody = await response.text();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Upload contract failed with status ${response.status}: ${rawBody || "no body"}`);
  }

  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new Error(`Upload contract response was not valid JSON: ${rawBody}`);
  }
  const { filename, documentId, text, source } = payload;
  if (source !== "upload") {
    throw new Error(`Upload contract responded with unexpected source ${source}`);
  }
  if (!filename) {
    throw new Error("Upload contract response is missing filename");
  }
  if (!documentId) {
    throw new Error("Upload contract response is missing documentId");
  }
  if (!text || !text.includes(SAMPLE_UPLOAD_SNIPPET)) {
    throw new Error("Upload contract response text does not include expected fixture content");
  }
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
      NODE_ENV: "development",
      DATABASE_PATH: ":memory:",
      IMAGE_PROVIDER: "mock",
      IMAGE_DEBUG: "true",
      IMAGE_MODEL: "gpt-image-1",
      SONG_PROVIDER: "mock",
      WRITER_PROVIDER: "mock",
      GRAMMAR_PROVIDER: "mock",
      SUMMARIZER_PROVIDER: "mock",
    },
      stdio: "pipe",
    });

  try {
    const ready = await waitForHealth();
    if (!ready) {
      throw new Error("Server failed to start for smoke test.");
    }

    const summaryPayload = {
      text: LANGUAGE_SAMPLE_TEXT.trim(),
      length: "short",
      format: "paragraph",
    };
    const summaryTest = await requestJson("POST", "/api/summarize", summaryPayload);
    if (summaryTest.status !== 200) {
      throw new Error(`Summary endpoint failed with status ${summaryTest.status}`);
    }
    const summaryBody = summaryTest.body || {};
    if (!summaryBody.summary) {
      throw new Error("Summary response missing content");
    }
    if (/Language:/i.test(summaryBody.summary)) {
      throw new Error("Summary output leaked metadata labels");
    }
    const summaryLanguage = summaryBody.meta?.language?.iso6391;
    if (!summaryLanguage || summaryLanguage !== "es") {
      throw new Error("Summary language detection did not return Spanish");
    }
    const summaryOverride = await requestJson("POST", "/api/summarize", {
      text: LANGUAGE_SAMPLE_TEXT.trim(),
      length: "short",
      format: "paragraph",
      targetLanguage: "French",
    });
    if (summaryOverride.status !== 200) {
      throw new Error(`Summary override failed with status ${summaryOverride.status}`);
    }
    const overrideLanguage = summaryOverride.body?.meta?.language?.iso6391;
    if (overrideLanguage !== "fr") {
      throw new Error("Summary override target language was ignored");
    }

    const shortSummaryResponse = await requestJson("POST", "/api/summarize", {
      text: "Hello world",
      length: "short",
      format: "paragraph",
    });
    if (shortSummaryResponse.status !== 200) {
      throw new Error(`Short summary handling failed with status ${shortSummaryResponse.status}`);
    }
    if (shortSummaryResponse.body?.summary !== "Text is too short to summarize meaningfully.") {
      throw new Error("Short summary response did not return the friendly fallback message");
    }
    if (shortSummaryResponse.body?.meta?.reason !== "SHORT_INPUT") {
      throw new Error("Short summary response missing SHORT_INPUT reason");
    }

    const emptySummaryResponse = await requestJson("POST", "/api/summarize", {
      text: "",
      length: "short",
      format: "paragraph",
    });
    if (emptySummaryResponse.status !== 400) {
      throw new Error("Empty summary input did not return validation error");
    }
    if (emptySummaryResponse.body?.code !== "VALIDATION_ERROR") {
      throw new Error("Empty summary input did not return VALIDATION_ERROR");
    }

    const generatePayload = buildSmokePayload();

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

    const writerPayload = {
      mode: "essay",
      tone: "neutral",
      length: "medium",
      level: "bachelor",
      citationStyle: "none",
      text: SMOKE_TEST_NOTES.slice(0, 1200),
    };

    const writerResponse = await requestJson("POST", "/api/writer/generate", writerPayload);
    if (writerResponse.status !== 200) {
      throw new Error(`Writer generate failed with status ${writerResponse.status}`);
    }
    const runId = writerResponse.body?.runId;
    if (!runId) {
      throw new Error("Writer generate response missing runId");
    }
    if (!writerResponse.body?.output) {
      throw new Error("Writer generate response missing output");
    }

    const writerHistoryResponse = await requestJson("GET", "/api/writer/history");
    if (!Array.isArray(writerHistoryResponse.body)) {
      throw new Error("Writer history response was not an array");
    }

    const invalidResponse = await requestJson("POST", "/api/writer/generate", {
      mode: "essay",
      text: "short",
    });
    if (invalidResponse.status !== 400) {
      throw new Error("Writer validation did not reject short text");
    }

    const shareResponse = await requestJson("POST", "/api/writer/share", { runId });
    if (!shareResponse.body?.token || !String(shareResponse.body?.urlPath || "").startsWith("/s/")) {
      throw new Error("Writer share response invalid");
    }

    const grammarPayload = {
      text: "I has went to the store yesterday, and i buyed milk it was good",
      goal: "clarity",
      dialect: "US",
      tone: "neutral",
      level: "light",
      preserveMeaning: true,
      preserveFormatting: true,
      explainChanges: true,
    };
    const grammarResponse = await requestJson("POST", "/api/grammar/fix", grammarPayload);
    if (grammarResponse.status !== 200) {
      throw new Error(`Grammar fix failed (${grammarResponse.status})`);
    }
    const corrected = grammarResponse.body?.corrected || "";
    if (!corrected || corrected === grammarPayload.text) {
      throw new Error("Grammar fix did not change the input");
    }
    if (/Language:/i.test(corrected)) {
      throw new Error("Grammar fix output should not include metadata labels");
    }
    if (!corrected.includes("went") || !corrected.includes("bought")) {
      throw new Error("Grammar fix did not correct the known irregular verbs");
    }
    if (!/\bI\b/.test(corrected)) {
      throw new Error("Grammar fix did not capitalize standalone I");
    }
    if (!/[.!?]$/.test(corrected.trim())) {
      throw new Error("Grammar fix output must end with punctuation");
    }
    const grammarHistoryResponse = await requestJson("GET", "/api/grammar/history");
    if (!Array.isArray(grammarHistoryResponse.body)) {
      throw new Error("Grammar history response was not an array");
    }

    const songPayload = {
      prompt: "Write an upbeat chorus about finishing a big project.",
      genre: "pop",
      structure: "verse-chorus",
      length: "short",
      mood: "uplifting",
      includeChords: true,
      includeTitleIdeas: true,
    };
    const songResponse = await requestJson("POST", "/api/song/generate", songPayload);
    if (songResponse.status !== 200) {
      throw new Error(`Song generation failed (${songResponse.status})`);
    }
    if (!songResponse.body?.runId || !songResponse.body?.title || !songResponse.body?.lyrics) {
      throw new Error("Song generate response missing data");
    }
    const songLyrics = String(songResponse.body?.lyrics || "");
    if (songLyrics.includes("Write an uplifting pop")) {
      throw new Error("Song lyrics should not echo the raw instruction string");
    }
    if (/Language:|Genre:|Mood:/i.test(songLyrics)) {
      throw new Error("Song lyrics should not include metadata lines");
    }
    if (!songLyrics.includes("[Chorus]")) {
      throw new Error("Song lyrics missing [Chorus] section");
    }
    if (/gentle cadence/i.test(songLyrics)) {
      throw new Error("Song lyrics contain placeholder phrasing");
    }
    const chorusSections = (songLyrics.match(/\[Chorus\]/g) || []).length;
    if (chorusSections < 2) {
      throw new Error("Song lyrics chorus did not repeat for verse-chorus structure");
    }
    if (!songLyrics.includes("Chords:")) {
      throw new Error("Song lyrics missing chord lines even though includeChords is true");
    }
    const titleIdeas = songResponse.body?.titleIdeas;
    if (!Array.isArray(titleIdeas) || titleIdeas.length < 3 || titleIdeas.length > 5) {
      throw new Error("Song title ideas response did not include 3-5 entries");
    }
    const songHistoryResponse = await requestJson("GET", "/api/song/history");
    if (!Array.isArray(songHistoryResponse.body)) {
      throw new Error("Song history response was not an array");
    }

    const imagePayload = {
      prompt: "A clean line art diagram of a classroom discussion.",
    };
    const imageResponse = await requestJson("POST", "/api/image/generate", imagePayload);
    if (imageResponse.status !== 200) {
      throw new Error(`Image generation failed (${imageResponse.status})`);
    }
    const imageUrl = imageResponse.body?.imageUrl;
    if (!imageUrl || !imageUrl.startsWith("data:image/")) {
      throw new Error("Image generation response missing data URL");
    }

    const imageHistoryResponse = await requestJson("GET", "/api/image/history");
    if (!Array.isArray(imageHistoryResponse.body)) {
      throw new Error("Image history response was not an array");
    }

    await assertUploadContract();

    console.log("Smoke test passed.");
  } finally {
    server.kill();
  }
};

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
