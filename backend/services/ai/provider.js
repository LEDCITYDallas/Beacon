const config = require("../../config/env");

// ---------------------------------------------------------------------
// Provider-agnostic AI adapter (Section 5 / Priority 1).
//
// The assistant NEVER talks to a vendor SDK directly - it calls this adapter,
// so the provider is a configuration value (AI_PROVIDER) and not a rewrite.
//
// Providers:
//   "mock"       deterministic, context-aware, no network, no key. Default for
//                development (Section 10.2 mock-data rule) and the labelled
//                fallback when a real provider fails in development.
//   "openai"     /chat/completions   (GPT-4o-mini class)
//   "gemini"     :generateContent    (Gemini Flash class)
//   "anthropic"  /v1/messages        (Claude Haiku class)
//
// Security + cost rules enforced here:
//   - the API key is only ever read from process.env (never hard-coded, never
//     logged, never returned to a client)
//   - every call has a hard timeout and a bounded retry, so a hung provider
//     cannot hold an employee's request open forever
//   - failures are normalised into AiError codes the API maps to a safe
//     response; in production a failure surfaces instead of silently posing
//     as a real answer
// ---------------------------------------------------------------------

const PROVIDERS = ["mock", "openai", "gemini", "anthropic"];

class AiError extends Error {
  constructor(code, message, { status = 502, retryable = false, detail = "" } = {}) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

function getProviderName() {
  const p = String(config.ai.provider || "mock").toLowerCase();
  return PROVIDERS.includes(p) ? p : "mock";
}

// A provider is "configured" when LED City has supplied the key Omair controls.
function isConfigured(provider = getProviderName()) {
  if (provider === "mock") return true;
  return Boolean(config.ai.apiKey && config.ai.apiKey.trim());
}

function estimateCostUsd(promptTokens, completionTokens, rates = config.ai.costPerMillion) {
  return Number(
    (
      (promptTokens / 1_000_000) * (rates.input || 0) +
      (completionTokens / 1_000_000) * (rates.output || 0)
    ).toFixed(6)
  );
}

function describeProvider() {
  const provider = getProviderName();
  return {
    provider,
    model: config.ai.model,
    configured: isConfigured(provider),
    live: provider !== "mock" && isConfigured(provider),
    fallbackToMock: config.ai.fallbackToMock,
    timeoutMs: config.ai.timeoutMs,
    monthlyBudgetUsd: config.ai.monthlyBudgetUsd,
    dailyCallLimitPerUser: config.ai.dailyCallLimitPerUser,
    costPerMillion: config.ai.costPerMillion,
  };
}

// The single entry point the assistant uses.
//   kind      - "qa" | "draft" | "handoff" | "summary" | "next_up"
//   system    - system instructions for this call
//   prompt    - fully composed user prompt (context is attached by the
//               assistant service; the model never queries the DB itself)
// Returns { text, provider, model, usage, latencyMs, fallback }
async function generate({ kind = "qa", system, prompt, maxTokens, temperature } = {}) {
  const provider = getProviderName();
  const startedAt = Date.now();

  if (provider === "mock") {
    return mockResult(kind, { system, prompt }, startedAt, { fallback: false });
  }

  if (!isConfigured(provider)) {
    if (config.ai.fallbackToMock) {
      return mockResult(kind, { system, prompt }, startedAt, {
        fallback: true,
        errorCode: "AI_NOT_CONFIGURED",
      });
    }
    throw new AiError(
      "AI_NOT_CONFIGURED",
      "The AI provider key is not configured on the server. Ask an administrator to set AI_API_KEY.",
      { status: 503 }
    );
  }

  const opts = {
    maxTokens: maxTokens || config.ai.maxOutputTokens,
    temperature: temperature === undefined ? config.ai.temperature : temperature,
  };

  let lastError = null;
  const attempts = Math.max(0, config.ai.maxRetries) + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw =
        provider === "openai"
          ? await callOpenai(system, prompt, opts)
          : provider === "gemini"
            ? await callGemini(system, prompt, opts)
            : await callAnthropic(system, prompt, opts);

      if (!raw.text || !raw.text.trim()) {
        throw new AiError("AI_INVALID_RESPONSE", "The AI provider returned an empty response.", {
          status: 502,
          retryable: true,
        });
      }

      const promptTokens = raw.promptTokens || 0;
      const completionTokens = raw.completionTokens || 0;

      return {
        text: raw.text.trim(),
        provider,
        model: raw.model || config.ai.model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: raw.totalTokens || promptTokens + completionTokens,
          estCostUsd: estimateCostUsd(promptTokens, completionTokens),
        },
        latencyMs: Date.now() - startedAt,
        fallback: false,
      };
    } catch (err) {
      lastError = normaliseError(err);
      if (!lastError.retryable || attempt === attempts) break;
      // Small bounded backoff: a transient 429/5xx should not burn the whole
      // timeout budget and should not hammer the provider either.
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  if (config.ai.fallbackToMock) {
    console.warn(`[ai] ${provider} call failed (${lastError.code}); using labelled mock fallback`);
    return mockResult(kind, { system, prompt }, startedAt, {
      fallback: true,
      errorCode: lastError.code,
    });
  }
  throw lastError;
}

function normaliseError(err) {
  if (err instanceof AiError) return err;
  if (err && (err.name === "AbortError" || err.code === "AI_TIMEOUT")) {
    return new AiError("AI_TIMEOUT", "The AI provider did not respond in time.", {
      status: 504,
      retryable: true,
    });
  }
  return new AiError("AI_PROVIDER_ERROR", "The AI provider request failed.", {
    status: 502,
    retryable: true,
    detail: err ? err.message : "",
  });
}

// Hard per-call timeout. Without this a provider incident would leave employee
// requests hanging until the reverse proxy gives up.
async function fetchWithTimeout(url, options, timeoutMs = config.ai.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === "AI_TIMEOUT")) {
      throw new AiError("AI_TIMEOUT", "The AI provider did not respond in time.", {
        status: 504,
        retryable: true,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res, providerLabel) {
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body - handled below */
  }

  if (!res.ok) {
    const apiMessage =
      json && (json.error?.message || json.message)
        ? String(json.error?.message || json.message)
        : "";
    if (res.status === 401 || res.status === 403) {
      throw new AiError("AI_AUTH_FAILED", "The AI provider rejected the configured key.", {
        status: 502,
        detail: apiMessage,
      });
    }
    if (res.status === 429) {
      throw new AiError("AI_RATE_LIMITED", "The AI provider is rate limiting requests.", {
        status: 503,
        retryable: true,
        detail: apiMessage,
      });
    }
    if (res.status >= 500) {
      throw new AiError("AI_PROVIDER_ERROR", "The AI provider is unavailable.", {
        status: 502,
        retryable: true,
        detail: apiMessage,
      });
    }
    throw new AiError("AI_REQUEST_REJECTED", `${providerLabel} rejected the request.`, {
      status: 502,
      detail: apiMessage || `HTTP ${res.status}`,
    });
  }
  if (!json) {
    throw new AiError("AI_INVALID_RESPONSE", "The AI provider returned a non-JSON response.", {
      status: 502,
      retryable: true,
    });
  }
  return json;
}

// --- Vendor calls ------------------------------------------------------

async function callOpenai(system, prompt, { maxTokens, temperature }) {
  const base = (config.ai.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const json = await readJson(
    await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: "system", content: system || "" },
          { role: "user", content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    }),
    "OpenAI"
  );

  const choice = json.choices && json.choices[0];
  return {
    text: choice?.message?.content || "",
    model: json.model,
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
    totalTokens: json.usage?.total_tokens,
  };
}

async function callGemini(system, prompt, { maxTokens, temperature }) {
  const base = (
    config.ai.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
  const json = await readJson(
    await fetchWithTimeout(`${base}/models/${config.ai.model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.ai.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }),
    "Gemini"
  );

  const candidate = json.candidates && json.candidates[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");
  return {
    text,
    model: config.ai.model,
    promptTokens: json.usageMetadata?.promptTokenCount,
    completionTokens: json.usageMetadata?.candidatesTokenCount,
    totalTokens: json.usageMetadata?.totalTokenCount,
  };
}

async function callAnthropic(system, prompt, { maxTokens, temperature }) {
  const base = (config.ai.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const json = await readJson(
    await fetchWithTimeout(`${base}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.ai.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    "Anthropic"
  );

  const text = (json.content || [])
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  return {
    text,
    model: json.model,
    promptTokens: json.usage?.input_tokens,
    completionTokens: json.usage?.output_tokens,
    totalTokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
  };
}

// --- Mock provider -----------------------------------------------------
//
// Deterministic and CONTEXT-AWARE (it reads the task lines the assistant
// already put in the prompt), so development and tests exercise the real
// shapes without any network access. Every answer is clearly labelled, so a
// mock response can never be mistaken for a live AI answer.

function taskLinesFromPrompt(prompt) {
  return String(prompt || "")
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim().slice(2));
}

function mockResult(kind, { prompt }, startedAt, { fallback, errorCode = "" } = {}) {
  const lines = taskLinesFromPrompt(prompt);
  const tag = fallback ? "[MOCK FALLBACK]" : "[MOCK]";
  let text;

  if (kind === "draft" || kind === "summary") {
    text =
      `${tag} Suggested draft based on the task data you have access to:\n\n` +
      (lines.length
        ? lines.slice(0, 4).map((l) => `• ${l}`).join("\n")
        : "• (no task data in scope)") +
      "\n\nReview and edit before sending - nothing is sent without your approval.";
  } else if (kind === "handoff") {
    text =
      `${tag} Handoff note: the task this depends on is complete, so your task is now ready to start.` +
      (lines.length ? `\nCurrent queue:\n${lines.slice(0, 3).map((l) => `• ${l}`).join("\n")}` : "");
  } else {
    // qa - keyword match against the employee's own task lines
    const words =
      String(prompt)
        .split("Question:")
        .pop()
        .toLowerCase()
        .match(/[a-z]{4,}/g) || [];
    const scored = lines
      .map((l) => ({ l, score: words.filter((w) => l.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score > 0)
      .slice(0, 5);

    text = scored.length
      ? `${tag} From your task data:\n${scored.map((s) => `• ${s.l}`).join("\n")}`
      : `${tag} I can only answer from your own task data. Your current tasks:\n` +
        (lines.length ? lines.slice(0, 5).map((l) => `• ${l}`).join("\n") : "• (none)");
    if (fallback) {
      text += `\n\n(The live AI provider could not be reached: ${errorCode}. Nothing was invented.)`;
    }
  }

  // Rough token estimate keeps the usage ledger realistic in development.
  const promptTokens = Math.max(1, Math.round(String(prompt || "").length / 4));
  const completionTokens = Math.max(1, Math.round(text.length / 4));

  return {
    text,
    provider: "mock",
    model: "mock-v1",
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estCostUsd: 0,
    },
    latencyMs: Date.now() - startedAt,
    fallback: Boolean(fallback),
    errorCode,
  };
}

module.exports = {
  PROVIDERS,
  AiError,
  generate,
  getProviderName,
  isConfigured,
  describeProvider,
  estimateCostUsd,
};