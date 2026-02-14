const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { randomUUID } = require("crypto");
const { AppError } = require("../middleware/errorHandler");
const { db } = require("../db");
const { ensureSafeUrl, fetchWithTimeout } = require("../utils/network");
const { isQuietTestLogs } = require("../utils/quietLogs");
const {
  SimpleCookieJar,
  extractInnertubeConfigFromHtml,
  buildBrowserHeaders,
} = require("../lib/youtubeInnertube");

const router = express.Router();
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const URL_TEXT_LIMIT = 25000;
const MAX_TRANSCRIPT_LENGTH = 200000;
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const YOUTUBE_DOMAINS = new Set(["youtube.com", "youtube-nocookie.com", "youtu.be"]);
const YOUTUBE_VIDEO_ID_REGEX = /(?:youtu\.be\/|\/shorts\/|\/embed\/|\/v\/|v=)([A-Za-z0-9_-]{11})/i;
const VIDEO_ID_MATCHER = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const YOUTUBE_HTML_ACCEPT = "text/html,*/*";
const YOUTUBE_CAPTION_ACCEPT = "text/vtt,application/json,text/plain,*/*";
const YOUTUBE_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const YOUTUBE_REFERER_PREFIX = "https://www.youtube.com/watch?v=";
const YOUTUBE_ORIGIN = "https://www.youtube.com";
const YOUTUBE_ROOT_URL = `${YOUTUBE_ORIGIN}/`;
const YOUTUBE_INNERTUBE_TRANSCRIPT_URL = "https://www.youtube.com/youtubei/v1/get_transcript";
const CAPTION_FORMAT_SEQUENCE = ["json3", "srv3", "vtt"];
const PLAYER_RESPONSE_PATTERN = /var ytInitialPlayerResponse\s*=\s*{/;
const PLAYER_RESPONSE_FALLBACK_PATTERN = /ytInitialPlayerResponse\s*=\s*{/;
const CONSENT_PATTERNS = [
  /consent\.google\.com/i,
  /consent\.youtube\.com/i,
  /ytd-consent-bump-lightbox/i,
  /consentRequired/i,
  /www\.google\.com\/sorry\//i,
];

const shouldLogYouTubeDebug = () => !isQuietTestLogs();

const stripLanguage = (value) => {
  if (!value) {
    return null;
  }
  const normalized = String(value).toLowerCase().trim();
  const filtered = normalized.replace(/[^a-z\-]/g, "");
  return filtered || null;
};

const ensureAsrQueryParams = (baseUrl) => {
  if (!baseUrl) {
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.searchParams.get("caps")) {
      parsed.searchParams.set("caps", "asr");
    }
    if (!parsed.searchParams.get("kind")) {
      parsed.searchParams.set("kind", "asr");
    }
    return parsed.toString();
  } catch {
    return baseUrl;
  }
};

const fetchCaptionTextWithRetry = async ({ track, videoId, cookieJar, consentCookieHeader, retryWatch }) => {
  const formatsToTry = CAPTION_FORMAT_SEQUENCE;
  const attempts = [];
  for (let pass = 0; pass < 2; pass += 1) {
    for (const fmt of formatsToTry) {
      const result = await fetchCaptionFormat({
        track,
        videoId,
        fmt,
        cookieJar,
        consentCookieHeader,
      });
      attempts.push(result);

      if (result.status === "success") {
        const parsed = parseCaptionResult(result, videoId, track.languageCode);
        if (parsed.success) {
          return {
            success: true,
            text: parsed.text,
            track,
            attempt: result,
            attempts,
          };
        }
      }

      if (result.status === "fatal") {
        return {
          success: false,
          fatal: true,
          reason: "fetch_blocked",
          trackLanguage: track.languageCode,
          lastAttempt: result,
          attempts,
          track,
        };
      }

      if (result.reason && isBlockedCaptionReason(result.reason)) {
        if (cookieJar && typeof retryWatch === "function" && pass === 0) {
          await sleep(250);
          await retryWatch();
          continue;
        }
        return {
          success: false,
          fatal: false,
          reason: result.reason,
          trackLanguage: track.languageCode,
          lastAttempt: result,
          attempts,
          track,
        };
      }
    }
    if (cookieJar && typeof retryWatch === "function" && pass === 0) {
      await sleep(250);
      await retryWatch();
    }
  }
  const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
  return {
    success: false,
    fatal: false,
    reason: lastAttempt?.reason || "caption_fetch_empty",
    trackLanguage: track?.languageCode || null,
    lastAttempt,
    attempts,
    track,
  };
};

const buildAcceptLanguageHeader = (primaryLanguage) => {
  const normalized = stripLanguage(primaryLanguage);
  if (!normalized) {
    return YOUTUBE_ACCEPT_LANGUAGE;
  }
  if (normalized.startsWith("en")) {
    return YOUTUBE_ACCEPT_LANGUAGE;
  }
  return `${normalized},${YOUTUBE_ACCEPT_LANGUAGE}`;
};

const containsConsentPage = (html) => {
  if (!html) {
    return false;
  }
  return CONSENT_PATTERNS.some((pattern) => pattern.test(html));
};

const isAutoGeneratedTrack = (track) => {
  if (!track) {
    return false;
  }
  const kind = (track.kind || track.trackKind || "").toLowerCase();
  if (kind === "asr") {
    return true;
  }
  if (typeof track.isAutoGenerated === "boolean") {
    return track.isAutoGenerated;
  }
  const baseUrl = track.baseUrl || "";
  if (baseUrl.includes("caps=asr")) {
    return true;
  }
  return false;
};

const getTrackLanguageTag = (track) => track?.languageCode || track?.vssId || track?.language || null;

const isEnglishTrackCandidate = (track) => {
  const normalized = stripLanguage(getTrackLanguageTag(track));
  return Boolean(normalized?.startsWith("en"));
};

const getTrackDisplayName = (track) => {
  if (!track) {
    return null;
  }
  const nameNode = track.name || track.captionTrackName || null;
  if (typeof nameNode?.simpleText === "string") {
    return nameNode.simpleText;
  }
  if (Array.isArray(nameNode?.runs)) {
    const joined = nameNode.runs.map((run) => run?.text || "").join("");
    return joined.trim() || null;
  }
  if (typeof nameNode === "string") {
    return nameNode;
  }
  return null;
};

const normalizeUrlWithoutFmt = (rawUrl) => {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("fmt");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const isBlockedCaptionReason = (reason) => {
  return reason === "unexpected_html" || reason === "empty body";
};

const BLOCKED_STATUS_BY_REASON = {
  unexpected_html: 502,
  "empty body": 424,
  fetch_blocked: 502,
};

const getBlockedStatusForReason = (reason) => BLOCKED_STATUS_BY_REASON[reason] || 502;

const hasCaptionBaseUrl = (track) => Boolean(track?.baseUrl);

const prioritizeCaptionTracks = (tracks) => {
  if (!Array.isArray(tracks)) {
    return [];
  }
  const englishTracks = [];
  const fallbackTracks = [];
  const asrTracks = [];
  for (const track of tracks) {
    if (!hasCaptionBaseUrl(track)) {
      continue;
    }
    if (isEnglishTrackCandidate(track) && !isAutoGeneratedTrack(track)) {
      englishTracks.push(track);
      continue;
    }
    if (isAutoGeneratedTrack(track)) {
      asrTracks.push(track);
      continue;
    }
    fallbackTracks.push(track);
  }
  return [...englishTracks, ...asrTracks, ...fallbackTracks];
};

const getTopLevelDomain = (hostname = "") => {
  const normalized = hostname.toLowerCase();
  const parts = normalized.split(".");
  if (parts.length <= 2) {
    return normalized;
  }
  return parts.slice(-2).join(".");
};

const isYouTubeDomain = (hostname) => {
  if (!hostname) {
    return false;
  }
  const domain = getTopLevelDomain(hostname);
  return YOUTUBE_DOMAINS.has(domain);
};

const parseYouTubeVideoId = (url) => {
  const searchParams = url.searchParams;
  if (searchParams.has("v")) {
    const vParam = searchParams.get("v");
    if (VIDEO_ID_MATCHER.test(vParam)) {
      return vParam;
    }
  }

  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    const shortId = url.pathname.replace("/", "");
    if (VIDEO_ID_MATCHER.test(shortId)) {
      return shortId;
    }
  }

  const match = url.href.match(YOUTUBE_VIDEO_ID_REGEX);
  if (match && match[1] && VIDEO_ID_MATCHER.test(match[1])) {
    return match[1];
  }

  const fallbackSegment = url.pathname.split("/").filter(Boolean).pop();
  if (fallbackSegment && VIDEO_ID_MATCHER.test(fallbackSegment)) {
    return fallbackSegment;
  }

  return null;
};

const buildTranscriptText = (segments) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "";
  }
  const joined = segments
    .map((segment) => (segment && segment.text ? String(segment.text) : ""))
    .map((text) => text.replace(/\s+/g, " ").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return joined;
};

const buildTranscriptTextFromPlayerEvents = (events) => {
  if (!Array.isArray(events)) {
    return "";
  }
  const segments = [];
  for (const event of events) {
    if (!event || !Array.isArray(event.segs)) {
      continue;
    }
    for (const seg of event.segs) {
      const text = typeof seg?.utf8 === "string" ? seg.utf8 : null;
      if (text) {
        segments.push({ text });
      }
    }
  }
  return buildTranscriptText(segments);
};

const extractJsonSegment = (text) => {
  if (!text) {
    return "";
  }
  const trimmed = String(text).trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return "";
  }
  return trimmed.slice(start, end + 1);
};

const parseJsonTranscriptPayload = (text) => {
  const segment = extractJsonSegment(text);
  if (!segment) {
    return { success: false, reason: "empty payload", raw: text };
  }
  try {
    return { success: true, payload: JSON.parse(segment) };
  } catch (error) {
    return { success: false, reason: error?.message || "invalid json", raw: segment };
  }
};

const buildTranscriptTextFromVtt = (vtt) => {
  if (!vtt) {
    return "";
  }
  const cleaned = String(vtt)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.toLowerCase().startsWith("webvtt") &&
        !line.toLowerCase().startsWith("note") &&
        !line.includes("-->")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
};

const extractPlayerResponse = (html) => {
  if (!html) {
    return null;
  }
  const match =
    html.match(PLAYER_RESPONSE_PATTERN) || html.match(PLAYER_RESPONSE_FALLBACK_PATTERN);
  if (!match) {
    return null;
  }
  const braceIndex = html.indexOf("{", match.index);
  if (braceIndex === -1) {
    return null;
  }
  const scriptEnd = html.indexOf("</script>", braceIndex);
  if (scriptEnd === -1) {
    return null;
  }
  const closingIndex = html.lastIndexOf("};", scriptEnd);
  if (closingIndex === -1) {
    return null;
  }
  const jsonText = html.slice(braceIndex, closingIndex + 1);
  return JSON.parse(jsonText);
};

const findGetTranscriptEndpointParams = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (
    typeof value.getTranscriptEndpoint === "object" &&
    typeof value.getTranscriptEndpoint.params === "string"
  ) {
    return value.getTranscriptEndpoint.params;
  }
  for (const nested of Object.values(value)) {
    const result = findGetTranscriptEndpointParams(nested);
    if (result) {
      return result;
    }
  }
  return null;
};

const debugLog = (...args) => {
  if (!shouldLogYouTubeDebug()) {
    return;
  }
  console.debug(...args);
};

const logYouTubeTranscriptStatus = (details = {}) => {
  debugLog("[youtube-transcript] status", details);
};

const logCaptionFetchDebug = ({
  videoId,
  captionsFound,
  selectedTrackLanguage,
  selectedTrackName,
  finalUrl,
  responseContentType,
  youtubeiAttempted,
  youtubeiStatus,
  youtubeiContentType,
  youtubeiJsonErrorCode,
  youtubeiJsonErrorMessage,
}) => {
  if (!shouldLogYouTubeDebug()) {
    return;
  }
  let finalUrlDomain = null;
  if (finalUrl) {
    try {
      finalUrlDomain = getTopLevelDomain(new URL(finalUrl).hostname);
    } catch {
      finalUrlDomain = null;
    }
  }
  debugLog("[youtube-transcript] caption debug", {
    videoId,
    captionsFound,
    selectedTrackLanguage,
    selectedTrackName: selectedTrackName || null,
    finalUrlDomain,
    responseContentType: responseContentType || null,
    youtubeiAttempted: Boolean(youtubeiAttempted),
    youtubeiStatus: youtubeiStatus ?? null,
    youtubeiContentType: youtubeiContentType || null,
    youtubeiJsonErrorCode: youtubeiJsonErrorCode || null,
    youtubeiJsonErrorMessage: youtubeiJsonErrorMessage || null,
  });
};

const logInnertubeConfigFlags = (videoId, config = {}) => {
  if (!shouldLogYouTubeDebug()) {
    return;
  }
  const hasApiKey = Boolean(config?.apiKey ?? config?.hasApiKey);
  const hasContext = Boolean(config?.context ?? config?.hasContext);
  const hasVisitorData = Boolean(config?.visitorData ?? config?.hasVisitorData);
  debugLog("[youtube-transcript] youtubei config", {
    videoId,
    hasApiKey,
    hasContext,
    hasVisitorData,
    containsInnertubeApiKeySubstring: config?.containsInnertubeApiKeySubstring ?? null,
    apiKeyWindow: config?.apiKeyWindow ?? null,
  });
};

const escapeRegex = (value) =>
  (value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractCookieValueFromResponse = (response, cookieName) => {
  if (!response?.headers || !cookieName) {
    return null;
  }
  const safeName = escapeRegex(cookieName);
  const pattern = new RegExp(`${safeName}=([^;]+)`, "i");
  for (const [headerName, headerValue] of response.headers.entries()) {
    if (headerName.toLowerCase() !== "set-cookie") {
      continue;
    }
    const match = headerValue.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
};

const fetchYouTubeConsentCookieHeader = async (cookieJar) => {
  try {
    const response = await fetchWithTimeout(YOUTUBE_ROOT_URL, {
      method: "GET",
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        Accept: YOUTUBE_HTML_ACCEPT,
        "Accept-Language": YOUTUBE_ACCEPT_LANGUAGE,
      },
      redirect: "follow",
    });
    if (cookieJar) {
      cookieJar.addFromResponseHeaders(response.headers);
    }
    const consentValue = extractCookieValueFromResponse(response, "CONSENT");
    await response.text().catch(() => null);
    if (consentValue) {
      debugLog("[youtube-transcript] consent cookie captured", {
        finalUrl: response.url,
      });
      return `CONSENT=${consentValue}`;
    }
    debugLog("[youtube-transcript] consent cookie not present", {
      finalUrl: response.url,
    });
  } catch (error) {
    debugLog("[youtube-transcript] consent fetch failed", {
      error: error?.message,
    });
  }
  return null;
};

const extractYoutubeiJsonError = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.error) {
    const error = payload.error;
    return {
      code: error?.code ?? error?.status ?? null,
      message:
        error?.message ||
        (Array.isArray(error?.errors) && error.errors[0]?.message) ||
        null,
    };
  }
  if (Array.isArray(payload.errorResponses) && payload.errorResponses.length) {
    const [entry] = payload.errorResponses;
    return {
      code: entry?.reason ?? entry?.code ?? null,
      message: entry?.message ?? null,
    };
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const [entry] = payload.errors;
    return {
      code: entry?.code ?? entry?.reason ?? null,
      message: entry?.message ?? entry?.reason ?? null,
    };
  }
  return null;
};

const createTranscriptUnavailableError = (reason, details = {}) => {
  debugLog(`[youtube-transcript] ${reason}`, details);
  return new AppError(
    `No transcript found for this video. (${reason})`,
    422,
    "TRANSCRIPT_UNAVAILABLE",
    { reason, ...details }
  );
};

const createYouTubeTranscriptBlockedError = (reason, details = {}) => {
  const status = getBlockedStatusForReason(reason);
  return new AppError(
    `YouTube transcript blocked (${reason}).`,
    status,
    "YOUTUBE_TRANSCRIPT_BLOCKED",
    { reason, ...details }
  );
};

const sanitizeBaseUrlForLogging = (rawBaseUrl) => {
  if (!rawBaseUrl) {
    return "";
  }
  try {
    const parsed = new URL(rawBaseUrl);
    const query = parsed.search ? "?<redacted>" : "";
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch {
    const [base] = rawBaseUrl.split("?");
    return base;
  }
};

const buildCaptionHeaders = (videoId, languagePreference) => ({
  "User-Agent": YOUTUBE_USER_AGENT,
  Accept: YOUTUBE_CAPTION_ACCEPT,
  "Accept-Language": buildAcceptLanguageHeader(languagePreference),
  Referer: `${YOUTUBE_REFERER_PREFIX}${videoId}`,
  Origin: YOUTUBE_ORIGIN,
});

const isTranscriptPayloadContentTypeAllowed = (contentType) => {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) {
    return false;
  }
  if (ct.includes("text/vtt")) {
    return true;
  }
  if (ct.includes("application/json") || ct.includes("text/json")) {
    return true;
  }
  if (ct.includes("text/xml") || ct.includes("application/xml")) {
    return true;
  }
  if (ct.includes("text/plain")) {
    return true;
  }
  return false;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

const captureResponseHeaders = (response) => {
  const responseHeaders = {};
  if (response?.headers && typeof response.headers.forEach === "function") {
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
  }
  return {
    responseHeaders,
    contentType: responseHeaders["content-type"] || null,
    contentLength: responseHeaders["content-length"] || null,
    contentEncoding: responseHeaders["content-encoding"] || null,
    location: responseHeaders["location"] || null,
  };
};

const buildCaptionUrlWithFmt = (baseUrl, fmt) => {
  const captionUrl = new URL(baseUrl);
  if (fmt) {
    captionUrl.searchParams.set("fmt", fmt);
  }
  return captionUrl;
};

const buildTranscriptTextFromGenericCaptions = (raw) => {
  if (!raw) {
    return "";
  }
  const decoded = String(raw)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const extractYoutubeiSnippetText = (segmentRenderer) => {
  if (!segmentRenderer) {
    return "";
  }
  const snippet = segmentRenderer.snippet || {};
  if (Array.isArray(snippet.runs)) {
    return snippet.runs.map((run) => run?.text || "").join("");
  }
  if (typeof snippet.simpleText === "string") {
    return snippet.simpleText;
  }
  return "";
};

const parseYoutubeiTranscriptResponse = (payload) => {
  if (!payload) {
    return "";
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const segments = [];
  for (const action of actions) {
    const renderer =
      action?.updateEngagementPanelAction?.content?.transcriptRenderer?.content
        ?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    if (!Array.isArray(renderer)) {
      continue;
    }
    for (const segment of renderer) {
      const text = extractYoutubeiSnippetText(segment?.transcriptSegmentRenderer);
      if (text) {
        segments.push({ text });
      }
    }
  }
  return buildTranscriptText(segments);
};

const fetchInnertubePlayerResponse = async ({ html, videoId, language, consentCookieHeader, cookieJar }) => {
  const it = extractInnertubeConfigFromHtml(html);
  logInnertubeConfigFlags(videoId, it.debug);
  if (!it.ok || !it.config?.apiKey || !it.config?.context) {
    return {
      success: false,
      reason: "innertube_config_missing",
      status: null,
      requestMade: false,
    };
  }

  const requestUrl = `https://www.youtube.com/youtubei/v1/player?key=${it.config.apiKey}`;
  const requestHeaders = buildBrowserHeaders({ videoId, cookieJar });
  requestHeaders.Accept = "application/json,text/plain,*/*";
  requestHeaders["Accept-Language"] = buildAcceptLanguageHeader(language);
  requestHeaders["Content-Type"] = "application/json";
  requestHeaders["Origin"] = YOUTUBE_ORIGIN;
  requestHeaders.Referer = `${YOUTUBE_REFERER_PREFIX}${videoId}`;

  if (consentCookieHeader) {
    const newEntry = consentCookieHeader.trim();
    const existingCookie = requestHeaders.Cookie || "";
    const tokens = existingCookie
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!tokens.includes(newEntry)) {
      requestHeaders.Cookie = [existingCookie, consentCookieHeader].filter(Boolean).join("; ");
    }
  }

  let response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "POST",
      headers: requestHeaders,
      redirect: "follow",
      body: JSON.stringify({
        context: it.config.context,
        videoId,
      }),
    });
  } catch (error) {
    return {
      success: false,
      reason: "fetch_error",
      error,
      status: null,
      requestMade: true,
    };
  }

  const headerSnapshot = captureResponseHeaders(response);
  if (cookieJar) {
    cookieJar.addFromResponseHeaders(response.headers);
  }

  if (!response.ok) {
    return {
      success: false,
      reason: "non-200 status",
      status: response.status,
      headers: headerSnapshot,
      requestMade: true,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      success: false,
      reason: "invalid_json",
      error,
      status: response.status,
      headers: headerSnapshot,
      requestMade: true,
    };
  }

  return {
    success: true,
    status: response.status,
    headers: headerSnapshot,
    payload,
    requestMade: true,
  };
};

const tryYoutubeiGetTranscript = async ({
  html,
  playerResponse,
  videoId,
  language,
  consentCookieHeader,
  cookieJar,
}) => {
  const it = extractInnertubeConfigFromHtml(html);
  logInnertubeConfigFlags(videoId, it.debug);
  if (!it.ok) {
    return {
      success: false,
      reason: "innertube_config_missing",
      status: null,
      jsonErrorCode: null,
      jsonErrorMessage: null,
      requestMade: false,
    };
  }
  const innertube = it.config;
  const transcriptParams = findGetTranscriptEndpointParams(playerResponse);
  if (!transcriptParams) {
    return {
      success: false,
      reason: "transcript_params_missing",
      status: null,
      jsonErrorCode: null,
      jsonErrorMessage: null,
      requestMade: false,
    };
  }
  const requestUrl = `${YOUTUBE_INNERTUBE_TRANSCRIPT_URL}?key=${innertube.apiKey}`;
  const context = innertube.context || playerResponse?.responseContext || {};
  const requestHeaders = buildBrowserHeaders({ videoId, cookieJar });
  requestHeaders.Accept = YOUTUBE_CAPTION_ACCEPT;
  requestHeaders["Accept-Language"] = buildAcceptLanguageHeader(language);
  requestHeaders["Content-Type"] = "application/json";
  requestHeaders["Origin"] = YOUTUBE_ORIGIN;
  requestHeaders.Referer = `${YOUTUBE_REFERER_PREFIX}${videoId}`;
  if (consentCookieHeader) {
    const newEntry = consentCookieHeader.trim();
    const existingCookie = requestHeaders.Cookie || "";
    const tokens = existingCookie
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!tokens.includes(newEntry)) {
      requestHeaders.Cookie = [existingCookie, consentCookieHeader].filter(Boolean).join("; ");
    }
  }
  let response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "POST",
      headers: requestHeaders,
      redirect: "follow",
      body: JSON.stringify({
        context,
        videoId,
        params: transcriptParams,
      }),
    });
  } catch (error) {
    return {
      success: false,
      reason: "fetch_error",
      error,
      status: null,
      jsonErrorCode: null,
      jsonErrorMessage: null,
      requestMade: true,
    };
  }

  const headerSnapshot = captureResponseHeaders(response);
  if (cookieJar) {
    cookieJar.addFromResponseHeaders(response.headers);
  }
  const contentType = headerSnapshot.contentType || "";
  const isHtmlResponse = contentType.toLowerCase().includes("text/html");
  if (!response.ok || isHtmlResponse) {
    return {
      success: false,
      reason: isHtmlResponse ? "unexpected_html" : "non-200 status",
      status: response.status,
      finalUrl: response.url,
      headers: headerSnapshot,
      contentType,
      jsonErrorCode: null,
      jsonErrorMessage: null,
      requestMade: true,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      success: false,
      reason: "invalid_json",
      error,
      finalUrl: response.url,
      headers: headerSnapshot,
      contentType,
      status: response.status,
      jsonErrorCode: null,
      jsonErrorMessage: error?.message || null,
      requestMade: true,
    };
  }

  const jsonError = extractYoutubeiJsonError(payload);
  const jsonErrorCode = jsonError?.code || null;
  const jsonErrorMessage = jsonError?.message || null;
  const text = parseYoutubeiTranscriptResponse(payload);
  if (!text) {
    return {
      success: false,
      reason: "empty_transcript",
      finalUrl: response.url,
      headers: headerSnapshot,
      contentType,
      status: response.status,
      jsonErrorCode,
      jsonErrorMessage,
      requestMade: true,
    };
  }

  return {
    success: true,
    text,
    finalUrl: response.url,
    headers: headerSnapshot,
    contentType,
    status: response.status,
    jsonErrorCode,
    jsonErrorMessage,
    requestMade: true,
  };
};

const logCaptionFetchAttempt = ({
  videoId,
  fmtLabel,
  track,
  targetUrl,
  attempt,
  status,
  headerSnapshot,
  bodySnippet,
  bodyLength,
  message,
  finalUrl,
  requestMethod,
}) => {
  const captionTrackBaseUrlHost = (() => {
    if (!track?.baseUrl) {
      return null;
    }
    try {
      return new URL(track.baseUrl).hostname;
    } catch {
      return null;
    }
  })();
  const captionTrackRequestMatchesBaseUrl = (() => {
    const normalizedTrack = normalizeUrlWithoutFmt(track?.baseUrl);
    const normalizedTarget = normalizeUrlWithoutFmt(targetUrl?.href);
    if (!normalizedTrack || !normalizedTarget) {
      return null;
    }
    return normalizedTrack === normalizedTarget;
  })();
  const logPayload = {
    videoId,
    fmt: fmtLabel || "(none)",
    attempt,
    status,
    requestMethod: requestMethod || "GET",
    requestUrl: targetUrl?.href,
    finalUrl,
    baseUrl: sanitizeBaseUrlForLogging(track?.baseUrl),
    baseDomain: targetUrl?.hostname,
    pathLength: targetUrl?.pathname?.length,
    headers: headerSnapshot,
    responseHeaders: headerSnapshot?.responseHeaders,
    captionTrackBaseUrlHost,
    captionTrackRequestMatchesBaseUrl,
  };
  if (typeof bodyLength === "number") {
    logPayload.bodyLength = bodyLength;
  }
  if (bodySnippet) {
    logPayload.bodySnippet = bodySnippet;
  }
  if (message) {
    logPayload.message = message;
  }
  debugLog("[youtube-transcript] caption fetch", logPayload);
};

const fetchCaptionFormat = async ({ track, videoId, fmt, cookieJar, consentCookieHeader }) => {
  const fmtLabel = fmt || "(none)";
  const baseUrl = isAutoGeneratedTrack(track) ? ensureAsrQueryParams(track.baseUrl) : track.baseUrl;
  const targetUrl = buildCaptionUrlWithFmt(baseUrl, fmt);
  const trackLanguageTag = getTrackLanguageTag(track);
  const headers = buildBrowserHeaders({ videoId, cookieJar });
  headers.Accept = YOUTUBE_CAPTION_ACCEPT;
  headers["Accept-Language"] = buildAcceptLanguageHeader(trackLanguageTag);
  headers.Referer = `${YOUTUBE_REFERER_PREFIX}${videoId}`;
  headers.Origin = YOUTUBE_ORIGIN;
  if (consentCookieHeader) {
    const newEntry = consentCookieHeader.trim();
    const existingCookie = headers.Cookie || "";
    const tokens = existingCookie
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!tokens.includes(newEntry)) {
      headers.Cookie = [existingCookie, consentCookieHeader].filter(Boolean).join("; ");
    }
  }
  const requestOptions = {
    method: "GET",
    headers,
    redirect: "follow",
  };

  let response;
  try {
    response = await fetchWithTimeout(targetUrl.href, requestOptions);
  } catch (error) {
    logCaptionFetchAttempt({
      videoId,
      fmtLabel,
      track,
      targetUrl,
      attempt: 1,
      status: null,
      headerSnapshot: null,
      bodyLength: 0,
      message: "fetch error",
      requestMethod: requestOptions.method,
    });
    return {
      status: "fatal",
      reason: "fetch_error",
      fmt,
      fmtLabel,
      url: targetUrl.href,
      error,
    };
  }

  const headerSnapshot = captureResponseHeaders(response);
  const finalUrl = response.url;
  if (!response.ok) {
    logCaptionFetchAttempt({
      videoId,
      fmtLabel,
      track,
      targetUrl,
      attempt: 1,
      status: response.status,
      headerSnapshot,
      finalUrl,
      message: "non-200 status",
      requestMethod: requestOptions.method,
    });
    return {
      status: "retry",
      reason: "non-200 status",
      fmt,
      fmtLabel,
      url: targetUrl.href,
      finalUrl,
      statusCode: response.status,
      headers: headerSnapshot,
      attempt: 1,
    };
  }

  if (cookieJar) {
    cookieJar.addFromResponseHeaders(response.headers);
  }

  const bodyText = await response.text();
  const bodySnippet = String(bodyText || "").slice(0, 200);
  const bodyLength = bodyText.length;
  const emptyBody = !bodyText.trim();
  const contentType = headerSnapshot.contentType || "";
  const isHtmlResponse = contentType.toLowerCase().includes("text/html");
  const allowedContentType = isTranscriptPayloadContentTypeAllowed(contentType);
  const isBlockedContentType = !allowedContentType;

  logCaptionFetchAttempt({
    videoId,
    fmtLabel,
    track,
    targetUrl,
    attempt: 1,
    status: response.status,
    headerSnapshot,
    bodySnippet,
    bodyLength,
    message: isHtmlResponse
      ? "unexpected html response"
      : isBlockedContentType
      ? "unexpected content-type"
      : emptyBody
      ? "empty body"
      : undefined,
    finalUrl,
    requestMethod: requestOptions.method,
  });

  if (emptyBody || isHtmlResponse || isBlockedContentType) {
    return {
      status: "retry",
      reason: isHtmlResponse || isBlockedContentType ? "unexpected_html" : "empty body",
      fmt,
      fmtLabel,
      url: targetUrl.href,
      finalUrl,
      headers: headerSnapshot,
      statusCode: response.status,
      bodyLength,
      bodySnippet,
      attempt: 1,
    };
  }

  return {
    status: "success",
    fmt,
    fmtLabel,
    body: bodyText,
    url: targetUrl.href,
    finalUrl,
    headers: headerSnapshot,
    bodyLength,
    bodySnippet,
    attempt: 1,
  };
};

const parseCaptionResult = (result, videoId, trackLanguage) => {
  if (!result?.body) {
    return { success: false, reason: "empty body" };
  }

  if (result.fmt === "json3") {
    const parseResult = parseJsonTranscriptPayload(result.body);
    if (!parseResult.success) {
    debugLog(`[youtube-transcript] parse failure json`, {
      videoId,
      trackLanguage,
      fmt: result.fmtLabel,
      reason: `json parse error: ${parseResult.reason}`,
        bodyLength: result.bodyLength,
        bodySnippet: result.bodySnippet,
      });
      return { success: false, reason: parseResult.reason };
    }

    const text = buildTranscriptTextFromPlayerEvents(parseResult.payload?.events);
    if (!text) {
    debugLog(`[youtube-transcript] parse failure json`, {
      videoId,
      trackLanguage,
      fmt: result.fmtLabel,
      reason: "json payload had no segments",
        bodyLength: result.bodyLength,
        bodySnippet: result.bodySnippet,
      });
      return { success: false, reason: "json payload had no segments" };
    }
    return { success: true, text };
  }

  const fallbackText =
    result.fmt === "vtt"
      ? buildTranscriptTextFromVtt(result.body)
      : buildTranscriptTextFromGenericCaptions(result.body);
  const normalizedFallback = String(fallbackText || "").trim();
  const fallbackHasLetters = /[A-Za-z]/.test(normalizedFallback);
  const fallbackReason = !normalizedFallback
    ? "fallback text empty"
    : !fallbackHasLetters
    ? "fallback text lacks letters"
    : null;

  if (fallbackReason) {
    debugLog(`[youtube-transcript] parse failure fallback`, {
      videoId,
      trackLanguage,
      fmt: result.fmtLabel,
      reason: fallbackReason,
      bodyLength: result.bodyLength,
      bodySnippet: result.bodySnippet,
    });
    return { success: false, reason: fallbackReason };
  }

  return { success: true, text: normalizedFallback };
};

const fetchCaptionText = async ({ track, videoId }) => {
  if (!track?.baseUrl) {
    return {
      success: false,
      fatal: false,
      reason: "track_missing_base_url",
      trackLanguage: track?.languageCode || null,
      track,
    };
  }
  let lastAttempt = null;
  for (const fmt of CAPTION_FORMAT_SEQUENCE) {
    const nextResult = await fetchCaptionFormat({ track, videoId, fmt });

    if (nextResult.status === "fatal") {
      return {
        success: false,
        fatal: true,
        reason: "fetch_blocked",
        trackLanguage: track.languageCode,
        lastAttempt: {
          fmt: nextResult.fmtLabel,
          reason: nextResult.reason,
          headers: nextResult.headers,
          statusCode: nextResult.statusCode,
          attempt: nextResult.attempt,
          finalUrl: nextResult.finalUrl,
        },
        fmtLabel: nextResult.fmtLabel,
        error: nextResult.error,
        track,
      };
    }

    if (nextResult.status === "success") {
      const parsed = parseCaptionResult(nextResult, videoId, track.languageCode);
      if (parsed.success) {
        return {
          success: true,
          text: parsed.text,
          track,
          attempt: nextResult,
        };
      }
      lastAttempt = {
        fmt: nextResult.fmtLabel,
        reason: parsed.reason,
        bodyLength: nextResult.bodyLength,
        bodySnippet: nextResult.bodySnippet,
        headers: nextResult.headers,
        finalUrl: nextResult.finalUrl,
        statusCode: nextResult.statusCode,
        attempt: nextResult.attempt,
      };
      continue;
    }

    lastAttempt = {
      fmt: nextResult.fmtLabel,
      reason: nextResult.reason,
      statusCode: nextResult.statusCode,
      attempt: nextResult.attempt,
      bodyLength: nextResult.bodyLength,
      bodySnippet: nextResult.bodySnippet,
      headers: nextResult.headers,
      finalUrl: nextResult.finalUrl,
    };

    if (isBlockedCaptionReason(nextResult.reason)) {
      return {
        success: false,
        fatal: false,
        reason: nextResult.reason,
        trackLanguage: track.languageCode,
        lastAttempt,
        track,
      };
    }
  }

  return {
    success: false,
    fatal: false,
    reason: lastAttempt?.reason || "caption_fetch_empty",
    trackLanguage: track.languageCode,
    lastAttempt,
    track,
  };
};

const buildWatchUrl = (videoId, hl) => {
  const url = new URL(`${YOUTUBE_ORIGIN}/watch`);
  url.searchParams.set("v", videoId);
  if (hl) {
    url.searchParams.set("hl", hl);
  }
  return url.href;
};

const fetchWatchPageData = async ({ videoId, language, hl, userAgent, cookie, cookieJar }) => {
  const watchUrl = buildWatchUrl(videoId, hl);
  const headers = buildBrowserHeaders({ videoId, cookieJar, acceptHtml: true });
  headers["Accept-Language"] = buildAcceptLanguageHeader(language);
  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }
  headers.Origin = YOUTUBE_ORIGIN;
  if (cookie) {
    const newEntry = cookie.trim();
    const existingCookie = headers.Cookie || "";
    const tokens = existingCookie
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!tokens.includes(newEntry)) {
      headers.Cookie = [existingCookie, cookie].filter(Boolean).join("; ");
    }
  }
  const requestOptions = {
    method: "GET",
    headers,
    redirect: "follow",
  };
  let response;
  try {
    response = await fetchWithTimeout(watchUrl, requestOptions);
  } catch (error) {
    throw createTranscriptUnavailableError("fetch_blocked", {
      videoId,
      error: error?.message,
    });
  }
  const status = response.status;
  if (cookieJar) {
    cookieJar.addFromResponseHeaders(response.headers);
  }
  const watchPageHeaders = captureResponseHeaders(response);
  const finalUrl = response.url;
  const html = await response.text();
  const htmlSnippet = String(html || "").slice(0, 200);
  debugLog("[youtube-transcript] watch page fetch", {
    videoId,
    status,
    hl: hl || null,
    userAgent: headers["User-Agent"],
    finalUrl,
    contentType: watchPageHeaders.contentType,
    contentLength: watchPageHeaders.contentLength,
    bodySnippet: htmlSnippet,
    requestMethod: requestOptions.method,
    responseHeaders: watchPageHeaders.responseHeaders,
  });
  if (!response.ok) {
    throw createTranscriptUnavailableError("fetch_blocked", {
      videoId,
      status,
    });
  }
  if (containsConsentPage(html)) {
    throw createTranscriptUnavailableError("consent_required", {
      videoId,
      status,
      watchUrl: finalUrl,
      bodySnippet: htmlSnippet,
    });
  }
  let playerResponse;
  try {
    playerResponse = extractPlayerResponse(html);
  } catch (error) {
    throw createTranscriptUnavailableError("parse failure", {
      videoId,
      error: error?.message,
    });
  }
  if (!playerResponse) {
    throw createTranscriptUnavailableError("parse failure", { videoId });
  }
  return {
    html,
    playerResponse,
    status,
    watchUrl: finalUrl,
    watchPageHeaders,
  };
};

const runYoutubeiWithRetry = async ({
  html,
  playerResponse,
  videoId,
  language,
  consentCookieHeader,
  cookieJar,
  retryWatchPage,
}) => {
  let result = await tryYoutubeiGetTranscript({
    html,
    playerResponse,
    videoId,
    language,
    consentCookieHeader,
    cookieJar,
  });
  if (
    result?.reason === "innertube_config_missing" &&
    typeof retryWatchPage === "function"
  ) {
    debugLog("[youtube-transcript] innertube config missing, retrying watch fetch", {
      videoId,
    });
    const retryData = await retryWatchPage();
    result = await tryYoutubeiGetTranscript({
      html: retryData.html,
      playerResponse: retryData.playerResponse,
      videoId,
      language: "en",
      consentCookieHeader,
      cookieJar,
    });
  }
  return result;
};

const fetchYouTubeTranscript = async (videoId, language) => {
  const enableCaptionRetries = process.env.NODE_ENV !== "test";
  const enableInnertubePlayerDiscovery = process.env.NODE_ENV !== "test";
  const cookieJar = new SimpleCookieJar();
  let consentCookieHeader = await fetchYouTubeConsentCookieHeader(cookieJar);
  const watchData = await fetchWatchPageData({
    videoId,
    language,
    cookie: consentCookieHeader,
    cookieJar,
  });
  const { html, playerResponse, status } = watchData;
  const captions = playerResponse?.captions;
  const tracks =
    captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const captionsExists = Boolean(captions);
  let resolvedTracks = tracks;
  if (enableInnertubePlayerDiscovery && (!Array.isArray(resolvedTracks) || resolvedTracks.length === 0)) {
    const playerResult = await fetchInnertubePlayerResponse({
      html,
      videoId,
      language,
      consentCookieHeader,
      cookieJar,
    });
    const playerTracks =
      playerResult?.success && playerResult.payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks
        ? playerResult.payload.captions.playerCaptionsTracklistRenderer.captionTracks
        : [];
    if (Array.isArray(playerTracks) && playerTracks.length) {
      resolvedTracks = playerTracks;
    }
  }
  const trackCount = Array.isArray(resolvedTracks) ? resolvedTracks.length : 0;
  const orderedTracks = prioritizeCaptionTracks(resolvedTracks);
  const selectedTrack = orderedTracks[0] || null;
  const selectedTrackLanguage = getTrackLanguageTag(selectedTrack);
  const selectedTrackName = getTrackDisplayName(selectedTrack);
  let selectedTrackBaseDomain = null;
  if (selectedTrack?.baseUrl) {
    try {
      selectedTrackBaseDomain = getTopLevelDomain(
        new URL(selectedTrack.baseUrl).hostname
      );
    } catch {
      selectedTrackBaseDomain = null;
    }
  }

  logYouTubeTranscriptStatus({
    videoId,
    status,
    captionsExists,
    trackCount,
    selectedTrackLanguage,
    selectedTrackBaseDomain,
    selectedTrackName,
  });

  const runYoutubei = () =>
    runYoutubeiWithRetry({
      html,
      playerResponse,
      videoId,
      language,
      consentCookieHeader,
      cookieJar,
      retryWatchPage: () =>
        fetchWatchPageData({
          videoId,
          language: "en",
          hl: "en",
          userAgent: YOUTUBE_USER_AGENT,
          cookie: consentCookieHeader,
          cookieJar,
        }),
    });

  if (trackCount === 0) {
    const youtubeiResult = await runYoutubei();
    logCaptionFetchDebug({
      videoId,
      captionsFound: captionsExists,
      selectedTrackLanguage: null,
      selectedTrackName: null,
      finalUrl: youtubeiResult?.finalUrl,
      responseContentType: youtubeiResult?.contentType,
      youtubeiAttempted: Boolean(youtubeiResult?.requestMade),
      youtubeiStatus: youtubeiResult?.status,
      youtubeiContentType: youtubeiResult?.contentType,
      youtubeiJsonErrorCode: youtubeiResult?.jsonErrorCode,
      youtubeiJsonErrorMessage: youtubeiResult?.jsonErrorMessage,
    });
    if (youtubeiResult?.success) {
      return youtubeiResult.text;
    }
    const normalizedReason = youtubeiResult?.reason === "transcript_params_missing" ? "fetch_blocked" : youtubeiResult?.reason;
    throw createTranscriptUnavailableError("youtubei_transcript_failure", {
      videoId,
      status,
      reason: normalizedReason,
      httpStatus: youtubeiResult?.status,
      responseHeaders: youtubeiResult?.headers,
      jsonErrorCode: youtubeiResult?.jsonErrorCode,
      jsonErrorMessage: youtubeiResult?.jsonErrorMessage,
    });
  }

  if (!selectedTrack) {
    logCaptionFetchDebug({
      videoId,
      captionsFound: captionsExists,
      selectedTrackLanguage: null,
      selectedTrackName: null,
      finalUrl: null,
      responseContentType: null,
      youtubeiAttempted: false,
    });
    throw createTranscriptUnavailableError("no track selected", {
      videoId,
      status,
    });
  }

  const trackResult = await fetchCaptionText({
    track: selectedTrack,
    videoId,
  });

  const retryWatch = () =>
    (async () => {
      const refreshedConsent = await fetchYouTubeConsentCookieHeader(cookieJar);
      if (refreshedConsent) {
        consentCookieHeader = refreshedConsent;
      }
      return fetchWatchPageData({
        videoId,
        language: "en",
        hl: "en",
        userAgent: YOUTUBE_USER_AGENT,
        cookie: consentCookieHeader,
        cookieJar,
      });
    })();

  const hardenedTrackResult = !enableCaptionRetries || trackResult.success
    ? trackResult
    : await fetchCaptionTextWithRetry({
        track: selectedTrack,
        videoId,
        cookieJar,
        consentCookieHeader,
        retryWatch,
      });

  if (hardenedTrackResult.success) {
    logCaptionFetchDebug({
      videoId,
      captionsFound: captionsExists,
      selectedTrackLanguage,
      selectedTrackName,
      finalUrl: hardenedTrackResult.attempt?.finalUrl || hardenedTrackResult.attempt?.url,
      responseContentType: hardenedTrackResult.attempt?.headers?.contentType,
      youtubeiAttempted: false,
    });
    return hardenedTrackResult.text;
  }

  const lastAttempt = hardenedTrackResult.lastAttempt || hardenedTrackResult.attempt;
  logCaptionFetchDebug({
    videoId,
    captionsFound: captionsExists,
    selectedTrackLanguage,
    selectedTrackName,
    finalUrl: lastAttempt?.finalUrl || selectedTrack?.baseUrl || null,
    responseContentType: lastAttempt?.headers?.contentType,
    youtubeiAttempted: false,
  });

  const blockedReason =
    (lastAttempt && isBlockedCaptionReason(lastAttempt.reason) && lastAttempt.reason) ||
    (hardenedTrackResult.fatal && hardenedTrackResult.reason === "fetch_blocked" && "fetch_blocked") ||
    null;

  if (blockedReason) {
    const youtubeiResult = await runYoutubei();
    if (youtubeiResult?.reason === "transcript_params_missing") {
      const redactedTracks = Array.isArray(resolvedTracks)
        ? resolvedTracks.slice(0, 3).map((track) => ({
            languageCode: track?.languageCode || null,
            kind: track?.kind || track?.trackKind || null,
            vssId: track?.vssId || null,
            name: track?.name?.simpleText || null,
            hasBaseUrl: Boolean(track?.baseUrl),
            baseUrlHost: (() => {
              try {
                return track?.baseUrl ? new URL(track.baseUrl).hostname : null;
              } catch {
                return null;
              }
            })(),
            baseUrlHasSignature: typeof track?.baseUrl === "string" && /[?&](sig|signature|sparams|lsig)=/i.test(track.baseUrl),
          }))
        : null;
      debugLog("[youtube-transcript] transcript params missing", {
        videoId,
        captionTrackCount: Array.isArray(resolvedTracks) ? resolvedTracks.length : null,
        captionTracks: redactedTracks,
      });
    }
    logCaptionFetchDebug({
      videoId,
      captionsFound: captionsExists,
      selectedTrackLanguage,
      selectedTrackName,
      finalUrl: youtubeiResult?.finalUrl,
      responseContentType: youtubeiResult?.contentType,
      youtubeiAttempted: Boolean(youtubeiResult?.requestMade),
      youtubeiStatus: youtubeiResult?.status,
      youtubeiContentType: youtubeiResult?.contentType,
      youtubeiJsonErrorCode: youtubeiResult?.jsonErrorCode,
      youtubeiJsonErrorMessage: youtubeiResult?.jsonErrorMessage,
    });
    if (youtubeiResult?.success) {
      return youtubeiResult.text;
    }
    throw createYouTubeTranscriptBlockedError(blockedReason, {
      videoId,
      status,
      trackLanguage: selectedTrack?.languageCode || null,
      lastAttempt,
      fallbackReason: youtubeiResult?.reason,
      httpStatus: youtubeiResult?.status,
      responseHeaders: youtubeiResult?.headers,
      jsonErrorCode: youtubeiResult?.jsonErrorCode,
      jsonErrorMessage: youtubeiResult?.jsonErrorMessage,
    });
  }

  const failureReason = trackResult.reason || "caption_fetch_empty";
  if (failureReason === "caption_fetch_empty") {
    const captionUrlDetails = (() => {
      try {
        const parsedUrl = new URL(selectedTrack?.baseUrl || "");
        return { hostname: parsedUrl.hostname, pathname: parsedUrl.pathname };
      } catch {
        return {};
      }
    })();
    debugLog(`[youtube-transcript] caption_fetch_empty debug`, {
      videoId,
      trackLanguage: selectedTrack?.languageCode || null,
      captionDomain: captionUrlDetails.hostname || null,
      captionPath: captionUrlDetails.pathname || null,
      responseStatus: lastAttempt?.statusCode ?? null,
      responseHeaders: lastAttempt?.headers,
      bodyLength: lastAttempt?.bodyLength ?? null,
    });
  }

  throw createTranscriptUnavailableError(failureReason, {
    videoId,
    trackLanguage: selectedTrack?.languageCode || null,
    lastAttempt,
  });
};

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter(req, file, cb) {
    const isTxt = (file.originalname || "").toLowerCase().endsWith(".txt");
    if (ALLOWED_MIMES.has(file.mimetype) || isTxt) {
      return cb(null, true);
    }
    cb(new AppError("Unsupported file type. Upload PDF, DOCX, or TXT.", 400, "VALIDATION_ERROR"));
  },
});

const persistDocument = ({ id, title, sourceType, sourceRef, text }) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents (id, title, sourceType, sourceRef, text, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, title, sourceType, sourceRef, text, now);
};

const sanitizeText = (value) => (String(value || "").trim() || "");

const parseFileBuffer = async (file) => {
  const buffer = file.buffer;
  const mime = file.mimetype;

  if (mime === "application/pdf") {
    const pdf = await pdfParse(buffer);
    const cleaned = sanitizeText(pdf.text);
    if (cleaned.length < 20) {
      throw new AppError("PDF appears to be scanned. Use OCR instead.", 422, "OCR_REQUIRED");
    }
    return cleaned;
  }

  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer });
    return sanitizeText(value);
  }

  if (mime === "text/plain" || (file.originalname || "").toLowerCase().endsWith(".txt")) {
    return sanitizeText(buffer.toString("utf8"));
  }

  throw new AppError("Unsupported file type. Upload PDF, DOCX, or TXT.", 400, "VALIDATION_ERROR");
};

const buildDocumentResponse = ({ id, text, source, filename, mime, url }) => {
  const payload = {
    documentId: id,
    text,
    source,
  };
  if (filename) payload.filename = filename;
  if (mime) payload.mime = mime;
  if (url) payload.url = url;
  return payload;
};

router.post("/text", async (req, res, next) => {
  try {
    const { text, source, videoId, url, title } = req.body || {};
    const cleaned = sanitizeText(text);
    if (!cleaned) {
      throw new AppError("Text is required.", 400, "VALIDATION_ERROR");
    }

    const normalizedSource = source ? String(source).toLowerCase().trim() : "text";
    const safeTitle =
      (title && String(title).trim()) ||
      (normalizedSource === "youtube" && videoId ? `YouTube transcript ${videoId}` : "Pasted text");

    const processedText =
      cleaned.length > MAX_TRANSCRIPT_LENGTH ? cleaned.slice(0, MAX_TRANSCRIPT_LENGTH) : cleaned;

    const id = randomUUID();
    persistDocument({
      id,
      title: safeTitle,
      sourceType: normalizedSource,
      sourceRef: url || videoId || "manual",
      text: processedText,
    });

    res.json(
      buildDocumentResponse({
        id,
        text: processedText,
        source: normalizedSource,
        url: url || null,
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError("Upload file is required.", 400, "VALIDATION_ERROR");
    }

    const text = await parseFileBuffer(file);
    const id = randomUUID();
    persistDocument({
      id,
      title: file.originalname,
      sourceType: "upload",
      sourceRef: file.originalname,
      text,
    });

    res.json(
      buildDocumentResponse({
        id,
        text,
        source: "upload",
        filename: file.originalname,
        mime: file.mimetype,
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/url", async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      throw new AppError("URL is required.", 400, "VALIDATION_ERROR");
    }

    const parsed = await ensureSafeUrl(url);
    const response = await fetchWithTimeout(parsed.href, {
      headers: {
        "User-Agent": "StudySummarize/1.0",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      throw new AppError("Unable to fetch URL content.", 502, "FETCH_ERROR");
    }

    const html = await response.text();
    const cleaned = html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, URL_TEXT_LIMIT);

    const text = cleaned || "No readable text was found at the provided URL.";
    const id = randomUUID();
    persistDocument({
      id,
      title: parsed.hostname,
      sourceType: "url",
      sourceRef: parsed.href,
      text,
    });

    res.json(
      buildDocumentResponse({
        id,
        text,
        source: "url",
        url: parsed.href,
        filename: parsed.hostname,
      })
    );
  } catch (error) {
    next(error);
  }
});

const enqueuedNotImplemented = (message) => new AppError(message, 501, "NOT_IMPLEMENTED");

const TRANSCRIPT_UNAVAILABLE_ERROR = () =>
  new AppError(
    "No transcript found for this video. Please paste the transcript text or try another video.",
    422,
    "TRANSCRIPT_UNAVAILABLE"
  );

router.post("/youtube", async (req, res, next) => {
  try {
    const { url, language } = req.body || {};
    if (!url) {
      throw new AppError("URL is required.", 400, "VALIDATION_ERROR");
    }

    const parsed = await ensureSafeUrl(url);
    if (!isYouTubeDomain(parsed.hostname)) {
      throw new AppError("Only YouTube URLs are allowed.", 400, "INVALID_URL");
    }

    const videoId = parseYouTubeVideoId(parsed);
    if (!videoId) {
      throw new AppError("Unable to parse YouTube video ID.", 400, "INVALID_URL");
    }

    let text;
    try {
      text = await fetchYouTubeTranscript(videoId, language);
    } catch (error) {
      if (error instanceof AppError) {
        const nonFatalBlocked =
          process.env.NODE_ENV !== "test" &&
          ["YOUTUBE_TRANSCRIPT_BLOCKED", "TRANSCRIPT_UNAVAILABLE"].includes(error.code);

        const blockedReason = error.details?.reason || error.code;
        const nonFatalNetworkBlocked =
          process.env.NODE_ENV !== "test" &&
          blockedReason &&
          ["fetch_blocked", "unexpected_html", "consent_required"].includes(String(blockedReason));

        if (nonFatalBlocked || nonFatalNetworkBlocked) {
          return res.json({
            source: "youtube",
            url: parsed.href,
            videoId,
            text: null,
            action: "PASTE_TRANSCRIPT",
            watchUrl: `${YOUTUBE_REFERER_PREFIX}${videoId}`,
            message:
              "YouTube blocked automatic transcript fetching. Please copy the transcript in your browser and paste it here.",
            reason: blockedReason,
            experimental: true,
          });
        }

        throw error;
      }
      throw new AppError(
        "Unable to fetch the YouTube transcript.",
        502,
        "TRANSCRIPT_FETCH_FAILED",
        error?.message
      );
    }

    if (!text) {
      throw TRANSCRIPT_UNAVAILABLE_ERROR();
    }

    const processedText =
      text.length > MAX_TRANSCRIPT_LENGTH ? text.slice(0, MAX_TRANSCRIPT_LENGTH) : text;

    const id = randomUUID();
    persistDocument({
      id,
      title: `YouTube transcript ${videoId}`,
      sourceType: "youtube",
      sourceRef: parsed.href,
      text: processedText,
    });

    res.json(
      buildDocumentResponse({
        id,
        text: processedText,
        source: "youtube",
        url: parsed.href,
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/ocr", (req, res, next) => {
  next(enqueuedNotImplemented("OCR is not available yet. Please paste text or enable an OCR provider."));
});

router.post("/audio", (req, res, next) => {
  next(
    enqueuedNotImplemented(
      "Audio transcription is not available yet. Please paste text or connect an ASR provider."
    )
  );
});

module.exports = router;
