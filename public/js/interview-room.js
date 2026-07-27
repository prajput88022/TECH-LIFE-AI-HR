// Shared logic for both roles in the interview room.
//   ?token=<candidate formToken>&role=candidate           (public, no login)
//   ?session=<interviewSessionId>&role=hr                 (authenticated HR/Management)
//
// WebRTC is a simple 2-party mesh signaled over Socket.IO (no media touches the server).
// The "AI interviewer" runs entirely in the candidate's browser using the Web Speech API
// (speechSynthesis for the voice, SpeechRecognition for capturing spoken answers) — this is
// the "browser_webspeech" vendor from the Integrations page; swap in Deepgram/ElevenLabs/etc.
// by changing the vendor there and wiring src/services later without touching this UI.

const params = new URLSearchParams(window.location.search);
const ROLE = params.get("role") === "hr" ? "hr" : "candidate";
const TOKEN = params.get("token");
const SESSION_ID = params.get("session");

let ROOM = null;         // { roomId, mode, questions, ... }
let SESSION_META = null; // HR-only: { session, candidate }
let socket = null;
let pc = null;
let localStream = null;
let myName = ROLE === "hr" ? (API.getUser() ? API.getUser().name : "HR") : "Candidate";

let qIndex = 0;
let recognizer = null;
let aiPaused = false;
let aiActive = false;

(async function init() {
  try {
    if (ROLE === "candidate") {
      if (!TOKEN) throw new Error("Missing interview token");
      const res = await fetch(`/api/public/room/${TOKEN}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load interview room");
      ROOM = data;
      myName = data.candidateName;
    } else {
      requireSession(["hr", "management", "superadmin"]);
      if (!SESSION_ID) throw new Error("Missing session id");
      const data = await API.get(`/api/interviews/${SESSION_ID}`);
      SESSION_META = data;
      ROOM = { roomId: data.session.roomId, mode: data.session.mode, aiPaused: data.session.aiPaused, candidateName: data.candidate.name };
      data.transcript.forEach((t) => appendTranscript(t.speaker, t.text, t.speakerName));
    }

    document.getElementById("loading").style.display = "none";
    document.getElementById("room").style.display = "block";
    document.getElementById("roomTitle").textContent = ROLE === "hr" ? `Interview: ${ROOM.candidateName}` : "Your screening conversation";
    document.getElementById("roomSub").textContent = ROLE === "hr" ? "You are joining as the human interviewer." : "Sit back, relax, and answer naturally — this may be AI-assisted.";
    updateModeBadge();

    if (ROLE === "hr") document.getElementById("hrControls").style.display = "block";

    await setupMedia();
    setupSocket();

    if (ROLE === "candidate" && ROOM.mode === "ai") {
      startAIInterview();
    } else if (ROLE === "candidate") {
      setStatus("Waiting for your interviewer to join…", false);
    }
  } catch (e) {
    document.getElementById("loading").textContent = e.message;
  }
})();

function updateModeBadge() {
  const badge = document.getElementById("modeBadge");
  if (ROOM.mode === "ai") { badge.textContent = "AI-conducted"; badge.className = "pill created"; }
  else { badge.textContent = "Human-conducted"; badge.className = "pill active"; }
}

function setStatus(text, paused) {
  const el = document.getElementById("statusStrip");
  el.style.display = "block";
  el.textContent = text;
  el.className = "status-strip" + (paused ? " paused" : "");
}

// ---------------- Media + WebRTC ----------------
async function setupMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    document.getElementById("localVideo").srcObject = localStream;
  } catch (e) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      document.getElementById("localLabel").textContent = "You (audio only)";
    } catch (e2) {
      localStream = null;
      document.getElementById("localLabel").textContent = "You (no mic/camera access)";
    }
  }
}

function ensurePeerConnection() {
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("signal", { roomId: ROOM.roomId, data: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    document.getElementById("remoteVideo").srcObject = e.streams[0];
    document.getElementById("aiTile").style.display = "none";
    document.getElementById("remoteLabel").textContent = ROLE === "hr" ? ROOM.candidateName : (ROOM.assignedUserName || "Interviewer");
  };
  return pc;
}

function setupSocket() {
  socket = io();
  socket.on("connect", () => {
    socket.emit("join-room", { roomId: ROOM.roomId, role: ROLE, name: myName });
  });

  socket.on("peer-joined", async ({ role }) => {
    // The peer already in the room initiates the offer when someone new joins.
    const conn = ensurePeerConnection();
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    socket.emit("signal", { roomId: ROOM.roomId, data: { sdp: offer } });
    if (ROLE === "hr" && ROOM.mode === "ai") {
      document.getElementById("aiTile").style.display = "none"; // candidate's real video will arrive
    }
  });

  socket.on("signal", async ({ data }) => {
    const conn = ensurePeerConnection();
    if (data.sdp) {
      await conn.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        socket.emit("signal", { roomId: ROOM.roomId, data: { sdp: answer } });
      }
    } else if (data.candidate) {
      try { await conn.addIceCandidate(data.candidate); } catch (e) { /* ignore */ }
    }
  });

  socket.on("ai-control", ({ action, by }) => {
    if (action === "pause") {
      aiPaused = true;
      stopAIInterview();
      setStatus(`${by || "Your interviewer"} has joined live and taken over the conversation.`, true);
      document.getElementById("candidateQA").style.display = "none";
    } else if (action === "resume") {
      aiPaused = false;
      setStatus("Your AI interviewer has resumed the conversation.", false);
      if (ROLE === "candidate") startAIInterview();
    }
  });

  socket.on("live-caption", ({ speaker, text }) => appendTranscript(speaker, text));

  socket.on("peer-left", () => {
    document.getElementById("remoteLabel").textContent = "Left the room";
  });
}

function toggleMic() {
  if (!localStream) return;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
  const on = localStream.getAudioTracks()[0]?.enabled;
  document.getElementById("micBtn").classList.toggle("off", on === false);
}
function toggleCam() {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
  const on = localStream.getVideoTracks()[0]?.enabled;
  document.getElementById("camBtn").classList.toggle("off", on === false);
}

function leaveRoom() {
  if (socket) socket.disconnect();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  window.location.href = ROLE === "hr" ? "/dashboard.html" : "about:blank";
}

// ---------------- Transcript ----------------
function appendTranscript(speaker, text, speakerName) {
  const panel = document.getElementById("transcriptPanel");
  const label = speaker === "ai" ? "AI Interviewer" : speaker === "hr" ? (speakerName || "HR") : (ROOM.candidateName || "Candidate");
  const div = document.createElement("div");
  div.className = "t-line";
  div.innerHTML = `<div class="t-who ${speaker}">${escapeHtml(label)}</div><div>${escapeHtml(text)}</div>`;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

async function postTranscript(speaker, text) {
  appendTranscript(speaker, text, myName);
  socket.emit("live-caption", { roomId: ROOM.roomId, speaker, text });
  try {
    if (ROLE === "candidate") {
      await fetch(`/api/public/room/${TOKEN}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speaker, text }) });
    } else {
      await API.post(`/api/interviews/${SESSION_ID}/transcript`, { text });
    }
  } catch (e) { /* non-fatal */ }
}

// ---------------- AI interviewer (candidate side only) ----------------
function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1;
    utter.onend = resolve;
    utter.onerror = resolve;
    window.speechSynthesis.speak(utter);
  });
}

function listenOnce(timeoutMs = 12000) {
  return new Promise((resolve) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return resolve(null);
    const rec = new SpeechRecognition();
    recognizer = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { rec.stop(); } catch (e) {} resolve(null); } }, timeoutMs);
    rec.onresult = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(e.results[0][0].transcript);
    };
    rec.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
    rec.onend = () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
    try { rec.start(); } catch (e) { resolve(null); }
  });
}

async function startAIInterview() {
  if (aiActive || aiPaused) return;
  aiActive = true;
  document.getElementById("aiTile").style.display = "flex";
  document.getElementById("candidateQA").style.display = "block";
  setStatus("Your AI interviewer is speaking with you now. You can answer out loud or type below.", false);
  await runNextQuestion();
}

function stopAIInterview() {
  aiActive = false;
  window.speechSynthesis && window.speechSynthesis.cancel();
  if (recognizer) { try { recognizer.stop(); } catch (e) {} }
}

async function runNextQuestion() {
  if (aiPaused || !aiActive) return;
  const questions = ROOM.questions || [];
  if (qIndex >= questions.length) {
    document.getElementById("candidateQA").style.display = "none";
    setStatus("That's the end of your questions — thank you! Submitting your interview…", false);
    await speak("Thank you, that concludes our conversation. Your responses have been recorded.");
    await fetch(`/api/public/room/${TOKEN}/complete`, { method: "POST" });
    setStatus("Your interview is complete. You may close this window — HR will follow up soon.", false);
    return;
  }
  const q = questions[qIndex];
  renderQuestion(q);
  await postTranscript("ai", q.text);
  await speak(q.type === "mcq" ? `${q.text} Your options are: ${q.options.join(", ")}.` : q.text);
  if (aiPaused) return;

  const spoken = await listenOnce();
  if (spoken && !aiPaused) {
    document.getElementById("qaAnswer").value = spoken;
    await confirmAnswer(spoken);
  }
  // If nothing was picked up by speech, the candidate can still type + click "Submit answer".
}

function renderQuestion(q) {
  document.getElementById("qaTitle").textContent = `Question ${qIndex + 1} of ${(ROOM.questions || []).length}`;
  document.getElementById("qaText").textContent = q.text;
  document.getElementById("qaAnswer").value = "";
  const optsEl = document.getElementById("qaOptions");
  if (q.type === "mcq") {
    optsEl.innerHTML = q.options.map((o) => `<div class="opt-row" onclick="document.getElementById('qaAnswer').value=${JSON.stringify(o)}">${escapeHtml(o)}</div>`).join("");
  } else {
    optsEl.innerHTML = "";
  }
  document.getElementById("qaHint").textContent = "speechSynthesis" in window ? "Listening for your spoken answer — or just type it and click Submit." : "Your browser doesn't support voice capture here; please type your answer.";
}

async function submitAnswer() {
  const text = document.getElementById("qaAnswer").value.trim();
  if (!text) return;
  await confirmAnswer(text);
}

async function confirmAnswer(text) {
  if (recognizer) { try { recognizer.stop(); } catch (e) {} }
  await postTranscript("candidate", text);
  qIndex += 1;
  await runNextQuestion();
}

// ---------------- HR controls ----------------
async function takeover() {
  await API.post(`/api/interviews/${SESSION_ID}/takeover`, { action: "takeover" });
  socket.emit("ai-control", { roomId: ROOM.roomId, action: "pause" });
  document.getElementById("takeoverBtn").style.display = "none";
  document.getElementById("resumeBtn").style.display = "inline-flex";
  setStatus("You have taken over the conversation live.", true);
}

async function resumeAI() {
  await API.post(`/api/interviews/${SESSION_ID}/takeover`, { action: "resume_ai" });
  socket.emit("ai-control", { roomId: ROOM.roomId, action: "resume" });
  document.getElementById("takeoverBtn").style.display = "inline-flex";
  document.getElementById("resumeBtn").style.display = "none";
  setStatus("Handed the conversation back to the AI interviewer.", false);
}

function openDecision() {
  document.getElementById("decisionCard").style.display = "block";
}

async function submitDecision() {
  const errEl = document.getElementById("decisionErr");
  errEl.classList.remove("show");
  try {
    await API.post(`/api/interviews/${SESSION_ID}/decision`, {
      decision: document.getElementById("decisionSelect").value,
      notes: document.getElementById("decisionNotes").value,
      notifyCandidate: document.getElementById("notifyCandidate").checked,
    });
    toast("Decision saved");
    setTimeout(() => { window.location.href = "/dashboard.html"; }, 900);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add("show");
  }
}
