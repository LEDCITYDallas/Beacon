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
  return PROVIDERS.includes(p) ? p : "invalid";
}

// A labelled mock answer is allowed only for a temporary outage. A missing
// or rejected key must surface as an error, or the UI would treat it as a
// successful assistant response.
const FALLBACK_CODES = new Set([
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_ERROR",
  "AI_INVALID_RESPONSE",
]);

const MAX_OUTPUT_CHARS = 8000;

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
    configured: provider !== "invalid" && isConfigured(provider),
    live: provider !== "mock" && provider !== "invalid" && isConfigured(provider),
    fallbackToMock: config.ai.fallbackToMock,
    timeoutMs: config.ai.timeoutMs,
    monthlyBudgetUsd: config.ai.monthlyBudgetUsd,
    dailyCallLimitPerUser: config.ai.dailyCallLimitPerUser,
    costPerMillion: config.ai.costPerMillion,
  };
}

// Prior chat turns. The assistant service already caps and validates these;
// this is a second bound so a caller cannot smuggle a huge transcript through.
function normaliseHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const clean = [];
  for (const turn of messages) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const content = typeof turn.content === "string" ? turn.content.trim() : "";
    if (!content) continue;
    clean.push({ role: turn.role, content: content.slice(0, 1500) });
  }
  return clean.slice(-8);
}

// Vendor APIs reject two user turns in a row. Fold those together.
function conversationTurns(history, prompt) {
  const turns = [...history, { role: "user", content: String(prompt || "") }];
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content += "\n\n" + turn.content;
    else merged.push({ role: turn.role, content: turn.content });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

function usesReasoningTokens(model) {
  return /^(gpt-5|o\d)/i.test(String(model || ""));
}

function geminiThinkingModel(model) {
  return /^gemini-[34]/i.test(String(model || ""));
}

// The single entry point the assistant uses.
//   kind      - "qa" | "draft" | "handoff" | "summary" | "next_up"
//   system    - system instructions for this call
//   prompt    - fully composed user prompt (context is attached by the
//               assistant service; the model never queries the DB itself)
//   messages  - optional prior user/assistant turns for follow-up questions
// Returns { text, provider, model, usage, latencyMs, fallback }
async function generate({ kind = "qa", system, prompt, messages, maxTokens, temperature } = {}) {
  const provider = getProviderName();
  const startedAt = Date.now();

  if (provider === "invalid") {
    throw new AiError(
      "AI_NOT_CONFIGURED",
      `AI_PROVIDER must be one of ${PROVIDERS.join(", ")}.`,
      { status: 503 }
    );
  }

  if (provider === "mock") {
    return mockResult(kind, { system, prompt }, startedAt, { fallback: false });
  }

  if (!isConfigured(provider)) {
    throw new AiError(
      "AI_NOT_CONFIGURED",
      "The AI provider key is not configured on the server. Ask an administrator to set AI_API_KEY.",
      { status: 503 }
    );
  }

  const opts = {
    maxTokens: maxTokens || config.ai.maxOutputTokens,
    temperature: temperature === undefined ? config.ai.temperature : temperature,
    history: normaliseHistory(messages),
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
        text: boundOutput(raw.text),
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

  if (config.ai.fallbackToMock && FALLBACK_CODES.has(lastError.code)) {
    console.warn(`[ai] ${provider} call failed (${lastError.code}); using labelled mock fallback`);
    return mockResult(kind, { system, prompt }, startedAt, {
      fallback: true,
      errorCode: lastError.code,
    });
  }
  throw lastError;
}

function boundOutput(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, MAX_OUTPUT_CHARS);
}

function safeDetail(message) {
  let text = String(message || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const key = config.ai.apiKey && config.ai.apiKey.trim();
  if (key && key.length > 6) text = text.split(key).join("[redacted]");
  return text;
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
    detail: safeDetail(err ? err.message : ""),
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
    const apiMessage = safeDetail(
      json && (json.error?.message || json.message) ? json.error?.message || json.message : ""
    );
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

async function callOpenai(system, prompt, { maxTokens, temperature, history }) {
  const base = (config.ai.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = config.ai.model;
  const reasoning = usesReasoningTokens(model);
  const body = {
    model,
    messages: [
      { role: "system", content: system || "" },
      ...conversationTurns(history, prompt),
    ],
  };
  // GPT-5 and o-series reject max_tokens and a non-default temperature.
  if (reasoning) {
    body.max_completion_tokens = maxTokens;
    body.reasoning_effort = "minimal";
  } else {
    body.max_tokens = maxTokens;
    body.temperature = temperature;
  }
  const json = await readJson(
    await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(body),
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

async function callGemini(system, prompt, { maxTokens, temperature, history }) {
  const base = (
    config.ai.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
  const model = config.ai.model;
  const generationConfig = { temperature, maxOutputTokens: maxTokens };
  // Flash 3/4 think by default. Low keeps employee Q&A fast and cheap.
  // "minimal" is rejected by Gemini 3.8 Flash.
  if (geminiThinkingModel(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  }
  const json = await readJson(
    await fetchWithTimeout(`${base}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.ai.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: conversationTurns(history, prompt).map((turn) => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.content }],
        })),
        generationConfig,
      }),
    }),
    "Gemini"
  );

  const candidate = json.candidates && json.candidates[0];
  const text = (candidate?.content?.parts || [])
    .filter((p) => p && p.thought !== true)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");
  const thoughts = json.usageMetadata?.thoughtsTokenCount || 0;
  const completion = json.usageMetadata?.candidatesTokenCount || 0;
  return {
    text,
    model,
    promptTokens: json.usageMetadata?.promptTokenCount,
    completionTokens: completion + thoughts,
    totalTokens: json.usageMetadata?.totalTokenCount,
  };
}

async function callAnthropic(system, prompt, { maxTokens, temperature, history }) {
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
        messages: conversationTurns(history, prompt),
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

function bullets(lines) {
  return lines.map((l) => `• ${l}`).join("\n");
}

function mockQa(prompt, lines, tag) {
  const question = String(prompt).split("Question:").pop().toLowerCase();
  const ready = lines.filter((l) => /\[(READY|IN_PROGRESS|PAUSED)/.test(l));
  const blocked = lines.filter((l) => /\[BLOCKED|blocked=/.test(l));

  if (/\b(leave|vacation|pto)\b/.test(question)) {
    return `${tag} Leave requests are not tracked in this application, so there is no leave status to report.`;
  }
  if (/\b(clock|punch|attendance)\b/.test(question)) {
    const presence = String(prompt)
      .split("\n")
      .find((l) => l.startsWith("Presence "));
    return (
      `${tag} There is no clock-in/clock-out ledger. ` +
      (presence || "No presence signal was included for you.")
    );
  }
  if (/\b(overdue|late)\b/.test(question)) {
    const late = lines.filter((l) => /\bOVERDUE\b/.test(l));
    return late.length
      ? `${tag} Overdue in your authorized task data:\n${bullets(late.slice(0, 5))}`
      : `${tag} None of the tasks in your authorized data are marked overdue.`;
  }
  if (/\bblock|\bwaiting|\bstuck/.test(question)) {
    return blocked.length
      ? `${tag} Blocked in your authorized task data:\n${bullets(blocked.slice(0, 5))}`
      : `${tag} Nothing in your authorized task data is marked blocked.`;
  }
  if (/\b(next|today|start)\b/.test(question)) {
    const picked = ready.length ? ready : lines;
    return picked.length
      ? `${tag} From your authorized task data, work these next:\n${bullets(picked.slice(0, 5))}`
      : `${tag} You have no tasks in scope right now.`;
  }

  const words = question.match(/[a-z]{4,}/g) || [];
  const scored = lines
    .map((l) => ({ l, score: words.filter((w) => l.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .slice(0, 5);

  if (scored.length) return `${tag} From your task data:\n${bullets(scored.map((s) => s.l))}`;
  return (
    `${tag} I can only answer from the records you are allowed to see. Your current tasks:\n` +
    (lines.length ? bullets(lines.slice(0, 5)) : "• (none)")
  );
}

function mockResult(kind, { prompt }, startedAt, { fallback, errorCode = "" } = {}) {
  const lines = taskLinesFromPrompt(prompt);
  const tag = fallback ? "[MOCK FALLBACK]" : "[MOCK]";
  let text;

  if (kind === "draft" || kind === "summary") {
    text =
      `${tag} Suggested draft based on the task data you have access to:\n\n` +
      (lines.length ? bullets(lines.slice(0, 4)) : "• (no task data in scope)") +
      "\n\nReview and edit before sending - nothing is sent without your approval.";
  } else if (kind === "handoff") {
    text =
      `${tag} Handoff note: the task this depends on is complete, so your task is now ready to start.` +
      (lines.length ? `\nCurrent queue:\n${bullets(lines.slice(0, 3))}` : "");
  } else {
    text = mockQa(prompt, lines, tag);
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