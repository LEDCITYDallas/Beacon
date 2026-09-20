# Requirements Coverage Report

**Date:** 2026-09-20 · **Repo:** `phase5-engine` (69/69 automated checks passing)

Legend — **Implemented** (working, mock-data verified) · **Partial** (architecture in
place, one piece missing) · **Production Wiring Required** (code done, Omair adds
credentials) · **Pending Client Decision** (Section 12 — not invented).

## Section-by-section

| Req § | Area | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Assistant framing, admin capability, overseas-first rollout | Implemented (rollout = pilot seed users) | seed roles, consent copy |
| 2 | Dark theme default + light toggle, placeholder branding | Implemented (name pending) | `frontend/src/styles/theme.css`, §12 decision |
| 3 | Roles, dept-scoped views, reduced-monitoring, live-view scope | Implemented; live-view scope configurable | `PermissionSettings`, `permissions.js`, smoke §3–4 |
| 4 | Tasks: priority/est/due/deps/DoD; single-focus home; timer; 120% overrun; timeline; auto-unblock; blocked-why (2 types, aggregate); completion detection; human-in-the-loop | Implemented | `Task`, `taskController`, `signalScanner`; smoke §5–10 |
| 5 | Assistant: next-up, proactive handoffs, Q&A, drafting; explicit approval-gate doc | Implemented | `assistantService`, `docs/approval-gates.md`; smoke §11–12 |
| 6 | Idle 15–20 min, screenshots off, live view (view-only, 5s frame bus, session logs admin-only, hard exclusions) | Implemented | `activityController`, `liveview/*`, smoke §13 |
| 7 | Scorecard: configurable weights, weekly+monthly, self-view, no automation on outcomes, DRAFT state pending Omair | Implemented (weights decision pending) | `ScorecardSettings`, `scorecardController` |
| 8 | Friday WhatsApp digest, overdue/blocked in-app+email alerts, per-employee timezones, self-view trend | Implemented (Cliq deferred) | `digestController`, `alertsController`, `composer` |
| 9 | Hard consent gate (can't use system until accepted), data residency, retention job | Implemented (retention days pending) | consent middleware, `RetentionSettings`, `scripts/retention.js` |
| 10 | Org repo, mock data only, no Ahmed credentials, Omair wires prod, review gate, ownership | Implemented in repo; **org push + signed statement outstanding** | README transfer steps, `docs/code-review-gate.md` |
| 11 | Zoho/WorkDrive/CMS read-only adapters + WhatsApp; runs alongside Zoho Connect | Implemented (mock) | `services/integrations/adapters.js`, `delivery/whatsappAdapter.js` |
| 12 | Open decisions | **All Pending Client Decision** | `docs/client-memo-open-decisions.md` |

## Pending Client Decision (Section 12 — DO NOT INVENT)

1. Product name (recommendation: LED City Pulse) — placeholder branding in UI.
2. Live-view role scope for reduced-monitoring roles (configurable in `PermissionSettings`; default excludes).
3. Retention period for activity/session logs (`RetentionSettings`, job exists).
4. AI provider + monthly cost (estimate delivered in `docs/ai-cost-estimate.md`; key wired by Omair).
5. Scorecard formula weights (DRAFT state shown in UI until Omair approves).
6. Real role/department/employee list for the permission matrix (admin screen ready).
7. Mac mini/Tailscale hosting cost breakdown (`docs/mac-mini-deployment.md` gives the architecture; costing is Omair's).

## Production Wiring Required (Omair, after code review)

- Push repo to the private LED City Dallas org (transfer steps in README).
- Real MongoDB on the Mac mini + TLS + least-privilege users (`/mongodb-setup`).
- `INTEGRATIONS_DRIVER=live` + Zoho/WorkDrive/CMS OAuth tokens (READ-only scopes; checklist in `docs/code-review-gate.md` §7).
- Real AI provider key; real SMTP/WhatsApp provider accounts; `DIGEST_SEND_ENABLED`.
- Real consent legal text replacing the placeholder (Section 9).

## Known small items

- Assignee picker in the create-task form is still a raw user-ID field (frontend).
- Zoho Cliq chat alerts deliberately deferred (Section 8: "to be discussed later").
- DST boundary tests for timezones are noted in the backlog (core timezone handling implemented).