let ME = null;
let CASES = [];
let quickDecisionTarget = null; // { sessionId }
const INDUSTRY_LABELS = {};
const LEVEL_LABELS = {};

(async function init() {
  const user = requireSession(["hr", "management", "superadmin"]);
  if (!user) return;
  document.getElementById("whoName").textContent = user.name;
  document.getElementById("whoEmail").textContent = user.email;

  try {
    ME = await API.get("/api/me");
    document.getElementById("tenantTag").textContent = ME.tenant ? ME.tenant.name : "Reports";
  } catch (e) { toast(e.message, true); }

  await loadFilterCatalogs();
  await applyFilters();
})();

function logout() { API.clearSession(); window.location.href = "/index.html"; }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function openModal(id) { document.getElementById(id).classList.add("show"); }

async function loadFilterCatalogs() {
  try {
    const [ind, lvl] = await Promise.all([API.get("/api/meta/industries"), API.get("/api/meta/levels")]);
    ind.industries.forEach((i) => (INDUSTRY_LABELS[i.key] = i.label));
    lvl.levels.forEach((l) => (LEVEL_LABELS[l.key] = l.label));
    document.getElementById("fIndustry").innerHTML += ind.industries.map((i) => `<option value="${i.key}">${escapeHtml(i.label)}</option>`).join("");
    document.getElementById("fLevel").innerHTML += lvl.levels.map((l) => `<option value="${l.key}">${escapeHtml(l.label)}</option>`).join("");
  } catch (e) { toast(e.message, true); }
}

function showTab(tab) {
  ["cases", "approvals", "department", "webhooks"].forEach((t) => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? "block" : "none";
  });
  document.querySelectorAll(".report-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "approvals") loadApprovals();
  if (tab === "department") loadDepartment();
  if (tab === "webhooks") loadWebhooks();
}

function buildQuery() {
  const params = new URLSearchParams();
  const map = {
    fDateFrom: "dateFrom", fDateTo: "dateTo", fIndustry: "industry", fLevel: "level",
    fCaseType: "caseType", fStatus: "status", fMode: "interviewMode", fDecision: "decision",
    fSentiment: "sentiment", fSearch: "search",
  };
  Object.entries(map).forEach(([elId, key]) => {
    const v = document.getElementById(elId).value.trim();
    if (v) params.set(key, v);
  });
  if (document.getElementById("fAngerOnly").checked) params.set("angerOnly", "true");
  return params.toString();
}

async function applyFilters() {
  try {
    const qs = buildQuery();
    const data = await API.get(`/api/reports/cases${qs ? "?" + qs : ""}`);
    CASES = data.rows;
    renderSummary(CASES);
    renderCases(CASES);
  } catch (e) { toast(e.message, true); }
}

function renderSummary(rows) {
  const total = rows.length;
  const selected = rows.filter((r) => r.session && r.session.decision === "selected").length;
  const withAnger = rows.filter((r) => r.session && r.session.callAnalysis && r.session.callAnalysis.angerDetected).length;
  const avgReadiness = (() => {
    const scores = rows.filter((r) => r.readinessScore !== null).map((r) => r.readinessScore);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "—";
  })();
  document.getElementById("summaryStats").innerHTML = `
    <div class="card stat-card"><div class="num">${total}</div><div class="lbl">Cases matching filters</div></div>
    <div class="card stat-card"><div class="num">${selected}</div><div class="lbl">Selected / promoted</div></div>
    <div class="card stat-card"><div class="num">${avgReadiness}</div><div class="lbl">Avg. readiness score</div></div>
    <div class="card stat-card"><div class="num">${withAnger}</div><div class="lbl">Calls with anger flagged</div></div>
  `;
}

function sentimentSpan(session) {
  if (!session || !session.callAnalysis || !session.callAnalysis.sentiment) return `<span class="muted">—</span>`;
  const s = session.callAnalysis.sentiment;
  const angerBadge = session.callAnalysis.angerDetected ? ` <span class="anger-badge">ANGER</span>` : "";
  return `<span class="sentiment-${s.label}">${s.label}</span>${angerBadge}`;
}

function renderCases(rows) {
  document.getElementById("caseCount").textContent = `${rows.length} case${rows.length === 1 ? "" : "s"}`;
  const body = document.getElementById("casesBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10" class="muted" style="padding:30px 12px;">No cases match these filters.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.name)}</strong>${r.requiresEscalation ? ' <span class="pill created" style="font-size:10px;">Mgmt approval</span>' : ""}<br/><span class="muted" style="font-size:11.5px;">${escapeHtml(r.appliedRole || "")}</span></td>
      <td>${INDUSTRY_LABELS[r.industry] || r.industry}<br/><span class="muted" style="font-size:11.5px;">${LEVEL_LABELS[r.level] || r.level}</span></td>
      <td>${r.caseType}</td>
      <td><span class="pill ${r.status}">${r.status.replace(/_/g, " ")}</span></td>
      <td>${r.session ? (r.session.mode === "ai" ? "AI" : r.session.mode === "human_pending" ? "Queued" : "Human") : "—"}</td>
      <td>${sentimentSpan(r.session)}</td>
      <td class="score-chip">${r.readinessScore ?? "—"}</td>
      <td>${r.session && r.session.decision ? `<span class="pill ${r.session.decision === "selected" ? "active" : r.session.decision === "rejected" ? "suspended" : "created"}">${r.session.decision}</span>` : `<span class="muted">pending</span>`}</td>
      <td>${timeAgo(r.createdAt)}</td>
      <td>${r.session && !r.session.decision && r.session.status === "completed" ? `<button class="btn secondary sm" onclick="openQuickDecision('${r.session.id}','${escapeHtml(r.name)}')">Decide</button>` : ""}</td>
    </tr>
  `).join("");
}

async function loadApprovals() {
  try {
    const data = await API.get("/api/reports/pending-approvals");
    document.getElementById("approvalCount").textContent = `${data.count} pending`;
    const body = document.getElementById("approvalsBody");
    if (!data.pending.length) {
      body.innerHTML = `<tr><td colspan="7" class="muted" style="padding:30px 12px;">Nothing waiting on a decision right now.</td></tr>`;
      return;
    }
    body.innerHTML = data.pending.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${LEVEL_LABELS[p.level] || p.level}</td>
        <td>${p.mode === "ai" ? "AI" : "Human"}</td>
        <td>${p.sentiment ? `<span class="sentiment-${p.sentiment}">${p.sentiment}</span>${p.angerDetected ? ' <span class="anger-badge">ANGER</span>' : ""}` : "—"}</td>
        <td>${timeAgo(p.completedAt)}</td>
        <td>${p.requiresManagementApproval ? '<span class="pill created">Management only</span>' : '<span class="muted">HR or Management</span>'}</td>
        <td><button class="btn teal sm" onclick="openQuickDecision('${p.sessionId}','${escapeHtml(p.name)}')">Decide</button></td>
      </tr>
    `).join("");
  } catch (e) { toast(e.message, true); }
}

async function loadDepartment() {
  try {
    const data = await API.get("/api/reports/scorecards");
    document.getElementById("deptBody").innerHTML = data.departmentAnalytics.map((d) => `
      <tr><td>${INDUSTRY_LABELS[d.industry] || d.industry}</td><td>${d.count}</td><td>${d.avgReadinessScore ?? "—"}</td></tr>
    `).join("") || `<tr><td colspan="3" class="muted">No data yet.</td></tr>`;
  } catch (e) { toast(e.message, true); }
}

async function loadWebhooks() {
  try {
    const data = await API.get("/api/reports/webhook-deliveries");
    const body = document.getElementById("webhooksBody");
    if (!data.deliveries.length) {
      body.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px;">No webhook deliveries yet — configure WEBHOOK_URLS in .env and enable the Webhook/API feature to start sending events.</td></tr>`;
      return;
    }
    body.innerHTML = data.deliveries.map((d) => `
      <tr>
        <td>${timeAgo(d.deliveredAt)}</td>
        <td>${d.event}</td>
        <td class="muted" style="font-size:11.5px;">${d.urls.map(escapeHtml).join(", ")}</td>
        <td>${d.results.map((r) => `<span class="pill ${r.ok ? "active" : "suspended"}">${r.status || "error"}</span>`).join(" ")}</td>
      </tr>
    `).join("");
  } catch (e) { toast(e.message, true); }
}

function openQuickDecision(sessionId, name) {
  quickDecisionTarget = sessionId;
  document.getElementById("qdTitle").textContent = `Record decision — ${name}`;
  document.getElementById("qdNotes").value = "";
  document.getElementById("qdErr").classList.remove("show");
  openModal("modalQuickDecision");
}

async function submitQuickDecision() {
  const errEl = document.getElementById("qdErr");
  errEl.classList.remove("show");
  try {
    await API.post(`/api/interviews/${quickDecisionTarget}/decision`, {
      decision: document.getElementById("qdDecision").value,
      notes: document.getElementById("qdNotes").value,
      notifyCandidate: document.getElementById("qdNotify").checked,
    });
    toast("Decision saved");
    closeModal("modalQuickDecision");
    await applyFilters();
    if (document.getElementById("tab-approvals").style.display !== "none") await loadApprovals();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

function exportCsv() {
  const qs = buildQuery();
  window.open(`/api/reports/compliance-export?format=csv${qs ? "&" + qs : ""}`, "_blank");
}
