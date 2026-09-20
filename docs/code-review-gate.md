# Code Review Gate — Before Any Live OAuth/API Connection

**Status:** Required gate (Section 10.5): "Before any live OAuth connection is
added, the code is reviewed — by Omair and/or a third party — as a required
gate, not optional." This is the checklist that review must complete. Nothing
below goes live until each box is ticked by the reviewer.

---

## 1. Repo & ownership

- [ ] Repo is private, under the LED City Dallas GitHub org (Section 10.1).
- [ ] Full commit history is in the org repo from day one (no personal-repo transfer).
- [ ] Work-for-hire ownership statement signed and filed (Section 10.6).
- [ ] No third-party client code, data or business logic present.

## 2. Secrets & credentials

- [ ] `git log -p` shows no real secret was ever committed (history, not just HEAD).
- [ ] `.env` is git-ignored; `.env.example` contains placeholders only.
- [ ] No API keys, tokens, OAuth secrets or passwords anywhere in source.
- [ ] `grep -r "sk-\|Zoho-oauthtoken\|password.*=.*['\"]" --include="*.js"` clean of real values.
- [ ] Ahmed holds no live production credential, key or token (Section 10.3).

## 3. Mock-data discipline

- [ ] No real employee, customer or business data in seed, fixtures or logs (Section 10.2).
- [ ] All seed records use `*.mock.ledcity.test` style dummy identities.
- [ ] `INTEGRATIONS_DRIVER=mock` and `AI_PROVIDER=mock` are the defaults.

## 4. Approval gates (the core requirement)

- [ ] No code path sets a task to COMPLETED except `confirmCompletion` after explicit human confirmation (`taskController.js`).
- [ ] No code path sends WhatsApp/email except after a PENDING → approved proposal (`assistantController.confirmSend` / `delivery.deliverProposal`).
- [ ] Integration signals only RAISE proposals (`signalScanner.proposeFromSignal`); duplicates are IGNORED idempotently.
- [ ] Every proposal/approval/rejection is written to the task timeline AND the audit log.

## 5. Monitoring hard exclusions

- [ ] No keylogging, no webcam, no facial recognition, no audio capture anywhere (Section 6/9).
- [ ] Screenshots disabled by default; reduced-monitoring roles never receive them.
- [ ] Live-view frames exist only in the 5-second in-memory bus; nothing persisted to disk/DB.
- [ ] Live-view session logs (viewer, employee, start/end, duration) visible to Super Admin only.

## 6. Data residency

- [ ] No hosted DB (Railway/Atlas/third-party) configured anywhere in prod config.
- [ ] Production deploy plan targets the Mac mini/Tailscale only (`docs/mac-mini-deployment.md`).
- [ ] Retention job scope matches `RetentionSettings`; exact duration still a client decision.

## 7. API permission / scope checklist (to be wired by Omair)

| Integration | Required scopes (from `adapters.js`) | Approved? |
| --- | --- | --- |
| Zoho CRM | `ZohoCRM.modules.deals.READ`, `ZohoCRM.modules.tasks.READ` | ☐ |
| Zoho Books | `ZohoBooks.invoices.READ`, `ZohoBooks.expenses.READ` | ☐ |
| Zoho Inventory | `ZohoInventory.salesorders.READ`, `ZohoInventory.items.READ` | ☐ |
| WorkDrive | `WorkDrive.files.READ`, `WorkDrive.folders.READ` | ☐ |
| Website/CMS | `cms.content.read` | ☐ |
| AI provider | per `docs/ai-cost-estimate.md` §recommendation | ☐ |
| SMTP | send-only mailbox account | ☐ |
| WhatsApp provider | send-only; digest + approved handoffs | ☐ |

Rule: **READ-only** scopes for Zoho/WorkDrive/CMS. If any integration needs
write scope, stop and re-review — v1 should only read.

## 8. Audit-log review checklist (monthly)

- [ ] Spot-check 5 live-view sessions: viewer, employee, times, duration, admin-initiated trigger.
- [ ] Confirm every SENT MessageProposal has an approving actor and a matching NotificationLog row.
- [ ] Confirm every INTEGRATION_COMPLETION_PROPOSED has a matching confirm/reject in the task timeline.
- [ ] Confirm no CONSENT-REQUIRED bypass: new users all have consent records with version + timestamp.
- [ ] Review AiUsageLog for abnormal volume (cost control) and unexpected error rates.

## 9. Sign-off

| | Name | Date | Signature |
| --- | --- | --- | --- |
| Reviewer (Omair or third party) | | | |
| Approved for live OAuth wiring | | | |