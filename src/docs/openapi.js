const openapiSpec = {
  openapi: "3.0.0",
  info: {
    title: "StudySummarize API",
    version: "1.0.0",
    description: "API for summaries and AI exam generation.",
  },
  servers: [
    {
      url: "http://localhost:3000",
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          200: {
            description: "OK",
          },
        },
      },
    },
    "/api/summarize": {
      post: {
        summary: "Summarize study text",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  length: { type: "string", enum: ["short", "medium", "detailed", "unlimited"] },
                  format: { type: "string", enum: ["paragraph", "bullets"] },
                },
                required: ["text", "length", "format"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "Summary response",
          },
        },
      },
    },
    "/api/writer/generate": {
      post: {
        summary: "Generate a writer studio output",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WriterGenerateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Writer output",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriterRunResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          429: {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/writer/refine": {
      post: {
        summary: "Refine a writer output",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WriterRefineRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Refined writer output",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriterRefineResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/writer/history": {
      get: {
        summary: "List recent writer runs",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          200: {
            description: "Writer history",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/WriterHistoryItem" },
                },
              },
            },
          },
        },
      },
    },
    "/api/writer/save": {
      post: {
        summary: "Save writer run to history",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WriterSaveRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Saved item",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SavedItemResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/writer/share": {
      post: {
        summary: "Create a share link for writer output",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WriterShareRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Share link",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriterShareResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          404: {
            description: "Run not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/grammar/fix": {
      post: {
        summary: "Fix grammar and clarity for pasted text",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GrammarFixRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Grammar fix result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrammarFixResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          429: {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          503: {
            description: "Provider configuration error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/grammar/refine": {
      post: {
        summary: "Refine an existing grammar fix",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GrammarRefineRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Refined grammar output",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrammarRefineResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/grammar/history": {
      get: {
        summary: "List recent grammar runs",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          200: {
            description: "History",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/GrammarHistoryItem" },
                },
              },
            },
          },
        },
      },
    },
    "/api/grammar/save": {
      post: {
        summary: "Save a grammar run",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GrammarSaveRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Saved item",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SavedItemResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          404: {
            description: "Run not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/grammar/share": {
      post: {
        summary: "Create a share link for grammar output",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GrammarShareRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Share link",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrammarShareResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          404: {
            description: "Run not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/song/generate": {
      post: {
        summary: "Generate a new song",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SongGenerateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Song output",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SongRunResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          429: {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/song/refine": {
      post: {
        summary: "Refine an existing song",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SongRefineRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Refined song",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SongRunResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/song/history": {
      get: {
        summary: "List song history",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          200: {
            description: "Song history",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SongHistoryItem" },
                },
              },
            },
          },
        },
      },
    },
    "/api/song/save": {
      post: {
        summary: "Save a song run",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SongSaveRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Song saved",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SavedItemResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/song/share": {
      post: {
        summary: "Create a share link for a song",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SongShareRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Share link",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SongShareResponse" },
              },
            },
          },
          400: {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/image/generate": {
      post: {
        summary: "Generate an AI visual from a prompt",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ImageGenerateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Generated visual",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ImageGenerateResponse" },
              },
            },
          },
          400: {
            description: "Invalid request/configuration",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          429: {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/image/history": {
      get: {
        summary: "Recent image generations",
        responses: {
          200: {
            description: "History",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ImageHistoryItem" },
                },
              },
            },
          },
        },
      },
    },
    "/api/exams/generate": {
      post: {
        summary: "Generate a new exam",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExamGenerateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Exam generated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Exam" },
              },
            },
          },
          422: {
            description: "Exam generation failed to meet requested quotas",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    code: { type: "string", example: "EXAM_GENERATION_FAILED" },
                    missing: { type: "object", additionalProperties: { type: "integer" } },
                    reason: { type: "string", example: "validation-too-strict" },
                    debug: {
                      type: "object",
                      properties: {
                        subjectCategory: { type: "string", example: "math" },
                        attemptsByType: {
                          type: "object",
                          additionalProperties: { type: "integer" },
                        },
                        lastErrorsByType: {
                          type: "object",
                          additionalProperties: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                reason: { type: "string" },
                                count: { type: "integer" },
                              },
                            },
                          },
                        },
                        exampleFailedCandidates: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              templateId: { type: ["string", "null"] },
                              templateFamily: { type: ["string", "null"] },
                              prompt: { type: "string" },
                              choices: { type: "array", items: { type: "string" } },
                              answerKey: { type: "string" },
                              issues: { type: "array", items: { type: "string" } },
                            },
                          },
                        },
                        templateFailures: {
                          type: "object",
                          additionalProperties: { type: "integer" },
                        },
                      },
                    },
                  },
                  required: ["code", "missing", "reason"],
                },
              },
            },
          },
        },
      },
    },
    "/api/exams": {
      get: {
        summary: "List exams",
        responses: {
          200: {
            description: "Exam list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ExamListItem" },
                },
              },
            },
          },
        },
      },
    },
    "/api/exams/{id}": {
      get: {
        summary: "Get exam by id",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Exam detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Exam" },
              },
            },
          },
        },
      },
    },
    "/api/exams/{id}/submit": {
      post: {
        summary: "Submit exam answers",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExamSubmissionRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Grading response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ExamSubmissionResponse" },
              },
            },
          },
        },
      },
    },
    "/api/exams/{id}/attempts": {
      get: {
        summary: "List exam attempts",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Attempt list",
          },
        },
      },
    },
    "/api/attempts/{attemptId}": {
      get: {
        summary: "Get attempt details",
        parameters: [
          { name: "attemptId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Attempt detail",
          },
        },
      },
    },
    "/api/exams/{id}/export": {
      get: {
        summary: "Export exam",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["json", "html"] },
          },
          {
            name: "withAnswers",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
          },
        ],
        responses: {
          200: {
            description: "Export response",
          },
        },
      },
    },
    "/api/knowledge/sources": {
      get: {
        summary: "List knowledge base sources",
        responses: {
          200: {
            description: "Knowledge sources list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sources: {
                      type: "array",
                      items: { $ref: "#/components/schemas/KnowledgeSource" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/tools/run": {
      post: {
        summary: "Run a workspace tool",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ToolRunRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Tool execution result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolRunResponse" },
              },
            },
          },
        },
      },
    },
    "/api/inputs/upload": {
      post: {
        summary: "Upload a document",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "Document uploaded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DocumentResponse" },
              },
            },
          },
          400: {
            description: "Bad request or unsupported file type",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          413: {
            description: "Upload exceeded the maximum file size",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/inputs/ocr": {
      post: {
        summary: "Extract text via OCR",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          501: {
            description: "OCR not implemented",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/inputs/url": {
      post: {
        summary: "Fetch readable text from a URL",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                },
                required: ["url"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "URL parsed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DocumentResponse" },
              },
            },
          },
          400: {
            description: "Invalid URL or disallowed host",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          502: {
            description: "Unable to fetch URL content",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/inputs/youtube": {
      post: {
        summary: "Extract transcript from a YouTube link",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  language: { type: "string", example: "en" },
                },
                required: ["url"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "Document created from YouTube transcript",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DocumentResponse" },
              },
            },
          },
          400: {
            description: "Invalid URL or disallowed domain",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          422: {
            description: "Transcript unavailable or disabled for this video",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          502: {
            description: "Unable to fetch the transcript from YouTube",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          504: {
            description: "YouTube transcript request timed out",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/inputs/audio": {
      post: {
        summary: "Submit audio for transcription (feature flag)",
        responses: {
          501: {
            description: "Audio transcription is not implemented yet",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/api/saved": {
      get: {
        summary: "List saved summaries",
        parameters: [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "folder", in: "query", schema: { type: "string" } },
          { name: "tag", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Saved summary list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SavedItem" },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Save a tool run",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SavedItemRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Saved item created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SavedItemResponse" },
              },
            },
          },
        },
      },
    },
    "/api/runs/{id}": {
      get: {
        summary: "Get tool run details",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "Run detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RunDetail" },
              },
            },
          },
        },
      },
    },
    "/api/share": {
      post: {
        summary: "Share a run via public token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ShareLinkRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Share link created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShareLinkResponse" },
              },
            },
          },
        },
      },
    },
    "/api/export/{runId}": {
      get: {
        summary: "Export a run output",
        parameters: [
          { name: "runId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["pdf", "docx", "txt", "md"] },
          },
        ],
        responses: {
          200: {
            description: "File download",
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ExamConfig: {
        type: "object",
        properties: {
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          questionCount: { type: "integer", minimum: 5, maximum: 30 },
          types: {
            type: "object",
            properties: {
              mcq: { type: "integer" },
              trueFalse: { type: "integer" },
              shortAnswer: { type: "integer" },
              fillBlank: { type: "integer" },
            },
          },
          strictTypes: { type: "boolean", example: true },
          language: { type: "string", example: "en" },
        },
      },
      ExamQuestion: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["mcq", "trueFalse", "shortAnswer", "fillBlank"] },
          prompt: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answerKey: { type: "string" },
          answerKeyBool: { type: "boolean" },
          answerKeyText: { type: "array", items: { type: "string" } },
          answerKeyBlank: { type: "string" },
          classification: {
            type: "string",
            enum: ["Definition", "Concept", "Fact", "Application"],
          },
          explanation: { type: "string" },
          points: { type: "number" },
          meta: {
            type: "object",
            properties: {
              templateId: { type: "string" },
              templateFamily: { type: "string" },
              regeneratedFrom: { type: ["string", "null"] },
              subjectCategory: { type: "string", example: "science" },
            },
          },
        },
      },
      Exam: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          createdAt: { type: "string" },
          config: { $ref: "#/components/schemas/ExamConfig" },
          questions: { type: "array", items: { $ref: "#/components/schemas/ExamQuestion" } },
          totalPoints: { type: "number" },
          meta: {
            type: "object",
            properties: {
              seed: { type: "string" },
              subjectCategory: { type: "string", example: "mixed" },
            },
          },
        },
      },
      KnowledgeSource: {
        type: "object",
        properties: {
          source: { type: "string", example: "OpenStax" },
          license: { type: "string", example: "CC-BY-4.0" },
        },
      },
      ExamListItem: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          createdAt: { type: "string" },
          difficulty: { type: "string" },
          questionCount: { type: "integer" },
        },
      },
      ExamGenerateRequest: {
        type: "object",
        properties: {
          text: { type: "string" },
          title: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          questionCount: { type: "integer", minimum: 5, maximum: 30 },
          seed: { type: "string" },
          types: {
            type: "object",
            properties: {
              mcq: { type: "integer" },
              trueFalse: { type: "integer" },
              shortAnswer: { type: "integer" },
              fillBlank: { type: "integer" },
            },
          },
          strictTypes: { type: "boolean", example: true },
        },
        required: ["text"],
        example: {
          text: "Paste study notes here...",
          difficulty: "medium",
          questionCount: 10,
          types: { mcq: 4, trueFalse: 2, shortAnswer: 2, fillBlank: 2 },
          strictTypes: true,
        },
      },
      ExamSubmissionRequest: {
        type: "object",
        properties: {
          examId: { type: "integer" },
          answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                questionId: { type: "string" },
                type: { type: "string" },
                value: { type: "string" },
              },
            },
          },
        },
      },
      ExamSubmissionResponse: {
        type: "object",
        properties: {
          attemptId: { type: "string" },
          examId: { type: "integer" },
          score: {
            type: "object",
            properties: {
              earned: { type: "number" },
              total: { type: "number" },
              percent: { type: "number" },
            },
          },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                questionId: { type: "string" },
                correct: { type: "boolean" },
                earnedPoints: { type: "number" },
                maxPoints: { type: "number" },
                feedback: { type: "string" },
              },
            },
          },
        },
      },
      ToolRunRequest: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            enum: [
              "summary.short",
              "summary.detailed",
              "summary.bullets",
              "summary.one_sentence",
              "summary.tldr",
              "summary.key_takeaways",
              "summary.executive",
              "summary.sectioned",
              "extract.action_items",
              "extract.questions",
              "extract.decisions",
              "extract.quotes",
              "extract.keywords",
              "extract.people",
              "extract.dates",
              "wow.highlight",
              "wow.fact_flags",
              "wow.mindmap",
              "wow.next_steps",
              "wow.email_reply",
              "rewrite",
            ],
          },
          text: { type: "string" },
          documentId: { type: "string" },
          controls: { $ref: "#/components/schemas/ToolControls" },
          options: { $ref: "#/components/schemas/ToolOptions" },
        },
        required: ["tool", "text"],
      },
      ToolControls: {
        type: "object",
        properties: {
          length: { type: "number", minimum: 0, maximum: 1 },
          tone: { type: "string", enum: ["professional", "casual", "academic"] },
          language: { type: "string" },
          focus: { type: "string", enum: ["student", "manager", "lawyer", "developer"] },
        },
      },
      ToolOptions: {
        type: "object",
        properties: {
          sectioned: {
            type: "object",
            properties: {
              maxSectionChars: { type: "number", example: 3500 },
            },
          },
          rewrite: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["shorter", "longer", "simpler"] },
            },
          },
        },
      },
      ToolRunResponse: {
        type: "object",
        properties: {
          runId: { type: "string" },
          tool: { type: "string" },
          output: { $ref: "#/components/schemas/ToolOutput" },
          highlights: {
            type: "array",
            items: { $ref: "#/components/schemas/ToolHighlight" },
          },
          meta: { $ref: "#/components/schemas/ToolMeta" },
        },
        required: ["runId", "tool", "output"],
      },
      ToolOutput: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["text", "bullets", "json"] },
          data: {},
        },
      },
      ToolHighlight: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          reason: { type: "string" },
        },
      },
      ToolMeta: {
        type: "object",
        properties: {
          provider: { type: "string" },
          model: { type: "string" },
        },
      },
      WriterGenerateRequest: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description: "Writer prompt mode",
            enum: [
              "essay",
              "outline",
              "paraphrase",
              "expand",
              "shorten",
              "explain",
              "flashcards",
              "email",
              "cover-letter",
              "notes-to-study-guide",
            ],
          },
          text: { type: "string" },
          tone: { type: "string", enum: ["academic", "neutral", "simple", "persuasive"] },
          length: { type: "string", enum: ["short", "medium", "long"] },
          level: {
            type: "string",
            enum: ["high_school", "bachelor", "master", "phd"],
          },
          citationStyle: {
            type: "string",
            enum: ["none", "apa", "mla", "chicago"],
          },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["mode", "text"],
      },
      WriterRefineRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          text: { type: "string" },
          instruction: {
            type: "string",
            enum: ["clarity", "academic", "structure", "concise"],
          },
          mode: { type: "string" },
          tone: { type: "string" },
          length: { type: "string" },
          level: { type: "string" },
          citationStyle: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["mode", "instruction"],
      },
      WriterRunMeta: {
        type: "object",
        properties: {
          mode: { type: "string" },
          tone: { type: "string" },
          length: { type: "string" },
          level: { type: "string" },
          citationStyle: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          wordCount: { type: "integer" },
          provider: { type: "string" },
          model: { type: "string" },
        },
        required: ["mode", "tone", "length", "level", "citationStyle", "wordCount"],
      },
      WriterRunResponse: {
        type: "object",
        properties: {
          runId: { type: "string" },
          output: { type: "string" },
          meta: { $ref: "#/components/schemas/WriterRunMeta" },
        },
        required: ["runId", "output", "meta"],
      },
      WriterRefineMeta: {
        type: "object",
        properties: {
          mode: { type: "string" },
          tone: { type: "string" },
          length: { type: "string" },
          level: { type: "string" },
          citationStyle: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          instruction: { type: "string" },
          wordCount: { type: "integer" },
          provider: { type: "string" },
          model: { type: "string" },
        },
        required: ["mode", "tone", "length", "level", "citationStyle", "wordCount", "instruction"],
      },
      WriterRefineResponse: {
        type: "object",
        properties: {
          output: { type: "string" },
          meta: { $ref: "#/components/schemas/WriterRefineMeta" },
        },
        required: ["output", "meta"],
      },
      WriterHistoryItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdAt: { type: "string" },
          mode: { type: "string" },
          tone: { type: "string" },
          length: { type: "string" },
          level: { type: "string" },
          citationStyle: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          snippet: { type: "string" },
          wordCount: { type: "integer" },
        },
      },
      WriterSaveRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          title: { type: "string" },
        },
        required: ["runId"],
      },
      WriterShareRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          savedItemId: { type: "string" },
          ttlHours: { type: "number" },
        },
      },
      WriterShareResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          urlPath: { type: "string" },
          expiresAt: { type: "string" },
        },
        required: ["token", "urlPath"],
      },
      GrammarFixRequest: {
        type: "object",
        properties: {
          text: { type: "string" },
          goal: {
            type: "string",
            enum: ["grammar", "clarity", "formal", "friendly", "concise", "academic"],
          },
          dialect: {
            type: "string",
            enum: ["US", "UK", "CA", "AU", "other"],
          },
          tone: {
            type: "string",
            enum: ["neutral", "formal", "friendly", "professional"],
          },
          level: {
            type: "string",
            enum: ["light", "standard", "strict"],
          },
          preserveMeaning: { type: "boolean" },
          preserveFormatting: { type: "boolean" },
          explainChanges: { type: "boolean" },
        },
        required: ["text"],
      },
      GrammarRefineRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          text: { type: "string" },
          instructions: { type: "string" },
        },
        required: ["instructions"],
      },
      GrammarMeta: {
        type: "object",
        properties: {
          goal: { type: "string" },
          dialect: { type: "string" },
          tone: { type: "string" },
          level: { type: "string" },
          preserveMeaning: { type: "boolean" },
          preserveFormatting: { type: "boolean" },
          explainChanges: { type: "boolean" },
        },
      },
      GrammarExplanation: {
        type: "object",
        properties: {
          type: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          reason: { type: "string" },
        },
      },
      GrammarFixResponse: {
        type: "object",
        properties: {
          runId: { type: "string" },
          original: { type: "string" },
          corrected: { type: "string" },
          explanations: {
            type: "array",
            items: { $ref: "#/components/schemas/GrammarExplanation" },
          },
          meta: { $ref: "#/components/schemas/GrammarMeta" },
          provider: { type: "string" },
          createdAt: { type: "string" },
        },
        required: ["runId", "original", "corrected", "meta", "provider", "createdAt"],
      },
      GrammarRefineResponse: {
        allOf: [{ $ref: "#/components/schemas/GrammarFixResponse" }],
      },
      GrammarHistoryItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdAt: { type: "string" },
          snippet: { type: "string" },
          meta: { $ref: "#/components/schemas/GrammarMeta" },
        },
      },
      GrammarSaveRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          title: { type: "string" },
        },
        required: ["runId"],
      },
      GrammarShareRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          savedItemId: { type: "string" },
          ttlHours: { type: "number" },
        },
      },
      GrammarShareResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          urlPath: { type: "string" },
          expiresAt: { type: "string" },
        },
        required: ["token", "urlPath"],
      },
      SongGenerateRequest: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          genre: {
            type: "string",
            enum: ["pop", "rock", "hip-hop", "r&b", "electronic", "indie", "country", "folk"],
          },
          structure: {
            type: "string",
            enum: ["verse-chorus", "verse-chorus-bridge", "story", "loop", "freeform"],
          },
          length: { type: "string", enum: ["short", "medium", "long"] },
          mood: { type: "string" },
          language: { type: "string" },
          explicit: { type: "boolean" },
          includeChords: { type: "boolean" },
          includeTitleIdeas: { type: "boolean" },
          rhymeScheme: { type: "string" },
          syllablesPerLine: { type: "integer", minimum: 1 },
          referenceArtists: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["prompt"],
        example: {
          prompt: "Write a hopeful anthem about finishing a big project.",
          genre: "pop",
          structure: "verse-chorus-bridge",
          length: "medium",
          mood: "uplifting",
          language: "English",
          explicit: false,
          includeChords: true,
          includeTitleIdeas: true,
          rhymeScheme: "ABAB",
          syllablesPerLine: 10,
          referenceArtists: ["bright indie pop", "modern singer-songwriter"],
        },
      },
      SongRefineRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          instruction: {
            type: "string",
            enum: ["clarity", "imagery", "energy", "structure"],
          },
          prompt: { type: "string" },
          genre: { type: "string" },
          structure: { type: "string" },
          length: { type: "string" },
          mood: { type: "string" },
          language: { type: "string" },
          explicit: { type: "boolean" },
          includeChords: { type: "boolean" },
          includeTitleIdeas: { type: "boolean" },
          rhymeScheme: { type: "string" },
          syllablesPerLine: { type: "integer" },
          referenceArtists: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["runId", "instruction"],
      },
      SongRunMeta: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          genre: { type: "string" },
          structure: { type: "string" },
          length: { type: "string" },
          mood: { type: "string" },
          language: { type: "string" },
          explicit: { type: "boolean" },
          includeChords: { type: "boolean" },
          includeTitleIdeas: { type: "boolean" },
          rhymeScheme: { type: "string" },
          syllablesPerLine: { type: "integer" },
          referenceArtists: {
            type: "array",
            items: { type: "string" },
          },
          instruction: { type: "string" },
          wordCount: { type: "integer" },
          provider: { type: "string" },
          model: { type: "string" },
        },
      },
      SongRunResponse: {
        type: "object",
        properties: {
          runId: { type: "string" },
          title: { type: "string" },
          lyrics: { type: "string" },
          titleIdeas: {
            type: "array",
            items: { type: "string" },
          },
          meta: { $ref: "#/components/schemas/SongRunMeta" },
        },
        required: ["runId", "title", "lyrics", "meta"],
      },
      SongHistoryItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          createdAt: { type: "string" },
          prompt: { type: "string" },
          genre: { type: "string" },
          structure: { type: "string" },
          length: { type: "string" },
          mood: { type: "string" },
          language: { type: "string" },
          explicit: { type: "boolean" },
          includeChords: { type: "boolean" },
          includeTitleIdeas: { type: "boolean" },
          rhymeScheme: { type: "string" },
          syllablesPerLine: { type: "integer" },
          referenceArtists: {
            type: "array",
            items: { type: "string" },
          },
          snippet: { type: "string" },
          lyrics: { type: "string" },
          titleIdeas: {
            type: "array",
            items: { type: "string" },
          },
          wordCount: { type: "integer" },
        },
      },
      SongSaveRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          title: { type: "string" },
        },
        required: ["runId"],
      },
      SongShareRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          savedItemId: { type: "string" },
          ttlHours: { type: "number" },
        },
        required: ["runId"],
      },
      SongShareResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          urlPath: { type: "string" },
          expiresAt: { type: "string" },
        },
        required: ["token", "urlPath"],
      },
      ImageGenerateRequest: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          style: {
            type: "string",
            enum: ["prompt-only", "photoreal", "anime", "sketch", "3d", "icon"],
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1536", "1536x1024"],
          },
          quality: { type: "string", enum: ["standard", "high"] },
          format: { type: "string", enum: ["png", "jpeg", "webp"] },
          n: { type: "integer", minimum: 1, maximum: 4 },
        },
        required: ["prompt"],
        example: {
          prompt: "A stylized diagram of the carbon cycle for high school students.",
          style: "photoreal",
          size: "1024x1024",
          quality: "high",
          format: "png",
          n: 1,
        },
      },
      ImageGenerateResponse: {
        type: "object",
        properties: {
          imageUrl: {
            type: "string",
            description: "Data URL (or accessible URL) that can be shown in an img tag",
            example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...",
          },
          provider: {
            type: "string",
            enum: ["openai", "huggingface", "mock"],
          },
          model: { type: "string" },
          usedPrompt: { type: "string" },
          revisedPrompt: { type: "string" },
          style: { type: "string" },
          size: { type: "string" },
          quality: { type: "string" },
          historyId: { type: "string" },
        },
        required: ["imageUrl", "provider"],
      },
      ImageHistoryItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          usedPrompt: { type: "string" },
          revisedPrompt: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          size: { type: "string" },
          quality: { type: "string" },
          style: { type: "string" },
          imageUrl: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "prompt", "provider", "imageUrl", "createdAt"],
      },
      DocumentResponse: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          text: { type: "string" },
          source: { type: "string" },
          filename: { type: "string" },
          mime: { type: "string", example: "text/plain" },
          url: { type: "string", format: "uri" },
        },
      },
      ApiError: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "NOT_IMPLEMENTED" },
              message: { type: "string" },
              details: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
      },
      SavedItemRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          title: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
          folder: { type: "string" },
        },
        required: ["runId"],
      },
      SavedItemResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          runId: { type: "string" },
          title: { type: "string" },
        },
      },
      SavedItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          folder: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
          runId: { type: "string" },
          tool: { type: "string" },
          createdAt: { type: "string" },
        },
      },
      RunDetail: {
        type: "object",
        properties: {
          id: { type: "string" },
          tool: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          params: { type: "object" },
          output: { $ref: "#/components/schemas/ToolOutput" },
          highlights: {
            type: "array",
            items: { $ref: "#/components/schemas/ToolHighlight" },
          },
          createdAt: { type: "string" },
        },
      },
      ShareLinkRequest: {
        type: "object",
        properties: {
          runId: { type: "string" },
          ttlHours: { type: "number" },
        },
        required: ["runId"],
      },
      ShareLinkResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          url: { type: "string" },
          expiresAt: { type: "string" },
        },
      },
    },
  },
};

module.exports = openapiSpec;
