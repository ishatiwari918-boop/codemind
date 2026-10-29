const $ = id => document.getElementById(id);
let token = localStorage.getItem("token");
let currentId = null;

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showApp(loggedIn) {
  $("auth").hidden = loggedIn;
  $("app").hidden = !loggedIn;
  if (loggedIn) loadProjects();
}

function logout() {
  token = null;
  currentId = null;
  localStorage.removeItem("token");
  showApp(false);
}

async function authenticate(kind) {
  $("authError").textContent = "";
  try {
    const data = await api(`/auth/${kind}`, "POST", {
      email: $("email").value.trim(),
      password: $("password").value,
    });
    token = data.token;
    localStorage.setItem("token", token);
    $("password").value = "";
    showApp(true);
  } catch (err) {
    $("authError").textContent = err.message;
  }
}

$("loginBtn").onclick = () => authenticate("login");
$("signupBtn").onclick = () => authenticate("signup");
$("logoutBtn").onclick = logout;

let pollTimer = null;
async function loadProjects() {
  try {
    const { projects } = await api("/projects");
    const list = $("projects");
    list.replaceChildren();
    for (const p of projects) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.textContent = p.name;
      if (p.id === currentId) btn.className = "active";
      const status = document.createElement("div");
      status.className = "status";
      status.textContent =
        p.status === "ready" ? `${p.chunks} chunks` : p.status === "failed" && p.error ? `failed: ${p.error}` : p.status;
      btn.appendChild(status);
      btn.onclick = () => selectProject(p);

      const del = document.createElement("button");
      del.className = "del secondary";
      del.textContent = "×";
      del.title = "Delete project";
      del.onclick = () => deleteProject(p);

      li.append(btn, del);
      list.appendChild(li);
    }
    clearTimeout(pollTimer);
    if (projects.some(p => p.status === "indexing")) pollTimer = setTimeout(loadProjects, 2000);
  } catch { /* a 401 already logged the user out */ }
}

async function deleteProject(p) {
  if (!confirm(`Delete "${p.name}" and its index?`)) return;
  try {
    await api(`/projects/${p.id}`, "DELETE");
    if (p.id === currentId) {
      currentId = null;
      $("question").disabled = true;
      $("askBtn").disabled = true;
      $("messages").replaceChildren();
      addMessage("bot", "Pick a project, then ask a question.");
    }
    loadProjects();
  } catch (err) {
    alert(err.message);
  }
}

function selectProject(p) {
  currentId = p.id;
  const ready = p.status === "ready";
  $("question").disabled = !ready;
  $("askBtn").disabled = !ready;
  $("messages").replaceChildren();
  addMessage("bot", ready ? `Ask anything about "${p.name}".` : `This project is ${p.status}.`);
  loadProjects();
}

$("addForm").onsubmit = async e => {
  e.preventDefault();
  $("addError").textContent = "";
  try {
    const source = $("projFolder").value.trim();
    // A link means "clone from GitHub"; anything else is a local folder name (development only)
    const body = /^https?:\/\//i.test(source)
      ? { name: $("projName").value.trim(), repoUrl: source }
      : { name: $("projName").value.trim(), folder: source };
    await api("/projects", "POST", body);
    $("projName").value = "";
    $("projFolder").value = "";
    loadProjects();
  } catch (err) {
    $("addError").textContent = err.message;
  }
};

// textContent only, never innerHTML: answers come from an LLM and must not run as HTML
function addMessage(role, text, sources = []) {
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : ""}`;
  div.textContent = text;
  if (sources.length) {
    const s = document.createElement("div");
    s.className = "sources";
    s.append("Sources: ");
    sources.forEach((src, i) => {
      const code = document.createElement("code");
      code.textContent = `${src.file} [${src.name}] ${src.startLine}-${src.endLine}`;
      s.append(code, i < sources.length - 1 ? " " : "");
    });
    div.appendChild(s);
  }
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
  return div;
}

$("askForm").onsubmit = async e => {
  e.preventDefault();
  const question = $("question").value.trim();
  if (!question || currentId === null) return;
  $("question").value = "";
  addMessage("user", question);
  const thinking = addMessage("bot", "Thinking...");
  $("askBtn").disabled = true;
  try {
    const data = await api(`/projects/${currentId}/ask`, "POST", { question });
    thinking.remove();
    addMessage("bot", data.answer, data.sources);
  } catch (err) {
    thinking.textContent = err.message;
  } finally {
    $("askBtn").disabled = false;
  }
};

showApp(Boolean(token));