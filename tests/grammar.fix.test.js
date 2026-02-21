process.env.NODE_ENV = "test";
process.env.GRAMMAR_PROVIDER = "mock";

const request = require("supertest");
const app = require("../src/app");

describe("Grammar fixer endpoints", () => {
const baselinePayload = {
  text: "this is  a test.  it should  improve clarity and punctuation.  ",
  goal: "clarity",
  dialect: "US",
  tone: "friendly",
  level: "standard",
  preserveMeaning: true,
  preserveFormatting: true,
};

  const knownBadInput =
    "I has went to the store yesterday, and i buyed milk it was good";

  it("fixes grammar when asked and returns explanations", async () => {
    const response = await request(app)
      .post("/api/grammar/fix")
      .send({
        ...baselinePayload,
        explainChanges: true,
      })
      .expect(200);
    expect(response.body).toHaveProperty("runId");
    expect(typeof response.body.corrected).toBe("string");
    expect(response.body.corrected).not.toBe(baselinePayload.text);
    expect(response.body.corrected).not.toMatch(/Language:/i);
    expect(Array.isArray(response.body.explanations)).toBe(true);
    expect(response.body.explanations.length).toBeGreaterThanOrEqual(1);
  });

  it("serves grammar history entries", async () => {
    await request(app).post("/api/grammar/fix").send(baselinePayload).expect(200);
    const history = await request(app).get("/api/grammar/history").expect(200);
    expect(Array.isArray(history.body)).toBe(true);
    expect(history.body.length).toBeGreaterThanOrEqual(1);
    expect(history.body[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        snippet: expect.any(String),
        meta: expect.any(Object),
      })
    );
  });

  it("corrects deterministic irregular grammar without repeating the input", async () => {
    const response = await request(app)
      .post("/api/grammar/fix")
      .send({
        ...baselinePayload,
        text: knownBadInput,
        explainChanges: true,
      })
      .expect(200);
    const corrected = response.body.corrected || "";
    expect(corrected).not.toBe(knownBadInput);
    expect(corrected).toContain("went");
    expect(corrected).toContain("bought");
    expect(/\bI\b/.test(corrected)).toBe(true);
  });
});
