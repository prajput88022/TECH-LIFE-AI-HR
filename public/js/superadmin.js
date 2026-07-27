let CATALOG = [];
let TENANTS = [];
let activeTenantId = null;

(async function init() {
  const user = requireSession(["superadmin"]);
  if (!user) return;
  document.getElementById("whoName").textContent = user.name;
  document.getElementById("whoEmail").textContent = user.email;

  try {
    const cat = await API.get("/api/superadmin/feature-catalog");
    CATALOG = cat.features;
  } catch (e) { toast(e.message, true); }

  await loadOverview();
  await loadTenants();
  await loadActivity();
})();

function logout() { API.clearSession(); window.location.href = "/index.html"; }

function showView(view) {
  ["overview", "tenants", "integrations", "industries", "activity"].forEach((v) => {
    document.getElementById(`view-${v}`).style.display = v === view ? "block" : "none";
  });
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  if (view === "integrations") loadIntegrations();
  if (view === "industries") loadIndustries();
}

function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function openModal(id) { document.getElementById(id).classList.add("show"); }

// ---------------- Overview ----------------
async function loadOverview() {
  try {
    const ov = await API.get("/api/superadmin/overview");
    document.getElementById("overviewStats").innerHTML = `
      ${statCard(ov.tenantCount, "Organizations")}
      ${statCard(ov.activeTenantCount, "Active organizations")}
      ${statCard(ov.userCount, "HR / Management users")}
      ${statCard(ov.candidateCount, "Candidates added")}
    `;
    const act = await API.get("/api/superadmin/activity");
    document.getElementById("overviewActivityBody").innerHTML = act.logs.slice(0, 8).map(activityRow(true)).join("") ||
      `<tr><td colspan="5" class="muted">No activity yet.</td></tr>`;
  } catch (e) { toast(e.message, true); }
}
function statCard(num, label) {
  return `<div class="card stat-card"><div class="num">${num}</div><div class="lbl">${label}</div></div>`;
}

// ---------------- Tenants ----------------
async function loadTenants() {
  try {
    const data = await API.get("/api/superadmin/tenants");
    TENANTS = data.tenants;
    renderTenants();
  } catch (e) { toast(e.message, true); }
}

function renderTenants() {
  const grid = document.getElementById("tenantGrid");
  if (!TENANTS.length) {
    grid.innerHTML = `<div class="card empty-state"><div class="big">No organizations yet</div>Create your first organization to get started.</div>`;
    return;
  }
  grid.innerHTML = TENANTS.map((t) => `
    <div class="card">
      <div class="flex between">
        <div>
          <div style="font-weight:700; font-size:15.5px;">${escapeHtml(t.name)}</div>
          <div class="muted" style="font-size:12.5px;">code: <strong>${escapeHtml(t.code)}</strong></div>
        </div>
        <span class="pill ${t.status === "active" ? "active" : "suspended"}">${t.status}</span>
      </div>
      <div class="flex wrap" style="margin-top:14px; gap:18px;">
        <div><div style="font-weight:700;">${t.userCount}</div><div class="muted" style="font-size:11.5px;">Users</div></div>
        <div><div style="font-weight:700;">${t.candidateCount}</div><div class="muted" style="font-size:11.5px;">Candidates</div></div>
        <div><div style="font-weight:700;">${t.enabledFeatureCount}/${CATALOG.length}</div><div class="muted" style="font-size:11.5px;">Features on</div></div>
      </div>
      <div class="flex" style="margin-top:16px;">
        <button class="btn teal sm" onclick="openManageTenant('${t.id}')">Manage features &amp; users</button>
        <button class="btn secondary sm" onclick="toggleTenantStatus('${t.id}','${t.status}')">${t.status === "active" ? "Suspend" : "Reactivate"}</button>
      </div>
    </div>
  `).join("");
}

function openCreateTenant() {
  document.getElementById("newTenantName").value = "";
  document.getElementById("newTenantCode").value = "";
  document.getElementById("errCreateTenant").classList.remove("show");
  document.getElementById("newTenantFeatures").innerHTML = CATALOG.map((f) => `
    <div class="feature-row">
      <div>
        <div class="name">${escapeHtml(f.label)}</div>
        <div class="desc">${escapeHtml(f.description)}</div>
      </div>
      <label class="switch"><input type="checkbox" data-key="${f.key}" ${f.defaultOn ? "checked" : ""}/><span class="slider"></span></label>
    </div>
  `).join("");
  openModal("modalCreateTenant");
}

async function submitCreateTenant() {
  const name = document.getElementById("newTenantName").value.trim();
  const code = document.getElementById("newTenantCode").value.trim();
  const errEl = document.getElementById("errCreateTenant");
  errEl.classList.remove("show");
  const features = Array.from(document.querySelectorAll("#newTenantFeatures input[type=checkbox]:checked")).map((el) => el.dataset.key);
  try {
    await API.post("/api/superadmin/tenants", { name, code, features });
    closeModal("modalCreateTenant");
    toast("Organization created");
    await loadTenants();
    await loadOverview();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

async function toggleTenantStatus(id, currentStatus) {
  const status = currentStatus === "active" ? "suspended" : "active";
  try {
    await API.patch(`/api/superadmin/tenants/${id}/status`, { status });
    toast(`Organization ${status}`);
    await loadTenants();
  } catch (e) { toast(e.message, true); }
}

// ---------------- Manage tenant modal (features + users) ----------------
async function openManageTenant(tenantId) {
  activeTenantId = tenantId;
  const tenant = TENANTS.find((t) => t.id === tenantId);
  document.getElementById("manageTenantTitle").textContent = tenant.name;
  document.getElementById("manageTenantSub").textContent = `Organization code: ${tenant.code}`;
  document.getElementById("errAddUser").classList.remove("show");
  document.getElementById("newUserName").value = "";
  document.getElementById("newUserEmail").value = "";
  document.getElementById("newUserPassword").value = "";

  await refreshFeatures(tenantId);
  await refreshUsers(tenantId);
  openModal("modalManageTenant");
}

async function refreshFeatures(tenantId) {
  const data = await API.get(`/api/superadmin/tenants/${tenantId}/features`);
  document.getElementById("manageFeaturesList").innerHTML = data.features.map((f) => `
    <div class="feature-row">
      <div>
        <div class="name">${escapeHtml(f.label)}</div>
        <div class="desc">${escapeHtml(f.description)}</div>
      </div>
      <label class="switch"><input type="checkbox" data-key="${f.key}" ${f.enabled ? "checked" : ""}/><span class="slider"></span></label>
    </div>
  `).join("");
}

async function saveFeatures() {
  const enabledKeys = Array.from(document.querySelectorAll("#manageFeaturesList input[type=checkbox]:checked")).map((el) => el.dataset.key);
  try {
    await API.put(`/api/superadmin/tenants/${activeTenantId}/features`, { enabledKeys });
    toast("Features updated");
    await loadTenants();
  } catch (e) { toast(e.message, true); }
}

async function refreshUsers(tenantId) {
  const data = await API.get(`/api/superadmin/tenants/${tenantId}/users`);
  const list = document.getElementById("manageUsersList");
  if (!data.users.length) {
    list.innerHTML = `<div class="muted" style="font-size:13px; padding:8px 0;">No users yet in this organization.</div>`;
    return;
  }
  list.innerHTML = `<table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.users.map((u) => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${u.role}</td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="pill ${u.status === "active" ? "active" : "disabled"}">${u.status}</span></td>
        <td><button class="btn secondary sm" onclick="toggleUserStatus('${u.id}','${u.status}')">${u.status === "active" ? "Disable" : "Enable"}</button></td>
      </tr>
    `).join("")}
  </tbody></table>`;
}

async function submitAddUser() {
  const errEl = document.getElementById("errAddUser");
  errEl.classList.remove("show");
  const payload = {
    name: document.getElementById("newUserName").value.trim(),
    email: document.getElementById("newUserEmail").value.trim(),
    password: document.getElementById("newUserPassword").value,
    role: document.getElementById("newUserRole").value,
  };
  try {
    await API.post(`/api/superadmin/tenants/${activeTenantId}/users`, payload);
    toast("User created");
    document.getElementById("newUserName").value = "";
    document.getElementById("newUserEmail").value = "";
    document.getElementById("newUserPassword").value = "";
    await refreshUsers(activeTenantId);
    await loadTenants();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

async function toggleUserStatus(userId, currentStatus) {
  const status = currentStatus === "active" ? "disabled" : "active";
  try {
    await API.patch(`/api/superadmin/users/${userId}/status`, { status });
    toast(`User ${status}`);
    await refreshUsers(activeTenantId);
  } catch (e) { toast(e.message, true); }
}

// ---------------- Activity ----------------
async function loadActivity() {
  try {
    const act = await API.get("/api/superadmin/activity");
    document.getElementById("activityBody").innerHTML = act.logs.map(activityRow(false)).join("") ||
      `<tr><td colspan="6" class="muted">No activity yet.</td></tr>`;
  } catch (e) { toast(e.message, true); }
}

function activityRow(compact) {
  return (log) => {
    const tenant = TENANTS.find((t) => t.id === log.tenantId);
    const tenantName = tenant ? tenant.name : (log.tenantId ? "—" : "Platform");
    return compact
      ? `<tr><td>${timeAgo(log.createdAt)}</td><td>${escapeHtml(tenantName)}</td><td>${escapeHtml(log.actorName)}</td><td>${log.action}</td><td class="muted">${escapeHtml(log.details)}</td></tr>`
      : `<tr><td>${new Date(log.createdAt).toLocaleString()}</td><td>${escapeHtml(tenantName)}</td><td>${escapeHtml(log.actorName)}</td><td>${log.role}</td><td>${log.action}</td><td class="muted">${escapeHtml(log.details)}</td></tr>`;
  };
}

// ---------------- Integrations ----------------
const FIELD_LABELS = {
  apiKey: "API key", model: "Model", baseUrl: "Base URL", projectId: "Project ID",
  voiceId: "Voice ID", region: "Region", voiceName: "Voice name", token: "Access token",
  amiHost: "AMI host", amiPort: "AMI port", amiUser: "AMI username", amiSecret: "AMI secret",
  eslHost: "ESL host", eslPort: "ESL port", eslPassword: "ESL password",
  accountSid: "Account SID", authToken: "Auth token", fromNumber: "From number",
  clientId: "Client ID", clientSecret: "Client secret", tenantId: "Directory / Tenant ID",
  host: "SMTP host", port: "SMTP port", secure: "Use TLS", user: "SMTP username", pass: "SMTP password", fromAddress: "From address",
};

async function loadIntegrations() {
  try {
    const data = await API.get("/api/superadmin/integrations");
    const grid = document.getElementById("integrationsGrid");
    grid.innerHTML = Object.entries(data.categories).map(([key, cat]) => renderIntegrationCard(key, cat)).join("");
  } catch (e) { toast(e.message, true); }
}

function renderIntegrationCard(key, cat) {
  const cfg = cat.config || {};
  const currentVendor = cfg.vendor || cat.defaultVendor;
  return `
    <div class="card" id="intcard-${key}">
      <div class="flex between">
        <div style="font-weight:700;">${escapeHtml(cat.label)}</div>
        <label class="switch"><input type="checkbox" id="int-enabled-${key}" ${cfg.enabled ? "checked" : ""}/><span class="slider"></span></label>
      </div>
      <div class="field" style="margin-top:12px;">
        <label>Vendor</label>
        <select id="int-vendor-${key}" onchange="renderIntegrationFields('${key}')">
          ${Object.keys(cat.vendors).map((v) => `<option value="${v}" ${v === currentVendor ? "selected" : ""}>${vendorLabel(v)}</option>`).join("")}
        </select>
      </div>
      <div id="int-fields-${key}"></div>
      <button class="btn teal sm" style="margin-top:10px;" onclick="saveIntegration('${key}')">Save</button>
    </div>
  `;
}

function vendorLabel(v) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderIntegrationFields(key) {
  API.get("/api/superadmin/integrations").then((data) => {
    const cat = data.categories[key];
    const vendor = document.getElementById(`int-vendor-${key}`).value;
    const fields = (cat.vendors[vendor] || {}).fields || [];
    const cfg = cat.config || {};
    const box = document.getElementById(`int-fields-${key}`);
    if (!fields.length) {
      box.innerHTML = vendor.includes("browser") || vendor === "builtin_webrtc" || vendor === "builtin_rules"
        ? `<div class="muted" style="font-size:12.5px; margin-top:8px;">Works out of the box — no credentials needed.</div>`
        : vendor === "none" ? `<div class="muted" style="font-size:12.5px; margin-top:8px;">Disabled — no vendor selected.</div>` : "";
      return;
    }
    box.innerHTML = fields.map((f) => `
      <div class="field" style="margin-top:10px;">
        <label>${FIELD_LABELS[f] || f}</label>
        <input id="int-field-${key}-${f}" type="${f.toLowerCase().includes("secret") || f.toLowerCase().includes("pass") || f === "apiKey" || f === "authToken" || f === "token" ? "password" : "text"}" value="${cfg.vendor === vendor && cfg[f] ? escapeHtml(cfg[f]) : ""}" />
      </div>
    `).join("");
  });
}

async function saveIntegration(key) {
  const vendor = document.getElementById(`int-vendor-${key}`).value;
  const enabled = document.getElementById(`int-enabled-${key}`).checked;
  const payload = { vendor, enabled };
  document.querySelectorAll(`#int-fields-${key} input`).forEach((el) => {
    const fieldName = el.id.replace(`int-field-${key}-`, "");
    payload[fieldName] = el.type === "checkbox" ? el.checked : el.value;
  });
  try {
    await API.put(`/api/superadmin/integrations/${key}`, payload);
    toast(`${key.replace(/_/g, " ")} integration saved`);
  } catch (e) { toast(e.message, true); }
}

// ---------------- Industries ----------------
async function loadIndustries() {
  try {
    const data = await API.get("/api/superadmin/industries");
    const body = document.getElementById("industriesBody");
    body.innerHTML = data.industries.map((i) => `
      <tr>
        <td><code>${escapeHtml(i.key)}</code></td>
        <td>${escapeHtml(i.label)}</td>
        <td class="muted" style="font-size:12.5px;">${escapeHtml(i.focusQuestion)}</td>
        <td><span class="pill ${i.custom ? "created" : "neutral"}">${i.custom ? "Custom" : "Built-in"}</span></td>
        <td>${i.custom ? `<button class="btn secondary sm" onclick="removeIndustry('${i.id}')">Remove</button>` : ""}</td>
      </tr>
    `).join("");
  } catch (e) { toast(e.message, true); }
}

async function submitAddIndustry() {
  const errEl = document.getElementById("errAddIndustry");
  errEl.classList.remove("show");
  const payload = {
    key: document.getElementById("newIndKey").value.trim(),
    label: document.getElementById("newIndLabel").value.trim(),
    focusQuestion: document.getElementById("newIndQuestion").value.trim(),
  };
  if (!payload.key || !payload.label) {
    errEl.textContent = "Key and label are required.";
    errEl.classList.add("show");
    return;
  }
  try {
    await API.post("/api/superadmin/industries", payload);
    toast("Industry added");
    ["newIndKey", "newIndLabel", "newIndQuestion"].forEach((id) => (document.getElementById(id).value = ""));
    await loadIndustries();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}

async function removeIndustry(id) {
  try {
    const res = await fetch(`/api/superadmin/industries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${API.token()}` } });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to remove"); }
    toast("Industry removed");
    await loadIndustries();
  } catch (e) { toast(e.message, true); }
}
