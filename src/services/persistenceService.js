const { db, runInTransaction } = require("../db");

const parseJson = (value) => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const persistRun = ({
  runId,
  documentId = null,
  tool,
  type,
  params = {},
  outputJson,
  provider = "unknown",
  model = null,
}) => {
  if (!runId || !tool || !outputJson) {
    throw new Error("runId, tool, and outputJson are required to persist a run.");
  }

  const now = new Date().toISOString();
  runInTransaction((transactionalDb) => {
    const insert = transactionalDb.prepare(
      `INSERT INTO runs
        (id, documentId, tool, type, paramsJson, provider, model, outputJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      runId,
      documentId || null,
      tool,
      type || tool,
      JSON.stringify(params),
      provider,
      model || null,
      JSON.stringify(outputJson),
      now
    );
  });
};

const getRunById = (runId) => {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!row) {
    return null;
  }
  const params = parseJson(row.paramsJson) || {};
  const payload = parseJson(row.outputJson) || {};
  return {
    id: row.id,
    documentId: row.documentId,
    tool: row.tool,
    type: row.type || row.tool,
    provider: row.provider,
    model: row.model,
    params,
    output: payload.output || null,
    highlights: payload.highlights || [],
    createdAt: row.createdAt,
  };
};

const getRunsByType = (type, limit = 20) => {
  const rows = db
    .prepare(
      `SELECT id, paramsJson, outputJson, createdAt
       FROM runs
       WHERE type = ?
       ORDER BY createdAt DESC
       LIMIT ?`
    )
    .all(type, limit);
  return rows;
};

module.exports = {
  persistRun,
  getRunById,
  getRunsByType,
};
