// Temporary design-pass audit (deleted at the end of the pass): every className
// token used in frontend/src compared against the class names defined in
// frontend/src/styles/theme.css.
const fs = require("fs");
const path = require("path");

const used = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
        const text = m[1] || m[2] || m[3] || "";
        text
          .split(/[\s${}?+:()"'|,]+/)
          .filter((t) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t))
          .forEach((t) => used.add(t));
      }
    }
  }
}
walk("frontend/src");

const css = fs.readFileSync("frontend/src/styles/theme.css", "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

const missing = [...used].filter((c) => !defined.has(c)).sort();
fs.writeFileSync(
  "tmp-audit.txt",
  `used=${used.size} defined=${defined.size}\nMISSING:\n${missing.join("\n")}\n`
);
console.log("written");
