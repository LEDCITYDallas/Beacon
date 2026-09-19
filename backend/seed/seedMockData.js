// CLI entrypoint: `npm run seed` - connects to whatever MONGO_URI is in
// .env, wipes it, and loads the mock data. Uses seedData.js so the same
// logic is shared with scripts/dev-memory.js.
require("dotenv").config();
const connectDB = require("../config/db");
const seedMockData = require("./seedData");

async function run() {
  await connectDB();
  await seedMockData();
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
