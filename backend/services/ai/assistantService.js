const Task = require("../../models/Task");

// ---------------------------------------------------------------------
// Assistant service (Section 5). Every function here receives the
// authenticated user and hard-filters queries by their identity/role -
// the assistant can never see more than the employee can (Section 5:
// "within each employee's own permissions", approval-gates doc rule 7).
// ---------------------------------------------------------------------

// Everything the employee is allowed to see, in compact form for the
// model prompt. Kept small on purpose (cost control + privacy).
async function buildOwnDataContext(user) {
  const filter =
    user.role === "EMPLOYEE"
      ? { assignedTo: user._id }
      : user.role === "MANAGER"
        ? { department: user.department }
        : {}; // SUPER_ADMIN

  const tasks = await Task.find(filter)
    .select("title status priority dueDate estimatedHours blockedReason dependsOn assignedTo")
    .populate("assignedTo", "name")
    .limit(50)
    .lean();

  return tasks
    .map((t) => {
      const who = t.assignedTo && t.assignedTo.name ? t.assignedTo.name : "unassigned";
      const blocked = t.blockedReason && t.blockedReason.type
        ? ` (blocked: ${t.blockedReason.type})`
        : "";
      return `- ${t.title} [${t.status}, ${t.priority}] assignee=${who} due=${t.dueDate}${blocked}`;
    })
    .join("\n");
}

const SYSTEM_QA =
  "You are a co-worker assistant inside LED City's workforce tool. " +
  "Answer ONLY from the task data provided. If the answer is not in the data, " +
  "say you don't know. Never invent task statuses, names, or dates. Be brief.";

const SYSTEM_DRAFT =
  "You are a co-worker assistant inside LED City's workforce tool. " +
  "Draft the requested routine work product (reply, status update, or summary) " +
  "based only on the task data provided. Output the draft text only, ready for " +
  "the employee to review. Never claim the message was sent - you only draft.";

// Q&A: read-only, no approval needed (approval-gates matrix row 1).
async function answerQuestion(user, question) {
  const provider = require("./provider");
  const context = await buildOwnDataContext(user);
  const prompt = `Task data for ${user.name}:\n${context}\n\nQuestion: ${question}`;
  const res = await provider.generate({ kind: "qa", system: SYSTEM_QA, prompt });
  return res;
}

// Drafting: generates text only; nothing is sent or persisted as "sent"
// without the explicit send step (approval-gates matrix rows 2-3).
async function draftWorkProduct(user, kind, request) {
  const provider = require("./provider");
  const context = await buildOwnDataContext(user);
  const prompt = `Task data:\n${context}\n\nDraft request (${kind}): ${request}`;
  const res = await provider.generate({ kind: "draft", system: SYSTEM_DRAFT, prompt });
  return res;
}

module.exports = { answerQuestion, draftWorkProduct, buildOwnDataContext };
