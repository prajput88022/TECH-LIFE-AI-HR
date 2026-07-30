// AI-based call evaluation, computed from the interview transcript that's already captured
// (each turn is tagged with its speaker — ai / candidate / hr — which is itself a basic form
// of diarization since every turn's speaker is known with certainty, unlike audio-only
// diarization which has to guess speaker boundaries from the waveform).
//
// Sentiment and anger detection here are lexicon/heuristic based and run entirely locally —
// no external NLP/AI API call is made (this environment has no network access to one). This
// is real, working analysis, just simpler than a commercial cloud NLP model; swap in a real
// provider by replacing scoreSentiment()/detectAnger() with an API call once you have one
// configured (see LLM_PROVIDER in .env.sample).

const POSITIVE_WORDS = ["great", "good", "excellent", "happy", "pleased", "confident", "enjoy", "success", "achieved", "strong", "proud", "positive", "improve", "improved", "opportunity", "growth", "helpful", "collaborat", "appreciate", "thank"];
const NEGATIVE_WORDS = ["bad", "difficult", "problem", "issue", "fail", "failed", "concern", "worried", "frustrat", "disappoint", "stress", "conflict", "delay", "missed", "poor", "struggl", "unable", "decline", "declining", "risk"];
const ANGER_WORDS = ["angry", "furious", "unacceptable", "ridiculous", "outrageous", "hate", "terrible", "worst", "useless", "incompetent", "shut up", "stupid", "sick of", "fed up"];

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z']+/g) || [];
}

function scoreSentiment(text) {
  const tokens = tokenize(text);
  if (!tokens.length) return { label: "neutral", score: 0 };
  let pos = 0;
  let neg = 0;
  tokens.forEach((t) => {
    if (POSITIVE_WORDS.some((w) => t.startsWith(w))) pos += 1;
    if (NEGATIVE_WORDS.some((w) => t.startsWith(w))) neg += 1;
  });
  const score = Math.max(-1, Math.min(1, (pos - neg) / Math.max(3, tokens.length / 8)));
  const label = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
  return { label, score: Math.round(score * 100) / 100 };
}

function detectAnger(text) {
  const lower = String(text || "").toLowerCase();
  const tokens = tokenize(text);
  const hasAngerWord = ANGER_WORDS.some((w) => lower.includes(w));
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
  const exclaims = (text.match(/!/g) || []).length;
  const angerSignal = hasAngerWord || capsWords >= 2 || exclaims >= 3;
  return { flagged: angerSignal, hasAngerWord, capsWords, exclaims };
}

function analyzeTranscript(entries) {
  if (!entries.length) {
    return { available: false, reason: "No transcript recorded for this session yet." };
  }

  const bySpeaker = { ai: [], candidate: [], hr: [] };
  const angerFlags = [];
  let sentimentSum = 0;
  let sentimentCount = 0;

  const turns = entries.map((e) => {
    const sentiment = scoreSentiment(e.text);
    const anger = detectAnger(e.text);
    const wordCount = tokenize(e.text).length;
    if (bySpeaker[e.speaker]) bySpeaker[e.speaker].push({ wordCount, sentiment });
    if (e.speaker === "candidate" || e.speaker === "hr") { sentimentSum += sentiment.score; sentimentCount += 1; }
    if (anger.flagged) angerFlags.push({ speaker: e.speaker, text: e.text.slice(0, 160), at: e.at, ...anger });
    return { speaker: e.speaker, at: e.at, wordCount, sentiment, angerFlagged: anger.flagged };
  });

  const totalWords = Object.values(bySpeaker).reduce((sum, arr) => sum + arr.reduce((s, x) => s + x.wordCount, 0), 0) || 1;
  const diarization = Object.fromEntries(Object.entries(bySpeaker).map(([speaker, arr]) => [
    speaker,
    {
      turns: arr.length,
      words: arr.reduce((s, x) => s + x.wordCount, 0),
      talkTimeSharePct: Math.round((arr.reduce((s, x) => s + x.wordCount, 0) / totalWords) * 100),
    },
  ]));

  const overallSentimentScore = sentimentCount ? Math.round((sentimentSum / sentimentCount) * 100) / 100 : 0;
  const overallSentimentLabel = overallSentimentScore > 0.15 ? "positive" : overallSentimentScore < -0.15 ? "negative" : "neutral";

  const candidateWords = diarization.candidate ? diarization.candidate.words : 0;
  const engagementScore = Math.max(0, Math.min(100, Math.round((candidateWords / Math.max(1, entries.filter((e) => e.speaker !== "candidate").length * 15)) * 100)));

  // A simple composite call-quality score: rewards balanced positive sentiment, candidate
  // engagement (they said enough to be evaluated), and the absence of anger flags.
  const qualityScore = Math.max(0, Math.min(100, Math.round(
    50 + overallSentimentScore * 30 + Math.min(20, engagementScore / 5) - angerFlags.length * 15
  )));

  return {
    available: true,
    turnCount: entries.length,
    diarization,
    overallSentiment: { label: overallSentimentLabel, score: overallSentimentScore },
    angerFlags,
    angerDetected: angerFlags.length > 0,
    engagementScore,
    qualityScore,
    turns,
    analyzedAt: new Date().toISOString(),
    method: "lexicon-heuristic (local, no external AI call) — see src/services/callAnalysisService.js",
  };
}

module.exports = { analyzeTranscript, scoreSentiment, detectAnger };
