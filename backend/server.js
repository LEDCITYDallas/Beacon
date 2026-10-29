const connectDB = require("./config/db");
const app = require("./app");
const config = require("./config/env");
const { redactSecrets } = require("./utils/redact");

connectDB()
  .then(() => {
    app.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
  })
  .catch((err) => {
    console.error("[startup]", redactSecrets(err && err.message));
    process.exit(1);
  });
