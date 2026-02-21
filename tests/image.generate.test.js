process.env.NODE_ENV = "test";
process.env.IMAGE_PROVIDER = "mock";
process.env.IMAGE_DEBUG = "true";

const request = require("supertest");
const app = require("../src/app");

describe("Image generation flow", () => {
  it("returns a mock image payload for valid prompts", async () => {
    const response = await request(app)
      .post("/api/image/generate")
      .send({
        prompt: "A minimalistic diagram of the water cycle for students.",
        size: "1024x1024",
        style: "photoreal",
        quality: "standard",
      })
      .expect(200);

    expect(response.body.provider).toBe("mock");
    expect(response.body.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(response.body.historyId).toBeTruthy();
  });

  it("rejects prompts shorter than three characters", async () => {
    const response = await request(app)
      .post("/api/image/generate")
      .send({ prompt: "Hi" })
      .expect(400);

    expect(response.body.error).toBe(true);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("serves image history entries", async () => {
    await request(app)
      .post("/api/image/generate")
      .send({ prompt: "A schematic of a classroom board." })
      .expect(200);

    const historyResponse = await request(app)
      .get("/api/image/history")
      .expect(200);

    expect(Array.isArray(historyResponse.body)).toBe(true);
    expect(historyResponse.body.length).toBeGreaterThanOrEqual(1);
    expect(historyResponse.body[0]).toEqual(
      expect.objectContaining({
        provider: "mock",
        imageUrl: expect.stringMatching(/^data:image\/png;base64,/),
      })
    );
  });
});
