// Master industry catalog used to build the adaptive question set. Superadmin can add more
// industries at runtime (stored as 'customIndustry' docs) without touching this file — the
// two lists are merged by src/services/industryService.js.

const BASE_INDUSTRIES = [
  { key: "it_ites", label: "IT / ITES / Software", focusQuestion: "How do you keep your technical skills current, and what are you learning right now?" },
  { key: "bfsi", label: "Banking, Financial Services & Insurance (BFSI)", focusQuestion: "How do you ensure regulatory/compliance requirements are met in your day-to-day work?" },
  { key: "manufacturing", label: "Manufacturing", focusQuestion: "How do you approach safety and quality standards on the shop floor?" },
  { key: "retail_ecom", label: "Retail & E-commerce", focusQuestion: "How do you think about customer experience when making operational decisions?" },
  { key: "healthcare", label: "Healthcare & Life Sciences", focusQuestion: "How do you ensure patient safety and care quality in your role?" },
  { key: "pharma", label: "Pharmaceuticals & Biotech", focusQuestion: "How do you ensure quality and regulatory compliance (e.g. GMP) in your work?" },
  { key: "logistics", label: "Logistics & Supply Chain", focusQuestion: "How do you manage cost vs. speed trade-offs in delivery/supply chain decisions?" },
  { key: "bpo", label: "BPO / Customer Service / ITES Voice", focusQuestion: "How do you maintain service quality and communication clarity on every customer interaction?" },
  { key: "education", label: "Education & EdTech", focusQuestion: "How do you adapt your approach for different learner/stakeholder needs?" },
  { key: "real_estate", label: "Real Estate & Construction", focusQuestion: "How do you manage timelines, quality and safety across a project site?" },
  { key: "telecom", label: "Telecom", focusQuestion: "How do you approach network reliability or service-quality issues in your role?" },
  { key: "media_entertainment", label: "Media & Entertainment", focusQuestion: "How do you balance creative goals with deadlines and budgets?" },
  { key: "travel_hospitality", label: "Travel, Hospitality & Aviation", focusQuestion: "How do you handle a guest/customer service situation that's gone wrong?" },
  { key: "energy_utilities", label: "Energy & Utilities", focusQuestion: "How do you factor safety and regulatory compliance into your daily decisions?" },
  { key: "automotive", label: "Automotive", focusQuestion: "How do you approach quality control or process improvement in your area?" },
  { key: "agriculture", label: "Agriculture & Agribusiness", focusQuestion: "How do you adapt plans given seasonal or supply variability?" },
  { key: "government", label: "Government & Public Sector", focusQuestion: "How do you ensure transparency and process compliance in your work?" },
  { key: "legal", label: "Legal Services", focusQuestion: "How do you ensure accuracy and confidentiality in your work?" },
  { key: "consulting", label: "Consulting & Professional Services", focusQuestion: "How do you manage client expectations under a tight timeline?" },
  { key: "nonprofit", label: "NGO / Non-Profit / Social Sector", focusQuestion: "How do you measure impact or success in your work?" },
  { key: "other", label: "Other / General", focusQuestion: "What quality or compliance standard matters most in your day-to-day work, and why?" },
];

module.exports = { BASE_INDUSTRIES };
