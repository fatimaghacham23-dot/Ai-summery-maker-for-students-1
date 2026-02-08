process.env.SUMMARIZER_PROVIDER = "mock";
process.env.DATABASE_PATH = ":memory:";

const request = require("supertest");
const app = require("../src/app");
const { db } = require("../src/db");

const summaryTools = [
  "summary.short",
  "summary.detailed",
  "summary.bullets",
  "summary.one_sentence",
  "summary.tldr",
  "summary.key_takeaways",
  "summary.executive",
];

const extractionTools = [
  "extract.action_items",
  "extract.questions",
  "extract.decisions",
  "extract.quotes",
  "extract.keywords",
  "extract.people",
  "extract.dates",
];

const goldenText = `
Tasks:
- Action: Review the draft by Friday (Owner: Dr. Harper).
Tareas:
- Reunión summary due by martes (Owner: Carlos Mendez).
Open questions:
- Are we locked on the presentation scope?
Decision: We decided to prioritize the lab walkthrough before the exam.
Quote: "Collaboration powers the lab."
Photosynthesis helps plants convert light to chemical energy and oxygen.
Participants: Alice Johnson, Dr. Harper, Carlos Mendez.
Deadline: March 5, 2026 is the presentation date. Follow-up by Friday or قبل Monday.
`;

const defaultControls = { length: 0.5, tone: "professional", language: "en", focus: "student" };

const runTool = async (tool, text = goldenText, controls = defaultControls, options = undefined) => {
  const response = await request(app)
    .post("/api/tools/run")
    .send({ tool, text, controls, options });
  expect(response.status).toBe(200);
  return response.body;
};

beforeEach(() => {
  db.exec("DELETE FROM share_links;");
  db.exec("DELETE FROM saved_items;");
  db.exec("DELETE FROM runs;");
  db.exec("DELETE FROM documents;");
});

describe("Phase 1 pipeline", () => {
  test.each(summaryTools)("summary tool %s returns meaningful output", async (tool) => {
    const response = await runTool(tool);
    expect(response.output).toBeDefined();
    expect(response.output.data).toBeTruthy();
  });

  test("summary.sectioned returns multiple sections when text is long", async () => {
    const longText = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}: ${goldenText.trim()}`).join(
      "\n\n"
    );
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "summary.sectioned",
        text: longText,
        controls: defaultControls,
        options: { sectioned: { maxSectionChars: 400 } },
      })
      .expect(200);

    const sections = response.body.output?.data?.sections;
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(1);
  });

  test.each(extractionTools)("extraction tool %s produces non-empty items", async (tool) => {
    const response = await runTool(tool);
    const key = tool.split(".")[1];
    const items = response.output?.data?.[key]?.items;
    expect(response.output?.type).toBe("json");
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test("GET /api/runs/:id returns stored params including inputText", async () => {
    const runResult = await runTool("summary.short");
    const runId = runResult.runId;
    const response = await request(app).get(`/api/runs/${runId}`).expect(200);
    expect(response.body.params?.inputText).toBeDefined();
    expect(response.body.params.inputText).toContain("Tasks:");
  });

  test("saved + search endpoints persist tool outputs", async () => {
    const runResult = await runTool("summary.short");
    const runId = runResult.runId;
    const saveResponse = await request(app)
      .post("/api/saved")
      .send({
        runId,
        title: "Phase1 Save",
        tags: ["phase1", "summary"],
        folder: "Phase",
      })
      .expect(200);
    expect(saveResponse.body.id).toBeDefined();

    const historyResponse = await request(app).get("/api/saved?query=Phase1").expect(200);
    expect(Array.isArray(historyResponse.body)).toBe(true);
    expect(historyResponse.body.find((entry) => entry.runId === runId)).toBeTruthy();
  });

  test("share link renders HTML content", async () => {
    const runResult = await runTool("summary.short");
    const shareResponse = await request(app)
      .post("/api/share")
      .send({ runId: runResult.runId, ttlHours: 1 })
      .expect(200);
    expect(shareResponse.body.token).toBeDefined();

    const publicResponse = await request(app).get(`/s/${shareResponse.body.token}`).expect(200);
    expect(publicResponse.text).toContain("Shared Tool Output");
  });

  test("exports endpoint delivers txt and md files", async () => {
    const runResult = await runTool("summary.short");
    const txtResponse = await request(app).get(`/api/export/${runResult.runId}?format=txt`).expect(200);
    expect(txtResponse.headers["content-type"]).toMatch(/text\/plain/);
    expect(txtResponse.text.trim().length).toBeGreaterThan(0);

    const mdResponse = await request(app).get(`/api/export/${runResult.runId}?format=md`).expect(200);
    expect(mdResponse.headers["content-type"]).toMatch(/markdown|text/);
    expect(mdResponse.text.trim().length).toBeGreaterThan(0);
  });
});
