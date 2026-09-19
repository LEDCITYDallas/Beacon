const connectDB = require("./config/db");
const app = require("./app");

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
});
