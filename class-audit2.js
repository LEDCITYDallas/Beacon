// Temp helper (design pass): report per-file class usage + leftover inline styles.
const fs = require("fs");
const path = require("path");

const targets = [
  "App.tsx",
  "components/Avatar.tsx",
  "components/StatusBadge.tsx",
  "components/TaskTimer.tsx",
  "components/BlockedWhyForm.tsx",
  "components/CompletionProposals.tsx",
  "components/LiveViewPrompt.tsx",
  "pages/Login.tsx",
  "pages/Consent.tsx",
  "pages/EmployeeHome.tsx",
  "pages/Assistant.tsx",
  "pages/ManagerDashboard.tsx",
  "pages/MyScorecard.tsx",
  "pages/TeamScorecard.tsx",
  "pages/LiveView.tsx",
  "pages/AdminSettings.tsx",
];

for (const rel of targets) {
  const p = path.join(__dirname, "frontend", "src", rel);
  if (!fs.existsSync(p)) {
    console.log(rel + " | MISSING");
    continue;
  }
  const src = fs.readFileSync(p, "utf8");
  const classes = new Set();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    for (const tok of (m[1] || m[2] || m[3] || "").split(/\s+/)) if (tok) classes.add(tok);
  }
  const inline = (src.match(/style=\{\{/g) || []).length;
  const dynamic = /className=\{navClass|className=\{`/.test(src) ? " has-dynamic-class" : "";
  console.log(rel + " | inline-styles=" + inline + dynamic);
  console.log("   " + [...classes].sort().join(" "));
}
