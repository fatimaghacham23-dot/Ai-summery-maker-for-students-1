const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB_PATH = path.join(__dirname, "../../data/app.db");

const isInMemoryPath = (candidate) => {
  return String(candidate || "").startsWith(":memory:");
};

const ensureDatabaseDirectory = (dbPath) => {
  if (!dbPath || isInMemoryPath(dbPath)) {
    return;
  }
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const resolveDatabasePath = () => {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return ":memory:";
  }
  return DEFAULT_DB_PATH;
};

const applyPragmaSettings = (database) => {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA synchronous = NORMAL;");
};

const createSchema = (database) => {
  database.exec(`
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
      type TEXT NOT NULL DEFAULT '',
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

  try {
    database.exec(`
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
    `);
  } catch (error) {
    // FTS5 may be unavailable; ignore so the rest of the schema can still load.
  }
};

const migrateExamSchema = (database) => {
  const examColumns = database.prepare("PRAGMA table_info(exams)").all();
  if (examColumns.length === 0) {
    return;
  }
  const idColumn = examColumns.find((column) => column.name === "id");
  if (!idColumn || idColumn.type.toUpperCase() === "INTEGER") {
    return;
  }

  database.exec("BEGIN");
  database.exec(`
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

  database.exec(`
    INSERT INTO exams_new (title, sourceTextHash, configJson, examJson, createdAt)
    SELECT title, sourceTextHash, configJson, examJson, createdAt
    FROM exams
    ORDER BY rowid;
  `);

  database.exec(`
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

  database.exec(`
    INSERT INTO attempts_new (id, examId, answersJson, scoreJson, createdAt)
    SELECT attempts.id,
      exam_id_map.newId,
      attempts.answersJson,
      attempts.scoreJson,
      attempts.createdAt
    FROM attempts
    JOIN exam_id_map ON attempts.examId = exam_id_map.oldId;
  `);

  database.exec("DROP TABLE attempts;");
  database.exec("DROP TABLE exams;");
  database.exec("DROP TABLE exam_id_map;");
  database.exec("ALTER TABLE exams_new RENAME TO exams;");
  database.exec("ALTER TABLE attempts_new RENAME TO attempts;");
  database.exec("COMMIT");
};

const ensureRunsTypeColumn = (database) => {
  const runColumns = database.prepare("PRAGMA table_info(runs)").all();
  const typeColumn = runColumns.find((column) => column.name === "type");
  if (typeColumn) {
    return;
  }
  database.exec("ALTER TABLE runs ADD COLUMN type TEXT DEFAULT ''");
  database.prepare("UPDATE runs SET type = tool WHERE type IS NULL OR type = ''").run();
};

const buildDatabase = () => {
  const resolvedPath = resolveDatabasePath();
  ensureDatabaseDirectory(resolvedPath);
  const database = new DatabaseSync(resolvedPath);
  applyPragmaSettings(database);
  createSchema(database);
  migrateExamSchema(database);
  createSchema(database);
  ensureRunsTypeColumn(database);
  return database;
};

let currentDb = null;

const getDb = () => {
  if (!currentDb) {
    currentDb = buildDatabase();
  }
  return currentDb;
};

const closeDatabase = () => {
  if (!currentDb) {
    return;
  }
  try {
    currentDb.close();
  } catch (error) {
    console.warn("Failed to close database:", error.message || error);
  }
  currentDb = null;
};

const resetTestDatabase = () => {
  if (process.env.NODE_ENV !== "test") {
    return getDb();
  }
  closeDatabase();
  return getDb();
};

const busyWait = (ms) => {
  const normalized = Number(ms) || 0;
  const end = Date.now() + Math.max(0, normalized);
  while (Date.now() < end) {
    // busy wait to give locks a chance to clear
  }
};

const runInTransaction = (operation, options = {}) => {
  const maxAttempts = Math.max(1, Number(options.retries) || 4);
  const backoffMs = Number(options.backoffMs) || 30;
  const db = getDb();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      const isBusy =
        error &&
        (error.code === "SQLITE_BUSY" ||
          (typeof error.message === "string" && error.message.includes("SQLITE_BUSY")));
      if (isBusy && attempt < maxAttempts - 1) {
        busyWait(backoffMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Database transaction failed after multiple retries.");
};

const dbProxy = new Proxy(
  {},
  {
    get(_, prop) {
      const database = getDb();
      const value = database[prop];
      return typeof value === "function" ? value.bind(database) : value;
    },
    set(_, prop, value) {
      const database = getDb();
      database[prop] = value;
      return true;
    },
    has(_, prop) {
      return prop in getDb();
    },
    ownKeys() {
      return Reflect.ownKeys(getDb());
    },
    getOwnPropertyDescriptor(_, prop) {
      const database = getDb();
      const descriptor = Object.getOwnPropertyDescriptor(database, prop);
      if (descriptor) {
        descriptor.configurable = true;
      }
      return descriptor;
    },
  }
);

module.exports = {
  db: dbProxy,
  getDb,
  runInTransaction,
  resetTestDatabase,
  closeDatabase,
  getDatabasePath: resolveDatabasePath,
};
