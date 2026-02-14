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
    if (!isQuietTestLogs()) {
      console.warn("EXAM_GENERATION_FAILED", JSON.stringify(payload, null, 2));
    }
    res.status(err.statusCode || 422).json(payload);
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
    error: {
      code,
      message: err.message || "Unexpected error",
    },
  };

  if (err.details) {
    response.error.details = err.details;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
};
