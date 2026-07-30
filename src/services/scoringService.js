// KPI & Performance Analytics Engine.
//
// HR/Management import an employee/candidate's KPI history (one record per review period,
// each with named metrics + a target). This service normalizes those into a 0-150 score per
// period (100 = hit target exactly, >100 = exceeded it), and blends that with an interview
// score and a pre-test score using tenant-configurable weights to produce a single
// "promotion-readiness score" HR can use alongside their own judgement - never in place of it.

const db = require("../db");

const DEFAULT_WEIGHTS = { kpi: 40, interview: 40, pretest: 20 };

function scoreOneMetric(metric) {
  const value = Number(metric.value);
  const target = Number(metric.target);
  const lowerIsBetter = metric.direction === "lower_is_better";
  if (!target || Number.isNaN(target)) return Number.isNaN(value) ? null : value;
  if (Number.isNaN(value)) return null;
  const ratio = lowerIsBetter ? (value === 0 ? 1.5 : target / value) : value / target;
  return Math.max(0, Math.min(150, ratio * 100));
}

function scoreOneRecord(record) {
  const scores = (record.metrics || []).map(scoreOneMetric).filter((s) => s !== null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Weighs the most recent periods more heavily (recent performance predicts readiness better
// than performance from a year ago) while still considering trend history.
function computeKpiScore(records) {
  const scored = records
    .map((r) => ({ ...r, _score: scoreOneRecord(r) }))
    .filter((r) => r._score !== null)
    .sort((a, b) => new Date(b.period + "-01").getTime() - new Date(a.period + "-01").getTime() || new Date(b.importedAt) - new Date(a.importedAt));

  if (!scored.length) return { score: null, trend: "no-data", periodsUsed: 0 };

  const recent = scored.slice(0, 4); // last up to 4 review periods
  const weights = recent.map((_, i) => recent.length - i); // most recent gets highest weight
  const weightedSum = recent.reduce((sum, r, i) => sum + r._score * weights[i], 0);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const score = Math.round(weightedSum / weightTotal);

  let trend = "stable";
  if (recent.length >= 2) {
    const diff = recent[0]._score - recent[recent.length - 1]._score;
    trend = diff > 5 ? "improving" : diff < -5 ? "declining" : "stable";
  }

  return { score, trend, periodsUsed: recent.length, latestPeriod: recent[0].period };
}

async function getWeights(tenantId) {
  const doc = await db.find("scoringWeights", (w) => w.tenantId === tenantId);
  return doc ? { kpi: doc.kpi, interview: doc.interview, pretest: doc.pretest, id: doc.id } : { ...DEFAULT_WEIGHTS };
}

async function setWeights(tenantId, weights) {
  const kpi = Number(weights.kpi) || 0;
  const interview = Number(weights.interview) || 0;
  const pretest = Number(weights.pretest) || 0;
  const existing = await db.find("scoringWeights", (w) => w.tenantId === tenantId);
  const clean = { tenantId, kpi, interview, pretest, updatedAt: new Date().toISOString() };
  if (existing) return db.update("scoringWeights", existing.id, clean);
  return db.insert("scoringWeights", clean);
}

// Combines whatever components are actually available (KPI history / interview score / pretest
// score) - if a component is missing, its weight is redistributed proportionally across the
// components that ARE present, rather than silently treating a missing score as zero.
async function computeReadinessScore(candidate) {
  const weights = await getWeights(candidate.tenantId);
  const records = await db.all("kpiRecords", (r) => r.candidateId === candidate.id);
  const kpi = computeKpiScore(records);

  const components = [];
  if (kpi.score !== null) components.push({ key: "kpi", score: kpi.score, weight: weights.kpi });
  if (typeof candidate.interviewScore === "number") components.push({ key: "interview", score: candidate.interviewScore, weight: weights.interview });
  if (typeof candidate.pretestScore === "number") components.push({ key: "pretest", score: candidate.pretestScore, weight: weights.pretest });

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const finalScore = totalWeight > 0
    ? Math.round(components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
    : null;

  return {
    finalScore,
    kpi,
    interviewScore: typeof candidate.interviewScore === "number" ? candidate.interviewScore : null,
    pretestScore: typeof candidate.pretestScore === "number" ? candidate.pretestScore : null,
    weightsUsed: weights,
    componentsIncluded: components.map((c) => c.key),
    recordCount: records.length,
  };
}

async function getPretestThreshold(tenantId) {
  const doc = await db.find("pretestThreshold", (t) => t.tenantId === tenantId);
  return doc ? { enabled: doc.enabled, minScore: doc.minScore, id: doc.id } : { enabled: false, minScore: 50 };
}

async function setPretestThreshold(tenantId, { enabled, minScore }) {
  const existing = await db.find("pretestThreshold", (t) => t.tenantId === tenantId);
  const clean = { tenantId, enabled: !!enabled, minScore: Number(minScore) || 50, updatedAt: new Date().toISOString() };
  if (existing) return db.update("pretestThreshold", existing.id, clean);
  return db.insert("pretestThreshold", clean);
}

module.exports = { DEFAULT_WEIGHTS, computeKpiScore, getWeights, setWeights, computeReadinessScore, getPretestThreshold, setPretestThreshold };
