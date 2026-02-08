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
    // headers may be a plain object or a WHATWG Headers-like object
    let setCookieValues = null;
    if (!headers) {
      setCookieValues = null;
    } else if (typeof headers.get === "function") {
      setCookieValues = headers.get("set-cookie") || headers.get("Set-Cookie");
    } else {
      setCookieValues = headers["set-cookie"] || headers["Set-Cookie"];
    }

    if (!setCookieValues && headers && typeof headers.forEach === "function") {
      const collected = [];
      headers.forEach((value, key) => {
        if (String(key || "").toLowerCase() === "set-cookie") {
          collected.push(value);
        }
      });
      if (collected.length) {
        setCookieValues = collected;
      }
    }

    const parts = parseSetCookie(setCookieValues);
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
  const containsInnertubeApiKeySubstring = html.includes("INNERTUBE_API_KEY") || html.includes("innertubeApiKey") || html.includes("API_KEY");

  const ytcfg = extractYtcfgObject(html);

  const extractJsonObjectAfter = (needle) => {
    const idx = html.indexOf(needle);
    if (idx < 0) return null;
    const start = html.indexOf("{", idx);
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let strCh = null;
    let esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === strCh) {
          inStr = false;
          strCh = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        strCh = ch;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        const jsonText = html.slice(start, i + 1);
        try {
          return JSON.parse(jsonText);
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  const apiKeyFromRegex = () => {
    const source = String(html || "");

    const patterns = [
      /\"INNERTUBE_API_KEY\"\s*:\s*\"([^\"\\]+)\"/i,
      /\bINNERTUBE_API_KEY\b\s*[:=]\s*["']([^"'\\]+)["']/i,
      /\byt(cfg\.)?set\(\s*["']INNERTUBE_API_KEY["']\s*,\s*["']([^"'\\]+)["']\s*\)/i,
      /\bINNERTUBE_API_KEY\b\s*[,)]\s*["']([^"'\\]+)["']/i,
      /\"innertubeApiKey\"\s*:\s*\"([^\"\\]+)\"/i,
      /\binnertubeApiKey\b\s*[:=]\s*["']([^"'\\]+)["']/i,
      /\"API_KEY\"\s*:\s*\"([^\"\\]+)\"/i,
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
      if (match && match[2]) {
        return match[2];
      }
    }

    return null;
  };

  const visitorDataFromRegex = () => {
    const match = String(html || "").match(/\bVISITOR_DATA\b\s*[:=]\s*["']([^"']+)["']/i);
    return match?.[1] || null;
  };

  const contextFromRegex = () => {
    const extracted = extractJsonObjectAfter("INNERTUBE_CONTEXT");
    return extracted || null;
  };

  const apiKeyFromConfigBlob = () => {
    const candidates = [
      "ytcfg.data_",
      "ytcfg.set(",
      "YTCFG_DATA",
      "ytcfg =",
      "ytcfg.data",
    ];
    for (const needle of candidates) {
      const blob = extractJsonObjectAfter(needle);
      if (!blob) {
        continue;
      }
      const possible = blob?.INNERTUBE_API_KEY || blob?.INNERTUBE_APIKEY || blob?.innertubeApiKey;
      if (possible) {
        return possible;
      }
      const nested = blob?.INNERTUBE_CONTEXT || blob?.INNERTUBE_CONTEXT_CLIENT;
      if (nested?.INNERTUBE_API_KEY) {
        return nested.INNERTUBE_API_KEY;
      }
    }
    return null;
  };

  const findRedactedWindow = () => {
    const source = String(html || "");
    const idx = source.search(/INNERTUBE_API_KEY|innertubeApiKey|API_KEY/i);
    if (idx < 0) {
      return null;
    }
    const start = Math.max(0, idx - 80);
    const end = Math.min(source.length, idx + 120);
    const windowText = source.slice(start, end);
    return windowText
      .replace(/(INNERTUBE_API_KEY\"?\s*[:=]\s*\"?)([^\"\\\s]{6,})(\"?)/gi, "$1<redacted>$3")
      .replace(/(innertubeApiKey\"?\s*[:=]\s*\"?)([^\"\\\s]{6,})(\"?)/gi, "$1<redacted>$3")
      .replace(/(API_KEY\"?\s*[:=]\s*\"?)([^\"\\\s]{6,})(\"?)/gi, "$1<redacted>$3");
  };

  const apiKey = ytcfg?.INNERTUBE_API_KEY || apiKeyFromRegex() || apiKeyFromConfigBlob();
  const context = ytcfg?.INNERTUBE_CONTEXT || contextFromRegex();
  const visitorData =
    ytcfg?.VISITOR_DATA || visitorDataFromRegex() || context?.client?.visitorData || null;

  const found = Boolean(ytcfg) || Boolean(apiKey || context || visitorData);
  const method = ytcfg ? "ytcfg.set" : found ? "regex" : "ytcfg.set";

  if (!found) {
    return {
      ok: false,
      debug: { containsYtcfg, containsInnertubeApiKey, method, found: false },
      config: null,
    };
  }

  const ok = Boolean(apiKey && context);

  return {
    ok,
    debug: {
      containsYtcfg,
      containsInnertubeApiKey,
      containsInnertubeApiKeySubstring,
      apiKeyWindow: findRedactedWindow(),
      method,
      found: Boolean(found),
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
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": acceptHtml ? "navigate" : "cors",
    "Sec-Fetch-Dest": acceptHtml ? "document" : "empty",
    "Sec-Fetch-User": acceptHtml ? "?1" : "?0",
    "sec-ch-ua": '"Chromium";v="120", "Not=A?Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
  const cookie = cookieJar?.header?.() || "";
  if (cookie) headers.Cookie = cookie;
  if (videoId) headers.Referer = `https://www.youtube.com/watch?v=${videoId}`;
  if (videoId) headers.Origin = "https://www.youtube.com";
  return headers;
}

module.exports = {
  SimpleCookieJar,
  extractInnertubeConfigFromHtml,
  buildBrowserHeaders,
};
