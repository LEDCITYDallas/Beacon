if (process.env.NODE_ENV === "production") {
  console.error("[reset-consent] Refusing to reset consent in production.");
  process.exit(1);
}

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const { redactSecrets } = require("../utils/redact");

async function run() {
  await connectDB();

  try {
    const result = await User.updateOne(
      { email: "bilal@mock.ledcity.test" },
      { $set: { consentAccepted: false, consentAcceptedAt: null, consentVersion: "" } }
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
  console.error("[reset-consent] failed:", redactSecrets(err.message));
  process.exit(1);
});
