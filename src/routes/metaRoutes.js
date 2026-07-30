const express = require("express");
const { requireAuth } = require("../middleware/auth");
const industryService = require("../services/industryService");
const { getLevelCatalog, getModuleCatalog } = require("../services/formTemplates");

const router = express.Router();
router.use(requireAuth);

// All industries the platform currently supports (base catalog + any Superadmin has added).
router.get("/industries", async (req, res) => {
  const industries = await industryService.getAllIndustries();
  res.json({ industries });
});

router.get("/levels", (req, res) => {
  res.json({ levels: getLevelCatalog() });
});

router.get("/assessment-modules", (req, res) => {
  res.json({ modules: getModuleCatalog() });
});

module.exports = router;
