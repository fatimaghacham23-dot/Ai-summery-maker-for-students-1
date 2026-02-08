// src/lib/youtubeInnertube.js
// Minimal, robust helpers: cookie jar + ytcfg parsing + innertube extraction

function parseSetCookie(setCookieHeader) {
  // set-cookie can be array or string
  if (!setCookieHeader) return [];
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr
    .map((v) => String(v).split(";")[0].trim())
    .filter(Boolean);
}

class SimpleCookieJar {
  constructor() {
    this.cookies = new Map();
  }
  addFromResponseHeaders(headers) {
    // headers may be plain object
    const sc = headers?.["set-cookie"] || headers?.["Set-Cookie"];
    const parts = parseSetCookie(sc);
    for (const kv of parts) {
      const eq = kv.indexOf("=");
      if (eq > 0) this.cookies.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
  }
  header() {
    if (!this.cookies.size) return "";
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

// Extract JSON inside ytcfg.set({...});
function extractYtcfgObject(html) {
  const idx = html.indexOf("ytcfg.set(");
  if (idx < 0) return null;

  // Find first '{' after ytcfg.set(
  const start = html.indexOf("{", idx);
  if (start < 0) return null;

  // Balanced brace scan
  let depth = 0;
  let inStr = false;
  let strCh = null;
  let esc = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\\\") {
        esc = true;
      } else if (ch === strCh) {
        inStr = false;
        strCh = null;
      }
      continue;
    } else {
      if (ch === '"' || ch === "'") {
        inStr = true;
        strCh = ch;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        const jsonText = html.slice(start, i + 1);
        // ytcfg is JSON (double quotes). Some pages embed as JSON; if parse fails, return null.
        try {
          return JSON.parse(jsonText);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractInnertubeConfigFromHtml(html) {
  const containsYtcfg = html.includes("ytcfg");
  const containsInnertubeApiKey = html.includes("INNERTUBE_API_KEY") || html.includes("innertubeApiKey");

  const ytcfg = extractYtcfgObject(html);
  if (!ytcfg) {
    return {
      ok: false,
      debug: { containsYtcfg, containsInnertubeApiKey, method: "ytcfg.set", found: false },
      config: null,
    };
  }

  const apiKey = ytcfg.INNERTUBE_API_KEY;
  const context = ytcfg.INNERTUBE_CONTEXT;
  const visitorData = ytcfg.VISITOR_DATA || context?.client?.visitorData || null;

  const ok = Boolean(apiKey && context && visitorData);

  return {
    ok,
    debug: {
      containsYtcfg,
      containsInnertubeApiKey,
      method: "ytcfg.set",
      found: true,
      hasApiKey: Boolean(apiKey),
      hasContext: Boolean(context),
      hasVisitorData: Boolean(visitorData),
    },
    config: ok ? { apiKey, context, visitorData } : { apiKey, context, visitorData },
  };
}

function buildBrowserHeaders({ videoId, cookieJar, acceptHtml = false }) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: acceptHtml ? "text/html,*/*" : "*/*",
  };
  const cookie = cookieJar?.header?.() || "";
  if (cookie) headers.Cookie = cookie;
  if (videoId) headers.Referer = `https://www.youtube.com/watch?v=${videoId}`;
  return headers;
}

module.exports = {
  SimpleCookieJar,
  extractInnertubeConfigFromHtml,
  buildBrowserHeaders,
};
