import axios from "axios";

// A production bundle must be built with the real API URL. Leaving this unset
// used to call the staff member's own localhost.
const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:5000/api" : "");
if (!API_BASE) {
  throw new Error("VITE_API_BASE was not set when this frontend was built.");
}
if (import.meta.env.PROD && typeof window !== "undefined") {
  const apiHost = new URL(API_BASE, window.location.origin).hostname;
  const pageHost = window.location.hostname;
  const isLocal = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal(apiHost) && !isLocal(pageHost)) {
    throw new Error("This frontend was built with a local API URL. Rebuild it with the production VITE_API_BASE.");
  }
}

const client = axios.create({ baseURL: API_BASE });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = String(err.config?.url || "");
    if (!url.includes("/assistant/ask") && err.response?.status && err.response.status !== 401) {
      const message = err.response?.data?.message || "Request failed";
      try {
        sessionStorage.setItem(
          "ems.lastError",
          JSON.stringify({
            at: Date.now(),
            status: err.response.status,
            path: url.split("?")[0].slice(0, 80),
            message: String(message).slice(0, 240),
          })
        );
      } catch {
        /* storage unavailable */
      }
    }
    if (err.response?.data?.code === "CONSENT_REQUIRED") {
      window.location.href = "/consent";
    } else if (err.response?.status === 401 && window.location.pathname !== "/login") {
      // Token expired or revoked - clear it so the next load goes to login
      // instead of bouncing an invalid token around forever.
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;
