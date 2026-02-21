const { closeDatabase, resetTestDatabase } = require("../src/db");

process.env.QUIET_TEST_LOGS = "1";
process.env.DATABASE_PATH = process.env.DATABASE_PATH || ":memory:";
process.env.USE_MOCK_IMAGE_PROVIDER = process.env.USE_MOCK_IMAGE_PROVIDER || "true";

beforeEach(() => {
  resetTestDatabase();
});

afterAll(() => {
  closeDatabase();
});
