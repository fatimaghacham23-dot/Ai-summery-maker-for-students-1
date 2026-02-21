process.env.SUMMARIZER_PROVIDER = "mock";
process.env.DATABASE_PATH = ":memory:";

const request = require("supertest");
const app = require("../src/app");
const { db } = require("../src/db");
const { buildSmokePayload, DEFAULT_SMOKE_SEED } = require("../scripts/smokePayload");
const {
  SCENARIO_WRAPPER_TOKENS,
  SCENARIO_EVIDENCE_TOKEN_RATIO_THRESHOLD,
  MAX_SCENARIO_WRAPPER_TOKENS,
  RELIABILITY_CRITERIA_REGEX,
  CHRONOLOGY_CONTEXT_REGEX,
  GOVERNMENT_FORM_REGEX,
} = require("../src/utils/groundedExamPipeline");

const baseText =
  "Photosynthesis is the process by which plants convert light energy into chemical energy. " +
  "Chlorophyll absorbs light, and carbon dioxide combines with water to produce glucose and oxygen. " +
  "This process supports life by generating oxygen and storing energy in sugars. " +
  "A lab scenario describes how a scientist tracks energy moving through a system.";

const mixedSubjectText = `
MATHEMATICS
Linear equations use variables and constants to represent relationships.

🧪 SCIENCE
Photosynthesis converts light energy into chemical energy in plants.
`;

const diverseConceptText = Array.from({ length: 14 }, (_, i) =>
  `Topic ${i + 1} discusses concept${i + 1} and keyword${i + 1} in detail.`
).join(" ");

const shortSentenceText =
  "Atoms move. Cells grow. Energy shifts. Matter changes. Plants adapt. Heat spreads.";

const historyText = `
HISTORY
The American Revolution began in 1775 and ended in 1783.
A diary written during the revolution describes shortages in Boston.
A textbook written in 2005 analyzes the causes of the revolution.
The French Revolution in 1789 led to the rise of Napoleon.
A monarchy places power in a king or queen, while a republic elects leaders.
An empire expands by conquering neighboring lands.
The Industrial Revolution started in the late 1700s and accelerated in the 1800s.
Primary sources include letters, speeches, and photographs created at the time.
Secondary sources include textbooks and documentaries made later.
A law passed in 1865 abolished slavery in the United States.
Civics discussions compare rights and responsibilities to show how scenario planning in government decides which option better protects a right rather than a responsibility.
Scenario questions often describe a government system and ask how rights stay secure when responsibilities are balanced.
`.trim();

const mathText = `
MATHEMATICS
Solving a mixed word problem, a chef combines 3 liters of syrup with 6 liters of water to describe the ratio.
A student applies the quadratic formula to solve x^2 - 5x + 6 = 0 and interprets the result.
Geometry problems reference area = πr^2 and perimeter formulas to compare shapes.
Word problems describe how rates accumulate interest and how payments apply to equations.
Math scenarios use term names like system and process to describe how each idea applies while pointing out errors to correct.
Word problems warn students to check for errors while comparing idea names and explaining why one strategy beats another.
`.trim();

const englishText = `
ENGLISH
The sentence "Running quickly, the finish line appeared" misplaces the modifier and needs revision.
A paragraph discusses tone, voice, and strong verbs to improve clarity and flow.
Students edit sentences to maintain consistent tense and correct punctuation.
A scenario about tone compares different systems of expression to show which option keeps the idea clear.
Students use scenario language to explain how voice, structure, and process work together in a paragraph.
`.trim();

const geographyText = `
GEOGRAPHY
A coastal map uses latitude and longitude to describe erosion patterns and travel routes.
Climate data contrasts rainfall and temperature shifts across tropical and temperate zones.
Transportation planners compare resource access and elevation changes along a corridor.
A scenario about a transportation system contrasts resources, weather, and strategy to show which path best connects people across places.
`.trim();

const csText = `
COMPUTER SCIENCE
An algorithm processes inputs through an IPO diagram to calculate averages of sensor data.
Debugging reveals a race condition when two threads access shared memory simultaneously.
The lesson compares hardware, software, data, and information used to store knowledge.
A coding scenario explains how a system uses a process to move data and why errors happen when steps are skipped.
`.trim();

const civicsSubjectText = `
CIVICS
Human rights: basic freedoms for all people, like speech, religion, and equal protection under the law.
Responsibilities such as obeying laws, respecting neighbors, and paying taxes keep communities fair.
Laws explain how freedoms to vote, petition, and assemble peacefully are balanced by civic duties.
Government accountability, transparency, and equality help maintain justice for every citizen.
Community service and informed voting show respect for both rights and responsibilities.
Civics scenarios examine how rights and responsibilities balance in civic systems, showing which option best protects rights rather than responsibilities.
`.trim();

const subjectTexts = {
  history: historyText,
  math: mathText,
  science: baseText,
  english: englishText,
  geography: geographyText,
  cs: csText,
  civics: civicsSubjectText,
};

const SUBJECT_SCENARIO_FAMILY_DATA = {
  history: [
    "history-sources",
    "history-reliability",
    "history-chronology",
    "history-government",
    "history-cause",
    "history-rights",
  ],
  math: ["math-application", "math-core", "math-error", "math-classify"],
  science: [
    "science-cause",
    "science-function",
    "science-classify",
    "organelles",
    "equations",
    "genetics",
    "ecology",
  ],
  english: ["english-grammar", "english-device", "english-improvement", "english-voice"],
  geography: ["geography-scenario", "geography-climate", "geography-resources"],
  cs: ["cs-ipo", "cs-hardware", "cs-algorithm", "cs-data"],
};

const SCENARIO_FAMILY_SET = new Set(["scenario-application"]);
const FAMILY_SUBJECT_MAP = {};
Object.entries(SUBJECT_SCENARIO_FAMILY_DATA).forEach(([subject, families]) => {
  families.forEach((family) => {
    SCENARIO_FAMILY_SET.add(family);
    FAMILY_SUBJECT_MAP[family] = subject;
  });
});

const ALLOWED_PROMPT_TOKENS = new Set([...SCENARIO_WRAPPER_TOKENS]);

const buildTokenSet = (text) => {
  const tokens = String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  return new Set(tokens.filter((token) => token.length >= 3));
};

const bannedStemRegexes = [
  /which statement best matches/i,
  /which best describes/i,
  /according to the provided text/i,
  /which concept is described/i,
  /a student observes/i,
  /which term matches this description/i,
  /describe the role or function of/i,
  /compare .* with a related idea/i,
];

const bannedPromptPhraseRegexes = [/\bfield study\b/i, /\bappears\b/i, /\boccurs\b/i];

const scenarioFamilies = new Set([
  "scenario-application",
  "geography-scenario",
  "geography-climate",
  "geography-resources",
  "history-sources",
  "history-reliability",
  "history-chronology",
  "history-government",
  "history-cause",
  "history-rights",
  "cs-ipo",
  "cs-hardware",
  "cs-algorithm",
  "cs-data",
  "empire",
  "government",
]);

const isCommaBagStem = (prompt) => {
  const cleaned = String(prompt || "")
    .replace(/true\s+or\s+false\s*:\s*/i, "")
    .replace(/["'`]/g, "")
    .trim();
  const commaCount = (cleaned.match(/,/g) || []).length;
  if (commaCount < 2) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 12) {
    return false;
  }
  const hasVerbCue =
    /\b(is|are|was|were|has|have|had|do|does|did|can|should|would|will|cause|causes|caused|explain|describe|identify|determine|shows|show|means|refers)\b/i.test(
      cleaned
    );
  return !hasVerbCue;
};

const extractFillBlankStatement = (prompt) => {
  const raw = String(prompt || "").replace(/\s*\(Topic:[^)]+\)\s*[.!?]?\s*$/i, "");
  const hintMatch = raw.match(/^(.*?)(?:\s*\(?hint:)/i);
  const trimmedRaw = hintMatch ? hintMatch[1] : raw;
  if (!trimmedRaw.includes("____")) {
    return trimmedRaw.trim();
  }
  const lastColon = trimmedRaw.lastIndexOf(":");
  if (lastColon !== -1) {
    const afterLast = trimmedRaw.slice(lastColon + 1);
    if (afterLast.includes("____")) {
      return afterLast.trim();
    }
  }
  return trimmedRaw.trim();
};

const countWords = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;

beforeEach(() => {
  db.exec("DELETE FROM attempts; DELETE FROM exams;");
});

describe("Exam Maker API", () => {
  test("generate exam success", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        difficulty: "easy",
        questionCount: 6,
        types: { mcq: 3, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(200);
    expect(response.body.id).toBeDefined();
    expect(response.body.questions).toHaveLength(6);
    expect(response.body.config.difficulty).toBe("easy");
  });

  test("true/false questions include classification and explanation", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        questionCount: 6,
        types: { mcq: 2, trueFalse: 2, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(200);
    const trueFalseQuestions = response.body.questions.filter(
      (question) => question.type === "trueFalse"
    );
    expect(trueFalseQuestions.length).toBeGreaterThan(0);
    trueFalseQuestions.forEach((question) => {
      expect(["Definition", "Concept", "Fact", "Application"]).toContain(
        question.classification
      );
      const sentences = question.explanation
        .split(/[.!?]/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      expect(sentences.length).toBeGreaterThan(1);
    });
  });

  test("generate exam validation error on types sum", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        questionCount: 5,
        types: { mcq: 2, trueFalse: 1, shortAnswer: 1, fillBlank: 0 },
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  test("generate exam validation error on invalid difficulty", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        difficulty: "expert",
        questionCount: 5,
        types: { mcq: 2, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  test("get exam by id", async () => {
    const generate = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        questionCount: 5,
        types: { mcq: 2, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    const examId = generate.body.id;
    const response = await request(app).get(`/api/exams/${examId}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(examId);
  });

  test("submit exam scoring works", async () => {
    const generate = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        questionCount: 5,
        types: { mcq: 2, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    const exam = generate.body;
    const answers = exam.questions.map((question) => {
      let value = "";
      if (question.type === "mcq") {
        value = question.answerKey;
      } else if (question.type === "trueFalse") {
        value = question.answerKeyBool;
      } else if (question.type === "shortAnswer") {
        value = question.answerKeyText.join(" ");
      } else if (question.type === "fillBlank") {
        value = question.answerKeyBlank;
      }
      return {
        questionId: question.id,
        type: question.type,
        value,
      };
    });

    const response = await request(app)
      .post(`/api/exams/${exam.id}/submit`)
      .send({ examId: exam.id, answers });

    expect(response.status).toBe(200);
    expect(response.body.score.percent).toBe(100);
    const tfResult = response.body.results.find(
      (result) => result.questionType === "trueFalse"
    );
    expect(tfResult.classification).toBeDefined();
    expect(tfResult.explanation).toBeDefined();
  });

  test("export json and html", async () => {
    const generate = await request(app)
      .post("/api/exams/generate")
      .send({
        text: baseText,
        questionCount: 5,
        types: { mcq: 2, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    const examId = generate.body.id;
    const jsonExport = await request(app).get(`/api/exams/${examId}/export?format=json`);
    expect(jsonExport.status).toBe(200);
    expect(jsonExport.body.id).toBe(examId);

    const htmlExport = await request(app).get(`/api/exams/${examId}/export?format=html`);
    expect(htmlExport.status).toBe(200);
    expect(htmlExport.headers["content-type"]).toContain("text/html");
  });

  test("subjectCategory becomes mixed when multiple headings are present", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: mixedSubjectText,
        questionCount: 6,
        types: { mcq: 3, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(200);
    expect(response.body.meta.subjectCategory).toBe("mixed");
  });

  test("no repeated prompt stems and no duplicate topicConceptId when enough concepts exist", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: diverseConceptText,
        questionCount: 6,
        types: { mcq: 3, trueFalse: 1, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(200);
    const stems = response.body.questions.map((question) =>
      question.prompt
        .toLowerCase()
        .replace(/["'`]/g, "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5)
        .join(" ")
    );
    const stemSet = new Set(stems);
    expect(stemSet.size).toBe(stems.length);

    const termMatchCount = response.body.questions.filter((question) =>
      /which term matches/i.test(question.prompt)
    ).length;
    expect(termMatchCount).toBeLessThanOrEqual(1);

    const conceptIds = response.body.questions.map((question) => question.topicConceptId);
    const uniqueConceptIds = new Set(conceptIds);
    expect(uniqueConceptIds.size).toBe(conceptIds.length);
  });

  test("generation degrades gracefully when type quotas cannot be met", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: shortSentenceText,
        questionCount: 6,
        types: { mcq: 1, trueFalse: 3, shortAnswer: 1, fillBlank: 1 },
      });

    expect(response.status).toBe(200);
    expect(response.body.questions.length).toBe(6);
    expect(response.body.meta.distributionAdjustment).toBeDefined();
  });

  test("history strictTypes respects quotas and fillBlank reconstruction", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: historyText,
        questionCount: 10,
        types: { mcq: 4, trueFalse: 2, shortAnswer: 2, fillBlank: 2 },
        strictTypes: true,
      });

    if (response.status === 422) {
      expect(response.body.missing).toBeDefined();
      expect(response.body.details?.debug).toBeDefined();
      return;
    }

    expect(response.status).toBe(200);
    const questions = response.body.questions;
    const counts = questions.reduce((acc, question) => {
      acc[question.type] = (acc[question.type] || 0) + 1;
      return acc;
    }, {});
    expect(counts.mcq).toBe(4);
    expect(counts.trueFalse).toBe(2);
    expect(counts.shortAnswer).toBe(2);
    expect(counts.fillBlank).toBe(2);

    questions.forEach((question) => {
      const hasBannedStem = bannedStemRegexes.some((regex) => regex.test(question.prompt));
      expect(hasBannedStem).toBe(false);
    });

    questions
      .filter((question) => question.type === "mcq" || question.type === "trueFalse")
      .forEach((question) => {
        const hasBannedPhrase = bannedPromptPhraseRegexes.some((regex) =>
          regex.test(question.prompt)
        );
        expect(hasBannedPhrase).toBe(false);
        expect(isCommaBagStem(question.prompt)).toBe(false);
      });

    const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    questions
      .filter((question) => question.type === "fillBlank")
      .forEach((question) => {
        expect(question.answerKeyBlank).toBeDefined();
        const statement = extractFillBlankStatement(question.prompt);
        const filled = normalize(statement.replace("____", question.answerKeyBlank || ""));
        expect(filled).toBe(normalize(question.explanation));
      });

    const mcqQuestions = questions.filter((question) => question.type === "mcq");
    const scenarioCount = mcqQuestions.filter((question) =>
      scenarioFamilies.has(question.meta?.templateFamily)
    ).length;
    const requiredScenario = Math.ceil(mcqQuestions.length * 0.5);
    expect(scenarioCount).toBeGreaterThanOrEqual(requiredScenario);

    const historyReliabilityQuestions = mcqQuestions.filter(
      (question) => question.meta?.templateFamily === "history-reliability"
    );
    historyReliabilityQuestions.forEach((question) => {
      const evidence = question.grounding?.evidenceSnippets?.[0] || "";
      expect(RELIABILITY_CRITERIA_REGEX.test(evidence)).toBe(true);
      expect(question.topicConceptId).toBeDefined();
    });

    const historyGovernmentQuestions = mcqQuestions.filter(
      (question) => question.meta?.templateFamily === "history-government"
    );
    historyGovernmentQuestions.forEach((question) => {
      const evidence = question.grounding?.evidenceSnippets?.[0] || "";
      expect(GOVERNMENT_FORM_REGEX.test(evidence)).toBe(true);
      expect(question.topicConceptId).toBeDefined();
    });

    const historyChronologyQuestions = mcqQuestions.filter(
      (question) => question.meta?.templateFamily === "history-chronology"
    );
    historyChronologyQuestions.forEach((question) => {
      const evidence = question.grounding?.evidenceSnippets?.[0] || "";
      expect(CHRONOLOGY_CONTEXT_REGEX.test(evidence)).toBe(true);
      expect(question.topicConceptId).toBeDefined();
    });
  });

  test("fillBlank deterministic fallback blanks 1-3 word phrases with context", async () => {
    const fallbackText = `
HISTORY
Monarchy is rule by a king or queen, and a republic elects leaders.
An empire expands by conquering neighboring lands over many years.
`.trim();
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: fallbackText,
        questionCount: 5,
        types: { mcq: 0, trueFalse: 0, shortAnswer: 0, fillBlank: 5 },
        strictTypes: true,
      });

    if (response.status === 422) {
      expect(response.body.details?.debug).toBeDefined();
      return;
    }

    expect(response.status).toBe(200);
    const fallbackQuestions = response.body.questions.filter(
      (question) => question.meta?.templateId === "fillBlank_fallback_deterministic"
    );
    if (!fallbackQuestions.length) {
      return;
    }
    fallbackQuestions.forEach((question) => {
      const statement = extractFillBlankStatement(question.prompt);
      const answerWords = String(question.answerKeyBlank || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      expect(answerWords.length).toBeGreaterThanOrEqual(1);
      expect(answerWords.length).toBeLessThanOrEqual(3);
      const contextWords = countWords(statement.replace("____", ""));
      expect(contextWords).toBeGreaterThanOrEqual(10);
    });
  });

  test("strictTypes enforces mcq quota or returns debug candidates", async () => {
    const requestedMcq = 5;
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: shortSentenceText,
        questionCount: 7,
        types: { mcq: requestedMcq, trueFalse: 1, shortAnswer: 1, fillBlank: 0 },
        strictTypes: true,
      });

    if (response.status === 422) {
      expect(response.body.details?.debug).toBeDefined();
      expect(
        Array.isArray(response.body.details?.debug?.exampleFailedCandidates)
      ).toBe(true);
      return;
    }

    expect(response.status).toBe(200);
    const mcqCount = response.body.questions.filter(
      (question) => question.type === "mcq"
    ).length;
    expect(mcqCount).toBeGreaterThanOrEqual(requestedMcq);
    expect(response.body.config.strictTypes).toBe(true);
  });

  describe("StrictTypes scenario share matrix by subject", () => {
    Object.entries(subjectTexts).forEach(([subject, text]) => {
      test(
        `Subject ${subject} meets scenario share across seeds`,
        async () => {
      const failures = [];
      for (let seedIndex = 0; seedIndex < 20; seedIndex += 1) {
        const seed = `${subject}-scenario-${seedIndex}`;
        const response = await request(app)
              .post("/api/exams/generate")
              .send({
                text,
                questionCount: 10,
                types: { mcq: 4, trueFalse: 2, shortAnswer: 2, fillBlank: 2 },
                strictTypes: true,
                seed,
              });
            if (response.status !== 200) {
              failures.push({ seed, status: response.status, reason: response.body.reason });
              continue;
            }
          expect(response.body.meta.subjectCategory).toBe(subject);
          const sourceSentences = response.body.sourceText?.sentences || [];
          const sourceText = sourceSentences.length
            ? sourceSentences.map((sentence) => sentence.text).join(" ")
            : text;
          const subjectTokenSet = buildTokenSet(sourceText);
          const mcqQuestions = response.body.questions.filter((q) => q.type === "mcq");
            const scenarioCount = mcqQuestions.filter((question) =>
              SCENARIO_FAMILY_SET.has(question.meta?.templateFamily)
            ).length;
            const requiredScenario = Math.ceil(mcqQuestions.length * 0.5);
            if (scenarioCount < requiredScenario) {
              failures.push({ seed, reason: "scenario share unmet" });
              continue;
            }
            const crossSubject = mcqQuestions.filter((question) => {
              const family = question.meta?.templateFamily;
              return family && FAMILY_SUBJECT_MAP[family] && FAMILY_SUBJECT_MAP[family] !== subject;
            });
            if (crossSubject.length) {
              failures.push({ seed, reason: "cross-subject template leak" });
              continue;
            }
            for (const question of mcqQuestions) {
            const promptTokens = buildTokenSet(question.prompt);
            const tokenList = [...promptTokens];
            const evidenceMatchCount = tokenList.filter((token) => subjectTokenSet.has(token)).length;
            const evidenceRatio = tokenList.length ? evidenceMatchCount / tokenList.length : 1;
            const unseenTokens = tokenList.filter((token) => !subjectTokenSet.has(token));
            const wrapperTokens = unseenTokens.filter((token) => SCENARIO_WRAPPER_TOKENS.has(token));
            if (
              evidenceRatio < SCENARIO_EVIDENCE_TOKEN_RATIO_THRESHOLD &&
              wrapperTokens.length > MAX_SCENARIO_WRAPPER_TOKENS
            ) {
              failures.push({ seed, reason: "out-of-text stem", tokens: unseenTokens });
              break;
            }
            }
          }
          expect(failures).toHaveLength(0);
        },
        120000
      );
    });
  });

  describe("StrictTypes other subject regression", () => {
    const requestedOtherTypes = { mcq: 5, trueFalse: 2, shortAnswer: 2, fillBlank: 2 };
    test(
    "civics subject meets strict quotas across seeds",
      async () => {
        const seeds = Array.from({ length: 20 }, (_, index) => `other-strict-${index}`);
        const questionCount = Object.values(requestedOtherTypes).reduce((sum, value) => sum + value, 0);
        for (const seed of seeds) {
          const response = await request(app)
            .post("/api/exams/generate")
            .send({
              text: civicsSubjectText,
              questionCount,
              types: requestedOtherTypes,
              strictTypes: true,
              seed,
            });
          expect(response.status).toBe(200);
          expect(response.body.meta.subjectCategory).toBe("civics");
          expect(response.body.missing?.mcq).toBeUndefined();
          const questions = response.body.questions;
          const counts = { mcq: 0, trueFalse: 0, shortAnswer: 0, fillBlank: 0 };
          questions.forEach((question) => {
            if (counts[question.type] !== undefined) {
              counts[question.type] += 1;
            }
          });
          expect(counts).toEqual(requestedOtherTypes);
          questions.forEach((question) => {
            const hasBannedStem = bannedStemRegexes.some((regex) => regex.test(question.prompt));
            expect(hasBannedStem).toBe(false);
          });
          questions
            .filter((question) => question.type === "mcq" || question.type === "trueFalse")
            .forEach((question) => {
              const hasBannedPhrase = bannedPromptPhraseRegexes.some((regex) =>
                regex.test(question.prompt)
              );
              expect(hasBannedPhrase).toBe(false);
              expect(isCommaBagStem(question.prompt)).toBe(false);
            });
          const normalizeForComparison = (text) =>
            String(text || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
          questions
            .filter((question) => question.type === "fillBlank")
            .forEach((question) => {
              const statement = extractFillBlankStatement(question.prompt);
          const filled = normalizeForComparison(
            statement.replace("____", question.answerKeyBlank || "")
          );
          const evidenceNorm = normalizeForComparison(question.explanation);
          if (!filled.includes(evidenceNorm)) {
            console.log("fill mismatch", { filled, evidenceNorm, prompt: question.prompt });
          }
          expect(filled.includes(evidenceNorm)).toBe(true);
            });
        }
      },
      120000
    );
  });

  test("smoke exam payload generates deterministic strict exam", async () => {
    const payload = buildSmokePayload({ seed: DEFAULT_SMOKE_SEED });
    const response = await request(app).post("/api/exams/generate").send(payload);
    expect(response.status).toBe(200);
    expect(response.body.config.strictTypes).toBe(true);
    expect(response.body.meta?.subjectCategory).toBe("mixed");
    const questions = response.body.questions || [];
    expect(questions).toHaveLength(payload.questionCount);
    const typeCounts = questions.reduce((counts, question) => {
      counts[question.type] = (counts[question.type] || 0) + 1;
      return counts;
    }, {});
    Object.entries(payload.types).forEach(([type, count]) => {
      expect(typeCounts[type] || 0).toBe(count);
    });
    expect(response.body.missing).toBeUndefined();
  });

  test("scenario share failure surfaces debug info", async () => {
    const response = await request(app)
      .post("/api/exams/generate")
      .send({
        text: shortSentenceText,
        questionCount: 6,
        types: { mcq: 4, trueFalse: 1, shortAnswer: 1, fillBlank: 0 },
        strictTypes: true,
      });
    expect(response.status).toBe(422);
    expect(response.body.details?.reason).toBe("scenario-share");
    expect(response.body.details?.debug?.scenarioShare?.deficit).toBeGreaterThan(0);
    expect(response.body.details?.debug?.scenarioShare?.generatedFamilies).toBeDefined();
  });
});
