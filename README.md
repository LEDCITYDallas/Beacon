# LED City — Agentic Workforce Assistant

**Status: Phases 1–5 implemented, verified & hardened** (Foundation, Task &
Dependency Engine, AI Assistant, Activity Monitoring & Live Screen-View,
Scorecard/Alerts/Digest/Retention, plus the external completion-signal
pipeline with mock Zoho/WorkDrive/CMS adapters).
Built against mock data only, per Section 10.2 of the client requirements —
no real LED City employee/customer/business data anywhere in this repo.

Verification: `npm test` in `/backend` runs a 69-check end-to-end smoke test
(`scripts/smoke-test.js`) against the running dev server — auth, the Section 9
consent gate, role/department/task-level scoping, priority ordering, timer +
overrun, blocked-why, dependency auto-unblock, human-in-the-loop completion,
the integration signal scanner, assistant approval gates, auto-handoff
proposals, alerts/flags, presence/heartbeat, live-view gating, scorecard and
digest. All 69 pass; the frontend TypeScript build is clean.

This is a local dev scaffold. Per Section 10.1, once this is reviewed it
should be pushed as the first commit into a **private repo under the LED
City Dallas GitHub org** — not developed further in a personal repo.

The first local commit exists (`git init` done, secrets excluded — verify
with `git status` that `backend/.env` is not tracked). To transfer:

```bash
# after Omair creates the private repo <repo-name> under the org and invites you:
git remote add origin git@github.com:<led-city-dallas-org>/<repo-name>.git
git branch -M main
git push -u origin main
```

From that point on, all work happens directly in the org repo.

## What's implemented

**Backend** (`/backend` — Node/Express/MongoDB)
- Auth: JWT login, `/me`, and a hard **consent gate** middleware (Section 9) —
  every route except `/auth/consent` is blocked until `consentAccepted` is true
- Roles: `SUPER_ADMIN` / `MANAGER` / `EMPLOYEE`, with department-scoped
  data access (`scopeToDepartment` middleware)
- Task model: priority, estimated hours, due date, dependencies, definition
  of done, full timeline log
- Dependency engine: completing a task auto-flips every dependent task from
  `BLOCKED` → `READY` (see `unblockDependents` in `taskController.js`)
- Per-task timer (start/pause), separate from clock-in/out, with
  configurable overrun alert (default 120% of estimate)
- "Blocked — why" field, restricted to the two required reasons
- Human-in-the-loop completion: `proposeCompletion` → `confirmCompletion` /
  `rejectCompletion`. This is the hook Phase 6's Zoho/WorkDrive/CMS signal
  readers will call — it **never** finalizes a task on its own
- Mock data seed script (`npm run seed`) with 5 fictional users covering
  each role, including a reduced-monitoring example

**Frontend** (`/frontend` — React + TypeScript + Vite)
- Login page
- Consent screen — placeholder legal text, **swap for LED City's actual
  consent copy before go-live**
- Employee home: single-focus "current task + what's next" view (Section 4)
  with the timer and blocked-why form
- Manager/Super Admin team queue: table of tasks + a bare-bones create-task
  form (assignee is a raw user ID for now — needs a proper picker)
- Dark theme by default; accent color is a **placeholder teal** since the
  product name/branding (Section 2) isn't finalized yet

## Not in this scaffold yet (later phases)

- AI Co-Working Assistant (next-up ranking beyond simple sort, WhatsApp/email
  handoff notifications, on-demand Q&A, drafting) — Phase 3
- Idle/AFK detection + live screen-view — Phase 4
- Performance scorecard + Friday digest — Phase 5
- Real Zoho/Books/Inventory/WorkDrive/CMS signal readers that call
  `proposeCompletion` — Phase 6, and this needs Omair's OAuth setup per
  Section 10.3–10.4
- Consent copy is placeholder — needs real legal text from the client
- No employee/task picker UI yet — raw ObjectIds for now

## Security hardening included

The backend now ships with:

- **helmet** — sets protective HTTP headers
- **CORS locked to known origins** (`FRONTEND_ORIGIN` in `.env`), not `*`
- **express-rate-limit** — 300 req/15min globally, 10 req/15min specifically
  on `/auth/login` so a leaked or guessed password can't be brute-forced
- **express-mongo-sanitize** — strips `$`/`.` operators from input to block
  NoSQL injection (e.g. `{"email": {"$ne": null}}`)
- **hpp** — blocks HTTP parameter pollution
- Body size capped at 200kb
- Error handler never leaks stack traces when `NODE_ENV=production`
- Passwords are bcrypt-hashed (never stored/logged in plaintext) and JWTs
  are signed with a secret you generate yourself (see `.env.example`)

`/mongodb-setup` has reference material for Omair when he wires up the
production Mac mini (Section 10.4 — Ahmed never touches live credentials):

- `mongod.conf.example` — bind only to localhost + the Tailscale IP
  (never `0.0.0.0`), require TLS, enable `security.authorization`
- `mongo-create-users.js` — creates least-privilege DB users instead of
  one shared superuser (a scoped app user, a separate read-only reporting
  user, and an admin user used only for maintenance)

None of this makes anything "unhackable" — it closes the specific holes
that actually get exploited in the wild: an open port, auth left off by
default, a shared superuser password, and no rate limit on login.

## Running locally WITHOUT a real database (fastest way to check things work)

No Atlas, no local Mongo install, no DNS/network dependency — this spins up
an in-memory MongoDB that only lives while the process runs (data resets on
restart). Good for a quick sanity check; not a substitute for real dev DB.

```bash
cd backend
cp .env.example .env      # JWT_SECRET/FRONTEND_ORIGIN still apply; MONGO_URI is ignored here
npm install
npm run dev:memory         # first run downloads a small mongod binary automatically
```

It seeds the same 5 mock users + 4 mock tasks automatically on startup, then
listens on http://localhost:5000. Then run the frontend as normal (below).

## Running locally with a real database (Atlas or local Mongo)

```bash
# backend
cd backend
cp .env.example .env      # point MONGO_URI at your own local/dev Mongo
# generate a real JWT secret and paste it into .env:
openssl rand -hex 64
npm install
npm run seed               # loads 5 mock users + 4 mock tasks
npm run dev                # http://localhost:5000

# frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Mock login (password for all: `MockPass123!`):

| Role | Email |
| --- | --- |
| Super Admin | omair@mock.ledcity.test |
| Manager | sana.manager@mock.ledcity.test |
| Employee (overseas, no consent yet) | bilal@mock.ledcity.test |
| Employee (Dallas showroom) | maria@mock.ledcity.test |
| Employee (reduced monitoring) | yusuf@mock.ledcity.test |

Log in as `bilal@mock.ledcity.test` first to see the consent gate in action.

## Open decisions still needed from the client before later phases

See Section 12 of the requirements doc: final product name, live-view role
scope, retention period, performance formula weights, real role/department
list, AI provider + monthly cost, hosting cost breakdown for Mac
mini/Tailscale.
