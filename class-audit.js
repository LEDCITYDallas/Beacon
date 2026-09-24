// Temp helper (design pass): list CSS classes referenced in frontend/src that
// theme.css does not define, and theme.css classes nothing references.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "frontend", "src");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) files.push(p);
  }
})(root);

const used = new Set();
const noise = /^[a-z][a-z0-9-]*$/;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] || m[2] || m[3] || "";
    for (const tok of raw.split(/[^a-zA-Z0-9_-]+/)) {
      if (noise.test(tok) && !/^(var|const|let|return|true|false|null|undefined|status|active|size)$/.test(tok)) {
        used.add(tok);
      }
    }
  }
}

const cssPath = path.join(root, "styles", "theme.css");
const css = fs.readFileSync(cssPath, "utf8");
const defined = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(m[1]);

const missing = [...used].filter((c) => !defined.has(c)).sort();
const unused = [...defined].filter((c) => !used.has(c)).sort();
console.log("USED_BUT_UNDEFINED (" + missing.length + "): " + missing.join(", "));
console.log("DEFINED_BUT_UNUSED (" + unused.length + "): " + unused.join(", "));
