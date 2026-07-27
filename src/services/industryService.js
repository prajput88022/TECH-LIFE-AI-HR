const db = require("../db");
const { BASE_INDUSTRIES } = require("../industryCatalog");

async function getAllIndustries() {
  const custom = await db.all("customIndustry");
  const customMapped = custom.map((c) => ({ key: c.key, label: c.label, focusQuestion: c.focusQuestion, custom: true }));
  return [...BASE_INDUSTRIES, ...customMapped];
}

async function getIndustry(key) {
  const all = await getAllIndustries();
  return all.find((i) => i.key === key) || all.find((i) => i.key === "other");
}

async function addCustomIndustry({ key, label, focusQuestion }) {
  const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const all = await getAllIndustries();
  if (all.find((i) => i.key === cleanKey)) {
    throw Object.assign(new Error("An industry with that key already exists"), { status: 409 });
  }
  return db.insert("customIndustry", {
    key: cleanKey,
    label: String(label).trim(),
    focusQuestion: focusQuestion && String(focusQuestion).trim() ? String(focusQuestion).trim() : "What quality or compliance standard matters most in your day-to-day work, and why?",
    createdAt: new Date().toISOString(),
  });
}

async function removeCustomIndustry(id) {
  return db.remove(id);
}

module.exports = { getAllIndustries, getIndustry, addCustomIndustry, removeCustomIndustry };
