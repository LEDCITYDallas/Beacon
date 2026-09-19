// ---------------------------------------------------------------------
// Provider-agnostic AI adapter (Section 5).
//
// The assistant code never talks to a vendor SDK directly - it calls this
// adapter. The concrete provider is chosen by env var AI_PROVIDER and can
// be swapped later without touching assistant logic.
//
// Providers:
//   "mock"      - deterministic canned responses, no network, no key.
//                 Default. Used for all development/testing (Section 10.2
//                 mock-data rule) and as the fallback if a real provider
//                 is not configured yet.
//   "openai"    - placeholder for the approved provider; implemented when
//                 Omair adds the key (Section 10.3-10.4) and the client
//                 confirms the provider decision (Section 12).
//
// LED City holds the provider key at all times - this code never reads or
// stores one beyond reading the env var Omair sets.
// ---------------------------------------------------------------------

const PROVIDERS = ["mock", "openai"];

function getProviderName() {
  const p = (process.env.AI_PROVIDER || "mock").toLowerCase();
  if (!PROVIDERS.includes(p)) {
    console.warn(`[ai] unknown AI_PROVIDER "${p}", falling back to mock`);
    return "mock";
  }
  return p;
}

// The single entry point the assistant uses.
//   kind   - "qa" | "draft"
//   prompt - the fully composed user prompt (context already attached by
//            the assistant service; the model never queries the DB itself)
//   system - system instructions for this call
// Returns { text, provider, model }.
async function generate({ kind, system, prompt }) {
  const provider = getProviderName();

  if (provider === "mock") {
    return {
      text: mockResponse(kind, prompt),
      provider: "mock",
      model: "mock-v1",
    };
  }

  // Real providers plug in here once the key exists (added by Omair).
  // Until then, anything other than mock degrades to mock rather than
  // throwing - the assistant must not crash the app over a missing key.
  console.warn(`[ai] provider "${provider}" not configured yet, using mock`);
  return { text: mockResponse(kind, prompt), provider: "mock", model: "mock-v1" };
}

function mockResponse(kind, prompt) {
  if (kind === "draft") {
    return (
      "[MOCK DRAFT] Here is a suggested draft based on your request:\n\n" +
      prompt.slice(0, 200) +
      "\n\n(Replace with the real provider once AI_PROVIDER and the key are set.)"
    );
  }
  return (
    "[MOCK ANSWER] Based on your current task data: " +
    prompt.slice(0, 200) +
    " (mock provider - configure AI_PROVIDER for real answers.)"
  );
}

module.exports = { generate, getProviderName, PROVIDERS };
