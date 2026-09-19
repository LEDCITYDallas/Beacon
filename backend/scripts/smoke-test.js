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
