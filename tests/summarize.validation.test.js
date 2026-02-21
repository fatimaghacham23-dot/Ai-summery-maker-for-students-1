process.env.NODE_ENV = "test";

const request = require("supertest");
const app = require("../src/app");

describe("/api/summarize validation", () => {
  beforeAll(() => {
    process.env.SUMMARIZER_PROVIDER = "mock";
  });

  it("returns friendly summary for very short text", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({
        text: "Hello world",
        length: "short",
        format: "paragraph",
      })
      .expect(200);

    expect(response.body).toEqual({
      summary: "Text is too short to summarize meaningfully.",
      meta: { reason: "SHORT_INPUT" },
    });
  });

  it("keeps empty string validation errors", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({
        text: "",
        length: "short",
        format: "paragraph",
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: true,
      code: "VALIDATION_ERROR",
    });
    expect(response.body.message).toMatch(/Text is required/);
  });
});
