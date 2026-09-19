# LED City Workforce Assistant — Open Decisions Memo

**To:** Omair, LED City Dallas
**From:** Muhammad Ahmed (contract development)
**Date:** 2026-09-19
**Re:** Section 12 of the requirements — "Confirm before build" decisions, plus
build status and remaining delivery plan.

Phase 1+2 (foundation + task/dependency engine) is built, security-hardened,
and verified by a 43-check automated end-to-end test suite. Before Phase 3
(AI assistant) begins, the decisions below need your sign-off — the
requirements document lists them as "Confirm Before Build" items.

Each item includes my recommendation so you can approve quickly or override.

---

## 1. Decisions needed (Section 12)

### 1.1 Product name

| Option | Rationale |
| --- | --- |
| LED City Pulse | Ties to company brand; implies live view of work |
| Relay | Names the handoff/dependency mechanic directly |
| Compass | Implies "what to do next" guidance |
| Sync | Simple; coordination across people |

**Recommendation:** LED City Pulse (brand + meaning). UI is dark-theme,
placeholder-branded — renaming later is cosmetic, not architectural.

**Your decision:** ______________

### 1.2 Live screen-view role scope

Does the reduced-monitoring exclusion (credentials/PII/payment roles — no
screenshots) also exclude those roles from **live screen-view**, or does
live-view apply to every role?

- **Option A (recommended):** exclusion applies to live-view as well.
  Finance/PII roles get activity/idle tracking only, never screens.
  Consistent with Section 3's intent and lower privacy risk for the pilot.
- **Option B:** live-view applies to all roles regardless, logged per
  Section 6 (view-only, no storage, session logs visible to Super Admin only).

**Your decision:** A / B

### 1.3 Data retention period

Requirements leave the exact number open. My proposal:

| Data | Proposed retention |
| --- | --- |
| Activity/idle logs | 90 days, then deleted |
| Live-view session logs | 90 days, then deleted |
| Scorecard aggregates | 12 months |
| Task/timeline data | Life of the system (business record) |

Rolling deletion runs automatically. Tell me different numbers if you prefer.

**Your decision:** accept / specify: ______________

### 1.4 AI provider & monthly cost

Covered in the attached `ai-cost-estimate.md`. Short version: a
GPT-4o-mini / Gemini Flash class model, **~$8–15/month at pilot scale**,
budget **$25/month pilot / $60/month full rollout**. Approval needed before
Phase 3 build (Section 5 requirement).

**Your decision:** approve / specify: ______________

### 1.5 Performance formula weights

Section 7 requires the final weighting be set jointly with you before any
scorecard goes live. My draft to start that discussion (not unilateral —
this is a proposal):

| Input | Draft weight |
| --- | --- |
| On-time completion % | 30% |
| Manager rating | 25% |
| Estimate accuracy | 20% |
| Tasks closed per week | 15% |
| Rework / reopened count | −10% penalty |
| Activity/idle % | 0% initially, capped ≤10% ever (never dominant — Section 7) |

We will finalize together in a working session before the scorecard ships.

**Your decision:** schedule session / adjust numbers: ______________

### 1.6 Real role/department list

For the permission matrix and reduced-monitoring list (Section 3), please
fill one row per staff member (pilot group first):

| Name | Email | Role | Department | Timezone | Reduced monitoring? (Y/N) |
| ---- | ----- | ---- | ---------- | -------- | ------------------------- |
|      |       |      |            |          |                           |

Reduced-monitoring = anyone regularly handling credentials, customer PII,
or payment data.

**Your decision:** return the completed table.

### 1.7 Hosting cost breakdown (Mac mini / Tailscale)

Per Section 12: reflects self-hosted infrastructure, not the previously
quoted Railway/hosted-MongoDB stack.

| Item | Cost |
| --- | --- |
| Mac mini (already owned) | $0 |
| Electricity (~10–15W continuous) | ~$1–3/month |
| Tailscale | Free tier for admin-only access; Starter ~$6/user/month for more operators |
| MongoDB — self-hosted on the Mac mini | $0 (vs ~$57/month for Atlas M10) |
| App hosting — local, no Railway | $0 |
| Domain/TLS | $0 over Tailscale (internal), or ~$12/year for a public name |
| Recurring total | **~$2–40/month depending on Tailscale tier** |

**Your decision:** confirm approach / preferred Tailscale tier.

---

## 2. Build status today

- **Done & verified:** auth with hard consent gate (Section 9), roles +
  department scoping, task engine with priorities/estimates/due dates/
  dependencies/definition-of-done, per-task timer with 120% overrun alert,
  blocked-why with the two required reasons, dependency auto-unblock,
  human-in-the-loop completion (system proposes, human confirms — nothing
  closes silently), dark theme UI, Mac mini/Tailscale production configs.
- **Verification:** 43-check automated end-to-end suite, all passing;
  frontend TypeScript build clean.
- **Process compliance so far:** mock data only (10.2); no live credentials
  held (10.3); code built from scratch (10.6).

## 3. Remaining delivery plan (after your inputs)

| Phase | Scope | Est. duration | Blocked on |
| --- | --- | --- | --- |
| 3 | AI co-working assistant (4 features + written approval-gates document) | ~1.5–2 weeks | 1.4 decision |
| 4 | Idle/AFK + live screen-view (view-only, no storage, session logs) | ~2 weeks | 1.2 decision |
| 5 | Scorecard + Friday WhatsApp digest + manager alerts + self-view | ~1.5 weeks | 1.5 session |
| 6 | Zoho/WorkDrive/CMS signal readers → completion proposals | ~2–3 weeks | 1.6 list + your OAuth wiring (10.3–10.4) |

Phases overlap where decisions arrive early. Section 10 gates stay as
written: private repo under the LED City Dallas GitHub org from day one,
your OAuth-only production setup, and a required code review before any
live connection.

## 4. What I need from you

1. Answers to 1.1–1.4 (name, live-view scope, retention, AI approval)
2. A 30-minute session date for 1.5 (scorecard weights)
3. The 1.6 staff table (pilot group first)
4. Signed ownership/work-for-hire statement per Section 10.6
5. Invitation to the LED City Dallas GitHub org private repo (10.1)


