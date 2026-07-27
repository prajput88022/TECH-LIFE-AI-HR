const API = (() => {
  function token() { return localStorage.getItem("tlai_token"); }
  function setToken(t) { localStorage.setItem("tlai_token", t); }
  function clearSession() {
    localStorage.removeItem("tlai_token");
    localStorage.removeItem("tlai_user");
    localStorage.removeItem("tlai_tenant");
  }
  function setUser(u) { localStorage.setItem("tlai_user", JSON.stringify(u)); }
  function getUser() { try { return JSON.parse(localStorage.getItem("tlai_user")); } catch (e) { return null; } }
  function setTenant(t) { localStorage.setItem("tlai_tenant", JSON.stringify(t)); }
  function getTenant() { try { return JSON.parse(localStorage.getItem("tlai_tenant")); } catch (e) { return null; } }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401) { clearSession(); }
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    patch: (p, b) => request("PATCH", p, b),
    token, setToken, clearSession, setUser, getUser, setTenant, getTenant,
  };
})();

function requireSession(allowedRoles) {
  const user = API.getUser();
  if (!API.token() || !user || (allowedRoles && !allowedRoles.includes(user.role))) {
    window.location.href = "/index.html";
    return null;
  }
  return user;
}

function toast(msg, isError) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
