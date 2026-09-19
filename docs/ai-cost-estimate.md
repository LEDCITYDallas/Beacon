# AI Provider — Monthly Cost Estimate

**To:** Omair, LED City Dallas
**From:** Muhammad Ahmed (contract development)
**Date:** 2026-09-19
**Re:** Section 5 / Section 12 of the Workforce Assistant requirements — "Ahmed must
provide a monthly cost estimate before build begins."

This is the pre-build cost estimate for the AI Co-Working Assistant (next-up
ranking, handoff messages, on-demand Q&A, drafting). LED City pays actual
usage cost directly to the provider; I hold no live keys (Section 10.3 —
you will add the provider API key yourself after the code review gate).

---

## 1. Assumed usage (pilot scale)

- 15 employees in the overseas pilot (Section 11 rollout order)
- ~30 assistant interactions per employee per day (Q&A + drafts + queue ranking)
- Average ~3,000 input tokens / ~600 output tokens per interaction
- 22 working days per month

That is roughly **30M input + 6M output tokens per month** at pilot scale,
and about 2–3x that at full rollout (overseas + showroom staff).

## 2. Provider comparison (approximate published rates)

| Provider / model        | Input $/1M | Output $/1M | Est. pilot monthly | Quality for Q&A + drafting |
| ----------------------- | ---------: | ----------: | -----------------: | -------------------------- |
| Google Gemini Flash     |     ~$0.15 |      ~$0.60 |           **~$8**  | Good                       |
| OpenAI GPT-4o-mini      |     ~$0.15 |      ~$0.60 |           **~$8**  | Good                       |
| OpenAI GPT-4.1-mini     |     ~$0.40 |      ~$1.60 |          **~$22**  | Better reasoning           |
| DeepSeek (chat class)   |     ~$0.27 |      ~$1.10 |          **~$15**  | Good, EU/US data terms vary |
| Anthropic Claude Haiku  |     ~$0.80 |      ~$4.00 |          **~$48**  | Strong writing             |

Rates are the publicly listed card prices at the time of writing — verify the
exact figure on the provider's pricing page at purchase time, since vendors
revise them periodically.

## 3. Recommendation

Start on a **GPT-4o-mini or Gemini Flash class model**: adequate quality for
task Q&A and short drafts, and roughly **$8–15/month at pilot scale**.

Budget line to approve: **$25/month pilot, $60/month after full rollout** —
includes headroom for spikes. The AI layer will be built behind a
provider-agnostic adapter, so switching providers later is a config change,
not a rebuild.

## 4. Notification costs (Friday digest + handoff messages)

- **WhatsApp Cloud API:** utility/service-class messages are charged per
  conversation by Meta; at pilot volumes (Friday digest + a handful of
  handoffs/day) expect **~$5–15/month**.
- **Email:** sent from LED City's own SMTP (e.g. Zoho Mail) — $0 additional.

## 5. What LED City does NOT pay (hosting side)

See the separate hosting memo: production data lives on the Mac mini over
Tailscale. No Railway, no MongoDB Atlas, no third-party app hosting —
no per-service cloud bills for this system.

## 6. Cost controls built into the design

- Approval gates mean the assistant never loops unattended on expensive calls
- Q&A answers are scoped to the employee's own task data — short context,
  small prompts by design
- A monthly usage report (tokens + dollars) is exposed to the Super Admin
  dashboard so you can see the actual bill forming

---

**Decision needed from you (Section 12):** approve the provider class and the
$25/month pilot budget, or name a preferred provider. I will then build
Phase 3 against the approved choice.
