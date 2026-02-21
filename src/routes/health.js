const configuredPort = Number.parseInt(process.env.PORT, 10);
const PORT = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const ENV = process.env.NODE_ENV || "development";

module.exports = (req, res) => {
  res.json({
    ok: true,
    env: ENV,
    port: PORT,
    uptimeSeconds: Math.floor(process.uptime()),
  });
};
