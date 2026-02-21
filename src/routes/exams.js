const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const { AppError } = require("../middleware/errorHandler");
const { getProvider } = require("../providers");
const { db, runInTransaction } = require("../db");
const {
  buildExamConfig,
  gradeSubmission,
  renderExamHtml,
} = require("../utils/exams");
const { generateGroundedExam } = require("../utils/groundedExamPipeline");
const crypto = require("crypto");

const router = express.Router();

const limiterOptions = {
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    code: "RATE_LIMITED",
    message: "Too many requests, please try again later.",
  },
};

const isTestEnvironment =
  process.env.NODE_ENV === "test" || typeof process.env.JEST_WORKER_ID !== "undefined";
const limiter = isTestEnvironment ? (req, res, next) => next() : rateLimit(limiterOptions);

const generateSchema = z.object({
  text: z.string().min(50).max(20000),
  title: z.string().min(1).max(200).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  questionCount: z.number().int().min(5).max(30).optional(),
  seed: z.union([z.string().min(1).max(200), z.number()]).optional(),
  strictTypes: z.boolean().optional(),
  types: z
    .object({
      mcq: z.number().int().min(0),
      trueFalse: z.number().int().min(0),
      shortAnswer: z.number().int().min(0),
      fillBlank: z.number().int().min(0),
    })
    .optional(),
});

const submissionSchema = z.object({
  examId: z.coerce.number().int(),
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      type: z.enum(["mcq", "trueFalse", "shortAnswer", "fillBlank"]),
      value: z.union([z.string(), z.boolean(), z.number()]),
    })
  ),
});

const exportSchema = z.object({
  format: z.enum(["json", "html"]).default("json"),
  withAnswers: z.preprocess(
    (value) => {
      if (value === undefined) {
        return false;
      }
      return value === "true";
    },
    z.boolean()
  ),
});

const handleValidation = (schema, data) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.flatten();
    throw new AppError("Validation failed.", 400, "VALIDATION_ERROR", details);
  }
  return result.data;
};

router.post("/exams/generate", limiter, async (req, res, next) => {
  try {
    const payload = handleValidation(generateSchema, req.body || {});
    const strictTypes =
      typeof payload.strictTypes === "undefined"
        ? process.env.NODE_ENV === "production"
        : Boolean(payload.strictTypes);
    const config = buildExamConfig({ ...payload, strictTypes });
    config.strictTypes = strictTypes;
    getProvider();
    const exam = generateGroundedExam({
      text: payload.text,
      title: payload.title,
      config,
      seed: payload.seed,
    });
    const sourceTextHash = crypto.createHash("sha256").update(payload.text).digest("hex");

    runInTransaction((transactionalDb) => {
      const insert = transactionalDb.prepare(
        `INSERT INTO exams (title, sourceTextHash, configJson, examJson, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      );
      const placeholderExam = { ...exam, id: null };
      const info = insert.run(
        exam.title,
        sourceTextHash,
        JSON.stringify(exam.config),
        JSON.stringify(placeholderExam),
        exam.createdAt
      );
      const examId = Number(info.lastInsertRowid);
      exam.id = examId;
      exam.config = { ...(exam.config || {}), strictTypes };
      transactionalDb.prepare("UPDATE exams SET examJson = ? WHERE id = ?").run(
        JSON.stringify(exam),
        examId
      );
    });

    res.json(exam);
  } catch (error) {
    next(error);
  }
});

router.get("/exams", limiter, (req, res, next) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, title, configJson, createdAt FROM exams ORDER BY createdAt DESC"
      )
      .all();
    const list = rows.map((row) => {
      const config = JSON.parse(row.configJson);
      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        difficulty: config.difficulty,
        questionCount: config.questionCount,
      };
    });
    res.json(list);
  } catch (error) {
    next(error);
  }
});

router.get("/exams/:id", limiter, (req, res, next) => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId)) {
      throw new AppError("Exam ID must be an integer.", 400, "VALIDATION_ERROR");
    }
    const row = db
      .prepare("SELECT examJson FROM exams WHERE id = ?")
      .get(examId);
    if (!row) {
      throw new AppError("Exam not found.", 404, "NOT_FOUND");
    }
    const exam = JSON.parse(row.examJson);
    exam.id = examId;
    res.json(exam);
  } catch (error) {
    next(error);
  }
});

router.post("/exams/:id/submit", limiter, (req, res, next) => {
  try {
    const payload = handleValidation(submissionSchema, req.body || {});
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId)) {
      throw new AppError("Exam ID must be an integer.", 400, "VALIDATION_ERROR");
    }
    if (payload.examId !== examId) {
      throw new AppError("Exam ID mismatch.", 400, "VALIDATION_ERROR");
    }
    const examRow = db
      .prepare("SELECT examJson FROM exams WHERE id = ?")
      .get(examId);
    if (!examRow) {
      throw new AppError("Exam not found.", 404, "NOT_FOUND");
    }
    const exam = JSON.parse(examRow.examJson);
    exam.id = examId;
    const grading = gradeSubmission(exam, payload.answers);

    runInTransaction((transactionalDb) => {
      const attemptInsert = transactionalDb.prepare(
        `INSERT INTO attempts (id, examId, answersJson, scoreJson, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      );
      attemptInsert.run(
        grading.attemptId,
        examId,
        JSON.stringify(payload.answers),
        JSON.stringify({ score: grading.score, results: grading.results }),
        grading.createdAt
      );
    });

    res.json({
      attemptId: grading.attemptId,
      examId,
      score: grading.score,
      results: grading.results,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/exams/:id/attempts", limiter, (req, res, next) => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId)) {
      throw new AppError("Exam ID must be an integer.", 400, "VALIDATION_ERROR");
    }
    const rows = db
      .prepare(
        "SELECT id, scoreJson, createdAt FROM attempts WHERE examId = ? ORDER BY createdAt DESC"
      )
      .all(examId);
    const list = rows.map((row) => {
      const scorePayload = JSON.parse(row.scoreJson);
      return {
        attemptId: row.id,
        createdAt: row.createdAt,
        scorePercent: scorePayload.score?.percent ?? 0,
      };
    });
    res.json(list);
  } catch (error) {
    next(error);
  }
});

router.get("/attempts/:attemptId", limiter, (req, res, next) => {
  try {
    const row = db
      .prepare(
        "SELECT id, examId, answersJson, scoreJson, createdAt FROM attempts WHERE id = ?"
      )
      .get(req.params.attemptId);
    if (!row) {
      throw new AppError("Attempt not found.", 404, "NOT_FOUND");
    }
    const scorePayload = JSON.parse(row.scoreJson);
    res.json({
      attemptId: row.id,
      examId: row.examId,
      createdAt: row.createdAt,
      answers: JSON.parse(row.answersJson),
      score: scorePayload.score,
      results: scorePayload.results,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/exams/:id/export", limiter, (req, res, next) => {
  try {
    const query = handleValidation(exportSchema, req.query || {});
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId)) {
      throw new AppError("Exam ID must be an integer.", 400, "VALIDATION_ERROR");
    }
    const row = db
      .prepare("SELECT examJson FROM exams WHERE id = ?")
      .get(examId);
    if (!row) {
      throw new AppError("Exam not found.", 404, "NOT_FOUND");
    }
    const exam = JSON.parse(row.examJson);
    exam.id = examId;
    if (query.format === "json") {
      return res.json(exam);
    }

    const html = renderExamHtml(exam, query.withAnswers);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
