process.env.NODE_ENV = "test";
process.env.SONG_PROVIDER = "mock";

const request = require("supertest");
const app = require("../src/app");

describe("Song generator endpoints", () => {
  const payload = {
    prompt: "Celebrate finishing a big group project with a hopeful chorus.",
    genre: "pop",
    structure: "verse-chorus",
    length: "short",
    mood: "uplifting",
    includeTitleIdeas: true,
    includeChords: true,
  };

  it("returns a song payload from /generate", async () => {
    const response = await request(app).post("/api/song/generate").send(payload).expect(200);
    expect(response.body).toHaveProperty("runId");
    expect(typeof response.body.title).toBe("string");
    expect(typeof response.body.lyrics).toBe("string");
    const lyrics = response.body.lyrics || "";
    const moodWord = payload.mood?.toLowerCase();
    const promptHasMood = moodWord ? payload.prompt?.toLowerCase().includes(moodWord) : false;
    if (moodWord && !promptHasMood) {
      expect(lyrics.toLowerCase()).not.toContain(moodWord);
    }
    expect(lyrics).not.toContain("Write an uplifting pop");
    expect(lyrics).not.toMatch(/Language:|Genre:|Mood:/i);
    expect(lyrics).toContain("[Chorus]");
    expect(lyrics).not.toMatch(/gentle cadence/i);
    const chorusMatches = lyrics.match(/\[Chorus\]/g) || [];
    expect(chorusMatches.length).toBeGreaterThanOrEqual(2);
    expect(lyrics).toContain("Chords:");
    expect(Array.isArray(response.body.titleIdeas)).toBe(true);
    expect(response.body.titleIdeas.length).toBeGreaterThanOrEqual(3);
    expect(response.body.titleIdeas.length).toBeLessThanOrEqual(5);
  });

  it("serves song history entries", async () => {
    await request(app).post("/api/song/generate").send(payload).expect(200);
    const history = await request(app).get("/api/song/history").expect(200);
    expect(Array.isArray(history.body)).toBe(true);
    expect(history.body.length).toBeGreaterThanOrEqual(1);
    expect(history.body[0]).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        lyrics: expect.any(String),
        id: expect.any(String),
      })
    );
  });
});
