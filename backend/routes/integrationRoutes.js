const express = require("express");
const router = express.Router();
const integrationController = require("../controllers/integrationController");
const { requireAuth } = require("../middleware/auth");

// Express 4 does not catch async rejections - wrap keeps the process alive.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(wrap(requireAuth));

// Priority 6: Zoho CRM/Books/Inventory, WorkDrive and the website CMS.
// Managers/administrators only (enforced in the controller).
router.get("/status", wrap(integrationController.getStatus));
router.post("/scan", wrap(integrationController.runScan));
router.get("/signals", wrap(integrationController.listSignals));
router.post("/propose", wrap(integrationController.proposeManually));

module.exports = router;