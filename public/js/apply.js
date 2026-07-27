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

    document.getElementById("questionFields").innerHTML = data.template.questions.map((q) => {
      if (q.type === "mcq") {
        return `<div class="q-block">
          <div class="qtext">${escapeHtml(q.text)}</div>
          ${q.options.map((opt, i) => `
            <label class="opt-row"><input type="radio" name="q_${q.id}" value="${escapeHtml(opt)}" ${i === 0 ? "" : ""} required/> ${escapeHtml(opt)}</label>
          `).join("")}
        </div>`;
      }
      return `<div class="q-block">
        <div class="qtext">${escapeHtml(q.text)}</div>
        <textarea name="q_${q.id}" rows="3" required></textarea>
      </div>`;
    }).join("");
  } catch (e) {
    document.getElementById("loading").textContent = e.message;
  }
})();

async function submitForm(e) {
  e.preventDefault();
  const errEl = document.getElementById("formErr");
  errEl.classList.remove("show");

  const form = document.getElementById("applyForm");
  const fd = new FormData(form);

  const profile = {};
  TEMPLATE.profileFields.forEach((f) => { profile[f.label] = fd.get(`profile_${f.id}`) || ""; });

  const answers = {};
  TEMPLATE.questions.forEach((q) => { answers[q.text] = fd.get(`q_${q.id}`) || ""; });

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
