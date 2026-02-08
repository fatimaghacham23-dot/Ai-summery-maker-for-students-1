const { db } = require("../db");

const DEFAULT_LIMIT_PER_SUBJECT = 3;
const MIN_QUERY_TOKEN_LENGTH = 3;

const normalizeSubject = (value) => String(value || "").trim().toLowerCase();

const tokenizeQuery = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_QUERY_TOKEN_LENGTH);

const buildFtsQuery = (queryText) => {
  const tokens = tokenizeQuery(queryText);
  if (!tokens.length) {
    return null;
  }
  return tokens.map((token) => `"${token}"`).join(" AND ");
};

const buildLikeQuery = (queryText) => {
  const tokens = tokenizeQuery(queryText);
  if (!tokens.length) {
    return null;
  }
  return tokens.map((token) => `%${token}%`);
};

const retrieveRelevantChunks = (queryText, subjects = [], limitPerSubject = DEFAULT_LIMIT_PER_SUBJECT) => {
  const ftsQuery = buildFtsQuery(queryText);
  const likeTokens = buildLikeQuery(queryText);
  if (!ftsQuery || !likeTokens) {
    return [];
  }

  const normalizedSubjects = Array.isArray(subjects)
    ? subjects.map((subject) => normalizeSubject(subject)).filter(Boolean)
    : [];

  const results = [];
  if (!normalizedSubjects.length) {
    try {
      const rows = db
        .prepare(
          `SELECT kc.id, kc.subject, kc.source, kc.license, kc.title, kc.text
           FROM knowledge_chunks_fts fts
           JOIN knowledge_chunks kc ON kc.rowid = fts.rowid
           WHERE knowledge_chunks_fts MATCH ?
           ORDER BY bm25(knowledge_chunks_fts)
           LIMIT ?`
        )
        .all(ftsQuery, Math.max(1, Number(limitPerSubject) || DEFAULT_LIMIT_PER_SUBJECT));
      return rows;
    } catch (error) {
      const likeWhere = likeTokens.map(() => "(text LIKE ? OR title LIKE ? OR subject LIKE ? OR source LIKE ?)").join(" AND ");
      const likeParams = likeTokens.flatMap((token) => [token, token, token, token]);
      const rows = db
        .prepare(
          `SELECT id, subject, source, license, title, text
           FROM knowledge_chunks
           WHERE ${likeWhere}
           LIMIT ?`
        )
        .all(...likeParams, Math.max(1, Number(limitPerSubject) || DEFAULT_LIMIT_PER_SUBJECT));
      return rows;
    }
  }

  normalizedSubjects.forEach((subject) => {
    try {
      const rows = db
        .prepare(
          `SELECT kc.id, kc.subject, kc.source, kc.license, kc.title, kc.text
           FROM knowledge_chunks_fts fts
           JOIN knowledge_chunks kc ON kc.rowid = fts.rowid
           WHERE knowledge_chunks_fts MATCH ?
             AND kc.subject = ?
           ORDER BY bm25(knowledge_chunks_fts)
           LIMIT ?`
        )
        .all(ftsQuery, subject, Math.max(1, Number(limitPerSubject) || DEFAULT_LIMIT_PER_SUBJECT));
      results.push(...rows);
    } catch (error) {
      const likeWhere = likeTokens.map(() => "(text LIKE ? OR title LIKE ? OR subject LIKE ? OR source LIKE ?)").join(" AND ");
      const likeParams = likeTokens.flatMap((token) => [token, token, token, token]);
      const rows = db
        .prepare(
          `SELECT id, subject, source, license, title, text
           FROM knowledge_chunks
           WHERE subject = ?
             AND ${likeWhere}
           LIMIT ?`
        )
        .all(subject, ...likeParams, Math.max(1, Number(limitPerSubject) || DEFAULT_LIMIT_PER_SUBJECT));
      results.push(...rows);
    }
  });

  return results;
};

const listKnowledgeSources = () =>
  db
    .prepare(
      `SELECT DISTINCT source, license
       FROM knowledge_chunks
       ORDER BY source ASC`
    )
    .all()
    .map((row) => ({
      source: row.source,
      license: row.license,
    }));

module.exports = {
  retrieveRelevantChunks,
  listKnowledgeSources,
};
