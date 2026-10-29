// Quick local testing WITHOUT a real MongoDB - no Atlas, no local install,
// no DNS/network dependency. Spins up an in-memory MongoDB instance that
// lives only for as long as this process runs; data resets every restart.
//
// Run with: npm run dev:memory
//
// This is for checking that the app itself works end-to-end. It is NOT
// a substitute for the real dev setup once Atlas/local Mongo is sorted,
// and it is obviously not for production (Section 9 requires
// LED City-controlled infrastructure for real data anyway).
if (process.env.NODE_ENV === "production") {
  console.error(
    "[dev-memory] Refusing to start in-memory storage in production. Use npm start with MONGO_URI."
  );
  process.exit(1);
}

require("dotenv").config();
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../app");
const seedMockData = require("../seed/seedData");

async function main() {
  console.log("[dev-memory] starting in-memory MongoDB (first run downloads a small mongod binary)...");
  const mongod = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  const uri = mongod.getUri();

  await mongoose.connect(uri);
  console.log(`[dev-memory] connected -> ${uri}`);

  await seedMockData();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`[dev-memory] listening on :${PORT}`);
    console.log("[dev-memory] data is IN-MEMORY ONLY - it resets when you stop this process.");
  });

  process.on("SIGINT", async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[dev-memory] failed to start:", err);
  process.exit(1);
});
