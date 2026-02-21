require("dotenv").config();

<<<<<<< HEAD
const parseBooleanFlag = (value) => String(value || "").toLowerCase() === "true";
console.log("DEBUG_TOKEN =", JSON.stringify(process.env.DEBUG_TOKEN));
console.log("ENABLE_DEBUG_ROUTES =", JSON.stringify(process.env.ENABLE_DEBUG_ROUTES));
=======
["HUGGINGFACE_API_KEY"].forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing ${key}`);
  }
});

>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
console.log("NODE_ENV =", JSON.stringify(process.env.NODE_ENV));

const fs = require("fs");
const os = require("os");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
<<<<<<< HEAD
const imageService = require("./server/services/imageService");
const settingsService = require("./src/services/settingsService");
const { resolveProviderName } = require("./src/providers/providerSelector");
=======
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe

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
const imagesRouter = require("./src/routes/images");
const writerRouter = require("./src/routes/writer");
const songRouter = require("./src/routes/song");
const grammarRouter = require("./src/routes/grammar");
const settingsRouter = require("./src/routes/settings");
const { debugRouter } = require("./src/debug/debugRoutes");
const { debugSessionMiddleware } = require("./src/debug/debugSessionMiddleware");
const { apiDebugRecorder } = require("./src/debug/apiDebugRecorder");

const openapiSpec = require("./src/docs/openapi");

const app = express();

<<<<<<< HEAD
const ENV_NAME = String(process.env.NODE_ENV || "development").trim();
const isDevEnv = ENV_NAME.toLowerCase() !== "production";
const parsedPort = Number.parseInt(process.env.PORT, 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

const CRASH_LOG_PATH = path.join(os.tmpdir(), "study-summarize-nodemon-crash.json");
const CRASH_WARNING_WINDOW_MS = 5 * 60 * 1000;
const CRASH_WARNING_THRESHOLD = 3;

const readCrashInfo = () => {
  try {
    const raw = fs.readFileSync(CRASH_LOG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const formatCrashReason = (value) => {
  if (!value) {
    return "unknown";
  }
  if (value instanceof Error) {
    return value.stack || value.message || value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof value.message === "string") {
      return value.message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const persistCrashInfo = (info) => {
  try {
    fs.writeFileSync(CRASH_LOG_PATH, JSON.stringify(info, null, 2));
  } catch (error) {
    console.warn("Unable to persist crash info:", error && error.message ? error.message : error);
  }
};

const recordCrashInfo = (reason) => {
  const now = Date.now();
  const previous = readCrashInfo();
  const hasRecentCrash =
    previous && typeof previous.lastCrashAt === "number"
      ? now - previous.lastCrashAt < CRASH_WARNING_WINDOW_MS
      : false;
  const consecutiveCrashes = hasRecentCrash ? (previous.consecutiveCrashes || 0) + 1 : 1;
  const info = {
    consecutiveCrashes,
    lastCrashAt: now,
    lastErrorReason: formatCrashReason(reason),
  };
  persistCrashInfo(info);
  return info;
};

const clearCrashInfo = () => {
  try {
    fs.unlinkSync(CRASH_LOG_PATH);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn("Unable to clear crash info:", error.message || error);
    }
  }
};

const logFrequentRestartWarning = () => {
  if (!isDevEnv) {
    return;
  }
  const info = readCrashInfo();
  if (!info) {
    return;
  }
  const age = Date.now() - (info.lastCrashAt || 0);
  if (info.consecutiveCrashes >= CRASH_WARNING_THRESHOLD && age < CRASH_WARNING_WINDOW_MS) {
    console.warn(
      "⚠️ Frequent nodemon restarts detected within the last 5 minutes. Last error:",
      info.lastErrorReason || "unknown"
    );
  }
};

const installCrashHandlers = () => {
  const handleCrash = (reason, label) => {
    recordCrashInfo(reason);
    console.error(`${label}:`, reason && reason.stack ? reason.stack : reason);
    process.exit(1);
  };
  process.on("uncaughtException", (error) => handleCrash(error, "Unhandled exception"));
  process.on("unhandledRejection", (reason) =>
    handleCrash(reason, "Unhandled rejection")
  );
};

const extractListeningAddress = (serverInstance) => {
  if (!serverInstance) {
    return null;
  }
  const addressInfo = serverInstance.address();
  if (!addressInfo) {
    return null;
  }
  if (typeof addressInfo === "string") {
    return { display: addressInfo };
  }
  const normalizedAddress = addressInfo.address === "::" ? "0.0.0.0" : addressInfo.address;
  return { address: normalizedAddress || "0.0.0.0", port: addressInfo.port };
};

const formatListeningAddress = (info) => {
  if (!info) {
    return "unknown";
  }
  if (info.display) {
    return info.display;
  }
  return `${info.address}:${info.port || PORT}`;
};

const resolveProviderSafely = (options) => {
  try {
    return resolveProviderName(options);
  } catch (error) {
    console.warn(
      `Unable to resolve provider for ${options.toolName}:`,
      error && error.message ? error.message : error
    );
    return null;
  }
};

const buildMockProviderStatus = (imageStatus) => {
  const summarizerProvider = resolveProviderSafely({
    toolName: "Summarizer",
    configuredProvider: process.env.SUMMARIZER_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  const grammarProvider = resolveProviderSafely({
    toolName: "Grammar fixer",
    configuredProvider: process.env.GRAMMAR_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  const songProvider = resolveProviderSafely({
    toolName: "Song generator",
    configuredProvider: process.env.SONG_PROVIDER,
    availableProviders: ["openai", "mock"],
    fallbackWithoutKey: "mock",
  });
  return {
    summarizer: summarizerProvider === "mock",
    image: Boolean(imageStatus?.shouldMock),
    grammar: grammarProvider === "mock",
    song: songProvider === "mock",
  };
};

const logStartupDiagnostics = (serverInstance, imageStatus) => {
  const listeningAddress = formatListeningAddress(extractListeningAddress(serverInstance));
  const mockProviders = buildMockProviderStatus(imageStatus);
  console.log("Startup diagnostics:", {
    NODE_ENV: ENV_NAME,
    PORT,
    listeningAddress,
    mockProviders,
    imageProviderConfigured: Boolean(imageStatus?.configured),
    missingImageEnvVars: imageStatus?.missing || [],
    imageMockReason: imageStatus?.reason || null,
  });
  clearCrashInfo();
};

installCrashHandlers();
logFrequentRestartWarning();

/**
 * =========================
 * CORS CONFIGURATION (FIXED)
 * =========================
 */
=======
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));
app.use(debugSessionMiddleware);

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/health", healthRouter);
app.use("/api", apiDebugRecorder);
app.use("/api", summarizeRouter);
app.use("/api", imagesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api", examsRouter);
app.use("/api", writerRouter);
app.use("/api", songRouter);
app.use("/api", grammarRouter);
app.use("/api", knowledgeRouter);
app.use("/api", persistenceRouter);
app.use("/api/inputs", inputsRouter);
app.use("/api/tools", toolsRouter);
app.use(shareViewRouter);
app.use("/__debug", debugRouter);

app.get("/openapi.json", (req, res) => {
  res.json(openapiSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use(notFoundHandler);
app.use(errorHandler);

<<<<<<< HEAD
/**
 * ==============
 * START SERVER
 * ==============
 */
const startServer = async () => {
  try {
    await settingsService.loadLocalSettings();
  } catch (error) {
    console.warn("Unable to load local settings:", error.message || error);
  }
  const imageEnvStatus = imageService.getEnvStatus();

  if (!imageEnvStatus.configured) {
    const envLabel = isDevEnv ? "development" : "production";
    const missingVars = imageEnvStatus.missing.length
      ? imageEnvStatus.missing.join(", ")
      : "IMAGE_PROVIDER or credentials";
    const fallbackHint =
      " Set USE_MOCK_IMAGE_PROVIDER=true to use the mock provider until the real service is configured.";
    const warningTail = isDevEnv
      ? "Image generation endpoints may return CONFIG_ERROR until those vars are configured or the mock override is enabled."
      : "Image generation endpoints may return CONFIG_ERROR until those values are supplied.";
    console.warn(
      `⚠️ Missing image service env vars (${envLabel}): ${missingVars}. ${warningTail}${fallbackHint}`
    );
  }

  const shouldValidate = parseBooleanFlag(
    process.env.VALIDATE_IMAGE_SERVICE_ON_START
  );
  const strictStartup = parseBooleanFlag(process.env.STRICT_STARTUP);

  if (
    shouldValidate &&
    !imageEnvStatus.shouldMock &&
    imageEnvStatus.provider === "huggingface" &&
    imageEnvStatus.configured
  ) {
    try {
      await imageService.ensureRouterModelAvailable();
    } catch (error) {
      console.warn(
        "⚠️ Hugging Face image service validation failed:",
        error.message || error
      );
      if (strictStartup) {
        throw error;
      }
    }
  } else if (
    shouldValidate &&
    !imageEnvStatus.shouldMock &&
    imageEnvStatus.provider === "huggingface"
  ) {
    console.warn(
      "⚠️ Skipping Hugging Face router validation because required env vars are missing."
    );
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    logStartupDiagnostics(server, imageEnvStatus);
  });
};

startServer().catch((error) => {
  recordCrashInfo(error);
  console.error("Failed to start server:", error);
  process.exit(1);
=======
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
>>>>>>> 6ac966a3b517f7a7a874dad7b2b8e768879c3ebe
});
