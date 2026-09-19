// Run this ONCE against a freshly-installed mongod, via the mongosh shell,
// to set up least-privilege users instead of one shared superuser.
//
//   mongosh "mongodb://127.0.0.1:27017" mongo-create-users.js
//
// Generate strong random passwords first, e.g.:
//   openssl rand -base64 32
//
// Replace every REPLACE_ME_* below before running. Never commit the
// real passwords anywhere - store them in whatever secrets manager /
// password manager Omair uses for the production host.

// 1. Cluster admin - used only for maintenance, never by the app itself.
db = db.getSiblingDB("admin");
db.createUser({
  user: "cluster_admin",
  pwd: "REPLACE_ME_STRONG_RANDOM_PASSWORD_1",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase"],
});

// 2. Application user - the ONLY credential that goes in the backend's
// .env (as part of MONGO_URI). Scoped to just this one database, and
// only readWrite - it can't create/drop other databases or manage users.
db = db.getSiblingDB("led-city-workforce-prod");
db.createUser({
  user: "workforce_app",
  pwd: "REPLACE_ME_STRONG_RANDOM_PASSWORD_2",
  roles: [{ role: "readWrite", db: "led-city-workforce-prod" }],
});

// 3. Read-only reporting user - useful later for the Friday digest /
// scorecard jobs (Phase 5) or an external BI tool, without giving those
// processes write access to production data.
db.createUser({
  user: "workforce_readonly",
  pwd: "REPLACE_ME_STRONG_RANDOM_PASSWORD_3",
  roles: [{ role: "read", db: "led-city-workforce-prod" }],
});

print("Users created. Now set security.authorization: enabled in mongod.conf and restart mongod.");
print("The backend's MONGO_URI becomes something like:");
print(
  "mongodb://workforce_app:<password>@127.0.0.1:27017/led-city-workforce-prod?authSource=led-city-workforce-prod"
);
