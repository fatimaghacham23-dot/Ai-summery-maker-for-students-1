const { isQuietTestLogs } = require("../utils/quietLogs");

class AppError extends Error {
  constructor(message, statusCode, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
};

const errorHandler = (err, req, res, next) => {
  if (err.code === "EXAM_GENERATION_FAILED") {
    const payload = {
      code: err.code,
      missing: err.missing || {},
      reason: err.reason || "validation-too-strict",
      debug: err.debug || null,
    };
    const details = {};
    if (err.missing) {
      details.missing = err.missing;
    }
    if (err.reason) {
      details.reason = err.reason;
    }
    if (err.debug) {
      details.debug = err.debug;
    }
    if (!isQuietTestLogs()) {
      console.warn("EXAM_GENERATION_FAILED", JSON.stringify(payload, null, 2));
    }
    res.status(err.statusCode || 422).json({
      error: true,
      code: err.code,
      message: err.message || "Exam generation failed.",
      ...(Object.keys(details).length ? { details } : {}),
    });
    return;
  }

  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";

  if (statusCode >= 500) {
    const shouldLog500Error =
      !isQuietTestLogs() || err.code !== "YOUTUBE_TRANSCRIPT_BLOCKED";
    if (shouldLog500Error) {
      console.error(err);
    }
  }

  const response = {
    error: true,
    message: err.message || "Unexpected error",
    code,
  };

  if (err.details) {
    response.details = err.details;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
};
