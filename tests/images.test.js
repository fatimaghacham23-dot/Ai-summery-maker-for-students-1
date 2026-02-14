process.env.NODE_ENV = "test";

jest.mock("undici", () => ({
  request: jest.fn(),
}));

const request = require("supertest");
const app = require("../src/app");
const undici = require("undici");

const createMockImageResponse = () => {
  const buffer = Buffer.alloc(45000, 0x61);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
    },
    body: {
      arrayBuffer: async () => arrayBuffer,
      text: async () => "",
    },
  };
};

describe("Images router", () => {
  beforeEach(() => {
    process.env.HUGGINGFACE_API_KEY = "hf_dummy_key";
    process.env.HF_ROUTER_PROVIDER = "hf-inference";
    process.env.HF_ROUTER_BASE_URL = "https://router.huggingface.co";
    process.env.HF_IMAGE_MODEL = "stabilityai/stable-diffusion-2-1";
    undici.request.mockReset();
    undici.request.mockImplementation(() => Promise.resolve(createMockImageResponse()));
  });

  it("returns huggingface data URLs for valid prompts", async () => {
    const response = await request(app)
      .post("/api/images/generate")
      .send({
        prompt: "A colorful diagram of the water cycle with labeled arrows.",
        style: "photoreal",
        size: "1024x1024",
        quality: "standard",
        format: "png",
        n: 2,
      })
      .expect(200);

    expect(response.body.provider).toBe("huggingface");
    expect(response.body.model).toBe(process.env.HF_IMAGE_MODEL);
    expect(Array.isArray(response.body.images)).toBe(true);
    expect(response.body.images).toHaveLength(2);
    expect(response.body.images[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(response.body.images[0].imageBase64.length).toBeGreaterThan(0);
    expect(response.body.raw).toEqual(
      expect.objectContaining({
        contentType: "image/png",
        byteLength: expect.any(Number),
      })
    );
    expect(response.body.raw.byteLength).toBeGreaterThan(40000);
  });

  it("rejects prompt that is too short", async () => {
    const response = await request(app)
      .post("/api/images/generate")
      .send({
        prompt: "Hi",
        style: "icon",
        size: "512x512",
        quality: "standard",
        format: "png",
        n: 1,
      })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error.message).toMatch(/validation/i);
  });

  it("rejects a request that exceeds the image count limit", async () => {
    const response = await request(app)
      .post("/api/images/generate")
      .send({
        prompt: "Show a clean icon set for science equipment.",
        n: 5,
        style: "icon",
        size: "512x512",
        quality: "standard",
        format: "png",
      })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error.message).toMatch(/validation/i);
  });
});
