// End-to-end smoke test for the Phase 1+2 API.
//
// Prereq: the dev server must be running (npm run dev:memory or npm run dev
// with a seeded Mongo). Run with:
//
//   node scripts/smoke-test.js
//
// Exits 0 when every check passes, 1 otherwise. Safe to run repeatedly on a
// freshly booted dev:memory server (it mutates state, so reseed by restarting
// if you need a clean slate).
//
// Mock logins used here are seeded by seedData.js (Section 10.2 - mock data
// only, no real employee data).

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:5000/api";

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
  check("health endpoint responds", health.status === 200);

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
  const accept = await api("POST", "/auth/consent", { token: bilalToken });
  check("consent acceptance works", accept.status === 200);
  const postConsent = await api("GET", "/tasks/my-queue", { token: bilalToken });
  check("consented user can use the API", postConsent.status === 200);

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
  const ask = await api("POST", "/assistant/ask", {
    token: bilalToken,
    body: { question: "What is my current task?" },
  });
  check(
    "Q&A answers from own data (mock provider)",
    ask.status === 200 && ask.data.text && ask.data.provider === "mock",
    JSON.stringify(ask.data).slice(0, 120)
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
  // Summary
  // ------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke-test] crashed:", err);
  process.exit(1);
});
