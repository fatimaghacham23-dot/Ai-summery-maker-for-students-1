const CONFIG_META_KEYS = {
  apiBaseUrl: "api-base-url",
  nodeEnv: "node-env",
  enableDebugRoutes: "enable-debug-routes",
};

const DEFAULT_TIMEOUT = 20000;

const normalizeUrl = (url = "") => String(url).replace(/\/$/, "");

const isLocalhost = (hostname) => hostname === "localhost" || hostname === "127.0.0.1";

const getMetaContent = (name) => {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta ? meta.getAttribute("content") : "";
};

const getAppConfig = () => window.APP_CONFIG || window.__APP_CONFIG__ || {};

const getApiBaseUrl = () => {
  const config = getAppConfig();
  const baseUrl =
    config.BASE_API_URL ||
    config.baseApiUrl ||
    getMetaContent(CONFIG_META_KEYS.apiBaseUrl) ||
    "";

  if (baseUrl) {
    return normalizeUrl(baseUrl);
  }

  if (isLocalhost(window.location.hostname)) {
    if (window.location.port && window.location.port !== "3000") {
      return "http://localhost:3000";
    }
  }

  return normalizeUrl(window.location.origin);
};

const buildApiUrl = (path) => {
  if (!path) {
    return getApiBaseUrl();
  }
  if (path.startsWith("http")) {
    return path;
  }
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${trimmed}`;
};

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.data = data || null;
  }
}

const requestJson = async (path, options = {}) => {
  const url = buildApiUrl(path);
  const { signal: userSignal, headers: customHeaders, ...restOptions } = options || {};
  const controller = new AbortController();
  const signal = controller.signal;

  const handleUserAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort();
    } else {
      userSignal.addEventListener("abort", handleUserAbort);
    }
  }

  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(url, {
      credentials: "include",
      signal,
      ...restOptions,
      headers: {
        "Content-Type": "application/json",
        ...(customHeaders || {}),
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        data?.error?.message || data?.reason || response.statusText || "Request failed";
      throw new ApiError(message, response.status, data);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ApiError("Request timed out", 408);
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(error.message || "Network error");
  } finally {
    clearTimeout(timeout);
    if (userSignal) {
      userSignal.removeEventListener("abort", handleUserAbort);
    }
  }
};

export { getApiBaseUrl, buildApiUrl, requestJson, ApiError };
