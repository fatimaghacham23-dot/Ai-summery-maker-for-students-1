process.env.NODE_ENV = "test";

const request = require("supertest");
const app = require("../src/app");

describe("Summarize provider validation", () => {
  const sampleText =
    "Mock study notes for testing summarizer validation and configuration logic.";
  let savedEnv = {};

  beforeEach(() => {
    savedEnv = {
      SUMMARIZER_PROVIDER: process.env.SUMMARIZER_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_KEY: process.env.OPENAI_KEY,
      OPENAI_API_TOKEN: process.env.OPENAI_API_TOKEN,
    };

    process.env.SUMMARIZER_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
    delete process.env.OPENAI_API_TOKEN;
  });

  afterEach(() => {
    Object.entries(savedEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it("returns 400 when openai provider is requested without a key", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({
        text: sampleText,
        length: "short",
        format: "paragraph",
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: true,
      code: "CONFIG_ERROR",
    });
    expect(response.body.message).toMatch(/OPENAI_API_KEY/);
  });
});
