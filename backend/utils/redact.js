// Strip credentials before anything is written to a log.
function redactSecrets(value) {
  return String(value || "")
    .replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, "mongodb://[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|password|secret|authorization)=([^&\s]+)/gi, "$1=[redacted]");
}

function describeMongoTarget(uri) {
  try {
    const parsed = new URL(uri);
    const db = parsed.pathname.replace(/^\//, "").split("?")[0] || "(no database name)";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.hostname}${port}/${db}`;
  } catch {
    return "(unreadable database target)";
  }
}

module.exports = { redactSecrets, describeMongoTarget };
