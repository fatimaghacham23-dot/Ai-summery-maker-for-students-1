const { lookup } = require("node:dns").promises;
const net = require("node:net");
const { AppError } = require("../middleware/errorHandler");
const { ProxyAgent } = require("undici");

let cachedYouTubeProxyUrl = null;
let cachedYouTubeProxyAgent = null;
const loggedProxyHosts = new Set();

const debugLog = (...args) => {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(...args);
};

const redactProxyUrl = (value) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const auth = parsed.username || parsed.password ? "<redacted>@" : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}`;
  } catch {
    return "<invalid_proxy_url>";
  }
};

const PRIVATE_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^::1$/,
];

const isPrivateIp = (ip) => {
  if (!ip) {
    return false;
  }
  if (net.isIP(ip) === 0) {
    return false;
  }
  return (
    ip.startsWith("10.") ||
    ip.startsWith("127.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.20.") ||
    ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") ||
    ip.startsWith("172.23.") ||
    ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") ||
    ip.startsWith("172.26.") ||
    ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") ||
    ip.startsWith("172.29.") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip === "::1"
  );
};

const isPrivateHost = (hostname) => {
  if (!hostname) {
    return true;
  }
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(hostname));
};

const ensureSafeUrl = async (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (isPrivateHost(parsed.hostname)) {
      throw new AppError("Private hosts are not allowed.", 400, "VALIDATION_ERROR");
    }
    const ip = net.isIP(parsed.hostname) ? parsed.hostname : null;
    if (ip && isPrivateIp(ip)) {
      throw new AppError("Resolved IP is private.", 400, "VALIDATION_ERROR");
    }
    if (!ip) {
      const lookupResult = await lookup(parsed.hostname).catch(() => null);
      if (lookupResult && isPrivateIp(lookupResult.address)) {
        throw new AppError("Resolved address is disallowed.", 400, "VALIDATION_ERROR");
      }
    }
    return parsed;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Invalid URL.", 400, "VALIDATION_ERROR");
  }
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const proxyUrl = process.env.YOUTUBE_PROXY_URL;
    const shouldProxy = (() => {
      if (!proxyUrl) {
        return false;
      }
      try {
        const parsed = new URL(url);
        const host = String(parsed.hostname || "").toLowerCase();
        return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
      } catch {
        return false;
      }
    })();

    const dispatcher = (() => {
      if (!shouldProxy) {
        return undefined;
      }
      if (cachedYouTubeProxyAgent && cachedYouTubeProxyUrl === proxyUrl) {
        return cachedYouTubeProxyAgent;
      }
      cachedYouTubeProxyUrl = proxyUrl;
      cachedYouTubeProxyAgent = new ProxyAgent(proxyUrl);
      return cachedYouTubeProxyAgent;
    })();

    if (shouldProxy) {
      try {
        const targetHost = new URL(url).hostname;
        if (!loggedProxyHosts.has(targetHost)) {
          loggedProxyHosts.add(targetHost);
          debugLog("[network] youtube proxy active", {
            proxy: redactProxyUrl(proxyUrl),
            targetHost,
          });
        }
      } catch {
        // ignore debug failures
      }
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  ensureSafeUrl,
  fetchWithTimeout,
};
