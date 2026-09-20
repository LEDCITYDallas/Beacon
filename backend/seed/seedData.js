// Reusable seed function - no connectDB() call and no process.exit() here,
// so it can be called both by the CLI seed script (seedMockData.js) and
// by the in-memory dev server (scripts/dev-memory.js).
//
// Section 10.2: everything below is fictional mock data - no real LED
// City employee, customer, or business data.
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Task = require("../models/Task");

async function seedMockData() {
  await User.deleteMany({});
  await Task.deleteMany({});

  const passwordHash = await bcrypt.hash("MockPass123!", 10);

  const [superAdmin, manager, empOverseas, empDallas, empReduced] = await User.create([
    {
      name: "Omair (Mock Super Admin)",
      email: "omair@mock.ledcity.test",
      passwordHash,
      role: "SUPER_ADMIN",
      department: "Executive",
      timezone: "America/Chicago",
      whatsappNumber: "+15550000001",
      notifyEmail: "omair@mock.ledcity.test",
      consentAccepted: true,
      consentAcceptedAt: new Date(),
    },
    {
      name: "Sana Manager (Mock)",
      email: "sana.manager@mock.ledcity.test",
      passwordHash,
      role: "MANAGER",
      department: "Overseas Ops",
      timezone: "Asia/Karachi",
      whatsappNumber: "+15550000002",
      notifyEmail: "sana.manager@mock.ledcity.test",
      consentAccepted: true,
      consentAcceptedAt: new Date(),
    },
    {
      name: "Bilal Overseas (Mock)",
      email: "bilal@mock.ledcity.test",
      passwordHash,
      role: "EMPLOYEE",
      department: "Overseas Ops",
      timezone: "Asia/Karachi",
      whatsappNumber: "+15550000003",
      // Starts unconsented so the Section 9 consent gate is demonstrable.
      consentAccepted: false,
    },
    {
      name: "Maria Dallas (Mock)",
      email: "maria@mock.ledcity.test",
      passwordHash,
      role: "EMPLOYEE",
      department: "Showroom",
      timezone: "America/Chicago",
      whatsappNumber: "+15550000004",
      consentAccepted: true,
      consentAcceptedAt: new Date(),
    },
    {
      name: "Yusuf Finance (Mock, reduced monitoring)",
      email: "yusuf@mock.ledcity.test",
      passwordHash,
      role: "EMPLOYEE",
      department: "Finance",
      reducedMonitoring: true,
      timezone: "Asia/Karachi",
      whatsappNumber: "+15550000005",
      consentAccepted: true,
      consentAcceptedAt: new Date(),
    },
  ]);

  const taskA = await Task.create({
    title: "Draft Q3 client proposal (mock deal #1042)",
    description: "Mock CRM deal - draft pricing proposal for a fictional signage order.",
    definitionOfDone: "Proposal PDF uploaded to mock WorkDrive folder, status set to Sent",
    // Explicit link so the Zoho CRM signal matches exactly instead of by guess.
    externalRefs: [{ source: "ZOHO_CRM", externalId: "1042" }],
    priority: "HIGH",
    estimatedHours: 4,
    dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
    department: "Overseas Ops",
    assignedTo: empOverseas._id,
    createdBy: manager._id,
    status: "READY",
    timeline: [{ event: "CREATED", actor: manager._id, meta: {} }],
  });

  const taskB = await Task.create({
    title: "Schedule install crew (depends on proposal sign-off)",
    description: "Mock task - book crew once the proposal above is accepted.",
    definitionOfDone: "Crew booked in mock calendar, confirmation sent",
    priority: "MEDIUM",
    estimatedHours: 1.5,
    dueDate: new Date(Date.now() + 5 * 24 * 3600 * 1000),
    department: "Overseas Ops",
    assignedTo: empOverseas._id,
    createdBy: manager._id,
    dependsOn: [taskA._id],
    status: "BLOCKED",
    timeline: [{ event: "CREATED", actor: manager._id, meta: {} }],
  });

  const taskC = await Task.create({
    title: "Reconcile mock invoice batch",
    description: "Mock Zoho Books batch reconciliation.",
    definitionOfDone: "All mock invoices in batch marked reconciled in Zoho Books",
    externalRefs: [{ source: "ZOHO_BOOKS", externalId: "BATCH-7" }],
    priority: "MEDIUM",
    estimatedHours: 2,
    dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
    department: "Finance",
    assignedTo: empReduced._id,
    createdBy: superAdmin._id,
    status: "READY",
    timeline: [{ event: "CREATED", actor: superAdmin._id, meta: {} }],
  });

  const taskD = await Task.create({
    title: "Update showroom display sign-out sheet",
    description: "Mock showroom housekeeping task.",
    definitionOfDone: "Sheet reflects current display inventory",
    externalRefs: [{ source: "WEBSITE_CMS", externalId: "page-77" }],
    priority: "LOW",
    estimatedHours: 1,
    dueDate: new Date(Date.now() + 1 * 24 * 3600 * 1000),
    department: "Showroom",
    assignedTo: empDallas._id,
    createdBy: manager._id,
    status: "READY",
    timeline: [{ event: "CREATED", actor: manager._id, meta: {} }],
  });

  console.log("[seed] done. Mock users (password for all: MockPass123!):");
  [superAdmin, manager, empOverseas, empDallas, empReduced].forEach((u) =>
    console.log(`  - ${u.role.padEnd(11)} ${u.email}`)
  );
  console.log(
    `[seed] created tasks: ${taskA.title} / ${taskB.title} (blocked on it) / ${taskC.title} / ${taskD.title}`
  );
}

module.exports = seedMockData;
