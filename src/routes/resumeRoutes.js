const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireRole, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const resumeService = require("../services/resumeService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function tenantOf(req) {
  const id = scopeTenantId(req);
  if (!id) throw Object.assign(new Error("tenantId is required"), { status: 400 });
  return id;
}

router.post("/:id/resume", upload.single("resume"), async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'resume')" });

  let text;
  try {
    text = await resumeService.extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
  } catch (e) {
    return res.status(400).json({ error: "Could not read this file - please upload a PDF, DOCX, or plain text resume" });
  }

  const match = resumeService.computeSkillMatch(text, candidate.requiredSkills);

  const updated = await db.update("candidates", candidate.id, {
    resumeText: text.slice(0, 20000),
    resumeFilename: req.file.originalname,
    resumeUploadedAt: new Date().toISOString(),
    skillMatch: match,
  });

  // Store the original file as a CouchDB attachment on the candidate document.
  try {
    await db.putAttachment(updated.id, "resume", req.file.buffer, req.file.mimetype);
  } catch (e) { /* non-fatal - extracted text + skill match are already saved */ }

  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "resume.uploaded", details: `Uploaded resume for ${candidate.name}${match.score !== null ? ` (skill match ${match.score}%)` : ""}` });

  res.status(201).json({ candidate: updated, skillMatch: match });
});

router.get("/:id/resume", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  try {
    const attachment = await db.getAttachment(candidate.id, "resume");
    res.setHeader("Content-Disposition", `attachment; filename="${candidate.resumeFilename || "resume"}"`);
    res.send(attachment);
  } catch (e) {
    res.status(404).json({ error: "No resume on file for this candidate" });
  }
});

module.exports = router;
