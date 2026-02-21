const express = require("express");
const { randomUUID } = require("crypto");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const { AppError } = require("../middleware/errorHandler");
const { db, runInTransaction } = require("../db");
const persistenceService = require("../services/persistenceService");

const router = express.Router();

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const flattenOutputData = (outputPayload) => {
  if (!outputPayload) return "";
  const data = outputPayload.output || {};
  if (typeof data.data === "string") {
    return data.data;
  }
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data.data || data, null, 2);
};

router.post("/saved", async (req, res, next) => {
  try {
    const { runId, title, tags, folder } = req.body || {};
    if (!runId) {
      throw new AppError("runId is required.", 400, "VALIDATION_ERROR");
    }
    const run = db.prepare("SELECT documentId FROM runs WHERE id = ?").get(runId);
    if (!run) {
      throw new AppError("Run not found.", 404, "NOT_FOUND");
    }
    const savedId = randomUUID();
    runInTransaction((transactionalDb) => {
      transactionalDb.prepare(
        `INSERT INTO saved_items (id, documentId, runId, title, tagsJson, folder, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        savedId,
        run.documentId || null,
        runId,
        title || "Saved summary",
        JSON.stringify(Array.isArray(tags) ? tags : []),
        folder || "default",
        new Date().toISOString()
      );
    });
    res.json({
      id: savedId,
      runId,
      title: title || "Saved summary",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/saved", (req, res, next) => {
  try {
    const { query, folder, tag } = req.query;
    const filters = [];
    const params = [];
    if (query) {
      filters.push("(saved_items.title LIKE ? OR saved_items.tagsJson LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }
    if (folder) {
      filters.push("folder = ?");
      params.push(folder);
    }
    if (tag) {
      filters.push("tagsJson LIKE ?");
      params.push(`%${tag}%`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT saved_items.*, runs.tool, runs.outputJson
      FROM saved_items
      LEFT JOIN runs ON saved_items.runId = runs.id
      ${whereClause}
      ORDER BY saved_items.createdAt DESC
    `;
    const rows = db.prepare(sql).all(...params);
    const payload = rows.map((row) => ({
      id: row.id,
      title: row.title,
      folder: row.folder,
      tags: parseJson(row.tagsJson) || [],
      runId: row.runId,
      tool: row.tool,
      createdAt: row.createdAt,
    }));
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

const handleGetRun = (req, res, next) => {
  try {
    const { id } = req.params;
    const run = persistenceService.getRunById(id);
    if (!run) {
      throw new AppError("Run not found.", 404, "NOT_FOUND");
    }
    res.json({
      id: run.id,
      tool: run.tool,
      type: run.type,
      provider: run.provider,
      model: run.model,
      params: run.params,
      inputText: run.params?.inputText || "",
      output: run.output,
      highlights: run.highlights,
      createdAt: run.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

router.get("/runs/:id", handleGetRun);
router.get("/persistence/runs/:id", handleGetRun);

router.post("/share", (req, res, next) => {
  try {
    const { runId, ttlHours } = req.body || {};
    if (!runId) {
      throw new AppError("runId is required to share output.", 400, "VALIDATION_ERROR");
    }
    const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(runId);
    if (!run) {
      throw new AppError("Run not found.", 404, "NOT_FOUND");
    }
    const token = randomUUID();
    const expiresAt =
      typeof ttlHours === "number" && ttlHours > 0
        ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
        : null;
    runInTransaction((transactionalDb) => {
      transactionalDb.prepare(
        `INSERT INTO share_links (id, runId, token, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), runId, token, expiresAt, new Date().toISOString());
    });
    res.json({
      token,
      url: `/s/${token}`,
      expiresAt,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/export/:runId", (req, res, next) => {
  try {
    const { runId } = req.params;
    const format = (req.query.format || "txt").toLowerCase();
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!run) {
      throw new AppError("Run not found.", 404, "NOT_FOUND");
    }
    const storedOutput = parseJson(run.outputJson);
    if (!storedOutput) {
      throw new AppError("Run output missing.", 500, "DATA_ERROR");
    }
    const content = flattenOutputData(storedOutput);
    const safeTool = run.tool.replace(/\W+/g, "-");
    const filename = `${safeTool}-${runId}.${format}`;

    switch (format) {
      case "pdf": {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        const doc = new PDFDocument({ margin: 40 });
        doc.pipe(res);
        doc.fontSize(12).text(content || "No content available.", {
          align: "left",
          lineGap: 4,
        });
        doc.end();
        return;
      }
      case "docx": {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        const doc = new Document({
          sections: [
            {
              properties: {},
              children: [
                new Paragraph({
                  children: [new TextRun({ text: content || "No output.", font: "Calibri", size: 24 })],
                }),
              ],
            },
          ],
        });
        Packer.toBuffer(doc)
          .then((buffer) => res.end(buffer))
          .catch(next);
        return;
      }
      case "md":
      case "txt":
      default: {
        const textFormat = format === "md" ? "text/markdown" : "text/plain";
        res.setHeader("Content-Type", textFormat);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(content || "");
        return;
      }
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
