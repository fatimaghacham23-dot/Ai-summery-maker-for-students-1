const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const resolveDatabasePath = () => {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  return path.join(__dirname, "../../data/app.db");
};

const ensureDatabaseDirectory = (dbPath) => {
  if (dbPath === ":memory:") {
    return;
  }
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const dbPath = resolveDatabasePath();
ensureDatabaseDirectory(dbPath);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

const createSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sourceTextHash TEXT NOT NULL,
      configJson TEXT NOT NULL,
      examJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      examId INTEGER NOT NULL,
      answersJson TEXT NOT NULL,
      scoreJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (examId) REFERENCES exams(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      source TEXT NOT NULL,
      license TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_subject ON knowledge_chunks(subject);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
      text,
      subject,
      title,
      source,
      content='knowledge_chunks',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
      INSERT INTO knowledge_chunks_fts(rowid, text, subject, title, source)
      VALUES (new.rowid, new.text, new.subject, new.title, new.source);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text, subject, title, source)
      VALUES ('delete', old.rowid, old.text, old.subject, old.title, old.source);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text, subject, title, source)
      VALUES ('delete', old.rowid, old.text, old.subject, old.title, old.source);
      INSERT INTO knowledge_chunks_fts(rowid, text, subject, title, source)
      VALUES (new.rowid, new.text, new.subject, new.title, new.source);
    END;
    
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT,
      sourceType TEXT NOT NULL,
      sourceRef TEXT,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      documentId TEXT,
      tool TEXT NOT NULL,
      paramsJson TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      outputJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (documentId) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      id TEXT PRIMARY KEY,
      documentId TEXT,
      runId TEXT,
      title TEXT,
      tagsJson TEXT,
      folder TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (documentId) REFERENCES documents(id),
      FOREIGN KEY (runId) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expiresAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (runId) REFERENCES runs(id)
    );
  `);
};

const migrateExamSchema = () => {
  const examColumns = db.prepare("PRAGMA table_info(exams)").all();
  if (examColumns.length === 0) {
    return;
  }
  const idColumn = examColumns.find((column) => column.name === "id");
  if (!idColumn || idColumn.type.toUpperCase() === "INTEGER") {
    return;
  }

  db.exec("BEGIN");
  db.exec(`
    CREATE TABLE exams_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sourceTextHash TEXT NOT NULL,
      configJson TEXT NOT NULL,
      examJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE attempts_new (
      id TEXT PRIMARY KEY,
      examId INTEGER NOT NULL,
      answersJson TEXT NOT NULL,
      scoreJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (examId) REFERENCES exams_new(id)
    );
  `);

  db.exec(`
    INSERT INTO exams_new (title, sourceTextHash, configJson, examJson, createdAt)
    SELECT title, sourceTextHash, configJson, examJson, createdAt
    FROM exams
    ORDER BY rowid;
  `);

  db.exec(`
    CREATE TABLE exam_id_map AS
    SELECT old.id AS oldId, new.id AS newId
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY rowid) AS rn
      FROM exams
    ) old
    JOIN (
      SELECT id, ROW_NUMBER() OVER (ORDER BY rowid) AS rn
      FROM exams_new
    ) new
    ON old.rn = new.rn;
  `);

  db.exec(`
    INSERT INTO attempts_new (id, examId, answersJson, scoreJson, createdAt)
    SELECT attempts.id,
      exam_id_map.newId,
      attempts.answersJson,
      attempts.scoreJson,
      attempts.createdAt
    FROM attempts
    JOIN exam_id_map ON attempts.examId = exam_id_map.oldId;
  `);

  db.exec("DROP TABLE attempts;");
  db.exec("DROP TABLE exams;");
  db.exec("DROP TABLE exam_id_map;");
  db.exec("ALTER TABLE exams_new RENAME TO exams;");
  db.exec("ALTER TABLE attempts_new RENAME TO attempts;");
  db.exec("COMMIT");
};

createSchema();
migrateExamSchema();
createSchema();

module.exports = {
  db,
};
