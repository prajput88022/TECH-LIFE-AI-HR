// Builds the candidate pre-test / profile form + AI-interview question set, adapted by
// industry + level. Level questions are a fixed bank (below); industry adds one tailored
// question sourced from the (extensible) industry catalog - see src/industryCatalog.js and
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

async function buildFormTemplate(industry, level) {
  const levelDef = LEVEL_FOCUS[level] || LEVEL_FOCUS.associate;
  const industryDef = await industryService.getIndustry(industry);

  return {
    industryLabel: industryDef.label,
    levelLabel: levelDef.label,
    profileFields: [
      { id: "current_role", label: "Current / most recent role title", type: "text", required: true },
      { id: "years_experience", label: "Total years of experience", type: "number", required: true },
      { id: "notice_period", label: "Notice period / availability", type: "text", required: false },
    ],
    questions: [
      ...levelDef.questions,
      { id: "industry_q", type: "text", text: industryDef.focusQuestion },
    ],
  };
}

function getLevelCatalog() {
  return Object.entries(LEVEL_FOCUS).map(([key, def]) => ({ key, label: def.label }));
}

module.exports = { buildFormTemplate, LEVEL_FOCUS, getLevelCatalog };
