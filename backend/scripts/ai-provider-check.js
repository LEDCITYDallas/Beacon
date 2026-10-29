// Provider selection and failure handling. No live vendor call.
// The fake key below is a fixture. It must never appear in a URL or an error detail.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ENV_KEYS = [
  "NODE_ENV",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
  "AI_FALLBACK_TO_MOCK",
  "AI_TIMEOUT_MS",
  "AI_MAX_RETRIES",
  "AI_MAX_OUTPUT_TOKENS",
];

const FAKE_KEY = "unit-test-key-not-real";

function load(overrides) {
  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = overrides[key];
    }
  }
  delete require.cache[require.resolve("../config/env")];
  delete require.cache[require.resolve("../services/ai/provider")];
  return require("../services/ai/provider");
}

async function main() {
  let failed = 0;
  function check(name, ok, detail) {
    if (ok) console.log(`  PASS  ${name}`);
    else {
      failed += 1;
      console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
    }
  }

  const originalFetch = global.fetch;
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];

  try {
    let provider = load({
      NODE_ENV: "test",
      AI_PROVIDER: "mock",
      AI_API_KEY: "",
      AI_MODEL: "",
      AI_BASE_URL: "",
      AI_FALLBACK_TO_MOCK: "true",
      AI_MAX_RETRIES: "0",
      AI_TIMEOUT_MS: "5000",
      AI_MAX_OUTPUT_TOKENS: "200",
    });
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error("network");
    };
    const mock = await provider.generate({
      kind: "qa",
      prompt: "Question: what next?\n- Task A [READY, LOW]",
    });
    check(
      "mock provider does not call the network",
      !called && mock.provider === "mock" && mock.text.startsWith("[MOCK]") && mock.fallback === false
    );

    provider = load({
      AI_PROVIDER: "gemini",
      AI_API_KEY: "",
      AI_MODEL: "gemini-3.8-flash",
      AI_FALLBACK_TO_MOCK: "true",
    });
    let missing = null;
    try {
      await provider.generate({ kind: "qa", prompt: "Question: hello" });
    } catch (err) {
      missing = err;
    }
    check(
      "missing key is an error, not a mock answer",
      missing && missing.code === "AI_NOT_CONFIGURED" && missing.status === 503,
      missing && missing.code
    );

    provider = load({ AI_PROVIDER: "vendor-x", AI_API_KEY: FAKE_KEY, AI_FALLBACK_TO_MOCK: "true" });
    let unknown = null;
    try {
      await provider.generate({ prompt: "Question: hi" });
    } catch (err) {
      unknown = err;
    }
    check("unknown provider is rejected", unknown && unknown.code === "AI_NOT_CONFIGURED");

    provider = load({
      AI_PROVIDER: "gemini",
      AI_API_KEY: FAKE_KEY,
      AI_MODEL: "gemini-3.8-flash",
      AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      AI_FALLBACK_TO_MOCK: "true",
      AI_MAX_RETRIES: "0",
    });
    let seenUrl = "";
    let headerOnly = false;
    global.fetch = async (url, options) => {
      seenUrl = String(url);
      headerOnly = options.headers["x-goog-api-key"] === FAKE_KEY;
      return new Response(
        JSON.stringify({ error: { message: `API key not valid ${FAKE_KEY}` } }),
        { status: 401 }
      );
    };
    let authErr = null;
    try {
      await provider.generate({
        kind: "qa",
        prompt: "Question: hello\n- Secret task [READY, LOW]",
      });
    } catch (err) {
      authErr = err;
    }
    check(
      "rejected key is an error, not a mock answer",
      authErr && authErr.code === "AI_AUTH_FAILED",
      authErr && authErr.code
    );
    check(
      "gemini key stays in the header, not the URL",
      headerOnly && !seenUrl.includes(FAKE_KEY)
    );
    check(
      "provider error detail does not keep the key",
      authErr && !String(authErr.detail || "").includes(FAKE_KEY)
    );

    global.fetch = async () => new Response("unavailable", { status: 503 });
    const fallback = await provider.generate({
      kind: "qa",
      prompt: "Question: what next?\n- Only mine [READY, LOW]",
    });
    check(
      "outage fallback is labelled mock",
      fallback.fallback === true &&
        fallback.provider === "mock" &&
        fallback.text.includes("[MOCK FALLBACK]") &&
        !fallback.text.includes(FAKE_KEY)
    );

    global.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "hidden reasoning" },
                  { text: `Live answer ${"x".repeat(9000)}` },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            thoughtsTokenCount: 1,
            totalTokenCount: 7,
          },
        }),
        { status: 200 }
      );
    const live = await provider.generate({ kind: "qa", prompt: "Question: hello" });
    check(
      "gemini success is not labelled mock",
      live.provider === "gemini" &&
        live.fallback === false &&
        live.text.startsWith("Live answer") &&
        !live.text.includes("hidden reasoning")
    );
    check("model output is length limited", live.text.length <= 8000);

    provider = load({
      AI_PROVIDER: "openai",
      AI_API_KEY: FAKE_KEY,
      AI_MODEL: "gpt-5-mini",
      AI_BASE_URL: "https://api.openai.com/v1",
      AI_FALLBACK_TO_MOCK: "false",
      AI_MAX_RETRIES: "0",
    });
    let openaiUrl = "";
    global.fetch = async (url, options) => {
      openaiUrl = String(url);
      const auth = options.headers.Authorization || "";
      if (!auth.startsWith("Bearer ") || openaiUrl.includes(FAKE_KEY)) {
        return new Response("{}", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          model: "gpt-5-mini",
          choices: [{ message: { content: "OpenAI answer" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      );
    };
    const openai = await provider.generate({ kind: "qa", prompt: "Question: hello" });
    check(
      "openai success uses the bearer header",
      openai.provider === "openai" &&
        openai.text === "OpenAI answer" &&
        !openaiUrl.includes(FAKE_KEY)
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    delete require.cache[require.resolve("../config/env")];
    delete require.cache[require.resolve("../services/ai/provider")];
  }

  const savedProd = {
    NODE_ENV: process.env.NODE_ENV,
    MONGO_URI: process.env.MONGO_URI,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    ALLOW_MOCK_AI: process.env.ALLOW_MOCK_AI,
  };
  try {
    const env = require("../config/env");
    const { redactSecrets } = require("../utils/redact");
    process.env.NODE_ENV = "production";
    delete process.env.MONGO_URI;
    delete process.env.FRONTEND_ORIGIN;
    delete process.env.AI_PROVIDER;
    delete process.env.ALLOW_MOCK_AI;
    delete process.env.AI_API_KEY;
    const blocked = env.productionProblems().join(" ");
    check(
      "production refuses a missing database, origin, and AI provider",
      blocked.includes("MONGO_URI") && blocked.includes("FRONTEND_ORIGIN") && blocked.includes("AI_PROVIDER")
    );
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/example";
    process.env.FRONTEND_ORIGIN = "https://workforce.example";
    process.env.AI_PROVIDER = "gemini";
    const openDatabase = env.productionProblems().join(" ");
    check(
      "production refuses a database URI without a user or TLS",
      openDatabase.includes("no username") &&
        openDatabase.includes("no password") &&
        openDatabase.includes("TLS")
    );
    process.env.MONGO_URI = "mongodb://workforce_app:unit-test-not-real@127.0.0.1:27017/example";
    const noTls = env.productionProblems().join(" ");
    check(
      "production refuses a database URI without TLS",
      noTls.includes("TLS") && !noTls.includes("unit-test-not-real")
    );
    process.env.MONGO_URI =
      "mongodb://workforce_app:unit-test-not-real@127.0.0.1:27017/example?authSource=example&tls=true";
    const missingKey = env.productionProblems().join(" ");
    check(
      "production refuses a live provider without a key",
      missingKey.includes("AI_API_KEY") && !missingKey.includes("unit-test-not-real")
    );
    process.env.AI_API_KEY = FAKE_KEY;
    const ready = env.productionProblems();
    check(
      "production accepts an explicit provider without echoing the key",
      ready.length === 0 && !ready.join(" ").includes(FAKE_KEY) && !ready.join(" ").includes("unit-test-not-real")
    );
    process.env.AI_PROVIDER = "mock";
    delete process.env.ALLOW_MOCK_AI;
    check("production refuses implicit mock AI", env.productionProblems().some((p) => p.includes("mock")));
    process.env.ALLOW_MOCK_AI = "true";
    check("production allows an explicit mock opt-in", env.productionProblems().length === 0);
    process.env.NODE_ENV = "development";
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/led-city-workforce-dev";
    check("development does not apply the production startup gates", env.productionProblems().length === 0);
    const exampleText = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    const exampleKeys = new Set(
      exampleText
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z0-9_]+)=/))
        .filter(Boolean)
        .map((match) => match[1])
    );
    const envSource = fs.readFileSync(path.join(__dirname, "..", "config", "env.js"), "utf8");
    const readNames = new Set();
    for (const match of envSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)) readNames.add(match[1]);
    for (const match of envSource.matchAll(/(?:bool|int|float|list)FromEnv\(\s*"([A-Z0-9_]+)"/g)) {
      readNames.add(match[1]);
    }
    const missingExample = [...readNames].filter((name) => !exampleKeys.has(name));
    check(
      "env example documents every variable env.js reads",
      missingExample.length === 0,
      missingExample.join(", ")
    );
    const leaked = "mongodb://user:s3cret@db.example:27017/led Bearer abc.def";
    const cleaned = redactSecrets(leaked);
    check(
      "logs do not keep database credentials",
      !cleaned.includes("s3cret") && !cleaned.includes("abc.def") && cleaned.includes("[redacted]")
    );
    const memory = spawnSync(process.execPath, ["scripts/dev-memory.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 15000,
    });
    check(
      "production refuses in-memory storage",
      memory.status === 1 && String(memory.stderr || "").includes("in-memory")
    );
  } finally {
    for (const [key, value] of Object.entries(savedProd)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  if (failed) {
    console.log(`\n${failed} provider checks failed`);
    process.exit(1);
  }
  console.log("\nprovider checks passed");
}

main().catch((err) => {
  const line = err && err.message ? err.message.split("\n")[0] : "provider check crashed";
  console.error(line);
  process.exit(1);
});
