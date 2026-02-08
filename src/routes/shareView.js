const express = require("express");
const { db } = require("../db");

const router = express.Router();

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

router.get("/s/:token", (req, res) => {
  const { token } = req.params;
  const link = db.prepare("SELECT * FROM share_links WHERE token = ?").get(token);
  if (!link) {
    return res.status(404).send("Share link not found.");
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).send("Share link expired.");
  }
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(link.runId);
  if (!run) {
    return res.status(404).send("Shared run not found.");
  }
  const stored = parseJson(run.outputJson);
  const dataSource = stored?.output;
  const data =
    Array.isArray(dataSource?.data) ? dataSource.data.join("<br/>") : escapeHtml(dataSource?.data || dataSource);
  const highlights = (stored?.highlights || [])
    .map((highlight) => `<li>${escapeHtml(highlight.reason || "highlight")}</li>`)
    .join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shared summary</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; background: #f9fafb; color: #111827; }
      .card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 10px 30px rgba(15,23,42,0.1); margin-bottom: 16px; }
      h1 { margin-top: 0; }
      pre { white-space: pre-wrap; word-break: break-word; }
      ul { padding-left: 1.25rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Shared Tool Output</h1>
      <p><strong>Tool:</strong> ${escapeHtml(run.tool)}</p>
      <p><strong>Provider:</strong> ${escapeHtml(run.provider)}</p>
      <p><strong>Created:</strong> ${escapeHtml(run.createdAt)}</p>
      <div>
        <h2>Output</h2>
        <pre>${data || "No details available."}</pre>
      </div>
    </div>
    ${highlights ? `<div class="card"><h2>Highlights</h2><ul>${highlights}</ul></div>` : ""}
  </body>
</html>`);
});

module.exports = router;
