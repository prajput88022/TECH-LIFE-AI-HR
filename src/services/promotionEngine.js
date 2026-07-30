// Promotion Recommendation Engine.
// Produces a full recommendation package from whatever data is available for a candidate/
// employee - it is explicitly advisory: HR and senior management make the actual call
// (see interviewRoutes.js POST /:id/decision). Nothing here auto-approves anything.

const scoring = require("./scoringService");

const LEVEL_LADDER = ["fresher", "associate", "senior_executive", "manager", "senior_manager", "gm", "vp"];
const LEVEL_LABELS = {
  fresher: "Fresher / Entry-level", associate: "Associate / Executive", senior_executive: "Senior Executive / Team Lead",
  manager: "Manager", senior_manager: "Senior Manager", gm: "General Manager (GM)", vp: "Vice President (VP) / CXO",
};

function nextLevel(currentLevel) {
  const idx = LEVEL_LADDER.indexOf(currentLevel);
  if (idx === -1 || idx === LEVEL_LADDER.length - 1) return null;
  return LEVEL_LADDER[idx + 1];
}

function confidenceFromComponents(componentsIncluded, kpiRecordCount) {
  let points = 0;
  if (componentsIncluded.includes("kpi")) points += kpiRecordCount >= 2 ? 2 : 1;
  if (componentsIncluded.includes("interview")) points += 1;
  if (componentsIncluded.includes("pretest")) points += 1;
  if (points >= 4) return "High";
  if (points >= 2) return "Medium";
  return "Low";
}

function buildRiskFlags(candidate, readiness) {
  const flags = [];
  if (readiness.kpi.trend === "declining") flags.push("KPI performance trend is declining over recent review periods");
  if (readiness.kpi.score === null) flags.push("No KPI history on file — recommendation is based on limited data");
  if (readiness.interviewScore === null) flags.push("No interview score recorded yet");
  if (readiness.pretestScore === null) flags.push("No pre-test/assessment score recorded yet");
  if (readiness.kpi.periodsUsed === 1) flags.push("Only one KPI review period available — trend cannot be confirmed");
  if (candidate.skillMatch && candidate.skillMatch.score !== null && candidate.skillMatch.score < 50) {
    flags.push(`Resume/skill match is low (${candidate.skillMatch.score}%) against required skills for this role`);
  }
  return flags;
}

function buildTrainingRecommendations(candidate, readiness, targetLevel) {
  const recs = [];
  if (candidate.skillMatch && candidate.skillMatch.missing && candidate.skillMatch.missing.length) {
    recs.push(`Skill development in: ${candidate.skillMatch.missing.slice(0, 5).join(", ")}`);
  }
  if (targetLevel && ["manager", "senior_manager", "gm", "vp"].includes(targetLevel)) {
    recs.push("Leadership / people-management development program");
  }
  if (readiness.interviewScore !== null && readiness.interviewScore < 70) {
    recs.push("Communication & interview-readiness coaching");
  }
  if (readiness.kpi.trend === "declining") {
    recs.push("Performance improvement plan focused on the metrics currently trending down");
  }
  if (!recs.length) recs.push("No specific gaps identified — continue current development plan");
  return recs;
}

function salaryBand(score) {
  if (score === null) return { band: "Not enough data", suggestedHikePct: null };
  if (score >= 90) return { band: "Strong", suggestedHikePct: "15-20%" };
  if (score >= 75) return { band: "Good", suggestedHikePct: "10-15%" };
  if (score >= 60) return { band: "Moderate", suggestedHikePct: "5-8%" };
  return { band: "Not yet ready", suggestedHikePct: "0% (revisit next cycle)" };
}

async function computeRecommendation(candidate) {
  const readiness = await scoring.computeReadinessScore(candidate);
  const target = nextLevel(candidate.level);
  const eligible = readiness.finalScore !== null && readiness.finalScore >= 75;

  return {
    eligibilityScore: readiness.finalScore,
    eligible,
    confidenceLevel: confidenceFromComponents(readiness.componentsIncluded, readiness.recordCount),
    riskAnalysis: buildRiskFlags(candidate, readiness),
    skillGapAnalysis: candidate.skillMatch
      ? { matched: candidate.skillMatch.matched, missing: candidate.skillMatch.missing, matchScore: candidate.skillMatch.score }
      : { matched: [], missing: [], matchScore: null, note: "No resume/required-skills data on file for this candidate" },
    recommendedNextRole: eligible && target ? LEVEL_LABELS[target] : target ? `Not yet ready for ${LEVEL_LABELS[target]}` : "Already at the top of the configured level ladder",
    salaryRecommendation: salaryBand(readiness.finalScore),
    trainingRecommendations: buildTrainingRecommendations(candidate, readiness, target),
    readinessBreakdown: readiness,
    disclaimer: "This is an AI-generated recommendation to support — not replace — HR and management judgement. All figures should be validated before acting on them.",
  };
}

module.exports = { computeRecommendation, nextLevel, LEVEL_LADDER, LEVEL_LABELS };
