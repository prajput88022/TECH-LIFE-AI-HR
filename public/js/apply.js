const TOKEN = new URLSearchParams(window.location.search).get("token");
let TEMPLATE = null;

(async function init() {
  if (!TOKEN) {
    document.getElementById("loading").textContent = "This link is missing a token and cannot be opened.";
    return;
  }
  try {
    const data = await fetch(`/api/public/form/${TOKEN}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Unable to load form");
      return j;
    });

    document.getElementById("loading").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("orgName").textContent = data.tenantName;
    document.getElementById("headline").textContent = `Hi ${data.candidate.name}, let's get started`;
    document.getElementById("subline").textContent = `${data.template.industryLabel} · ${data.template.levelLabel}${data.candidate.appliedRole ? " · " + data.candidate.appliedRole : ""}`;

    TEMPLATE = data.template;

    if (data.alreadySubmitted) {
      document.getElementById("alreadyDone").style.display = "block";
      document.getElementById("applyForm").style.display = "none";
      return;
    }

    document.getElementById("profileFields").innerHTML = data.template.profileFields.map((f) => `
      <div class="field">
        <label>${escapeHtml(f.label)}${f.required ? " *" : ""}</label>
        <input name="profile_${f.id}" type="${f.type === "number" ? "number" : "text"}" ${f.required ? "required" : ""} />
      </div>
    `).join("");

    const sections = data.template.sections;
    document.getElementById("questionFields").innerHTML = [
      renderSection("aptitude", sections.aptitude, renderMcq),
      renderSection("technical", sections.technical, renderMixed),
      renderSection("personality", sections.personality, renderLikert),
      renderSection("communication", sections.communication, renderText),
    ].join("");
  } catch (e) {
    document.getElementById("loading").textContent = e.message;
  }
})();

function renderSection(key, section, renderQuestion) {
  return `
    <div class="section-title">${escapeHtml(section.label)}</div>
    <div class="muted" style="font-size:12.5px; margin-bottom:10px;">${escapeHtml(section.note || "")}</div>
    ${section.questions.map((q) => renderQuestion(key, q)).join("")}
  `;
}

function renderMcq(section, q) {
  return `<div class="q-block">
    <div class="qtext">${escapeHtml(q.text)}</div>
    ${q.options.map((opt, i) => `<label class="opt-row"><input type="radio" name="${section}__${q.id}" value="${i}" required/> ${escapeHtml(opt)}</label>`).join("")}
  </div>`;
}

function renderMixed(section, q) {
  if (q.type === "mcq") return renderMcq(section, q);
  return renderText(section, q);
}

function renderLikert(section, q) {
  const labels = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
  return `<div class="q-block">
    <div class="qtext">${escapeHtml(q.text)}</div>
    <div style="display:flex; gap:6px; flex-wrap:wrap;">
      ${labels.map((l, i) => `<label class="opt-row" style="flex:1; min-width:110px; justify-content:center; text-align:center;"><input type="radio" name="${section}__${q.id}" value="${i + 1}" required/> ${l}</label>`).join("")}
    </div>
  </div>`;
}

function renderText(section, q) {
  return `<div class="q-block">
    <div class="qtext">${escapeHtml(q.text)}</div>
    <textarea name="${section}__${q.id}" rows="3" required></textarea>
  </div>`;
}

async function submitForm(e) {
  e.preventDefault();
  const errEl = document.getElementById("formErr");
  errEl.classList.remove("show");

  const form = document.getElementById("applyForm");
  const fd = new FormData(form);

  const profile = {};
  TEMPLATE.profileFields.forEach((f) => { profile[f.label] = fd.get(`profile_${f.id}`) || ""; });

  const answers = { aptitude: {}, technical: {}, personality: {}, communication: {} };
  Object.entries(TEMPLATE.sections).forEach(([sectionKey, section]) => {
    section.questions.forEach((q) => {
      answers[sectionKey][q.id] = fd.get(`${sectionKey}__${q.id}`) || "";
    });
  });

  try {
    const res = await fetch(`/api/public/form/${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, answers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed");
    form.style.display = "none";
    document.getElementById("successBox").style.display = "block";
    if (data.session) {
      setTimeout(() => { window.location.href = `/interview-room.html?token=${TOKEN}&role=candidate`; }, 1400);
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  }
  return false;
}
