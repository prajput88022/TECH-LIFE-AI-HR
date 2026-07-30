// Builds the candidate pre-test / profile form + AI-interview question set, adapted by
// industry + level, split into four assessment sections mirroring the original brief:
//   1. Aptitude        - generic, auto-graded (MCQ with a correct answer)
//   2. Technical &
//      Behavioral       - level + industry specific, reviewed by AI/HR (not auto-graded)
//   3. Personality      - self-report Likert scale, informational trait profile
//   4. Communication    - free-text response, heuristically scored
//
// Level questions are a fixed bank (below); industry adds one tailored question sourced
// from the (extensible) industry catalog - see src/industryCatalog.js and
// src/services/industryService.js for how Superadmin can add more industries at runtime.

const industryService = require("./industryService");

const LEVEL_FOCUS = {
  fresher: {
    label: "Fresher / Entry-level",
    questions: [
      { id: "q1", type: "text", text: "Tell us about a project (academic or personal) you are proud of and why." },
      { id: "q2", type: "mcq", text: "How comfortable are you learning a new tool/process with minimal guidance?", options: ["Very comfortable", "Somewhat comfortable", "Need structured training"] },
      { id: "q3", type: "text", text: "Describe a time you had to explain something clearly to someone who didn't understand it." },
    ],
  },
  associate: {
    label: "Associate / Executive",
    questions: [
      { id: "q1", type: "text", text: "Walk us through a task you owned end-to-end in your current/last role." },
      { id: "q2", type: "mcq", text: "How do you usually prioritize when you have multiple deadlines?", options: ["By deadline", "By business impact", "By manager guidance", "By effort required"] },
      { id: "q3", type: "text", text: "Describe a mistake you made at work and what you changed afterward." },
    ],
  },
  senior_executive: {
    label: "Senior Executive / Team Lead",
    questions: [
      { id: "q1", type: "text", text: "Describe a time you coordinated across two teams to get something done." },
      { id: "q2", type: "mcq", text: "How do you typically handle a disagreement with a peer on approach?", options: ["Escalate to manager", "Discuss and find middle ground", "Defer to peer", "Push for my approach with data"] },
      { id: "q3", type: "text", text: "What metric do you track most closely in your current role, and why?" },
    ],
  },
  manager: {
    label: "Manager",
    questions: [
      { id: "q1", type: "text", text: "Describe how you set goals/KPIs for your team and track them." },
      { id: "q2", type: "mcq", text: "A team member is consistently missing targets. What's your first step?", options: ["Performance improvement plan", "1:1 to understand root cause", "Reassign their work", "Escalate to HR immediately"] },
      { id: "q3", type: "text", text: "Tell us about a stakeholder management situation that was difficult to navigate." },
    ],
  },
  senior_manager: {
    label: "Senior Manager",
    questions: [
      { id: "q1", type: "text", text: "Describe a cross-functional initiative you led and its business outcome." },
      { id: "q2", type: "mcq", text: "How do you balance short-term targets against long-term team health?", options: ["Prioritize short-term always", "Prioritize long-term always", "Case-by-case trade-off", "Delegate the decision"] },
      { id: "q3", type: "text", text: "What KPI trend in your area are you currently most focused on improving?" },
    ],
  },
  gm: {
    label: "General Manager (GM)",
    questions: [
      { id: "q1", type: "text", text: "Describe a strategic decision you made that had org-wide impact." },
      { id: "q2", type: "mcq", text: "When functional priorities conflict with each other, how do you resolve it?", options: ["Data-driven trade-off review", "Escalate to leadership team", "Consensus workshop", "Decide unilaterally with rationale shared after"] },
      { id: "q3", type: "text", text: "How do you approach governance and risk within your area of ownership?" },
    ],
  },
  vp: {
    label: "Vice President (VP) / CXO",
    questions: [
      { id: "q1", type: "text", text: "Describe your vision for this function over the next 2-3 years." },
      { id: "q2", type: "mcq", text: "How do you typically evaluate enterprise-level risk in a major decision?", options: ["Formal risk framework", "Board/leadership consultation", "Scenario modeling", "External advisory input"] },
      { id: "q3", type: "text", text: "Tell us about a time you had to lead the organization through significant change." },
    ],
  },
};

// Generic, industry-agnostic aptitude questions - auto-graded (correctIndex is never sent
// to the client's displayed template in a way that reveals the answer ahead of grading).
const APTITUDE_QUESTIONS = [
  { id: "apt1", text: "A project has a budget of 100,000 and has used 72,000 so far. What percentage remains?", options: ["18%", "28%", "72%", "82%"], correctIndex: 1 },
  { id: "apt2", text: "If a task normally takes 8 hours and you have 3 people working on it equally, roughly how long per person (ignoring coordination overhead)?", options: ["8 hours", "5 hours", "2.5 hours", "1 hour"], correctIndex: 2 },
  { id: "apt3", text: "Which number comes next in the sequence: 2, 4, 8, 16, ...?", options: ["20", "24", "32", "18"], correctIndex: 2 },
];

const PERSONALITY_STATEMENTS = [
  { id: "per1", trait: "teamwork", text: "I prefer working closely with others over working alone." },
  { id: "per2", trait: "adaptability", text: "I adjust quickly when priorities change unexpectedly." },
  { id: "per3", trait: "conscientiousness", text: "I double-check my work before considering it done." },
  { id: "per4", trait: "resilience", text: "Setbacks don't discourage me for long." },
  { id: "per5", trait: "initiative", text: "I often act on ideas without being asked to." },
];

const COMMUNICATION_PROMPT = { id: "comm1", text: "In a few sentences, describe a time you had to communicate a difficult message to a colleague, client, or team member." };

const ALL_MODULES = ["aptitude", "technical", "personality", "communication"];

async function buildFormTemplate(industry, level, modules) {
  const enabledModules = Array.isArray(modules) && modules.length ? modules.filter((m) => ALL_MODULES.includes(m)) : ALL_MODULES;
  const levelDef = LEVEL_FOCUS[level] || LEVEL_FOCUS.associate;
  const industryDef = await industryService.getIndustry(industry);

  const allSections = {
    aptitude: {
      label: "Aptitude Assessment",
      note: "Auto-graded — quick logical/numerical reasoning questions.",
      questions: APTITUDE_QUESTIONS.map((q) => ({ id: q.id, type: "mcq", text: q.text, options: q.options })),
    },
    technical: {
      label: "Technical & Behavioral Assessment",
      note: `Adapted to ${levelDef.label} in ${industryDef.label}.`,
      questions: [...levelDef.questions, { id: "industry_q", type: "text", text: industryDef.focusQuestion }],
    },
    personality: {
      label: "Personality / Work-Style Profile",
      note: "Self-reported, informational only — not scored right or wrong.",
      questions: PERSONALITY_STATEMENTS.map((p) => ({ id: p.id, type: "likert", text: p.text })),
    },
    communication: {
      label: "Communication Assessment",
      note: "Heuristically scored on response quality/depth.",
      questions: [{ id: COMMUNICATION_PROMPT.id, type: "text", text: COMMUNICATION_PROMPT.text }],
    },
  };

  const sections = {};
  enabledModules.forEach((key) => { sections[key] = allSections[key]; });

  return {
    industryLabel: industryDef.label,
    levelLabel: levelDef.label,
    enabledModules,
    profileFields: [
      { id: "current_role", label: "Current / most recent role title", type: "text", required: true },
      { id: "years_experience", label: "Total years of experience", type: "number", required: true },
      { id: "notice_period", label: "Notice period / availability", type: "text", required: false },
    ],
    sections,
    // Flat list kept for the AI voice interview room, which walks through the Technical &
    // Behavioral questions conversationally rather than as a written form.
    questions: enabledModules.includes("technical")
      ? [...levelDef.questions, { id: "industry_q", type: "text", text: industryDef.focusQuestion }]
      : [],
  };
}

// Scores a submitted pre-test: { aptitude: {qid: optionIndex}, personality: {qid: 1-5}, communication: {qid: text}, technical: {...} }
// Only the modules actually assigned (present in `modules`) are scored; the overall pre-test
// score blends whichever of Aptitude/Communication were assigned, redistributing weight if one
// was left out rather than treating a skipped module as a zero.
function scorePretestSubmission(answers, modules) {
  const enabledModules = Array.isArray(modules) && modules.length ? modules.filter((m) => ALL_MODULES.includes(m)) : ALL_MODULES;
  const result = { enabledModules };

  if (enabledModules.includes("aptitude")) {
    const aptitudeAnswers = answers.aptitude || {};
    let correct = 0;
    APTITUDE_QUESTIONS.forEach((q) => { if (Number(aptitudeAnswers[q.id]) === q.correctIndex) correct += 1; });
    result.aptitudeScore = Math.round((correct / APTITUDE_QUESTIONS.length) * 100);
  }

  if (enabledModules.includes("personality")) {
    const personalityAnswers = answers.personality || {};
    const personalityProfile = {};
    PERSONALITY_STATEMENTS.forEach((p) => {
      const raw = Number(personalityAnswers[p.id]);
      if (!Number.isNaN(raw) && raw >= 1 && raw <= 5) personalityProfile[p.trait] = Math.round(((raw - 1) / 4) * 100);
    });
    result.personalityProfile = personalityProfile;
  }

  if (enabledModules.includes("communication")) {
    const commText = String((answers.communication || {})[COMMUNICATION_PROMPT.id] || "");
    const wordCount = commText.trim().split(/\s+/).filter(Boolean).length;
    result.communicationScore = Math.max(10, Math.min(100, Math.round((wordCount / 45) * 100)));
    result.wordCount = wordCount;
  }

  const scoredParts = [];
  if (typeof result.aptitudeScore === "number") scoredParts.push({ score: result.aptitudeScore, weight: 60 });
  if (typeof result.communicationScore === "number") scoredParts.push({ score: result.communicationScore, weight: 40 });
  const totalWeight = scoredParts.reduce((s, p) => s + p.weight, 0);
  result.overallPretestScore = totalWeight > 0
    ? Math.round(scoredParts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight)
    : null;

  return result;
}

function getLevelCatalog() {
  return Object.entries(LEVEL_FOCUS).map(([key, def]) => ({ key, label: def.label }));
}

function getModuleCatalog() {
  return [
    { key: "aptitude", label: "Aptitude Assessment", description: "Auto-graded logical/numerical reasoning (3 questions)." },
    { key: "technical", label: "Technical & Behavioral Assessment", description: "Industry + level adaptive questions. Also drives the AI voice interview." },
    { key: "personality", label: "Personality / Work-Style Profile", description: "Self-reported Likert-scale traits, informational only." },
    { key: "communication", label: "Communication Assessment", description: "Open-ended response, heuristically scored." },
  ];
}

module.exports = { buildFormTemplate, scorePretestSubmission, LEVEL_FOCUS, getLevelCatalog, getModuleCatalog, ALL_MODULES };
