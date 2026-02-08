process.env.SUMMARIZER_PROVIDER = "mock";
process.env.DATABASE_PATH = ":memory:";

const request = require("supertest");
const app = require("../src/app");
const { db } = require("../src/db");

beforeEach(() => {
  db.exec("DELETE FROM runs;");
  db.exec("DELETE FROM documents;");
  db.exec("DELETE FROM saved_items;");
  db.exec("DELETE FROM share_links;");
});

describe("Tools runner", () => {
const sampleText =
  "Photosynthesis helps plants turn carbon dioxide and light into glucose and oxygen. " +
  "Chlorophyll absorbs photons and triggers a chain of reactions that store energy.";

const defaultControls = { length: 0.5, tone: "professional", language: "en", focus: "student" };

  test("runs summary.tldr and returns structured output", async () => {
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "summary.tldr",
        text: sampleText,
        controls: { length: 0.6, tone: "professional", language: "en", focus: "student" },
      })
      .expect(200);

    expect(response.body.runId).toBeDefined();
    expect(response.body.output).toBeDefined();
    expect(response.body.output.data).toBeTruthy();
    expect(response.body.meta?.provider).toBe("mock");
  });

  test("runs extract.action_items and returns json list", async () => {
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "extract.action_items",
        text: `${sampleText} Action: Review photosynthesis steps.`,
        controls: { length: 0.5, tone: "academic", language: "en", focus: "student" },
      })
      .expect(200);

    expect(response.body.output?.type).toBe("json");
    const items = response.body.output?.data?.action_items?.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test("runs extract.questions and returns json list", async () => {
    const questionText = `${sampleText} Are the steps to energy conversion clear?`;
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "extract.questions",
        text: questionText,
        controls: defaultControls,
      })
      .expect(200);

    expect(response.body.output?.type).toBe("json");
    const items = response.body.output?.data?.questions?.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test("runs extract.decisions and returns json list", async () => {
    const decisionsText = `${sampleText} Decision: We decided to prioritize the lab walkthrough before the exam.`;
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "extract.decisions",
        text: decisionsText,
        controls: defaultControls,
      })
      .expect(200);

    expect(response.body.output?.type).toBe("json");
    const items = response.body.output?.data?.decisions?.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test("runs extract.dates and finds deadlines", async () => {
    const datesText = `${sampleText} Deadline: March 5, 2026 is the presentation date. Follow-up by 03/10/2026.`;
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "extract.dates",
        text: datesText,
        controls: defaultControls,
      })
      .expect(200);

    expect(response.body.output?.type).toBe("json");
    const dateItems = response.body.output?.data?.dates?.items;
    expect(Array.isArray(dateItems)).toBe(true);
    expect(dateItems.length).toBeGreaterThan(0);
  });

  test("runs wow.next_steps and returns text", async () => {
    const stepsText = `${sampleText} Next steps: outline the experiment, write flashcards, and rehearse the pitch.`;
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "wow.next_steps",
        text: stepsText,
        controls: defaultControls,
      })
      .expect(200);

    expect(response.body.output?.type).toBe("text");
    expect(typeof response.body.output?.data).toBe("string");
    expect(response.body.output?.data.trim().length).toBeGreaterThan(0);
  });

  test("runs wow.email_reply on email input", async () => {
    const emailText = `From: mentor@school.edu
Subject: Study update

Hi team,
I reviewed the respiration notes and highlighted the corrections.
Best,
Mentor`;
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "wow.email_reply",
        text: emailText,
        controls: defaultControls,
      })
      .expect(200);

    expect(response.body.output?.type).toBe("text");
    expect(response.body.output?.data.trim().length).toBeGreaterThan(0);
  });

  test("runs rewrite shorter and adjusts the text", async () => {
    const rewriteSource =
      "Photosynthesis turns light energy into chemical energy while releasing oxygen. Students should memorize the light-dependent and light-independent reactions because they form the base of most tests.";
    const response = await request(app)
      .post("/api/tools/run")
      .send({
        tool: "rewrite",
        text: rewriteSource,
        controls: defaultControls,
        options: { rewrite: { mode: "shorter" } },
      })
      .expect(200);

    const output = response.body.output?.data;
    expect(response.body.output?.type).toBe("text");
    expect(typeof output).toBe("string");
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output.trim()).not.toBe(rewriteSource.trim());
  });

  test("exports tool output as markdown", async () => {
    const runResult = await request(app).post("/api/tools/run").send({
      tool: "summary.short",
      text: sampleText,
      controls: { length: 0.4, tone: "professional", language: "en", focus: "manager" },
    });

    const runId = runResult.body.runId;
    expect(runId).toBeDefined();

    const exportResponse = await request(app).get(`/api/export/${runId}?format=md`);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers["content-type"]).toMatch(/markdown|text/);
  });
});
