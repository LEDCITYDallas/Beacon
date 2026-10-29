const mongoose = require("mongoose");
const { redactSecrets, describeMongoTarget } = require("../utils/redact");

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set. Copy .env.example to .env first.");
  }

  try {
    await mongoose.connect(uri);
    console.log(`[db] connected -> ${describeMongoTarget(uri)}`);
  } catch (err) {
    throw new Error(`Database connection failed: ${redactSecrets(err.message)}`);
  }
}

module.exports = connectDB;
