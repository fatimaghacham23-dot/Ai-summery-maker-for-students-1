process.env.QUIET_TEST_LOGS = process.env.QUIET_TEST_LOGS || "1";
require("./scripts/smoke_test.js");
