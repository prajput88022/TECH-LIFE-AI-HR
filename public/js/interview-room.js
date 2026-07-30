// Shared logic for both roles in the interview room.
//   ?token=<candidate formToken>&role=candidate           (public, no login)
//   ?session=<interviewSessionId>&role=hr                 (authenticated HR/Management)
//
// WebRTC is a simple 2-party mesh signaled over Socket.IO (no media touches the server).
// The "AI interviewer" runs entirely in the candidate's browser using the Web Speech API.
// Every call is locally recorded (mixed local+remote audio, plus local video) via
// MediaRecorder and uploaded to the server for storage + later playback; the transcript is
// separately run through sentiment/anger/diarization analysis (src/services/callAnalysisService.js).

const params = new URLSearchParams(window.location.search);
const ROLE = params.get("role") === "hr" ? "hr" : "candidate";
const TOKEN = params.get("token");
const SESSION_ID = params.get("session");

let ROOM = null;
let SESSION_META = null;
let socket = null;
let pc = null;
let localStream = null;
let remoteStream = null;
let myName = ROLE === "hr" ? (API.getUser() ? API.getUser().name : "HR") : "Candidate";

let qIndex = 0;
let recognizer = null;
let aiPaused = false;
let aiActive = false;

// Recording
let audioCtx = null;
let mixDest = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingUploaded = false;

(async function init() {
  try {
    if (ROLE === "candidate") {
      if (!TOKEN) throw new Error("Missing interview token");
      const res = await fetch(`/api/public/room/${TOKEN}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load interview room");
      ROOM = data;
      myName = data.candidateName;
      if (data.externalMeetingLink) {
        const banner = document.getElementById("externalMeetingBanner");
        banner.style.display = "block";
        banner.innerHTML = `Your organization also uses a team meeting room for this interview: <a href="${data.externalMeetingLink}" target="_blank">${data.externalMeetingLink}</a>`;
      }

      document.getElementById("loading").style.display = "none";
      if (!data.consentGiven) {
        document.getElementById("consentOverlay").style.display = "flex";
        return; // wait for giveConsent()
      }
      await enterRoom();
    } else {
      requireSession(["hr", "management", "superadmin"]);
      if (!SESSION_ID) throw new Error("Missing session id");
      const data = await API.get(`/api/interviews/${SESSION_ID}`);
      SESSION_META = data;
      ROOM = { roomId: data.session.roomId, mode: data.session.mode, aiPaused: data.session.aiPaused, candidateName: data.candidate.name };
      document.getElementById("loading").style.display = "none";
      await enterRoom();
      data.transcript.forEach((t) => appendTranscript(t.speaker, t.text, t.speakerName));
      if (data.session.callAnalysis) renderAnalysis(data.session.callAnalysis);
    }
  } catch (e) {
    document.getElementById("loading").textContent = e.message;
  }
})();

async function giveConsent() {
  const errEl = document.getElementById("consentErr");
  errEl.classList.remove("show");
  try {
    await fetch(`/api/public/room/${TOKEN}/consent`, { method: "POST" });
    document.getElementById("consentOverlay").style.display = "none";
    await enterRoom();
  } catch (e) {
    errEl.textContent = "Could not record your consent — please try again.";
    errEl.classList.add("show");
  }
}

async function enterRoom() {
  document.getElementById("room").style.display = "block";
  document.getElementById("roomTitle").textContent = ROLE === "hr" ? `Interview: ${ROOM.candidateName}` : "Your screening conversation";
  document.getElementById("roomSub").textContent = ROLE === "hr" ? "You are joining as the human interviewer." : "Sit back, relax, and answer naturally — this may be AI-assisted.";
  updateModeBadge();

  if (ROLE === "hr") document.getElementById("hrControls").style.display = "block";

  await setupMedia();
  setupSocket();
  buildDialpad();

  if (ROLE === "candidate" && ROOM.mode === "ai") {
    startAIInterview();
  } else if (ROLE === "candidate") {
    setStatus("Waiting for your interviewer to join…", false);
  }
}

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
  startRecording();
}

function ensurePeerConnection() {
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("signal", { roomId: ROOM.roomId, data: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    remoteStream = e.streams[0];
    document.getElementById("remoteVideo").srcObject = remoteStream;
    document.getElementById("aiTile").style.display = "none";
    document.getElementById("remoteLabel").textContent = ROLE === "hr" ? ROOM.candidateName : (ROOM.assignedUserName || "Interviewer");
    attachRemoteToRecording(remoteStream);
  };
  return pc;
}

function setupSocket() {
  socket = io();
  socket.on("connect", () => {
    socket.emit("join-room", { roomId: ROOM.roomId, role: ROLE, name: myName });
  });

  socket.on("peer-joined", async ({ role }) => {
    const conn = ensurePeerConnection();
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    socket.emit("signal", { roomId: ROOM.roomId, data: { sdp: offer } });
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
  socket.on("dtmf-pressed", ({ digit, by }) => {
    const log = document.getElementById("dtmfLog");
    if (log) log.textContent = `${by} pressed: ${digit}`;
  });

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
  stopRecordingAndUpload().finally(() => {
    if (socket) socket.disconnect();
    if (pc) pc.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    window.location.href = ROLE === "hr" ? "/dashboard.html" : "about:blank";
  });
}

// ---------------- Dial pad (RTCDTMFSender) ----------------
function buildDialpad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  document.getElementById("dialpadGrid").innerHTML = keys.map((k) => `<button onclick="pressDigit('${k}')">${k}</button>`).join("");
}
function toggleDialpad() {
  document.getElementById("dialpadCard").classList.toggle("show");
}
function pressDigit(digit) {
  const log = document.getElementById("dtmfLog");
  if (log) log.textContent = `You pressed: ${digit}`;
  socket.emit("dtmf-pressed", { roomId: ROOM.roomId, digit, by: myName });

  // Real WebRTC DTMF - sends telephone-event RTP packets over the active audio sender.
  // Meaningful once this call is bridged into a real telephony/IVR system (Asterisk/FreeSWITCH/
  // Twilio); between two plain browser peers there's no PSTN endpoint to receive it, so this is
  // the genuine API call with no visible effect on the other browser tab beyond the log above.
  try {
    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");
      if (sender && sender.dtmf && sender.dtmf.canInsertDTMF) sender.dtmf.insertDTMF(digit, 200, 100);
    }
  } catch (e) { /* non-fatal */ }
}

// ---------------- Call recording (MediaRecorder + Web Audio mixing) ----------------
const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm",
  "video/mp4", // Safari
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function setRecordingStatus(text, isError) {
  const el = document.getElementById("recIndicator");
  if (!el) return;
  el.style.display = "inline-block";
  el.innerHTML = isError ? `<span style="color:var(--danger);">⚠ ${escapeHtml(text)}</span>` : `<span class="rec-dot"></span>${escapeHtml(text)}`;
}

function startRecording() {
  try {
    if (!localStream) { setRecordingStatus("Recording unavailable — no microphone/camera access", true); return; }
    if (typeof MediaRecorder === "undefined") { setRecordingStatus("Recording is not supported in this browser", true); return; }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mixDest = audioCtx.createMediaStreamDestination();
    const localAudioTracks = localStream.getAudioTracks();
    if (localAudioTracks.length) audioCtx.createMediaStreamSource(new MediaStream(localAudioTracks)).connect(mixDest);

    const videoTrack = localStream.getVideoTracks()[0];
    const combined = new MediaStream();
    if (videoTrack) combined.addTrack(videoTrack);
    mixDest.stream.getAudioTracks().forEach((t) => combined.addTrack(t));

    if (!combined.getTracks().length) { setRecordingStatus("Nothing to record — no audio or video track available", true); return; }

    const mimeType = RECORDING_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || "";
    if (!mimeType) { setRecordingStatus("No supported recording format in this browser", true); return; }

    mediaRecorder = new MediaRecorder(combined, { mimeType });
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onerror = (e) => setRecordingStatus(`Recording error: ${e.error?.message || "unknown"}`, true);
    mediaRecorder.start(1000);
    setRecordingStatus("Recording this call", false);
  } catch (e) {
    setRecordingStatus(`Recording could not start (${e.message})`, true);
  }
}

function attachRemoteToRecording(stream) {
  try {
    if (!audioCtx || !mixDest) return;
    const remoteAudioTracks = stream.getAudioTracks();
    if (remoteAudioTracks.length) audioCtx.createMediaStreamSource(new MediaStream(remoteAudioTracks)).connect(mixDest);
  } catch (e) { /* non-fatal */ }
}

async function stopRecordingAndUpload() {
  if (!mediaRecorder || recordingUploaded) return;
  recordingUploaded = true;
  setRecordingStatus("Saving recording…", false);
  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
        if (blob.size > 0) {
          const fd = new FormData();
          fd.append("recording", blob, "call-recording.webm");
          const res = ROLE === "candidate"
            ? await fetch(`/api/public/room/${TOKEN}/recording`, { method: "POST", body: fd })
            : await fetch(`/api/interviews/${SESSION_ID}/recording`, { method: "POST", headers: { Authorization: `Bearer ${API.token()}` }, body: fd });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Upload failed (${res.status})`); }
          setRecordingStatus("Recording saved", false);
        } else {
          setRecordingStatus("No recording data was captured", true);
        }
      } catch (e) {
        setRecordingStatus(`Could not save recording: ${e.message}`, true);
      }
      resolve();
    };
    try { mediaRecorder.stop(); } catch (e) { resolve(); }
  });
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
    await stopRecordingAndUpload();
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
  loadAnalysis();
}

async function loadAnalysis() {
  try {
    const data = await API.get(`/api/interviews/${SESSION_ID}/call-analysis?refresh=true`);
    renderAnalysis(data.analysis);
  } catch (e) { /* non-fatal */ }
}

function renderAnalysis(analysis) {
  const card = document.getElementById("analysisCard");
  const body = document.getElementById("analysisBody");
  if (!analysis || !analysis.available) {
    card.style.display = "block";
    body.innerHTML = `<div class="muted" style="font-size:12.5px;">${analysis ? escapeHtml(analysis.reason) : "No analysis yet."}</div>`;
    return;
  }
  card.style.display = "block";
  const sentimentPill = analysis.overallSentiment.label === "positive" ? "active" : analysis.overallSentiment.label === "negative" ? "suspended" : "neutral";
  body.innerHTML = `
    <div class="analysis-row"><span>Overall sentiment</span><span class="pill ${sentimentPill}">${analysis.overallSentiment.label} (${analysis.overallSentiment.score})</span></div>
    <div class="analysis-row"><span>Anger detected</span><span class="pill ${analysis.angerDetected ? "suspended" : "active"}">${analysis.angerDetected ? `Yes (${analysis.angerFlags.length})` : "No"}</span></div>
    <div class="analysis-row"><span>Candidate engagement</span><span>${analysis.engagementScore}/100</span></div>
    <div class="analysis-row"><span>Composite call quality</span><span><strong>${analysis.qualityScore}/100</strong></span></div>
    <div class="analysis-row"><span>Speaking share (candidate)</span><span>${analysis.diarization.candidate ? analysis.diarization.candidate.talkTimeSharePct : 0}%</span></div>
    <div class="muted" style="font-size:11px; margin-top:8px;">${escapeHtml(analysis.method)}</div>
  `;
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
