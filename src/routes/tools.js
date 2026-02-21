const express = require("express");
const rateLimit = require("express-rate-limit");
const { debugFetch } = require("../debug/debugFetch");
const { runTool } = require("../tools/toolRunner");
const { getOpenAiApiKey, getOpenAiModelForWriter } = require("../utils/openaiConfig");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    code: "RATE_LIMITED",
    message: "Too many tool runs, please try again later.",
  },
});

router.post("/run", limiter, async (req, res, next) => {
  try {
    const { tool, text, controls, options, documentId } = req.body || {};
    const run = await runTool({ tool, text, controls, options, documentId });
    res.json(run);
  } catch (error) {
    next(error);
  }
});

const isDevMode = String(process.env.NODE_ENV || "").toLowerCase() === "development";

router.get("/openai-self-test", async (req, res) => {
  if (!isDevMode) {
    return res
      .status(404)
      .json({ error: true, code: "NOT_FOUND", message: "OpenAI self-test is only available in development." });
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return res
      .status(400)
      .json({ error: true, code: "CONFIG_ERROR", message: "OPENAI_API_KEY is not configured." });
  }

  const model = getOpenAiModelForWriter();

  try {
    const response = await debugFetch("openai_self_test", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: "Say hi with one friendly word.",
          },
        ],
        max_tokens: 5,
        temperature: 0.2,
      }),
    });

    if (response.status === 401) {
      return res.status(401).json({
        error: true,
        code: "INVALID_API_KEY",
        message: "Invalid OpenAI key. Recreate the key and update settings/.env.",
      });
    }

    if (response.status === 429) {
      return res.status(429).json({
        error: true,
        code: "RATE_LIMITED",
        message: "OpenAI request rate limited. Try again shortly.",
      });
    }

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({
        error: true,
        code: "PROVIDER_ERROR",
        message: `OpenAI request failed: ${text || response.statusText}`,
      });
    }

    const payload = await response.json();
    return res.json({
      ok: true,
      modelUsed: payload.model || model,
    });
  } catch (error) {
    return res.status(502).json({
      error: true,
      code: "PROVIDER_ERROR",
      message: `OpenAI request failed: ${error?.message || "Unknown error"}`,
    });
  }
});

module.exports = router;
