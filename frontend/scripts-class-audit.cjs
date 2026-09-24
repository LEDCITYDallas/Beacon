// Temporary audit helper (not part of the app, deleted after the design pass):
// lists className tokens used in src that are not defined in styles/theme.css,
// and theme.css classes that nothing uses.
const fs = require("fs");
const path = require("path");

const roots = ["frontend/src"];
const used = new Set();

function collectFrom(src) {
  const re = /className=/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let end = i;
    if (src[i] === '"') {
      end = src.indexOf('"', i + 1);
      collect(src.slice(i + 1, end));
      continue;
    }
    if (src[i] === "{") {
      depth = 1;
      end = i + 1;
      while (end < src.length && depth > 0) {
        if (src[end] === "{") depth += 1;
        if (src[end] === "}") depth -= 1;
        end += 1;
      }
      const expr = src.slice(i + 1, end - 1);
      for (const q of expr.matchAll(/"([^"]*)"/g)) collect(q[1]);
    }
  }
}

function collect(value) {
  value
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .forEach((c) => used.add(c));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) collectFrom(fs.readFileSync(full, "utf8"));
  }
}

roots.forEach(walk);

const css = fs.readFileSync("frontend/src/styles/theme.css", "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

console.log("USED-BUT-UNDEFINED: " + JSON.stringify([...used].filter((c) => !defined.has(c)).sort()));
console.log("DEFINED-BUT-UNUSED: " + JSON.stringify([...defined].filter((c) => !used.has(c)).sort()));
