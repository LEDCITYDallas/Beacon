# Mac mini / Tailscale Production Deployment Guide

**Status:** Production wiring reference. Per Section 10.3–10.4, Muhammad Ahmed
never touches live credentials — Omair performs every step marked **[OMAIR]**.

**Non-negotiable (Section 9):** production data lives ONLY on this machine.
No Railway, no hosted MongoDB, no third-party database, no public cloud.

---

## 1. Target environment

| Component | Value |
| --- | --- |
| Host | LED City Mac mini (Dallas office), always on |
| Network access | Tailscale only — never expose ports to the public internet |
| Database | MongoDB local to the mini (see `/mongodb-setup`) |
| Backend | Node 18+, `backend/` |
| Frontend | Static build from `frontend/` served by Node or a local static server |

## 2. Machine preparation **[OMAIR]**

1. Install Tailscale, sign in with the LED City account, enable **key expiry
   disabled** for the mini and note its Tailscale name (e.g. `led-city-mini`).
2. Install Node.js LTS and MongoDB Community Edition.
3. MongoDB config: use `/mongodb-setup/mongod.conf.example` as the template.
   It binds **localhost + the Tailscale IP only** (never `0.0.0.0`), enables
   TLS and `security.authorization`.
4. Create least-privilege DB users with `/mongodb-setup/mongo-create-users.js`
   (scoped app user, read-only reporting user, maintenance admin). Store the
   passwords in a password manager — never in the repo or `.env` committed.

## 3. Application install **[OMAIR]**

```bash
git clone git@github.com:<led-city-dallas-org>/<repo>.git   # private org repo
cd <repo>/backend
npm ci --omit=dev
cp .env.example .env            # then edit with real values below
node seed/seedMockData.js       # ONLY if you want demo data; skip in production
npm start                       # verify it boots, then move to a service
```

`.env` for production (values Omair supplies; nothing here is Ahmed's):

| Key | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGO_URI` | `mongodb://<app-user>:<pass>@127.0.0.1:27017/ledcity_workforce?authSource=admin&tls=true` |
| `JWT_SECRET` | fresh `openssl rand -hex 64` — never reuse the dev value |
| `FRONTEND_ORIGIN` | the Tailscale URL(s) the frontend is served from |
| `INTEGRATIONS_DRIVER` | `live` ONLY after the code-review gate (Section 10.5) |
| `ZOHO_*` / `WORKDRIVE_*` / `CMS_*` tokens | added by Omair, per `docs/code-review-gate.md` |
| `AI_PROVIDER` / `AI_API_KEY` | provider chosen by Omair (see `docs/ai-cost-estimate.md`) |
| `SMTP_*` / WhatsApp provider keys | Omair's own accounts |
| `DIGEST_SEND_ENABLED` | `true` only when Omair wants the Friday digest to actually send |

## 4. Run as services (auto-restart on boot/crash)

Use launchd (macOS native). Create `/Library/LaunchDaemons/com.ledcity.workforce.plist`
with `KeepAlive` = true and `RunAtLoad` = true pointing at
`/usr/local/bin/node <repo>/backend/server.js`. Frontend static build:
`cd frontend && npm run build`, serve `frontend/dist` behind the same Node
process or a second launchd job.

Restart procedures:

```bash
launchctl unload /Library/LaunchDaemons/com.ledcity.workforce.plist
launchctl load   /Library/LaunchDaemons/com.ledcity.workforce.plist
# Mongo:
brew services restart mongodb-community   # or the launchd label Mongo created
```

## 5. Backup & restore

**Backup (nightly, e.g. launchd at 02:00):**

```bash
mongodump --uri="<app-user-uri>" --out /Backups/workforce/$(date +%F)
# keep ≥ 14 daily dumps on a second Tailscale-connected disk; optional
# restic/encrypted rsync to an office NAS — still LED City-controlled storage
```

**Restore (test this before go-live):**

```bash
mongorestore --uri="<app-user-uri>" --drop /Backups/workforce/<date>/ledcity_workforce
```

**Verify a backup monthly:** restore into a scratch database and run the
smoke test's read-only checks against it.

## 6. Dev vs production separation

| | Development (Ahmed) | Production (Omair) |
| --- | --- | --- |
| Data | `npm run dev:memory` (in-memory, resets) or local dev Mongo | Mac mini MongoDB, real persistence |
| Credentials | placeholders in `.env.example` only | Omair's real secrets, never shared |
| Integrations | `INTEGRATIONS_DRIVER=mock` | `live` after code review |
| AI | `AI_PROVIDER=mock` | Omair's chosen provider + key |
| Delivery | mock adapters, everything SIMULATED | real SMTP/WhatsApp when Omair enables |

## 7. Go-live checklist

1. Code review gate complete (`docs/code-review-gate.md` signed).
2. Mongo up with TLS + least-privilege users; backup job ran once successfully.
3. Backend running under launchd, reachable only via Tailscale.
4. Frontend served, CORS locked to the real origin.
5. Consent copy replaced with client-approved legal text (Section 9).
6. Omair creates the first real (non-mock) user accounts via `/api/admin`.
7. Overseas pilot staff onboard first (Section 11 rollout order).