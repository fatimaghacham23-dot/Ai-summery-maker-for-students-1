const express = require("express");
const rateLimit = require("express-rate-limit");
const { runTool } = require("../tools/toolRunner");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many tool runs, please try again later.",
    },
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

module.exports = router;
