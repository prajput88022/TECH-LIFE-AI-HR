require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const authRoutes = require("./routes/authRoutes");
const superadminRoutes = require("./routes/superadminRoutes");
const candidateRoutes = require("./routes/candidateRoutes");
const publicRoutes = require("./routes/publicRoutes");
const reportRoutes = require("./routes/reportRoutes");
const meRoutes = require("./routes/meRoutes");
const interviewRoutes = require("./routes/interviewRoutes");
const metaRoutes = require("./routes/metaRoutes");
const kpiRoutes = require("./routes/kpiRoutes");
const scoringRoutes = require("./routes/scoringRoutes");
const resumeRoutes = require("./routes/resumeRoutes");
const promotionRoutes = require("./routes/promotionRoutes");
const complianceRoutes = require("./routes/complianceRoutes");
const mfaRoutes = require("./routes/mfaRoutes");
const { ensureSeeded } = require("./seed");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use("/api/candidates", candidateRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/me", meRoutes);
app.use("/api/interviews", interviewRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/candidates", kpiRoutes);
app.use("/api/candidates", resumeRoutes);
app.use("/api/candidates", promotionRoutes);
app.use("/api/scoring", scoringRoutes);
app.use("/api/reports", complianceRoutes);
app.use("/api/me/mfa", mfaRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "tech-life-ai-hr", time: new Date().toISOString(), db: db.info() }));

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// ---- WebRTC signaling + AI-control relay (Socket.IO) ----
// Rooms are keyed by interviewSessions.roomId. Each participant (candidate,
// HR/Management, or the in-browser AI interviewer) joins the same room and
// exchanges WebRTC offer/answer/ICE candidates through this relay. No media
// ever passes through the server - only signaling messages do.
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, role, name }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.name = name;
    socket.to(roomId).emit("peer-joined", { socketId: socket.id, role, name });
  });

  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", { from: socket.id, data });
  });

  socket.on("ai-control", ({ roomId, action }) => {
    // action: 'pause' (HR takes over) | 'resume' (hand back to AI)
    socket.to(roomId).emit("ai-control", { action, by: socket.data.name });
  });

  socket.on("live-caption", ({ roomId, speaker, text }) => {
    socket.to(roomId).emit("live-caption", { speaker, text });
  });

  socket.on("disconnect", () => {
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit("peer-left", { socketId: socket.id, role: socket.data.role });
    }
  });
});

(async () => {
  await ensureSeeded();
  server.listen(PORT, () => {
    console.log(`\nTech-Life AI HR platform running on http://localhost:${PORT}`);
    console.log(`Data layer: ${JSON.stringify(db.info())}`);
    console.log(`Superadmin console:  http://localhost:${PORT}/superadmin.html`);
    console.log(`Tenant portal login: http://localhost:${PORT}/index.html\n`);
  });
})();
