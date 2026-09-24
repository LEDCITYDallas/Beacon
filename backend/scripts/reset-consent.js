require("dotenv").config();
process.env.MONGO_URI = "mongodb://127.0.0.1:49254/";
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");

async function run() {
  await connectDB();

  try {
    const result = await User.updateOne(
      { email: "bilal@mock.ledcity.test" },
      { $set: { consentAccepted: false, consentAcceptedAt: null } }
    );

    if (result.matchedCount === 0) {
      throw new Error("Bilal user was not found");
    }

    console.log(
      `[reset-consent] updated Bilal: matched=${result.matchedCount}, modified=${result.modifiedCount}`
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("[reset-consent] failed:", err.message);
  process.exit(1);
});
