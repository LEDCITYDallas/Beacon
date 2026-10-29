// Working notice shown before someone can use the product.
// VERSION must change whenever the text changes, so an older acceptance
// does not count as acceptance of this text.
// This is a draft. It is not company policy and it is not legal advice.

const VERSION = "draft-2026-10-26";

const sections = [
  {
    heading: "Status of this notice",
    body:
      "This is a working draft of what this system does today. LED City has not approved it as company policy, and it has not been approved by a lawyer. Accepting it records that you read this version. It does not turn the draft into official policy.",
  },
  {
    heading: "Account and work records",
    body:
      "The system stores your name, work email, role, department, and timezone. An administrator may also store a notification email and a WhatsApp number. Those two contact fields are not shown to other employees. A manager can see the name, work email, role, and department of people in the same department. Tasks assigned to you are stored, including the title, description, status, priority, due date, estimate, dependencies, blocked reason and note, and completion notes. Time you start and pause on a task is stored. Manager ratings and short notes about your work are stored. Message drafts stay in the system until someone approves or declines them.",
  },
  {
    heading: "Active and inactive status",
    body:
      "After you accept and use the app, the browser reports how long it has been since the last pointer, keyboard, scroll, or touch input, and whether the tab is visible. The server stores an active or inactive state, a timestamp, and that idle duration. It does not store which keys you pressed, what was on the screen, webcam video, or microphone audio. There is no time-of-day limit in the software: the inactive state follows the idle duration while you are signed in.",
  },
  {
    heading: "Screen viewing",
    body:
      "A screen view starts only when a role the company has allowed asks to see your screen and you allow that request. The default allowed role is super admin. If a manager is later allowed to request a view, the request is limited to that manager's department. Accounts marked for reduced monitoring are left out of screen view while that rule is on. You can decline a request, and you can stop a session after it starts. The view is a live picture only. Audio is not requested. The latest frame is held in server memory for a few seconds and is not written to the database. Screenshot capture cannot be switched on. A session log is kept: who asked, who was viewed, the reason, the start and end, and how many frames were sent. The picture itself is not kept.",
  },
  {
    heading: "Who can see this, and the assistant",
    body:
      "You can see your own tasks, time, presence, and scorecard. A manager can see those records for their own department. A super admin can see every department, manage accounts, and read the audit log. The audit log records administrative actions. It does not store screen pictures or the body of a message. If an AI provider key is configured, a question you ask and the task records you are allowed to see are sent to that provider to produce an answer. This application's usage log stores counts, not the question text. The provider's own logging is outside this application. If no key is configured, the assistant answer is produced on this server. The chat transcript stays in your browser tab.",
  },
  {
    heading: "How long records are kept",
    body:
      "No retention period has been approved. The cleanup job does not delete records until an administrator sets a period, marks that decision approved, and runs the job. Until then, tasks, time logs, activity rows, ratings, session logs, and audit entries remain stored. Access still requires a signed-in account. Managers are limited to their department for tasks, presence, ratings, and the team scorecard.",
  },
  {
    heading: "Decline and withdrawal",
    body:
      "You cannot open tasks, the assistant, the scorecard, or screen view until you accept this version. Decline signs you out and does not grant access. After you accept, Withdraw consent in the sidebar records the withdrawal, signs you out, and blocks the system until you accept again. Withdrawal does not delete tasks, time logs, activity rows, ratings, or the audit entry of your acceptance. An administrator can deactivate an account. Deactivation stops sign-in. It does not by itself delete those records.",
  },
  {
    heading: "Decisions still open",
    body:
      "LED City still has to approve this text, the scorecard weights, whether any score is used for employment decisions, how long records are kept, and which roles may request a screen view. The scorecard number is a draft until that formula is approved. It is not an official performance score.",
  },
];

function document() {
  return {
    version: VERSION,
    legallyApproved: false,
    status: "Draft for review. Not legally approved.",
    title: "How this system uses your work information",
    sections,
  };
}

function current(user) {
  return Boolean(user && user.consentAccepted === true && user.consentVersion === VERSION);
}

module.exports = { VERSION, sections, document, current };
