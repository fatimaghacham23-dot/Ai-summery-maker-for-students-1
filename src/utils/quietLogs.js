const isQuietTestLogs = () =>
  process.env.QUIET_TEST_LOGS === "1" || process.env.NODE_ENV === "test";

module.exports = {
  isQuietTestLogs,
};
