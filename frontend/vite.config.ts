import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function publicApiUrl(value: string) {
  try {
    const host = new URL(value).hostname;
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return "";
    return value;
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  if (mode === "production") {
    const base = publicApiUrl(process.env.VITE_API_BASE || fileEnv.VITE_API_BASE || "");
    if (!base) {
      throw new Error(
        "Production build requires VITE_API_BASE to be the public API URL. A local address is only for the dev server."
      );
    }
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
  };
});
