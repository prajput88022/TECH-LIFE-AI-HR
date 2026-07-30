// Resume upload, text extraction, and skill-matching.
// PDF text extraction via pdf-parse, DOCX via mammoth. The extracted text is stored on the
// candidate's CouchDB document (as `resumeText`) and the original file as a CouchDB attachment,
// so nothing besides CouchDB is needed to run this.

const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractText(buffer, mimetype, filename) {
  const lower = (filename || "").toLowerCase();
  if (mimetype === "application/pdf" || lower.endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  // Fall back to treating it as plain text.
  return buffer.toString("utf-8");
}

function splitSkills(skillsInput) {
  if (Array.isArray(skillsInput)) return skillsInput.map((s) => String(s).trim()).filter(Boolean);
  return String(skillsInput || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeSkillMatch(resumeText, requiredSkills) {
  const skills = splitSkills(requiredSkills);
  if (!skills.length) return { matched: [], missing: [], score: null };
  const haystack = (resumeText || "").toLowerCase();
  const matched = [];
  const missing = [];
  skills.forEach((skill) => {
    if (haystack.includes(skill.toLowerCase())) matched.push(skill);
    else missing.push(skill);
  });
  const score = Math.round((matched.length / skills.length) * 100);
  return { matched, missing, score };
}

module.exports = { extractText, splitSkills, computeSkillMatch };
