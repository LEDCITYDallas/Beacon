// End-to-end smoke test for the Phase 1+2 API.
//
// By default this boots its own in-memory API on a free port. It does not
// talk to whatever is already listening on :5000, and it does not use a
// shared database. Set SMOKE_BASE_URL only when you intentionally want to
// hit a specific server.
//
//   node scripts/smoke-test.js
//
// Exits 0 when every check passes, 1 otherwise. The isolated server is
// discarded when the process exits.
//
// Mock logins used here are seeded by seedData.js (Section 10.2 - mock data
// only, no real employee data).

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

let BASE = process.env.SMOKE_BASE_URL || "";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`);

  // ------------------------------------------------------------------
  // 1. Health & auth basics
  // ------------------------------------------------------------------
  console.log("[health & auth]");
  const health = await api("GET", "/health");
  check(
    "health endpoint responds without provider or mock-mode details",
    health.status === 200 &&
      health.data &&
      health.data.status === "ok" &&
      health.data.service === "led-city-workforce-backend" &&
      !Object.prototype.hasOwnProperty.call(health.data, "aiProvider") &&
      !Object.prototype.hasOwnProperty.call(health.data, "mockMode"),
    `got ${health.status}`
  );

  const anon = await api("GET", "/tasks");
  check("tasks without token -> 401", anon.status === 401, `got ${anon.status}`);

  const bilalLogin = await api("POST", "/auth/login", {
    body: { email: "bilal@mock.ledcity.test", password: "MockPass123!" },
  });
  check("bilal login ok", bilalLogin.status === 200 && bilalLogin.data.token);
  const bilal = bilalLogin.data;
  const bilalToken = bilal.token;

  const sanaLogin = await api("POST", "/auth/login", {
    body: { email: "sana.manager@mock.ledcity.test", password: "MockPass123!" },
  });
  const sana = sanaLogin.data;
  const sanaToken = sana.token;
  check("sana (manager) login ok", sanaLogin.status === 200);

  const omairLogin = await api("POST", "/auth/login", {
    body: { email: "omair@mock.ledcity.test", password: "MockPass123!" },
  });
  const omairToken = omairLogin.data.token;
  check("omair (super admin) login ok", omairLogin.status === 200);

  // Live-view SSE must not accept a JWT from the query string. A missing
  // session id that is still a valid ObjectId proves the header passed auth
  // and reached the controller (404), instead of being rejected as anonymous.
  const queryStream = await fetch(
    `${BASE}/liveview/sessions/000000000000000000000000/stream?token=${encodeURIComponent(omairToken)}`
  );
  check(
    "live-view stream rejects query-string token",
    queryStream.status === 401,
    `got ${queryStream.status}`
  );
  const headerStream = await api(
    "GET",
    "/liveview/sessions/000000000000000000000000/stream",
    { token: omairToken }
  );
  check(
    "live-view stream accepts Authorization header",
    headerStream.status === 404,
    `got ${headerStream.status}`
  );

  const mariaLogin = await api("POST", "/auth/login", {
    body: { email: "maria@mock.ledcity.test", password: "MockPass123!" },
  });
  const mariaToken = mariaLogin.data.token;
  const mariaId = mariaLogin.data.user.id;
  check("maria (employee) login ok", mariaLogin.status === 200);

  const badLogin = await api("POST", "/auth/login", {
    body: { email: "bilal@mock.ledcity.test", password: "wrong" },
  });
  check("wrong password -> 401", badLogin.status === 401);

  // ------------------------------------------------------------------
  // 2. Consent gate (Section 9 - hard requirement, not policy text)
  // ------------------------------------------------------------------
  console.log("\n[consent gate]");
  const preConsent = await api("GET", "/tasks/my-queue", { token: bilalToken });
  check(
    "unconsented user blocked from API",
    preConsent.status === 403 && preConsent.data.code === "CONSENT_REQUIRED",
    `got ${preConsent.status}`
  );
  const consentBypass = await api("GET", "/tasks/my-queue?next=/consent", { token: bilalToken });
  check(
    "consent gate ignores a /consent query string",
    consentBypass.status === 403 && consentBypass.data.code === "CONSENT_REQUIRED",
    `got ${consentBypass.status}`
  );
  const meBefore = await api("GET", "/auth/me", { token: bilalToken });
  check(
    "unconsented user can restore their own session",
    meBefore.status === 200 &&
      meBefore.data.user &&
      meBefore.data.user.consentAccepted === false &&
      !meBefore.data.user.passwordHash,
    `got ${meBefore.status}`
  );
  const notice = await api("GET", "/auth/consent", { token: bilalToken });
  const noticeText = JSON.stringify(notice.data || {});
  check(
    "consent notice is an unapproved draft",
    notice.status === 200 &&
      notice.data.legallyApproved === false &&
      notice.data.version === "draft-2026-10-26" &&
      noticeText.includes("not been approved") &&
      noticeText.includes("No retention period has been approved"),
    `got ${notice.status}`
  );
  const accept = await api("POST", "/auth/consent", { token: bilalToken });
  check(
    "consent acceptance records the draft version",
    accept.status === 200 &&
      accept.data.legallyApproved === false &&
      accept.data.consentVersion === notice.data.version &&
      accept.data.user &&
      accept.data.user.consentCurrent === true,
    `got ${accept.status}`
  );
  const postConsent = await api("GET", "/tasks/my-queue", { token: bilalToken });
  check("consented user can use the API", postConsent.status === 200);
  const withdrawn = await api("POST", "/auth/consent/withdraw", { token: bilalToken });
  const afterWithdraw = await api("GET", "/tasks/my-queue", { token: bilalToken });
  check(
    "withdrawing consent blocks the API and does not claim records were deleted",
    withdrawn.status === 200 &&
      withdrawn.data.user.consentCurrent === false &&
      withdrawn.data.message.includes("not deleted") &&
      afterWithdraw.status === 403 &&
      afterWithdraw.data.code === "CONSENT_REQUIRED",
    `withdraw ${withdrawn.status} next ${afterWithdraw.status}`
  );
  const acceptAgain = await api("POST", "/auth/consent", { token: bilalToken });
  check("consent can be accepted again after withdrawal", acceptAgain.status === 200);

  const me = await api("GET", "/auth/me", { token: bilalToken });
  check(
    "/me never leaks passwordHash",
    me.status === 200 && !JSON.stringify(me.data).includes("passwordHash")
  );

  // ------------------------------------------------------------------
  // 3. Employee scoping (Section 3: employee sees own tasks only)
  // ------------------------------------------------------------------
  console.log("\n[employee scoping]");
  const bilalList = await api("GET", "/tasks", { token: bilalToken });
  const seenAssignees = new Set(
    (bilalList.data || []).map((t) =>
      typeof t.assignedTo === "object" ? t.assignedTo._id : t.assignedTo
    )
  );
  check(
    "employee list contains only own tasks",
    bilalList.status === 200 &&
      bilalList.data.length > 0 &&
      seenAssignees.size === 1 &&
      seenAssignees.has(bilal.user.id),
    `assignees: ${[...seenAssignees].join(",")}`
  );

  // Fetch a task that belongs to maria (showroom employee).
  const adminList = await api("GET", "/tasks", { token: omairToken });
  const mariaTask = (adminList.data || []).find((t) =>
    t.title.includes("showroom display")
  );
  check("found maria's mock task", Boolean(mariaTask));

  // ------------------------------------------------------------------
  // 4. Task-level access control (Section 3)
  // ------------------------------------------------------------------
  console.log("\n[task access control]");
  const crossView = await api("GET", `/tasks/${mariaTask._id}`, { token: bilalToken });
  check(
    "employee cannot view another employee's task",
    crossView.status === 403,
    `got ${crossView.status}`
  );

  const bilalStartMaria = await api("POST", `/tasks/${mariaTask._id}/start`, {
    token: bilalToken,
    body: {},
  });
  check(
    "employee cannot start another employee's task",
    bilalStartMaria.status === 403,
    `got ${bilalStartMaria.status}`
  );

  const badId = await api("GET", "/tasks/notanobjectid", { token: bilalToken });
  check("invalid ObjectId -> 400 (not 500)", badId.status === 400, `got ${badId.status}`);

  // ------------------------------------------------------------------
  // 5. Create-task rules & validation
  // ------------------------------------------------------------------
  console.log("\n[create task]");
  const future = new Date(Date.now() + 30 * 86400e3).toISOString();

  const empCreate = await api("POST", "/tasks", {
    token: bilalToken,
    body: {
      title: "x", definitionOfDone: "x", estimatedHours: 1,
      dueDate: future, assignedTo: bilal.user.id,
    },
  });
  check("employee cannot create tasks", empCreate.status === 403, `got ${empCreate.status}`);

  const zeroEst = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "zero estimate", definitionOfDone: "x", estimatedHours: 0,
      dueDate: future, assignedTo: bilal.user.id,
    },
  });
  check("estimatedHours must be > 0", zeroEst.status === 400, `got ${zeroEst.status}`);

  const badDep = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "bad dep", definitionOfDone: "x", estimatedHours: 1,
      dueDate: future, assignedTo: bilal.user.id, dependsOn: ["notanobjectid"],
    },
  });
  check("invalid dependsOn id -> 400", badDep.status === 400, `got ${badDep.status}`);

  const ghostAssignee = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "ghost", definitionOfDone: "x", estimatedHours: 1,
      dueDate: future, assignedTo: "507f1f77bcf86cd799439011",
    },
  });
  check("nonexistent assignee -> 400", ghostAssignee.status === 400, `got ${ghostAssignee.status}`);

  const crossDept = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "cross dept", definitionOfDone: "x", estimatedHours: 1,
      dueDate: future, assignedTo: mariaId,
    },
  });
  check(
    "manager cannot assign outside own department",
    crossDept.status === 400 || crossDept.status === 403,
    `got ${crossDept.status}`
  );

  // Three same-department tasks with equal due dates, different priorities.
  const prioSpecs = [
    ["LOW", "prio-low"],
    ["MEDIUM", "prio-medium"],
    ["HIGH", "prio-high"],
  ];
  const prioIds = {};
  for (const [prio, key] of prioSpecs) {
    const r = await api("POST", "/tasks", {
      token: sanaToken,
      body: {
        title: `Priority probe ${key}`,
        definitionOfDone: "probe",
        estimatedHours: 1,
        dueDate: future,
        assignedTo: bilal.user.id,
        priority: prio,
      },
    });
    check(`manager creates ${prio} task`, r.status === 201, `got ${r.status}`);
    prioIds[key] = r.data._id;
  }

  // ------------------------------------------------------------------
  // 6. Priority ordering (Section 4 - next-up must respect priority)
  // ------------------------------------------------------------------
  console.log("\n[priority ordering]");
  const q = await api("GET", "/tasks/my-queue", { token: bilalToken });
  const order = q.data.nextUp.map((t) => t._id);
  const posOf = (id) => order.indexOf(id);
  const highFirst =
    posOf(prioIds["prio-high"]) !== -1 &&
    posOf(prioIds["prio-high"]) < posOf(prioIds["prio-medium"]) &&
    posOf(prioIds["prio-medium"]) < posOf(prioIds["prio-low"]);
  check(
    "next-up ordered HIGH before MEDIUM before LOW",
    highFirst,
    `positions: high=${posOf(prioIds["prio-high"])} med=${posOf(prioIds["prio-medium"])} low=${posOf(prioIds["prio-low"])}`
  );

  // ------------------------------------------------------------------
  // 7. Timer: start / double-start / pause / overrun (Section 4)
  // ------------------------------------------------------------------
  console.log("\n[timer & overrun]");
  const t1 = await api("POST", `/tasks/${prioIds["prio-high"]}/start`, { token: bilalToken });
  check("assignee starts timer", t1.status === 200 && t1.data.task.status === "IN_PROGRESS");

  const t2 = await api("POST", `/tasks/${prioIds["prio-high"]}/start`, { token: bilalToken });
  check("double start rejected", t2.status === 400, `got ${t2.status}`);

  const pause1 = await api("POST", `/tasks/${prioIds["prio-high"]}/pause`, { token: bilalToken });
  check("pause works", pause1.status === 200 && pause1.data.task.status === "PAUSED");
  check(
    "pause response reports accrued seconds",
    typeof pause1.data.actualSeconds === "number" && pause1.data.actualSeconds >= 0,
    JSON.stringify(pause1.data.actualSeconds)
  );

  // Overrun: tiny estimate, brief run, then pause -> OVERRUN_ALERT logged.
  const ov = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "Overrun probe",
      definitionOfDone: "probe",
      estimatedHours: 0.0005, // ~1.8 seconds
      dueDate: future,
      assignedTo: bilal.user.id,
    },
  });
  await api("POST", `/tasks/${ov.data._id}/start`, { token: bilalToken });
  await sleep(2500);
  const ovPause = await api("POST", `/tasks/${ov.data._id}/pause`, { token: bilalToken });
  const ovEvents = (ovPause.data.task.timeline || []).map((e) => e.event);
  check(
    "overrun alert fires past 120% of estimate",
    ovEvents.includes("OVERRUN_ALERT"),
    `events: ${ovEvents.join(",")}`
  );

  // ------------------------------------------------------------------
  // 8. Blocked - why (Section 4 - two reasons only, aggregate-tracked)
  // ------------------------------------------------------------------
  console.log("\n[blocked-why]");
  const badBlock = await api("POST", `/tasks/${prioIds["prio-low"]}/block`, {
    token: bilalToken,
    body: { type: "SOMETHING_ELSE" },
  });
  check("invalid blocked type rejected", badBlock.status === 400, `got ${badBlock.status}`);

  const block = await api("POST", `/tasks/${prioIds["prio-low"]}/block`, {
    token: bilalToken,
    body: { type: "NOT_CONFIDENT", note: "unsure which mock vendor list applies" },
  });
  check(
    "block with valid reason works",
    block.status === 200 &&
      block.data.status === "BLOCKED" &&
      block.data.blockedReason.type === "NOT_CONFIDENT"
  );

  // ------------------------------------------------------------------
  // 9. Dependency map: completion flips dependents (Section 4)
  // ------------------------------------------------------------------
  console.log("\n[dependency unblock]");
  // Seeded: taskA (proposal) -> taskB (crew) blocked on it, both bilal's.
  const bilalTasks = (await api("GET", "/tasks", { token: bilalToken })).data;
  const taskA = bilalTasks.find((t) => t.title.includes("Q3 client proposal"));
  const taskB = bilalTasks.find((t) => t.title.includes("Schedule install crew"));
  check("seeded dependency pair found", Boolean(taskA && taskB));

  const completeA = await api("POST", `/tasks/${taskA._id}/complete`, { token: bilalToken });
  check(
    "manual completion works",
    completeA.status === 200 && completeA.data.status === "COMPLETED"
  );

  const recomplete = await api("POST", `/tasks/${taskA._id}/complete`, { token: bilalToken });
  check(
    "re-completing a completed task rejected",
    recomplete.status === 400,
    `got ${recomplete.status}`
  );

  const restate = await api("POST", `/tasks/${taskA._id}/start`, { token: bilalToken });
  check("restarting a completed task rejected", restate.status === 400, `got ${restate.status}`);

  const bAfter = await api("GET", `/tasks/${taskB._id}`, { token: bilalToken });
  const bEvents = (bAfter.data.timeline || []).map((e) => e.event);
  check(
    "dependent task auto-flipped to READY",
    bAfter.data.status === "READY" && bEvents.includes("UNBLOCKED"),
    `status=${bAfter.data.status} events=${bEvents.join(",")}`
  );

  // ------------------------------------------------------------------
  // 10. Human-in-the-loop completion (Section 4: nothing closes silently)
  // ------------------------------------------------------------------
  console.log("\n[human-in-the-loop completion]");
  const empPropose = await api(
    "POST",
    `/tasks/${prioIds["prio-medium"]}/propose-completion`,
    { token: bilalToken, body: { detectedSignal: "mock CRM: deal Won" } }
  );
  check(
    "employee cannot propose system completion",
    empPropose.status === 403,
    `got ${empPropose.status}`
  );

  const mgrPropose = await api(
    "POST",
    `/tasks/${prioIds["prio-medium"]}/propose-completion`,
    { token: sanaToken, body: { detectedSignal: "mock CRM: deal Won" } }
  );
  check(
    "manager proposes completion",
    mgrPropose.status === 200 && mgrPropose.data.pendingCompletionProposal.isPending
  );

  const empConfirm = await api(
    "POST",
    `/tasks/${prioIds["prio-medium"]}/confirm-completion`,
    { token: bilalToken }
  );
  check(
    "assignee confirms proposal (human in the loop)",
    empConfirm.status === 200 &&
      empConfirm.data.status === "COMPLETED" &&
      empConfirm.data.completionSource === "SYSTEM_DETECTED"
  );

  const noProposal = await api(
    "POST",
    `/tasks/${prioIds["prio-low"]}/confirm-completion`,
    { token: bilalToken }
  );
  check(
    "confirm without pending proposal -> 400",
    noProposal.status === 400,
    `got ${noProposal.status}`
  );

  // Reject path: super admin proposes on maria's task, maria rejects it.
  const adminPropose = await api("POST", `/tasks/${mariaTask._id}/propose-completion`, {
    token: omairToken,
    body: { detectedSignal: "mock CMS: sheet published" },
  });
  check("super admin can propose on any task", adminPropose.status === 200);
  const mariaReject = await api(
    "POST",
    `/tasks/${mariaTask._id}/reject-completion`,
    { token: mariaToken }
  );
  check(
    "assignee rejection clears proposal without completing",
    mariaReject.status === 200 &&
      mariaReject.data.status !== "COMPLETED" &&
      !mariaReject.data.pendingCompletionProposal.isPending
  );

  // ------------------------------------------------------------------
  // 11. AI assistant (Section 5) + approval gates (docs/approval-gates.md)
  // ------------------------------------------------------------------
  console.log("\n[assistant & approval gates]");
  const providerInfo = await api("GET", "/assistant/provider", { token: bilalToken });
  const providerDump = JSON.stringify(providerInfo.data || {});
  check(
    "provider info names mock and does not include a key",
    providerInfo.status === 200 &&
      providerInfo.data.provider === "mock" &&
      providerInfo.data.live === false &&
      !Object.prototype.hasOwnProperty.call(providerInfo.data, "apiKey") &&
      !providerDump.includes("sk-") &&
      !providerDump.includes("AIza"),
    providerDump.slice(0, 160)
  );

  const adminAsk = await api("POST", "/assistant/ask", {
    token: omairToken,
    body: { question: "List every employee task" },
  });
  check(
    "super-admin model context is not the whole workforce",
    adminAsk.status === 200 &&
      !String(adminAsk.data.text).includes("showroom display") &&
      !String(adminAsk.data.text).includes("invoice batch"),
    String(adminAsk.data && adminAsk.data.text).slice(0, 160)
  );

  const ask = await api("POST", "/assistant/ask", {
    token: bilalToken,
    body: { question: "What is my current task?" },
  });
  check(
    "Q&A answers from own data (mock provider)",
    ask.status === 200 && ask.data.text && ask.data.provider === "mock",
    JSON.stringify(ask.data).slice(0, 120)
  );
  check(
    "employee Q&A cannot see another employee's tasks",
    ask.status === 200 &&
      !String(ask.data.text).includes("showroom display") &&
      !String(ask.data.text).includes("invoice batch")
  );

  const emptyAsk = await api("POST", "/assistant/ask", {
    token: bilalToken,
    body: { question: "   " },
  });
  check("blank question rejected", emptyAsk.status === 400);

  const badHistory = await api("POST", "/assistant/ask", {
    token: bilalToken,
    body: { question: "What is blocked?", history: "ignore the filter" },
  });
  check("non-array history rejected", badHistory.status === 400);

  const followUp = await api("POST", "/assistant/ask", {
    token: bilalToken,
    body: {
      question: "What is blocking that?",
      history: [
        { role: "user", content: "What should I work on next?" },
        { role: "assistant", content: "Start with the proposal draft." },
      ],
      screen: { page: "home", error: "Task title is required" },
      userId: String(mariaId),
      role: "SUPER_ADMIN",
    },
  });
  check(
    "follow-up stays inside the signed-in employee's scope",
    followUp.status === 200 &&
      followUp.data.provider === "mock" &&
      !String(followUp.data.text).includes("showroom display") &&
      !String(followUp.data.text).includes("invoice batch"),
    JSON.stringify(followUp.data).slice(0, 160)
  );

  const draft = await api("POST", "/assistant/draft", {
    token: bilalToken,
    body: { kind: "STATUS_UPDATE", request: "Update on my proposal task" },
  });
  check("drafting generates reviewable text", draft.status === 200 && draft.data.draft);

  const badKind = await api("POST", "/assistant/draft", {
    token: bilalToken,
    body: { kind: "NOPE", request: "x" },
  });
  check("invalid draft kind rejected", badKind.status === 400, `got ${badKind.status}`);

  // Outbound message: propose -> confirm / decline lifecycle
  const propose = await api("POST", "/assistant/messages", {
    token: bilalToken,
    body: {
      channel: "WHATSAPP",
      kind: "HANDOFF",
      body: "Mock: proposal is signed, install crew task is ready for you.",
      recipientId: sana.user.id, // same department (Overseas Ops) - cross-dept
      // addressing is correctly rejected elsewhere in this file.
    },
  });
  check("handoff proposal created as PENDING", propose.status === 201 && propose.data.status === "PENDING");

  const listProposals = await api("GET", "/assistant/messages", { token: bilalToken });
  check(
    "proposal queue lists own pending items",
    listProposals.status === 200 &&
      listProposals.data.some((p) => p._id === propose.data._id)
  );

  const confirm = await api("POST", `/assistant/messages/${propose.data._id}/confirm`, {
    token: bilalToken,
  });
  check("creator confirms -> SENT", confirm.status === 200 && confirm.data.status === "SENT");

  const reconfirm = await api("POST", `/assistant/messages/${propose.data._id}/confirm`, {
    token: bilalToken,
  });
  check("double confirm rejected", reconfirm.status === 400, `got ${reconfirm.status}`);

  const propose2 = await api("POST", "/assistant/messages", {
    token: bilalToken,
    body: { channel: "EMAIL", kind: "DRAFT_MESSAGE", body: "Mock draft message" },
  });
  const foreignDecline = await api(
    "POST",
    `/assistant/messages/${propose2.data._id}/decline`,
    { token: sanaToken }
  );
  check(
    "non-creator cannot decline someone's proposal",
    foreignDecline.status === 403,
    `got ${foreignDecline.status}`
  );

  const decline = await api("POST", `/assistant/messages/${propose2.data._id}/decline`, {
    token: bilalToken,
  });
  check("creator declines -> DECLINED, nothing sent", decline.status === 200 && decline.data.status === "DECLINED");

  // ------------------------------------------------------------------
  // 12. Proactive handoff auto-trigger (Section 5.2 + approval-gates row 5)
  // ------------------------------------------------------------------
  console.log("\n[auto handoff proposals]");
  // Section 9 completed taskA, which unblocked taskB -> a PENDING HANDOFF
  // proposal for taskB should already exist, created by the completer.
  const autoList = await api("GET", "/assistant/messages", { token: bilalToken });
  const autoProposal = autoList.data.find(
    (p) => p.kind === "HANDOFF" && p.status === "PENDING" &&
      p.relatedTask === taskB._id
  );
  check(
    "unblock auto-creates a PENDING handoff proposal",
    Boolean(autoProposal) && autoProposal.body.includes(taskB.title.slice(0, 12)),
    autoProposal ? "body mismatch" : "no matching proposal"
  );

  const autoConfirm = await api(
    "POST",
    `/assistant/messages/${autoProposal._id}/confirm`,
    { token: bilalToken }
  );
  check(
    "completer confirms the auto handoff -> SENT",
    autoConfirm.status === 200 && autoConfirm.data.status === "SENT"
  );

  // Manager approval path: sana creates a fresh dependency pair for bilal,
  // bilal completes upstream, then sana (same-department manager) confirms
  // the auto-created proposal.
  const up = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "Handoff chain upstream",
      definitionOfDone: "probe",
      estimatedHours: 1,
      dueDate: future,
      assignedTo: bilal.user.id,
    },
  });
  const down = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "Handoff chain downstream",
      definitionOfDone: "probe",
      estimatedHours: 1,
      dueDate: future,
      assignedTo: bilal.user.id,
      dependsOn: [up.data._id],
    },
  });
  check(
    "downstream task starts BLOCKED",
    down.status === 201 && down.data.status === "BLOCKED"
  );

  await api("POST", `/tasks/${up.data._id}/complete`, { token: bilalToken });
  const downAfter = await api("GET", `/tasks/${down.data._id}`, { token: sanaToken });
  check("downstream auto-flipped to READY", downAfter.data.status === "READY");

  const chainList = await api("GET", "/assistant/messages", { token: sanaToken });
  const chainProposal = chainList.data.find(
    (p) => p.kind === "HANDOFF" && p.status === "PENDING" &&
      p.relatedTask === down.data._id
  );
  check("manager sees the auto handoff proposal", Boolean(chainProposal));

  const mgrConfirm = await api(
    "POST",
    `/assistant/messages/${chainProposal._id}/confirm`,
    { token: sanaToken }
  );
  check(
    "same-department manager confirms -> SENT",
    mgrConfirm.status === 200 && mgrConfirm.data.status === "SENT",
    `got ${mgrConfirm.status}`
  );

  // A foreign employee (maria, Showroom) must not decide bilal's proposals.
  const chain2Up = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "Handoff chain 2 upstream",
      definitionOfDone: "probe",
      estimatedHours: 1,
      dueDate: future,
      assignedTo: bilal.user.id,
    },
  });
  const chain2Down = await api("POST", "/tasks", {
    token: sanaToken,
    body: {
      title: "Handoff chain 2 downstream",
      definitionOfDone: "probe",
      estimatedHours: 1,
      dueDate: future,
      assignedTo: bilal.user.id,
      dependsOn: [chain2Up.data._id],
    },
  });
  await api("POST", `/tasks/${chain2Up.data._id}/complete`, { token: bilalToken });
  const chain2List = await api("GET", "/assistant/messages", { token: sanaToken });
  const chain2Proposal = chain2List.data.find(
    (p) => p.kind === "HANDOFF" && p.status === "PENDING" &&
      p.relatedTask === chain2Down.data._id
  );
  check("second chain proposal exists", Boolean(chain2Proposal));
  const foreignConfirm = await api(
    "POST",
    `/assistant/messages/${chain2Proposal._id}/decline`,
    { token: mariaToken }
  );
  check(
    "unrelated employee cannot decide someone else's handoff",
    foreignConfirm.status === 403,
    `got ${foreignConfirm.status}`
  );

  // ------------------------------------------------------------------
  // 13. Self-view stats, manager alerts, flag, presence (Sec 3/6/8)
  // ------------------------------------------------------------------
  console.log("\n[self-view, alerts, flags, presence]");

  const week = await api("GET", "/stats/my-week", { token: bilalToken });
  check(
    "self-view week stats (completed > 0, 4-week trend)",
    week.status === 200 &&
      week.data.current.tasksCompleted >= 1 &&
      Array.isArray(week.data.trend) &&
      week.data.trend.length === 3,
    JSON.stringify(week.data.current)
  );
  check(
    "self-view reports hours + on-time inputs",
    typeof week.data.current.hoursLogged === "number" &&
      (week.data.current.onTimePct === null || typeof week.data.current.onTimePct === "number")
  );

  const alertsAsEmp = await api("GET", "/alerts", { token: bilalToken });
  check("alerts blocked for employees", alertsAsEmp.status === 403, `got ${alertsAsEmp.status}`);

  const alerts = await api("GET", "/alerts", { token: sanaToken });
  check(
    "manager sees overdue/blocked lists (dept-scoped)",
    alerts.status === 200 &&
      Array.isArray(alerts.data.overdue) &&
      Array.isArray(alerts.data.blocked) &&
      alerts.data.blocked.some((t) => t.title.includes("prio-low")),
    `overdue=${alerts.data.overdue.length} blocked=${alerts.data.blocked.length}`
  );

  // Flag: manager flags bilal's blocked probe task; employee cannot flag.
  const flaggedTask = alerts.data.blocked.find((t) => t.title.includes("prio-low"));
  const flagByMgr = await api("POST", `/tasks/${flaggedTask._id}/flag`, {
    token: sanaToken,
    body: { flagged: true, note: "needs guidance - knowledge gap" },
  });
  check(
    "manager flags a task (Sec 3)",
    flagByMgr.status === 200 &&
      flagByMgr.data.flagged === true &&
      flagByMgr.data.flagNote.includes("guidance"),
    `got ${flagByMgr.status}`
  );

  const flagByEmp = await api("POST", `/tasks/${flaggedTask._id}/flag`, {
    token: bilalToken,
    body: { flagged: false },
  });
  check("employee cannot flag", flagByEmp.status === 403, `got ${flagByEmp.status}`);

  // Presence (Sec 6): presence-only, idle threshold 15-20 min.
  const hb = await api("POST", "/activity/heartbeat", { token: bilalToken });
  check(
    "heartbeat returns ACTIVE + threshold in 15-20 window",
    hb.status === 200 && hb.data.status === "ACTIVE" &&
      hb.data.idleThresholdMinutes >= 15 && hb.data.idleThresholdMinutes <= 20,
    JSON.stringify(hb.data)
  );

  const status = await api("GET", "/activity/status", { token: bilalToken });
  check("recent heartbeat -> ACTIVE", status.data.status === "ACTIVE");

  // yusuf never heartbeats -> INACTIVE (idle branch, without waiting).
  const yusufLogin = await api("POST", "/auth/login", {
    body: { email: "yusuf@mock.ledcity.test", password: "MockPass123!" },
  });
  const yusufStatus = await api("GET", "/activity/status", {
    token: yusufLogin.data.token,
  });
  check(
    "no heartbeat -> INACTIVE",
    yusufStatus.status === 200 && yusufStatus.data.status === "INACTIVE",
    JSON.stringify(yusufStatus.data)
  );

  // ------------------------------------------------------------------
  // Scorecard, team presence, live-view consent, admin gate
  // ------------------------------------------------------------------
  console.log("\n[scorecard, presence, live view, admin]");

  const teamAnon = await api("GET", "/scorecard/team");
  check("team scorecard without token -> 401", teamAnon.status === 401, `got ${teamAnon.status}`);

  const teamAsEmp = await api("GET", "/scorecard/team", { token: bilalToken });
  check("employee cannot open the team scorecard", teamAsEmp.status === 403, `got ${teamAsEmp.status}`);

  const myCard = await api("GET", "/scorecard/my", { token: bilalToken });
  check(
    "employee can open their own scorecard",
    myCard.status === 200 && myCard.data.week && Array.isArray(myCard.data.trends.weeks),
    `got ${myCard.status}`
  );
  check(
    "employee scorecard stays labelled as a draft",
    myCard.data.week.isLive === false && String(myCard.data.week.banner || "").includes("DRAFT"),
    `live=${myCard.data.week && myCard.data.week.isLive}`
  );

  const teamAsMgr = await api("GET", "/scorecard/team", { token: sanaToken });
  const teamNames = ((teamAsMgr.data && teamAsMgr.data.members) || []).map((m) => m.employee.name);
  check(
    "manager team scorecard stays inside the department",
    teamAsMgr.status === 200 &&
      teamAsMgr.data.department === "Overseas Ops" &&
      teamNames.some((n) => n.includes("Bilal")) &&
      !teamNames.some((n) => n.includes("Maria") || n.includes("Yusuf")),
    `dept=${teamAsMgr.data && teamAsMgr.data.department} names=${teamNames.join(", ")}`
  );
  check(
    "manager team scorecard stays labelled as a draft",
    teamAsMgr.data.isLive === false && String(teamAsMgr.data.banner || "").includes("DRAFT")
  );

  const deptAsMgr = await api("GET", "/scorecard/departments", { token: sanaToken });
  check("manager cannot open the all-department scorecard", deptAsMgr.status === 403, `got ${deptAsMgr.status}`);
  const deptAsAdmin = await api("GET", "/scorecard/departments", { token: omairToken });
  check(
    "super admin department roll-up stays labelled as a draft",
    deptAsAdmin.status === 200 &&
      deptAsAdmin.data.isLive === false &&
      String(deptAsAdmin.data.banner || "").includes("DRAFT"),
    `got ${deptAsAdmin.status}`
  );

  const crossRate = await api("POST", "/scorecard/rate", {
    token: sanaToken,
    body: { employeeId: mariaId, score: 5, note: "should not save" },
  });
  check("manager cannot rate another department", crossRate.status === 403, `got ${crossRate.status}`);

  const ownRate = await api("POST", "/scorecard/rate", {
    token: sanaToken,
    body: { employeeId: bilal.user.id, score: 4, note: "on track" },
  });
  check("manager can rate their own department", ownRate.status === 200 && ownRate.data.score === 4);

  const foreignRatings = await api("GET", `/scorecard/ratings?userId=${mariaId}`, { token: sanaToken });
  check(
    "manager cannot read another department's ratings",
    foreignRatings.status === 403,
    `got ${foreignRatings.status}`
  );

  const weightBlock = await api("PUT", "/scorecard/weights", {
    token: sanaToken,
    body: { isLive: true },
  });
  check("manager cannot publish scorecard weights", weightBlock.status === 403, `got ${weightBlock.status}`);

  const activityOnly = await api("PUT", "/scorecard/weights", {
    token: omairToken,
    body: {
      isLive: false,
      weights: {
        onTimePct: 0,
        managerRating: 0,
        estimateAccuracyPct: 0,
        tasksCompleted: 0,
        reworkPenalty: 0,
        activityIdlePct: 10,
      },
    },
  });
  const activityCard = await api("GET", "/scorecard/my", { token: bilalToken });
  check(
    "activity is not scored when it is the only input",
    activityOnly.status === 200 &&
      activityCard.data.week.score.value === null &&
      activityCard.data.week.score.activityIdleOnly === true &&
      activityCard.data.week.isLive === false,
    `save ${activityOnly.status} score=${activityCard.data.week && activityCard.data.week.score && activityCard.data.week.score.value}`
  );
  const restored = await api("PUT", "/scorecard/weights", {
    token: omairToken,
    body: {
      isLive: false,
      weights: {
        onTimePct: 30,
        managerRating: 25,
        estimateAccuracyPct: 20,
        tasksCompleted: 15,
        reworkPenalty: 10,
        activityIdlePct: 0,
      },
    },
  });
  check("draft weights can be restored", restored.status === 200 && restored.data.isLive === false);

  const presenceAnon = await api("GET", "/activity/team");
  check("team presence without token -> 401", presenceAnon.status === 401, `got ${presenceAnon.status}`);

  const presenceEmp = await api("GET", "/activity/team", { token: bilalToken });
  check("employee cannot list team presence", presenceEmp.status === 403, `got ${presenceEmp.status}`);

  const presenceMgr = await api("GET", "/activity/team", { token: sanaToken });
  check(
    "manager presence list is department-scoped",
    presenceMgr.status === 200 &&
      Array.isArray(presenceMgr.data) &&
      presenceMgr.data.length > 0 &&
      presenceMgr.data.every((p) => p.department === "Overseas Ops"),
    `got ${presenceMgr.status}`
  );

  const empView = await api("POST", "/liveview/sessions", {
    token: bilalToken,
    body: { employeeId: mariaId, reason: "employee probe" },
  });
  check("employee cannot request a live view", empView.status === 403, `got ${empView.status}`);

  const mgrView = await api("POST", "/liveview/sessions", {
    token: sanaToken,
    body: { employeeId: mariaId, reason: "cross-department probe" },
  });
  check("manager cannot request a live view outside policy", mgrView.status === 403, `got ${mgrView.status}`);

  const adminView = await api("POST", "/liveview/sessions", {
    token: omairToken,
    body: { employeeId: mariaId, reason: "audit probe" },
  });
  const requestedId = adminView.data && adminView.data.session && adminView.data.session.id;
  check(
    "super admin live view waits for the employee",
    adminView.status === 201 && adminView.data.session.status === "REQUESTED" && requestedId,
    `got ${adminView.status}`
  );

  const pending = await api("GET", "/liveview/sessions/for-me", { token: mariaToken });
  check(
    "employee sees the pending live-view request",
    pending.status === 200 && pending.data.pending && pending.data.pending.id === requestedId
  );

  const strangerApprove = await api("POST", `/liveview/sessions/${requestedId}/approve`, {
    token: bilalToken,
  });
  check(
    "another employee cannot approve the request",
    strangerApprove.status === 403,
    `got ${strangerApprove.status}`
  );

  const declined = await api("POST", `/liveview/sessions/${requestedId}/deny`, { token: mariaToken });
  check(
    "employee can decline the live view",
    declined.status === 200 && declined.data.session.status === "DENIED"
  );

  const digestEmp = await api("GET", "/digest/weekly", { token: bilalToken });
  check("employee cannot read the Friday digest", digestEmp.status === 403, `got ${digestEmp.status}`);

  const adminEmp = await api("GET", "/admin/system", { token: bilalToken });
  check("employee cannot open admin settings", adminEmp.status === 403, `got ${adminEmp.status}`);

  const directoryEmp = await api("GET", "/users", { token: bilalToken });
  check("employee cannot list the staff directory", directoryEmp.status === 403, `got ${directoryEmp.status}`);

  const empDepts = await api("GET", "/users/departments", { token: bilalToken });
  check("employee cannot list departments", empDepts.status === 403, `got ${empDepts.status}`);

  const mgrDepts = await api("GET", "/users/departments", { token: sanaToken });
  check(
    "manager department list is only their own department",
    mgrDepts.status === 200 &&
      Array.isArray(mgrDepts.data) &&
      mgrDepts.data.length === 1 &&
      mgrDepts.data[0] === "Overseas Ops",
    JSON.stringify(mgrDepts.data)
  );

  const adminDepts = await api("GET", "/users/departments", { token: omairToken });
  check(
    "super admin department list includes every seeded department",
    adminDepts.status === 200 &&
      Array.isArray(adminDepts.data) &&
      ["Executive", "Overseas Ops", "Showroom", "Finance"].every((name) => adminDepts.data.includes(name)),
    JSON.stringify(adminDepts.data)
  );

  // ------------------------------------------------------------------
  // Staff accounts: create, setup link, reset, activation
  // ------------------------------------------------------------------
  console.log("\n[staff accounts]");

  const staffBody = {
    name: "Nora Newhire",
    email: "nora.newhire@mock.ledcity.test",
    role: "EMPLOYEE",
    department: "Showroom",
    timezone: "America/Chicago",
  };
  const created = await api("POST", "/admin/users", { token: omairToken, body: staffBody });
  const setupToken = created.data && created.data.setup && created.data.setup.token;
  const createdUser = created.data && created.data.user;
  check(
    "admin creates an account without returning a password",
    created.status === 201 &&
      createdUser &&
      createdUser.email === staffBody.email &&
      createdUser.consentAccepted === false &&
      !createdUser.passwordHash &&
      !created.data.password &&
      typeof setupToken === "string" &&
      setupToken.length > 20 &&
      created.data.setup.delivery.email === "not_configured",
    `got ${created.status}`
  );

  const duplicate = await api("POST", "/admin/users", { token: omairToken, body: staffBody });
  check("duplicate email rejected", duplicate.status === 409, `got ${duplicate.status}`);

  const badRole = await api("POST", "/admin/users", {
    token: omairToken,
    body: { ...staffBody, email: "role.probe@mock.ledcity.test", role: "OWNER" },
  });
  check("invalid role rejected", badRole.status === 400, `got ${badRole.status}`);

  const badDepartment = await api("POST", "/admin/users", {
    token: omairToken,
    body: { ...staffBody, email: "dept.probe@mock.ledcity.test", department: "   " },
  });
  check("blank department rejected", badDepartment.status === 400, `got ${badDepartment.status}`);

  const employeeCreate = await api("POST", "/admin/users", {
    token: bilalToken,
    body: { ...staffBody, email: "emp.probe@mock.ledcity.test" },
  });
  check("employee cannot create accounts", employeeCreate.status === 403, `got ${employeeCreate.status}`);

  const managerCreate = await api("POST", "/admin/users", {
    token: sanaToken,
    body: { ...staffBody, email: "mgr.probe@mock.ledcity.test" },
  });
  check("manager cannot create accounts", managerCreate.status === 403, `got ${managerCreate.status}`);

  const wrongPurpose = await api("POST", "/auth/reset-password", {
    body: { token: setupToken, password: "NewHirePass9" },
  });
  check("setup token cannot reset a password", wrongPurpose.status === 400, `got ${wrongPurpose.status}`);

  const setup = await api("POST", "/auth/setup", {
    body: { token: setupToken, password: "NewHirePass1" },
  });
  check("setup token sets a password once", setup.status === 200 && !setup.data.token, `got ${setup.status}`);

  const setupReplay = await api("POST", "/auth/setup", {
    body: { token: setupToken, password: "NewHirePass1" },
  });
  check("setup token cannot be reused", setupReplay.status === 400, `got ${setupReplay.status}`);

  const newLogin = await api("POST", "/auth/login", {
    body: { email: staffBody.email, password: "NewHirePass1" },
  });
  check(
    "new account can sign in and still needs consent",
    newLogin.status === 200 && newLogin.data.user.consentAccepted === false,
    `got ${newLogin.status}`
  );

  const forgot = await api("POST", "/auth/forgot-password", { body: { email: staffBody.email } });
  const forgotDump = JSON.stringify(forgot.data || {});
  check(
    "forgot password does not return a token",
    forgot.status === 200 && !forgotDump.toLowerCase().includes("token") && !forgot.data.setup,
    `got ${forgot.status}`
  );

  const resetLink = await api("POST", `/admin/users/${createdUser.id}/access-link`, {
    token: omairToken,
    body: { purpose: "RESET" },
  });
  const resetToken = resetLink.data && resetLink.data.token;
  check(
    "admin can issue a one-time reset link",
    resetLink.status === 200 &&
      typeof resetToken === "string" &&
      resetToken !== setupToken &&
      resetLink.data.delivery.email === "not_configured",
    `got ${resetLink.status}`
  );

  const reset = await api("POST", "/auth/reset-password", {
    body: { token: resetToken, password: "NewHirePass2" },
  });
  check("reset token replaces the password once", reset.status === 200, `got ${reset.status}`);

  const resetReplay = await api("POST", "/auth/reset-password", {
    body: { token: resetToken, password: "NewHirePass3" },
  });
  check("reset token cannot be reused", resetReplay.status === 400, `got ${resetReplay.status}`);

  const oldPassword = await api("POST", "/auth/login", {
    body: { email: staffBody.email, password: "NewHirePass1" },
  });
  check("old password stops working", oldPassword.status === 401, `got ${oldPassword.status}`);

  const replacedLogin = await api("POST", "/auth/login", {
    body: { email: staffBody.email, password: "NewHirePass2" },
  });
  check("new password works", replacedLogin.status === 200, `got ${replacedLogin.status}`);

  const deactivated = await api("PATCH", `/admin/users/${createdUser.id}`, {
    token: omairToken,
    body: { isActive: false },
  });
  check(
    "admin can deactivate an account",
    deactivated.status === 200 && deactivated.data.isActive === false,
    `got ${deactivated.status}`
  );

  const inactiveLogin = await api("POST", "/auth/login", {
    body: { email: staffBody.email, password: "NewHirePass2" },
  });
  check("deactivated account cannot sign in", inactiveLogin.status === 401, `got ${inactiveLogin.status}`);

  const reactivated = await api("PATCH", `/admin/users/${createdUser.id}`, {
    token: omairToken,
    body: { isActive: true, department: "Finance" },
  });
  check(
    "admin can reactivate and edit the department",
    reactivated.status === 200 && reactivated.data.isActive === true && reactivated.data.department === "Finance",
    `got ${reactivated.status}`
  );

  const selfOff = await api("PATCH", `/admin/users/${omairLogin.data.user.id}`, {
    token: omairToken,
    body: { isActive: false },
  });
  check(
    "super admin cannot deactivate their own account",
    selfOff.status === 400 && selfOff.data.code === "SELF_DEACTIVATE",
    `got ${selfOff.status}`
  );

  const staffList = await api("GET", "/admin/users", { token: omairToken });
  const staffDump = JSON.stringify(staffList.data || {});
  check(
    "staff list hides secrets",
    staffList.status === 200 &&
      Array.isArray(staffList.data.users) &&
      staffList.data.users.some((row) => row.email === staffBody.email) &&
      !staffDump.includes("passwordHash") &&
      !staffDump.includes(setupToken) &&
      !staffDump.includes(resetToken),
    `got ${staffList.status}`
  );

  const auditRows = await api("GET", "/admin/audit?limit=40", { token: omairToken });
  const auditDump = JSON.stringify(auditRows.data || {});
  check(
    "audit log does not store access tokens",
    auditRows.status === 200 && !auditDump.includes(setupToken) && !auditDump.includes(resetToken),
    `got ${auditRows.status}`
  );
  check(
    "account create, setup, and reset link are audited",
    auditDump.includes("USER_CREATED") &&
      auditDump.includes("PASSWORD_SET") &&
      auditDump.includes("RESET_LINK_ISSUED"),
    "missing one of USER_CREATED, PASSWORD_SET, RESET_LINK_ISSUED"
  );

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    return 1;
  }
  return 0;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  });
}

async function bootIsolatedServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/dev-memory.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("isolated test server did not become ready"));
    }, 90000);
    const onData = (chunk) => {
      log += chunk.toString();
      if (log.includes("listening on")) {
        clearTimeout(timer);
        resolve();
      }
      if (log.includes("failed to start")) {
        clearTimeout(timer);
        reject(new Error("isolated test server failed to start"));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      if (!log.includes("listening on")) {
        clearTimeout(timer);
        reject(new Error(`isolated test server exited (${code}) before listening`));
      }
    });
  });
  try {
    await ready;
  } catch (err) {
    await stopChild(child);
    throw err;
  }
  const base = `http://127.0.0.1:${port}/api`;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const health = await fetch(`${base}/health`);
      if (health.ok) break;
    } catch {
      /* process is up but not accepting yet */
    }
    await sleep(200);
  }
  return { base, stop: () => stopChild(child) };
}

async function start() {
  let stop = async () => {};
  try {
    if (!BASE) {
      const isolated = await bootIsolatedServer();
      BASE = isolated.base;
      stop = isolated.stop;
    }
    const code = await main();
    await stop();
    process.exit(code);
  } catch (err) {
    console.error("[smoke-test] crashed:", err);
    await stop();
    process.exit(1);
  }
}

start();
