require("dotenv").config();
console.log("DEBUG_TOKEN =", JSON.stringify(process.env.DEBUG_TOKEN));
console.log("ENABLE_DEBUG_ROUTES =", JSON.stringify(process.env.ENABLE_DEBUG_ROUTES));
console.log("NODE_ENV =", JSON.stringify(process.env.NODE_ENV));

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

const {
  errorHandler,
  notFoundHandler,
} = require("./src/middleware/errorHandler");

const healthRouter = require("./src/routes/health");
const summarizeRouter = require("./src/routes/summarize");
const examsRouter = require("./src/routes/exams");
const knowledgeRouter = require("./src/routes/knowledge");
const toolsRouter = require("./src/routes/tools");
const persistenceRouter = require("./src/routes/persistence");
const shareViewRouter = require("./src/routes/shareView");
const inputsRouter = require("./src/routes/inputs");
const { debugRouter } = require("./src/debug/debugRoutes");
const { debugSessionMiddleware } = require("./src/debug/debugSessionMiddleware");
const { apiDebugRecorder } = require("./src/debug/apiDebugRecorder");

// OpenAPI spec source of truth.
const openapiSpec = require("./src/docs/openapi");

const app = express();

/**
 * =========================
 * CORS CONFIGURATION (FIXED)
 * =========================
 */
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",

  "http://localhost:5000",
  "http://127.0.0.1:5000",

  "http://localhost:5500",
  "http://127.0.0.1:5500",

  "http://localhost:5501",
  "http://127.0.0.1:5501",

  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server, curl, Postman, etc.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/**
 * =================
 * GLOBAL MIDDLEWARE
 * =================
 */
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.use(debugSessionMiddleware);

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * =======
 * ROUTES
 * =======
 */
app.use("/health", healthRouter);
app.use("/api", apiDebugRecorder);
app.use("/api", summarizeRouter);
app.use("/api", examsRouter);
app.use("/api", knowledgeRouter);
app.use("/api", persistenceRouter);
app.use("/api/inputs", inputsRouter);
app.use("/api/tools", toolsRouter);
app.use(shareViewRouter);
app.use("/__debug", debugRouter);

/**
 * ============
 * SWAGGER / API
 * ============
 */
app.get("/openapi.json", (req, res) => {
  res.json(openapiSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

/**
 * ==================
 * ERROR HANDLING
 * ==================
 */
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * ==============
 * START SERVER
 * ==============
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

