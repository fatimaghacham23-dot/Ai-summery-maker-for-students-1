process.env.DATABASE_PATH = ":memory:";
jest.setTimeout(60000);

jest.mock("node:dns", () => {
  const actualDns = jest.requireActual("node:dns");
  return {
    ...actualDns,
    promises: {
      ...actualDns.promises,
      lookup: jest.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
    },
  };
});
const mockExtractInnertubeConfigFromHtml = jest.fn();
jest.mock("../src/lib/youtubeInnertube", () => {
  const actual = jest.requireActual("../src/lib/youtubeInnertube");
  return {
    ...actual,
    extractInnertubeConfigFromHtml: mockExtractInnertubeConfigFromHtml,
  };
});
const buildFetchHeaders = (initial = {}) => {
  const normalized = {};
  Object.entries(initial || {}).forEach(([key, value]) => {
    normalized[key.toLowerCase()] = value;
  });
  return {
    forEach: (callback) => {
      Object.entries(normalized).forEach(([key, value]) => {
        callback(value, key);
      });
    },
    get: (name) => normalized[(name || "").toLowerCase()] || null,
  };
};
const withYouTubeRootFetch = (handler) => {
  const fetchMock = jest.fn((input, options = {}) => {
    const url = String(input || "");
    if (url === "https://www.youtube.com/") {
      return Promise.resolve({
        ok: true,
        status: 200,
        url,
        text: () => Promise.resolve("<html></html>"),
        headers: buildFetchHeaders({
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "CONSENT=TEST_CONSENT; Path=/; Secure",
        }),
      });
    }
    return handler(input, options);
  });
  return fetchMock;
};
const request = require("supertest");
const app = require("../src/app");
const { db } = require("../src/db");

describe("Inputs router", () => {
  beforeEach(() => {
    db.exec("DELETE FROM documents;");
    mockExtractInnertubeConfigFromHtml.mockReset();
    mockExtractInnertubeConfigFromHtml.mockImplementation(() => ({
      ok: true,
      debug: {
        containsYtcfg: true,
        containsInnertubeApiKey: true,
        method: "ytcfg.set",
        found: true,
        hasApiKey: true,
        hasContext: true,
        hasVisitorData: true,
      },
      config: {
        apiKey: "FAKE_KEY",
        context: { client: { clientName: "WEB", clientVersion: "1.0" } },
        visitorData: "VISITOR_DATA",
      },
    }));
  });

  it("extracts text from TXT uploads", async () => {
    const response = await request(app)
      .post("/api/inputs/upload")
      .attach("file", Buffer.from("Hello world\nLine two", "utf8"), "notes.txt")
      .expect(200);

    expect(response.body.source).toBe("upload");
    expect(response.body.mime).toBe("text/plain");
    expect(response.body.filename).toBe("notes.txt");
    expect(response.body.text).toContain("Hello world");
  });

  it("fetches and returns cleaned text from a safe URL", async () => {
    const html = "<html><body><h1>Example Domain</h1><p>The content is readable.</p></body></html>";
    const originalFetch = global.fetch;
    try {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });

      const response = await request(app)
        .post("/api/inputs/url")
        .send({ url: "https://example.com" })
        .expect(200);

      expect(response.body.source).toBe("url");
      expect(response.body.url).toBe("https://example.com/");
      expect(response.body.text).toContain("Example Domain");
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("extracts transcripts from a YouTube video", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: "en",
              name: { simpleText: "English" },
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
            },
            {
              languageCode: "es",
              name: { simpleText: "Spanish" },
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`,
            },
          ],
        },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script></html>`;
    const transcriptPayload = {
      events: [
        { segs: [{ utf8: "Hello world" }] },
        { segs: [{ utf8: "Next sentence" }] },
      ],
    };

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input, options = {}) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.includes("/api/timedtext")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify(transcriptPayload)),
            headers: buildFetchHeaders({ "content-type": "application/json" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}`, language: "ES" })
        .expect(200);

      expect(response.body.source).toBe("youtube");
      expect(response.body.url).toBe(`https://www.youtube.com/watch?v=${videoId}`);
      expect(response.body.text).toContain("Hello world");
      expect(response.body.text).toContain("Next sentence");
      const transcriptCall = fetchMock.mock.calls.find(([calledUrl]) =>
        String(calledUrl).includes("/api/timedtext")
      );
      expect(transcriptCall).toBeDefined();
      expect(String(transcriptCall[0])).toContain("&lang=en");
      expect(String(transcriptCall[0])).not.toContain("&lang=es");
      const transcriptOptions = transcriptCall[1];
      expect(transcriptOptions).toBeDefined();
      expect(transcriptOptions.method).toBe("GET");
      expect(transcriptOptions.headers).toBeDefined();
      expect(transcriptOptions.headers["Accept-Language"]).toContain("en");
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("falls back to VTT when YouTube JSON captions are malformed", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: "en",
              name: { simpleText: "English" },
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
            },
          ],
        },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script></html>`;
    const fallbackVtt = `WEBVTT

00:00.000 --> 00:02.000
Hello world

00:02.000 --> 00:04.000
Next sentence`;

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input, options) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.includes("/api/timedtext")) {
          if (url.includes("fmt=vtt")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: () => Promise.resolve(fallbackVtt),
              headers: buildFetchHeaders({ "content-type": "text/vtt" }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("{"),
            headers: buildFetchHeaders({ "content-type": "application/json" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}` })
        .expect(200);

      expect(response.body.source).toBe("youtube");
      expect(response.body.text).toContain("Hello world");
      expect(response.body.text).toContain("Next sentence");

      const fallbackCall = fetchMock.mock.calls.find(([calledUrl]) =>
        String(calledUrl).includes("fmt=vtt")
      );
      expect(fallbackCall).toBeDefined();
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("falls back to the youtubei transcript endpoint when captions are missing", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      getTranscriptEndpoint: { params: "TEST_PARAMS" },
      responseContext: {
        client: { clientName: "WEB", clientVersion: "1.0" },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"FAKE_KEY","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.0"}}});</script></html>`;
    const youtubeiResponse = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                content: {
                  transcriptSearchPanelRenderer: {
                    body: {
                      transcriptSegmentListRenderer: {
                        initialSegments: [
                          {
                            transcriptSegmentRenderer: {
                              snippet: { simpleText: "Fallback line" },
                            },
                          },
                          {
                            transcriptSegmentRenderer: {
                              snippet: {
                                runs: [{ text: "Second chunk" }],
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input, options = {}) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.startsWith("https://www.youtube.com/youtubei/v1/get_transcript")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url,
            json: () => Promise.resolve(youtubeiResponse),
            headers: buildFetchHeaders({ "content-type": "application/json" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}` })
        .expect(200);

      expect(response.body.text).toContain("Fallback line");
      expect(response.body.text).toContain("Second chunk");

      const youtubeiCall = fetchMock.mock.calls.find(([calledUrl]) =>
        String(calledUrl).includes("/youtubei/v1/get_transcript")
      );
      expect(youtubeiCall).toBeDefined();
      expect(String(youtubeiCall[0])).toContain("key=FAKE_KEY");
      const youtubeiOptions = youtubeiCall[1] || {};
      expect(youtubeiOptions.method).toBe("POST");
      const requestBody = JSON.parse(youtubeiOptions.body || "{}");
      expect(requestBody.videoId).toBe(videoId);
      expect(requestBody.params).toBe("TEST_PARAMS");
      const youtubeiHeaders = youtubeiOptions.headers || {};
      expect(youtubeiHeaders.Origin).toBe("https://www.youtube.com");
      expect(youtubeiHeaders.Referer).toBe(`https://www.youtube.com/watch?v=${videoId}`);
      expect(youtubeiHeaders.Cookie).toContain("CONSENT=TEST_CONSENT");
      expect(youtubeiHeaders.Cookie).toContain("GPS=WATCH_GPS");
    } finally {
        if (originalFetch) {
          global.fetch = originalFetch;
        } else {
          delete global.fetch;
        }
      }
  });

  it("falls back to youtubei when timedtext delivers HTML", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: "en",
              name: { simpleText: "English" },
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
            },
          ],
        },
      },
      getTranscriptEndpoint: { params: "TEST_PARAMS" },
      responseContext: {
        client: { clientName: "WEB", clientVersion: "1.0" },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"FAKE_KEY","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"1.0"}}});</script></html>`;
    const youtubeiResponse = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                content: {
                  transcriptSearchPanelRenderer: {
                    body: {
                      transcriptSegmentListRenderer: {
                        initialSegments: [
                          {
                            transcriptSegmentRenderer: {
                              snippet: { simpleText: "Fallback line" },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input, options = {}) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.includes("/api/timedtext")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("<html>blocked</html>"),
            headers: buildFetchHeaders({ "content-type": "text/html; charset=utf-8" }),
          });
        }
        if (url.startsWith("https://www.youtube.com/youtubei/v1/get_transcript")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url,
            json: () => Promise.resolve(youtubeiResponse),
            headers: buildFetchHeaders({ "content-type": "application/json" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}` })
        .expect(200);

      expect(response.body.text).toContain("Fallback line");

      const timedtextCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).includes("/api/timedtext")
      );
      expect(timedtextCalls).toHaveLength(1);

      const youtubeiCall = fetchMock.mock.calls.find(([calledUrl]) =>
        String(calledUrl).includes("/youtubei/v1/get_transcript")
      );
      expect(youtubeiCall).toBeDefined();
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("retries the watch page when innertube config is missing", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      getTranscriptEndpoint: { params: "TEST_PARAMS" },
      responseContext: {
        client: { clientName: "WEB", clientVersion: "1.0" },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script></html>`;
    const youtubeiResponse = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                content: {
                  transcriptSearchPanelRenderer: {
                    body: {
                      transcriptSegmentListRenderer: {
                        initialSegments: [
                          {
                            transcriptSegmentRenderer: {
                              snippet: { simpleText: "Retry line" },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    const missingConfig = {
      ok: false,
      debug: { containsYtcfg: true, containsInnertubeApiKey: false, method: "ytcfg.set", found: false },
      config: null,
    };
    const availableConfig = {
      ok: true,
      debug: {
        containsYtcfg: true,
        containsInnertubeApiKey: true,
        method: "ytcfg.set",
        found: true,
        hasApiKey: true,
        hasContext: true,
        hasVisitorData: true,
      },
      config: {
        apiKey: "RETRY_KEY",
        context: { client: { clientName: "WEB", clientVersion: "1.0" } },
        visitorData: "RETRY_VISITOR",
      },
    };
    mockExtractInnertubeConfigFromHtml.mockImplementationOnce(() => missingConfig);
    mockExtractInnertubeConfigFromHtml.mockImplementation(() => availableConfig);

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input, options = {}) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.startsWith("https://www.youtube.com/youtubei/v1/get_transcript")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url,
            json: () => Promise.resolve(youtubeiResponse),
            headers: buildFetchHeaders({ "content-type": "application/json" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}` })
        .expect(200);

      expect(response.body.text).toContain("Retry line");
      const watchCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).includes("/watch")
      );
      expect(watchCalls).toHaveLength(2);
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("returns YOUTUBE_TRANSCRIPT_BLOCKED when youtubei fallback is blocked", async () => {
    const videoId = "dQw4w9WgXcQ";
    const fakePlayerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: "en",
              name: { simpleText: "English" },
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
            },
          ],
        },
      },
      getTranscriptEndpoint: { params: "TEST_PARAMS" },
      responseContext: {
        client: { clientName: "WEB", clientVersion: "1.0" },
      },
    };
    const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
      fakePlayerResponse
    )};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"FAKE_KEY","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"1.0"}}});</script></html>`;

    const originalFetch = global.fetch;
    try {
      const fetchMock = withYouTubeRootFetch((input) => {
        const url = String(input || "");
        if (url.startsWith("https://www.youtube.com/watch")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(html),
            headers: buildFetchHeaders({
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "GPS=WATCH_GPS; Path=/; Secure",
            }),
          });
        }
        if (url.includes("/api/timedtext")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("<html>blocked</html>"),
            headers: buildFetchHeaders({ "content-type": "text/html; charset=utf-8" }),
          });
        }
        if (url.startsWith("https://www.youtube.com/youtubei/v1/get_transcript")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("<html>blocked</html>"),
            headers: buildFetchHeaders({ "content-type": "text/html; charset=utf-8" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(""),
        });
      });
      global.fetch = fetchMock;

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: `https://www.youtube.com/watch?v=${videoId}` })
        .expect(502);

      expect(response.body.error.code).toBe("YOUTUBE_TRANSCRIPT_BLOCKED");
      expect(response.body.error.details?.reason).toBe("unexpected_html");
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("returns TRANSCRIPT_UNAVAILABLE when captions are missing", async () => {
    const html = `<html><script>var ytInitialPlayerResponse = {};</script></html>`;
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(html),
        headers: buildFetchHeaders({ "content-type": "text/html; charset=utf-8" }),
      });

      const response = await request(app)
        .post("/api/inputs/youtube")
        .send({ url: "https://youtu.be/dQw4w9WgXcQ" })
        .expect(422);

      expect(response.body.error.code).toBe("TRANSCRIPT_UNAVAILABLE");
      expect(response.body.error.message).toMatch(/No transcript found/);
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("fetches a known YouTube transcript when available", async () => {
    const realVideoUrl = "https://www.youtube.com/watch?v=8jPQjjsBbIc";
    const response = await request(app).post("/api/inputs/youtube").send({ url: realVideoUrl });
      expect([200, 422, 424, 502]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.source).toBe("youtube");
        expect(response.body.text.length).toBeGreaterThan(1000);
      } else {
        if (response.status === 422) {
          expect(response.body.error.code).toBe("TRANSCRIPT_UNAVAILABLE");
          expect(response.body.error.details?.reason).toBe("fetch_blocked");
        } else {
          expect(response.body.error.code).toBe("YOUTUBE_TRANSCRIPT_BLOCKED");
          expect(response.body.error.details?.reason).toBeDefined();
        }
      }
  });

  it("returns NOT_IMPLEMENTED for OCR requests", async () => {
    const response = await request(app).post("/api/inputs/ocr").expect(501);

    expect(response.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: expect.stringContaining("OCR"),
      },
    });
  });

  it("returns NOT_IMPLEMENTED for audio transcription requests", async () => {
    const response = await request(app).post("/api/inputs/audio").expect(501);

    expect(response.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: expect.stringContaining("Audio transcription"),
      },
    });
  });
});
