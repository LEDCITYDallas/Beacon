# Completed Work Record — LED City Agentic Workforce Assistant

**Date:** 2026-09-20 · **Branch:** `phase5-engine` · **Commit:** `d3a3132`
**Verification:** 69/69 automated end-to-end checks passing (`backend/scripts/smoke-test.js`), frontend TypeScript build clean.
**Data rule honored throughout:** mock/demo data only — no real employee, customer or business data; no live credentials anywhere in the repo.

---

## 1. Foundation & Security (Phase 1)

- Node/Express/MongoDB backend (`/backend`) and React + TypeScript + Vite frontend (`/frontend`).
- JWT auth: login, `/me` (never leaks `passwordHash`), bcrypt-hashed passwords.
- **Hard consent gate (Section 9):** middleware blocks every route except `/auth/consent` until `consentAccepted` is true — consent records version + timestamp + employee identity.
- Hardening: helmet, CORS locked to known origins, rate limits (300/15min global, 10/15min login, separate 240/min bucket for live-view frames), express-mongo-sanitize (NoSQL injection), hpp, 200kb body cap, no stack traces in production errors.
- Roles: `SUPER_ADMIN` / `MANAGER` / `EMPLOYEE` with department-scoped access (`scopeToDepartment`); reduced-monitoring flag on users.
- Per-employee timezone support (Dallas + overseas), editable via `/api/users/me`.
- Security reference for production Mongo: `/mongodb-setup` (localhost+Tailscale-only bind, TLS, least-privilege users).

## 2. Task & Dependency Engine (Phase 2 — Section 4)

- Task model: priority, estimated hours, due date, `dependsOn`, definition of done, external refs, full timestamped timeline.
- Employee home screen: single-focus "current task + what's next" (not a long list).
- Per-task timer (start/pause), separate from clock-in/out; estimated vs actual hours tracked per task.
- **Overrun alert** to employee + manager at a configurable threshold (default 120% of estimate).
- **Dependency auto-unblock:** completing a task flips every dependent `BLOCKED` → `READY` with a timeline `UNBLOCKED` event.
- **"Blocked — why"** field restricted to the two required reasons (`WAITING_ON_OTHER` / `NOT_CONFIDENT`); tracked in aggregate, never to single out an individual.
- Manager flag on tasks; manager/admin reopen (feeds the rework scorecard input).
- **Human-in-the-loop completion:** `propose-completion` → `confirm-completion` / `reject-completion`. Only the assignee's explicit confirm finalizes; nothing closes silently.

## 3. AI Co-Working Assistant (Phase 3 — Section 5)

All four required capabilities:
1. **Next-up queue** — personalized, prioritized (`/assistant/next-up`).
2. **Proactive handoffs** — dependency unblock auto-creates a `PENDING` HANDOFF proposal for the newly-unblocked person; nothing transmits until a human confirms (WhatsApp or email).
3. **On-demand Q&A** — answers only from the employee's own scoped task data (`/assistant/ask`).
4. **Drafting** — status updates/replies/summaries for review; never sent without approval (`/assistant/draft`, `/assistant/summary`).

- Provider-agnostic adapter (`services/ai/provider.js`): `mock` (default, deterministic, context-aware, labelled `[MOCK]`), `openai`, `gemini`, `anthropic` — switched by config, key only ever from env.
- Usage ledger (`AiUsageLog`): tokens, estimated cost, per-call limits, monthly budget — feeds the Super Admin `/admin/ai-usage` spend view.
- **Explicit approval-gate matrix delivered in writing:** `docs/approval-gates.md` (which actions need approval, which two non-consequential actions don't — reading own data, generating unsent drafts).

## 4. Activity Monitoring & Live Screen-View (Phase 4 — Section 6)

- **Idle/AFK:** 15–20 min inactivity → INACTIVE/On Break; any activity auto-resumes ACTIVE. Heartbeat endpoint + frontend hook; threshold clamped inside 15–20 by config.
- **Privacy by construction:** activity state + timestamps only; no keystrokes, key content, screenshots, webcam, audio or window titles anywhere (enforced in config and controllers).
- **Live screen-view (v1, view-only):** admin-initiated sessions with employee approval prompt; frames live in a 5-second in-memory bus (`services/liveview/frameBus.js`) and are never persisted; sessions end cleanly (`REQUESTED → ACTIVE → ENDED/DENIED/EXPIRED`).
- **Session audit:** every session logs viewer, employee, start/end, duration, reason — listable by Super Admin only.
- Role scope for live-view is **configurable data** (`PermissionSettings` + `LIVEVIEW_*` env bootstrap), pending the client decision — not hardcoded.

## 5. External Completion-Signal Pipeline (Phase 4.5 — Sections 4/11)

- Read-only adapters for **Zoho CRM, Zoho Books, Zoho Inventory, WorkDrive, website/CMS** (`services/integrations/adapters.js`), each with documented required scopes and a gated fetch (timeout, error normalization).
- Normalized signal shape `{ source, externalId, type, title, summary, evidenceUrl, occurredAt }` — Task Engine never touches vendor APIs.
- Mock driver (default) with deterministic demo signals; live driver enabled only by Omair's tokens after code review.
- Scanner (`signalScanner.js`): explicit-reference/token matching with a conservative confidence threshold → **raises a completion proposal with evidence**; NEVER closes a task.
- **Idempotent duplicates:** a repeat signal on an already-pending proposal is logged `IGNORED`, no spam.
- One failing source never breaks the scan (per-source errors recorded as `IntegrationSignal` rows: `PROPOSED_COMPLETION` / `NO_MATCH` / `IGNORED` / `ERROR`).
- Admin surface: `/integrations/status`, `/integrations/scan`, `/integrations/signals`, manual `/integrations/propose` (manager/admin only).

## 6. Scorecard, Alerts, Digest, Stats (Phase 5 — Sections 7/8)

- **Scorecard:** configurable weights (`ScorecardSettings`) over on-time %, estimate accuracy, tasks closed/week, rework count, manager rating, optional activity/idle; activity can never dominate; reports weekly + monthly; DRAFT state visible until weights are jointly approved with Omair; no automatic compensation/disciplinary outcomes.
- Views: employee self-report (`/scorecard/my`), manager per-user (`/scorecard/user/:id`), team (`/scorecard/team`), Super Admin departments (`/scorecard/departments`); manager rating entry + history (`/scorecard/rate`, `/scorecard/ratings`); weights API (`/scorecard/settings`, `/scorecard/weights`).
- **Manager alerts:** in-app overdue/blocked lists (dept-scoped), human-triggered email dispatch, notification history; Cliq deliberately deferred.
- **Friday digest:** Super-Admin-only generation (`finished / late / overloaded`), schedule config, send via WhatsApp adapter — delivery off by default (`DIGEST_SEND_ENABLED`), simulated runs logged.
- **Employee self-view:** `/stats/my-week` (completed, hours, on-time %, 4-week trend).
- Delivery registry (`services/delivery/`): in-app (no credentials needed), email (SMTP), WhatsApp; every send recorded in `NotificationLog` with channel, driver, status, error, provider message id, approving actor.

## 7. Data Governance (Section 9)

- Consent gate as a hard access requirement (see §1) — disclosure covers AI task/handoff features AND activity tracking/screen checks including random spot checks.
- **Retention job** (`scripts/retention.js` + `RetentionSettings`): configurable scope for activity logs and session logs; exact duration pending client decision.
- Audit log on all consequential actions (proposals, approvals, rejections, permission changes, live-view requests) — viewable at `/admin/audit`.

## 8. Admin Console (Super Admin)

`/admin/system` (what's on/off, drivers, exclusions), `/admin/ai-usage` (real spend vs budget), `/admin/retention` (view + set), `/admin/permissions` (live-view role scope, permission matrix as editable data), `/admin/audit`; user management (roles, departments, timezones, reduced-monitoring, WhatsApp number) — the config surface where Omair will supply the final real-world matrix.

## 9. Frontend (React + TypeScript, dark theme default + light toggle)

- **Pages:** Login · Consent · EmployeeHome (single-focus current task + timer + blocked-why) · ManagerDashboard (team queue, alerts, flags, presence) · Assistant (Q&A, drafts, approval queue) · LiveView (viewer + employee-side prompt) · MyScorecard · TeamScorecard · AdminSettings (retention, permissions, AI usage, system status).
- **Components:** TaskTimer, BlockedWhyForm, CompletionProposals (proposal state visually distinct from executed state), LiveViewPrompt, StatusBadge.
- **Hooks:** `useIdleHeartbeat` (activity presence), `useLiveViewEmployee` (employee-side session prompt).
- Scoped API client + typed models; placeholder teal branding pending product-name decision.

## 10. Ops Scripts & Tests

- `scripts/dev-memory.js` — zero-install in-memory Mongo dev server (auto-seeds).
- `seed/seedData.js` — 5 mock users (every role incl. reduced-monitoring) + mock tasks.
- `scripts/activity-agent.js` — presence heartbeat agent; `scripts/run-digest.js` — deterministic Friday digest run; `scripts/retention.js` — retention enforcement.
- `scripts/smoke-test.js` — **69 automated end-to-end checks, all passing**: auth, consent gate, scoping (employee/manager/admin, task-level, cross-dept), task validation, priority ordering, timer + overrun, blocked-why rules, dependency auto-unblock, human-in-the-loop completion (incl. reject path), integrations scan → proposal → confirm, assistant Q&A/draft/approval gates, auto-handoff confirm by manager + foreign-decline 403, self-view stats, alerts, flags, presence/heartbeat thresholds.

## 11. Documentation Delivered

| Doc | Purpose |
| --- | --- |
| `README.md` | Current status, run instructions, mock logins, transfer-to-org-repo steps |
| `docs/approval-gates.md` | Written approval matrix (Section 5 requirement) |
| `docs/ai-cost-estimate.md` | Pre-build monthly AI cost estimate (Section 12 requirement) |
| `docs/client-memo-open-decisions.md` | Section 12 decision memo with recommendations |
| `docs/mac-mini-deployment.md` | Production setup, backup/restore, service restart, dev/prod separation |
| `docs/code-review-gate.md` | Required pre-OAuth review checklist, API scope table, audit review checklist, sign-off |
| `docs/requirements-coverage.md` | Section-by-section coverage: Implemented / Partial / Pending Client Decision / Production Wiring Required |
| `/mongodb-setup` | mongod.conf.example + least-privilege user creation for Omair |

## 12. Explicitly NOT done (by design)

- **Client decisions (Section 12):** product name, live-view role scope, retention duration, AI provider + budget, scorecard weights, real employee/department matrix, hosting cost — all remain configurable, none invented.
- **Production wiring (Omair, after code review):** org-repo push, real Mongo on Mac mini, `INTEGRATIONS_DRIVER=live` + OAuth tokens, real AI/SMTP/WhatsApp keys, real consent legal text.
- **Process (Section 10.6):** signed work-for-hire ownership statement.
- **Deferred by requirements:** Zoho Cliq chat alerts ("discussed later").