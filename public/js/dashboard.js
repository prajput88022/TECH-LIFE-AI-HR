let ME = null;
let CANDIDATES = [];
let activeCandidateId = null;
let INDUSTRIES = [];
let LEVELS = [];
let metricRowCount = 0;
const INDUSTRY_LABELS = {};
const LEVEL_LABELS = {};

(async function init() {
  const user = requireSession(["hr", "management"]);
  if (!user) return;
  document.getElementById("whoName").textContent = user.name;
  document.getElementById("whoEmail").textContent = user.email;
  document.getElementById("availabilityToggle").checked = user.available !== false;

  try {
    ME = await API.get("/api/me");
    document.getElementById("tenantTag").textContent = `${ME.tenant ? ME.tenant.name : ""} · ${user.role.toUpperCase()}`;
  } catch (e) { toast(e.message, true); }

  applyFeatureGating();
  await loadMetaCatalogs();
  await loadReports();
  await loadCandidates();
  await loadInterviews();
  renderMyFeatures();
})();

async function loadMetaCatalogs() {
  try {
    const [ind, lvl] = await Promise.all([API.get("/api/meta/industries"), API.get("/api/meta/levels")]);
    INDUSTRIES = ind.industries;
    LEVELS = lvl.levels;
    INDUSTRIES.forEach((i) => (INDUSTRY_LABELS[i.key] = i.label));
    LEVELS.forEach((l) => (LEVEL_LABELS[l.key] = l.label));
    document.getElementById("cIndustry").innerHTML = INDUSTRIES.map((i) => `<option value="${i.key}">${escapeHtml(i.label)}</option>`).join("");
    document.getElementById("cLevel").innerHTML = LEVELS.map((l) => `<option value="${l.key}" ${l.key === "associate" ? "selected" : ""}>${escapeHtml(l.label)}</option>`).join("");
  } catch (e) { toast(e.message, true); }
}

async function toggleAvailability() {
  const available = document.getElementById("availabilityToggle").checked;
  try {
    const data = await API.patch("/api/me/availability", { available });
    API.setUser(data.user);
    toast(available ? "You're marked as Available — new interviews may be routed to you" : "You're marked as Busy — new interviews will go to AI (if enabled) or queue");
  } catch (e) { toast(e.message, true); }
}

function logout() { API.clearSession(); window.location.href = "/index.html"; }

function showView(view) {
  ["reports", "candidates", "interviews", "features"].forEach((v) => {
    document.getElementById(`view-${v}`).style.display = v === view ? "block" : "none";
  });
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  if (view === "interviews") loadInterviews();
}

function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function openModal(id) { document.getElementById(id).classList.add("show"); }

function hasFeature(key) {
  return !!(ME && ME.features.find((f) => f.key === key && f.enabled));
}

function applyFeatureGating() {
  document.getElementById("reportsDisabledNote").style.display = hasFeature("reports_dashboard") ? "none" : "block";
  document.getElementById("reportsContent").style.display = hasFeature("reports_dashboard") ? "block" : "none";
  document.getElementById("addCandidateBtn").style.display = hasFeature("candidate_management") ? "inline-flex" : "none";
}

// ---------------- Reports ----------------
async function loadReports() {
  if (!hasFeature("reports_dashboard")) return;
  try {
    const pipeline = await API.get("/api/reports/pipeline");
    document.getElementById("pipelineStats").innerHTML = `
      ${statCard(pipeline.totalCandidates, "Total candidates")}
      ${statCard(pipeline.notificationsSent, "Links sent")}
      ${statCard(pipeline.formsSubmitted, "Forms completed")}
      ${statCard(pipeline.conversionRate + "%", "Completion rate")}
    `;
    const act = await API.get("/api/reports/activity");
    document.getElementById("activityBody").innerHTML = act.logs.map((l) => `
      <tr><td>${timeAgo(l.createdAt)}</td><td>${escapeHtml(l.actorName)}</td><td>${l.role}</td><td>${l.action}</td><td class="muted">${escapeHtml(l.details)}</td></tr>
    `).join("") || `<tr><td colspan="5" class="muted">No activity yet.</td></tr>`;
  } catch (e) { toast(e.message, true); }
}
function statCard(num, label) {
  return `<div class="card stat-card"><div class="num">${num}</div><div class="lbl">${label}</div></div>`;
}

// ---------------- Candidates ----------------
async function loadCandidates() {
  try {
    const data = await API.get("/api/candidates");
    CANDIDATES = data.candidates;
    renderCandidates();
  } catch (e) { toast(e.message, true); }
}

function renderCandidates() {
  const body = document.getElementById("candidatesBody");
  if (!CANDIDATES.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted" style="padding:30px 12px;">No candidates yet. Click "Add candidate" to get started.</td></tr>`;
    return;
  }
  body.innerHTML = CANDIDATES.map((c) => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong><br/><span class="muted" style="font-size:12px;">${escapeHtml(c.email || c.phone || "")}</span></td>
      <td>${escapeHtml(c.appliedRole || "—")}</td>
      <td>${INDUSTRY_LABELS[c.industry] || c.industry} / ${LEVEL_LABELS[c.level] || c.level}</td>
      <td><span class="pill ${c.status}">${c.status.replace("_", " ")}</span></td>
      <td>${timeAgo(c.createdAt)}</td>
      <td><button class="btn secondary sm" onclick="openCandidate('${c.id}')">View / Send</button></td>
    </tr>
  `).join("");
}

function openAddCandidate() {
  ["cName", "cEmail", "cPhone", "cRole"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("cCaseType").value = "screening";
  document.getElementById("errAddCandidate").classList.remove("show");
  openModal("modalAddCandidate");
}

async function submitAddCandidate() {
  const errEl = document.getElementById("errAddCandidate");
  errEl.classList.remove("show");
  const payload = {
    name: document.getElementById("cName").value.trim(),
    email: document.getElementById("cEmail").value.trim(),
    phone: document.getElementById("cPhone").value.trim(),
    industry: document.getElementById("cIndustry").value,
    level: document.getElementById("cLevel").value,
    appliedRole: document.getElementById("cRole").value.trim(),
    caseType: document.getElementById("cCaseType").value,
  };
  try {
    await API.post("/api/candidates", payload);
    closeModal("modalAddCandidate");
    toast("Candidate added");
    await loadCandidates();
    await loadReports();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

async function openCandidate(id) {
  activeCandidateId = id;
  try {
    const data = await API.get(`/api/candidates/${id}`);
    const c = data.candidate;
    document.getElementById("candTitle").textContent = c.name;
    document.getElementById("candSub").textContent = `${INDUSTRY_LABELS[c.industry] || c.industry} · ${LEVEL_LABELS[c.level] || c.level} · ${c.appliedRole || "No role specified"}`;
    document.getElementById("lastLinkBox").innerHTML = "";

    document.getElementById("candNotifications").innerHTML = data.notifications.length
      ? data.notifications.map((n) => `<div style="padding:6px 0; border-bottom:1px solid var(--border);">
          <span class="pill ${n.status}">${n.status}</span> via <strong>${n.channel}</strong> to ${escapeHtml(n.target)} — ${timeAgo(n.sentAt)}
          ${n.mode === "mock" ? '<span class="muted"> (sandbox/mock delivery)</span>' : ""}
        </div>`).join("")
      : "No links sent yet.";

    document.getElementById("candSubmission").innerHTML = data.submission
      ? renderSubmission(data.submission)
      : "Not submitted yet.";

    document.getElementById("candSession").innerHTML = data.session
      ? `<div>Mode: <strong>${data.session.mode === "ai" ? "AI-conducted" : data.session.mode === "human_pending" ? "Queued (no human/AI available)" : "Human-conducted"}</strong> · Status: ${data.session.status.replace("_", " ")}</div>
         <button class="btn secondary sm" style="margin-top:8px;" onclick="window.open('/interview-room.html?session=${data.session.id}&role=hr','_blank')">Join room</button>`
      : "No interview scheduled yet — send the candidate their invite link above.";

    document.getElementById("kpiSection").style.display = hasFeature("kpi_analytics") ? "block" : "none";
    if (hasFeature("kpi_analytics")) {
      document.getElementById("kpiInterviewScore").value = typeof c.interviewScore === "number" ? c.interviewScore : "";
      document.getElementById("kpiPretestScore").value = typeof c.pretestScore === "number" ? c.pretestScore : "";
      document.getElementById("kpiMetricRows").innerHTML = "";
      metricRowCount = 0;
      addMetricRow();
      document.getElementById("kpiErr").classList.remove("show");
      await loadKpiPanel();
    }

    openModal("modalCandidate");
  } catch (e) { toast(e.message, true); }
}

// ---------------- KPI & readiness ----------------
async function loadKpiPanel() {
  try {
    const [kpiData, readiness] = await Promise.all([
      API.get(`/api/candidates/${activeCandidateId}/kpi`),
      API.get(`/api/candidates/${activeCandidateId}/readiness-score`),
    ]);
    renderKpiRecords(kpiData.records, kpiData.trend);
    renderReadiness(readiness);
  } catch (e) { toast(e.message, true); }
}

function renderKpiRecords(records, trend) {
  const el = document.getElementById("kpiRecordsList");
  if (!records.length) { el.innerHTML = "No KPI periods imported yet."; return; }
  const trendBadge = trend.score !== null
    ? `<span class="pill ${trend.trend === "improving" ? "active" : trend.trend === "declining" ? "suspended" : "neutral"}">${trend.trend} · KPI score ${trend.score}</span>`
    : "";
  el.innerHTML = `<div style="margin-bottom:8px;">${trendBadge}</div>` + records.map((r) => `
    <div style="padding:6px 0; border-bottom:1px solid var(--border);">
      <strong>${escapeHtml(r.period)}</strong> — ${r.metrics.map((m) => `${escapeHtml(m.name)}: ${m.value}/${m.target} (${m.direction === "lower_is_better" ? "lower better" : "higher better"})`).join(", ")}
      <button class="btn secondary sm" style="padding:2px 8px; font-size:11px; margin-left:6px;" onclick="deleteKpiRecord('${r.id}')">Remove</button>
    </div>
  `).join("");
}

function renderReadiness(r) {
  const box = document.getElementById("readinessBox");
  if (r.finalScore === null) {
    box.innerHTML = `<div class="muted">Not enough data yet for a readiness score — import a KPI period and/or set interview/pre-test scores below.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="card" style="padding:14px; background:#fafbfc;">
      <div style="font-size:26px; font-weight:800; color:var(--navy);">${r.finalScore}<span style="font-size:14px; color:var(--text-dim);">/100</span></div>
      <div class="muted" style="font-size:12px; margin-bottom:6px;">Promotion/hiring readiness score — a decision aid, not the decision.</div>
      <div style="font-size:12.5px;">
        ${r.kpi.score !== null ? `KPI: <strong>${r.kpi.score}</strong> (${r.kpi.trend}) · ` : ""}
        ${r.interviewScore !== null ? `Interview: <strong>${r.interviewScore}</strong> · ` : ""}
        ${r.pretestScore !== null ? `Pre-test: <strong>${r.pretestScore}</strong> · ` : ""}
        Weights used: KPI ${r.weightsUsed.kpi} / Interview ${r.weightsUsed.interview} / Pre-test ${r.weightsUsed.pretest}
      </div>
    </div>
  `;
}

async function deleteKpiRecord(recordId) {
  try {
    await db_deleteKpi(recordId);
    await loadKpiPanel();
  } catch (e) { toast(e.message, true); }
}
async function db_deleteKpi(recordId) {
  const res = await fetch(`/api/candidates/${activeCandidateId}/kpi/${recordId}`, { method: "DELETE", headers: { Authorization: `Bearer ${API.token()}` } });
  if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to remove"); }
}

function addMetricRow() {
  metricRowCount += 1;
  const id = `metric-${metricRowCount}`;
  const row = document.createElement("div");
  row.className = "grid cols-2";
  row.style = "margin-top:6px; align-items:end;";
  row.id = id;
  row.innerHTML = `
    <div class="field" style="grid-column:span 2;"><label>Metric name</label><input id="${id}-name" placeholder="e.g. Sales Achievement %" /></div>
    <div class="field"><label>Actual value</label><input id="${id}-value" type="number" /></div>
    <div class="field"><label>Target</label><input id="${id}-target" type="number" /></div>
    <div class="field" style="grid-column:span 2;"><label>Direction</label>
      <select id="${id}-dir">
        <option value="higher_is_better">Higher is better (e.g. sales, CSAT)</option>
        <option value="lower_is_better">Lower is better (e.g. attrition, cost, defects)</option>
      </select>
    </div>
  `;
  document.getElementById("kpiMetricRows").appendChild(row);
}

async function submitKpiRecord() {
  const errEl = document.getElementById("kpiErr");
  errEl.classList.remove("show");
  const period = document.getElementById("kpiPeriod").value.trim();
  const rows = Array.from(document.querySelectorAll("#kpiMetricRows > div"));
  const metrics = rows.map((row) => ({
    name: document.getElementById(`${row.id}-name`).value.trim(),
    value: document.getElementById(`${row.id}-value`).value,
    target: document.getElementById(`${row.id}-target`).value,
    direction: document.getElementById(`${row.id}-dir`).value,
  })).filter((m) => m.name && m.value !== "");

  if (!period || !metrics.length) {
    errEl.textContent = "Enter a period label and at least one complete metric.";
    errEl.classList.add("show");
    return;
  }
  try {
    await API.post(`/api/candidates/${activeCandidateId}/kpi`, { period, metrics });
    toast("KPI record imported");
    document.getElementById("kpiPeriod").value = "";
    document.getElementById("kpiMetricRows").innerHTML = "";
    metricRowCount = 0;
    addMetricRow();
    await loadKpiPanel();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

async function saveManualScores() {
  const interviewScore = document.getElementById("kpiInterviewScore").value;
  const pretestScore = document.getElementById("kpiPretestScore").value;
  try {
    await API.patch(`/api/candidates/${activeCandidateId}/scores`, {
      interviewScore: interviewScore === "" ? null : Number(interviewScore),
      pretestScore: pretestScore === "" ? null : Number(pretestScore),
    });
    toast("Scores saved");
    await loadKpiPanel();
  } catch (e) { toast(e.message, true); }
}

function renderSubmission(sub) {
  const profileRows = Object.entries(sub.profile || {}).map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</div>`).join("");
  const answerRows = Object.entries(sub.answers || {}).map(([k, v]) => `<div style="margin-top:4px;"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</div>`).join("");
  return `<div>${profileRows}${answerRows}<div class="muted" style="margin-top:6px;">Submitted ${timeAgo(sub.submittedAt)}</div></div>`;
}

async function sendLink(channel) {
  try {
    const data = await API.post(`/api/candidates/${activeCandidateId}/send`, { channel });
    toast(`Sent via ${channel} (sandbox mock delivery)`);
    if (data.link) {
      document.getElementById("lastLinkBox").innerHTML = `<div class="copy-box"><span>${data.link}</span></div>`;
    }
    await openCandidate(activeCandidateId);
    await loadCandidates();
    await loadReports();
  } catch (e) { toast(e.message, true); }
}

// ---------------- Interviews ----------------
async function loadInterviews() {
  try {
    const data = await API.get("/api/interviews");
    const body = document.getElementById("interviewsBody");
    if (!data.sessions.length) {
      body.innerHTML = `<tr><td colspan="6" class="muted" style="padding:30px 12px;">No interviews scheduled yet.</td></tr>`;
      return;
    }
    body.innerHTML = data.sessions.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.candidate ? s.candidate.name : "—")}</strong></td>
        <td><span class="pill ${s.mode === "ai" ? "created" : "active"}">${s.mode === "ai" ? "AI-conducted" : s.mode === "human_pending" ? "Queued" : "Human-conducted"}</span></td>
        <td><span class="pill neutral">${s.status.replace("_", " ")}</span></td>
        <td>${escapeHtml(s.assignedUserName || "—")}</td>
        <td>${timeAgo(s.scheduledAt)}</td>
        <td><button class="btn secondary sm" onclick="joinInterview('${s.id}')">Join room</button></td>
      </tr>
    `).join("");
  } catch (e) { toast(e.message, true); }
}

function joinInterview(sessionId) {
  window.open(`/interview-room.html?session=${sessionId}&role=hr`, "_blank");
}
function renderMyFeatures() {
  if (!ME) return;
  document.getElementById("myFeaturesList").innerHTML = ME.features.map((f) => `
    <div class="feature-row">
      <div class="name">${escapeHtml(f.label)}</div>
      <span class="pill ${f.enabled ? "active" : "suspended"}">${f.enabled ? "Enabled" : "Off"}</span>
    </div>
  `).join("");
}
