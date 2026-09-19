import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

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
