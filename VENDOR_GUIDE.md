# Tech-Life AI HR — Vendor Integration Guide
## Complete Implementation for LLM, TTS, STT, Call & SIP Vendors

---

## Table of Contents
1. [LLM Vendors](#llm-vendors)
2. [TTS Vendors (Natural Voice)](#tts-vendors-natural-voice)
3. [STT Vendors (Speech-to-Text)](#stt-vendors-speech-to-text)
4. [Call Vendors (Telephony)](#call-vendors-telephony)
5. [SIP Providers](#sip-providers)
6. [Vendor Selection Workflow](#vendor-selection-workflow)
7. [Testing & Validation](#testing--validation)

---

## LLM Vendors

### Overview
The LLM (Large Language Model) powers:
- AI interview question generation
- Real-time response evaluation
- Behavioral assessment scoring
- Candidate feedback generation
- Promotion recommendation scoring

### 1.1 OpenAI (GPT-4/GPT-3.5)

#### Setup
```javascript
// src/services/llm/openaiService.js

const OpenAI = require('openai');

class OpenAIService {
  constructor(apiKey, model = 'gpt-4') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateInterviewQuestions(industry, level, assessmentType) {
    /**
     * @param {string} industry - IT, BFSI, Healthcare, etc.
     * @param {string} level - IC, L2, L3, Manager, Senior, VP
     * @param {string} assessmentType - technical, behavioral, aptitude
     */
    const prompt = `
      Generate 5 unique interview questions for:
      - Industry: ${industry}
      - Level: ${level}
      - Assessment Type: ${assessmentType}
      
      Format as JSON array with fields: question, difficulty, timeLimit, expectedKeywords
    `;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });

    return JSON.parse(response.choices[0].message.content);
  }

  async evaluateAnswer(question, candidateAnswer, rubric) {
    /**
     * Score candidate's answer against rubric
     * Returns: { score: 0-100, feedback: string, keywords_matched: [] }
     */
    const prompt = `
      Evaluate this candidate answer:
      
      Question: ${question}
      Answer: ${candidateAnswer}
      Scoring Rubric: ${JSON.stringify(rubric)}
      
      Return JSON: { score: 0-100, feedback: string, keywords_matched: [] }
    `;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    return JSON.parse(response.choices[0].message.content);
  }

  async generatePromotionScore(employeeData) {
    /**
     * Analyze KPI + assessment scores + interview performance
     * Returns: { score: 0-100, reasoning: string, recommendation: string }
     */
    const prompt = `
      Evaluate employee for promotion:
      ${JSON.stringify(employeeData, null, 2)}
      
      Return JSON: { score: 0-100, reasoning: string, recommendation: 'promote'|'hold'|'develop' }
    `;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1000
    });

    return JSON.parse(response.choices[0].message.content);
  }
}

module.exports = OpenAIService;
```

#### Configuration in Database
```javascript
{
  "_id": "tenantconfig:acme",
  "llm": {
    "vendor": "openai",
    "model": "gpt-4",
    "endpoint": "https://api.openai.com/v1",
    "timeout_ms": 30000,
    "max_tokens": 2000,
    "temperature": 0.7,
    "enabled": true
  }
}
```

#### Cost Estimation
- Question Generation: $0.003 per question (5 questions per interview = $0.015)
- Answer Evaluation: $0.002 per answer (5 questions = $0.01)
- **Total per interview: ~$0.025**
- **1000 interviews/month = $25**

---

### 1.2 Anthropic Claude

#### Setup
```javascript
// src/services/llm/claudeService.js

const Anthropic = require('@anthropic-ai/sdk');

class ClaudeService {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async generateInterviewQuestions(industry, level, assessmentType) {
    const message = await this.client.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `
            Generate 5 interview questions for ${industry}, level ${level}, type ${assessmentType}.
            Return as JSON array.
          `
        }
      ]
    });

    return JSON.parse(message.content[0].text);
  }

  async evaluateAnswer(question, candidateAnswer, rubric) {
    const message = await this.client.messages.create({
      model: 'claude-3-opus-20240229', // Most capable, for detailed evaluation
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `
            Evaluate answer to: "${question}"
            Answer: "${candidateAnswer}"
            Rubric: ${JSON.stringify(rubric)}
            Return JSON with score, feedback, keywords_matched.
          `
        }
      ]
    });

    return JSON.parse(message.content[0].text);
  }
}

module.exports = ClaudeService;
```

#### Advantages
- Better reasoning & explainability
- Stronger safety features
- Better at analyzing complex HR scenarios
- **Cost:** 2-3x cheaper than GPT-4

---

### 1.3 Custom/Self-Hosted (Ollama, vLLM)

#### Setup
```javascript
// src/services/llm/customEndpointService.js

const axios = require('axios');

class CustomLLMService {
  constructor(endpoint, model, apiKey = null) {
    this.endpoint = endpoint; // e.g., http://localhost:8000
    this.model = model; // e.g., 'mistral', 'llama2'
    this.apiKey = apiKey;
  }

  async generateInterviewQuestions(industry, level, assessmentType) {
    const prompt = `Generate 5 interview questions for ${industry}, ${level}, ${assessmentType}`;

    const response = await axios.post(`${this.endpoint}/v1/completions`, {
      model: this.model,
      prompt,
      max_tokens: 2000,
      temperature: 0.7
    }, {
      headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}
    });

    return JSON.parse(response.data.choices[0].text);
  }
}

module.exports = CustomLLMService;
```

#### Deployment Options
- **Ollama** (Local, free)
  - Models: Llama 2, Mistral, Neural Chat
  - No API key needed
  - Great for testing

- **vLLM** (Production-grade)
  - Higher throughput
  - Model serving with API
  - Kubernetes-ready

- **AWS SageMaker** (Managed)
  - Enterprise support
  - Auto-scaling
  - Integration with AWS services

---

### 1.4 LLM Vendor Factory

```javascript
// src/services/llm/llmFactory.js

const OpenAIService = require('./openaiService');
const ClaudeService = require('./claudeService');
const CustomLLMService = require('./customEndpointService');

class LLMFactory {
  static async createLLMService(tenantConfig) {
    const { vendor, endpoint, model } = tenantConfig.llm;
    const secrets = await getVendorSecrets(tenantConfig.tenant_id, 'llm');

    switch (vendor) {
      case 'openai':
        return new OpenAIService(secrets.api_key, model);
      
      case 'anthropic':
        return new ClaudeService(secrets.api_key);
      
      case 'custom':
        return new CustomLLMService(endpoint, model, secrets.api_key);
      
      default:
        throw new Error(`Unknown LLM vendor: ${vendor}`);
    }
  }
}

module.exports = LLMFactory;
```

---

## TTS Vendors (Natural Voice)

### Overview
TTS (Text-to-Speech) for natural AI voice in interviews:
- Interview question delivery
- Candidate answer prompts
- Real-time conversational flow
- Multiple voice profiles per industry

### 2.1 ElevenLabs

#### Features
- Natural voice quality (11 professional voices)
- Voice cloning capability
- Multiple languages
- Real-time streaming
- **Best for:** Most natural voice experience

#### Setup
```javascript
// src/services/tts/elevenLabsService.js

const axios = require('axios');

class ElevenLabsService {
  constructor(apiKey, voiceId) {
    this.apiKey = apiKey;
    this.voiceId = voiceId; // Specific voice ID
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  async synthesizeSpeech(text, options = {}) {
    /**
     * Convert text to audio stream
     * Returns: { audioUrl: string, duration: number, format: 'mp3' }
     */
    const response = await axios.post(
      `${this.baseUrl}/text-to-speech/${this.voiceId}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: options.stability || 0.75,
          similarity_boost: options.similarity_boost || 0.75
        }
      },
      {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    // Upload to cloud storage
    const audioUrl = await uploadToCloudStorage(response.data);
    
    return {
      audioUrl,
      duration: calculateDuration(response.data),
      format: 'mp3',
      voiceId: this.voiceId,
      timestamp: new Date()
    };
  }

  async getAvailableVoices() {
    /**
     * List all available voices
     * Returns: { voices: [{ voice_id, name, preview_url }] }
     */
    const response = await axios.get(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey }
    });

    return response.data.voices;
  }

  // Voice profiles per industry
  static VOICE_PROFILES = {
    'IT': {
      name: 'Professional Male - Tech',
      voiceId: 'EXAVITQu4vr4xnSDxMaL', // Professional voice
      stability: 0.7,
      clarity: 0.8
    },
    'BFSI': {
      name: 'Professional Female - Finance',
      voiceId: 'ThT5KcBeYPX3keUQqHPh', // Trustworthy voice
      stability: 0.8,
      clarity: 0.9
    },
    'Healthcare': {
      name: 'Calm Female - Medical',
      voiceId: 'jBpfuIE2acCO8z3wKNLl', // Empathetic voice
      stability: 0.85,
      clarity: 0.8
    }
  };
}

module.exports = ElevenLabsService;
```

#### Configuration
```javascript
{
  "_id": "tenantconfig:acme",
  "tts": {
    "vendor": "elevenlabs",
    "voice_profile": "professional_male",
    "language": "en-US",
    "speech_rate": 1.0,
    "natural_voice_enabled": true,
    "endpoint": "https://api.elevenlabs.io/v1",
    "timeout_ms": 5000,
    "enabled": true
  }
}
```

#### Pricing
- **Free:** 10,000 characters/month
- **Pro:** $99/month - 100,000 characters
- **Per call average:** 50 questions × 100 chars = 5,000 chars (~$0.05)

---

### 2.2 Google Cloud TTS

#### Setup
```javascript
// src/services/tts/googleTtsService.js

const textToSpeech = require('@google-cloud/text-to-speech');

class GoogleTTSService {
  constructor(projectId, credentialsPath) {
    this.client = new textToSpeech.TextToSpeechClient({
      projectId,
      keyFilename: credentialsPath
    });
  }

  async synthesizeSpeech(text, voiceName = 'en-US-Neural2-C') {
    /**
     * Google voice names:
     * en-US-Neural2-A: Professional Female
     * en-US-Neural2-C: Professional Male
     * en-US-Neural2-E: Young Female
     */
    const request = {
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: voiceName,
        ssmlGender: 'MALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0,
        speakingRate: 1.0
      }
    };

    const [response] = await this.client.synthesizeSpeech(request);
    
    const audioUrl = await uploadToCloudStorage(response.audioContent);
    
    return { audioUrl, format: 'mp3', voiceName };
  }
}

module.exports = GoogleTTSService;
```

#### Pricing
- **Free:** 1 million characters/month (generous!)
- **Paid:** $16 per 1 million characters above free tier
- **Neural voices:** 2x cost of standard

---

### 2.3 Azure Speech Services

#### Setup
```javascript
// src/services/tts/azureTtsService.js

const { SpeechSynthesizer, AudioConfig } = require('microsoft-cognitiveservices-speech-sdk');

class AzureTTSService {
  constructor(subscriptionKey, region) {
    this.subscriptionKey = subscriptionKey;
    this.region = region; // e.g., 'eastus'
  }

  async synthesizeSpeech(text, voiceName = 'en-US-AriaNeural') {
    const audioConfig = AudioConfig.fromDefaultSpeakerOutput();
    const speechConfig = SpeechConfig.fromSubscription(this.subscriptionKey, this.region);
    speechConfig.speechSynthesisVoiceName = voiceName;

    const synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

    return new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          synthesizer.close();
          resolve({ audioUrl: result.audioData, format: 'wav' });
        },
        (error) => {
          synthesizer.close();
          reject(error);
        }
      );
    });
  }
}

module.exports = AzureTTSService;
```

#### Available Voices
- Neural voices (most natural): en-US-AriaNeural, en-US-GuyNeural
- Standard voices: en-US-ZiraRUS, en-US-BenjaminRUS
- Multilingual support

---

## STT Vendors (Speech-to-Text)

### Overview
STT captures and transcribes candidate answers:
- Real-time transcription
- Keyword extraction
- Accent/language detection
- Confidence scoring

### 3.1 Deepgram

#### Setup
```javascript
// src/services/stt/deepgramService.js

const { createClient } = require('@deepgram/sdk');

class DeepgramService {
  constructor(apiKey) {
    this.client = createClient({ key: apiKey });
  }

  async transcribeAudio(audioStream, options = {}) {
    /**
     * Real-time transcription from audio stream
     * Returns: { transcript: string, confidence: 0-1, keywords: [] }
     */
    const response = await this.client.listen.prerecorded({
      stream: audioStream,
      model: 'nova-2',
      language: options.language || 'en',
      punctuate: true,
      paragraphs: true,
      keywords: options.keywords || []
    });

    const transcript = response.result.results.channels[0].alternatives[0].transcript;
    
    return {
      transcript,
      confidence: response.result.results.channels[0].alternatives[0].confidence,
      words: response.result.results.channels[0].alternatives[0].words,
      keywords: extractKeywords(transcript, options.keywords)
    };
  }

  async liveTranscription(websocketUrl) {
    /**
     * For real-time interview transcription
     * Emits events: 'transcription', 'interim', 'final'
     */
    const connection = this.client.listen.live({
      model: 'nova-2',
      language: 'en',
      punctuate: true,
      interim_results: true
    });

    connection.on('open', () => console.log('Deepgram connection open'));
    connection.on('close', () => console.log('Deepgram connection closed'));
    connection.on('transcriptionReceived', (msg) => {
      // Emit to candidate interview UI
      emitToWebSocket('transcription', msg);
    });

    return connection;
  }
}

module.exports = DeepgramService;
```

#### Pricing
- **Starter:** $0.0043/minute (transcription)
- **Pro:** $0.0040/minute
- **Average call:** 30 minutes × $0.004 = $0.12

---

### 3.2 Google Cloud Speech-to-Text

#### Setup
```javascript
// src/services/stt/googleSttService.js

const speech = require('@google-cloud/speech');

class GoogleSTTService {
  constructor(projectId, credentialsPath) {
    this.client = new speech.SpeechClient({
      projectId,
      keyFilename: credentialsPath
    });
  }

  async transcribeAudio(audioFile, language = 'en-US') {
    const audio = {
      content: audioFile
    };

    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: language,
      enableAutomaticPunctuation: true
    };

    const request = { audio, config };
    const [operation] = await this.client.longRunningRecognize(request);
    const [response] = await operation.promise();

    const transcript = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    const confidence = response.results[0]?.alternatives[0]?.confidence || 0;

    return { transcript, confidence };
  }
}

module.exports = GoogleSTTService;
```

#### Pricing
- **Free:** 60 minutes/month
- **Paid:** $0.024/minute
- **Auto-punctuation:** Included

---

### 3.3 Whisper (OpenAI Self-Hosted)

#### Setup
```javascript
// src/services/stt/whisperService.js

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class WhisperService {
  constructor(apiKey = null, endpoint = 'http://localhost:8000') {
    this.apiKey = apiKey; // If using OpenAI API
    this.endpoint = endpoint; // If using self-hosted
  }

  async transcribeAudio(audioFilePath, options = {}) {
    /**
     * OpenAI's Whisper model (open source)
     * Can be self-hosted for zero cost
     */
    const form = new FormData();
    form.append('file', fs.createReadStream(audioFilePath));
    form.append('model', 'base'); // tiny, base, small, medium, large

    if (this.apiKey) {
      // Use OpenAI API
      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...form.getHeaders()
        }
      });
      return { transcript: response.data.text, confidence: 0.95 };
    } else {
      // Use self-hosted
      const response = await axios.post(`${this.endpoint}/transcribe`, form, {
        headers: form.getHeaders()
      });
      return { transcript: response.data.text, confidence: response.data.confidence };
    }
  }
}

module.exports = WhisperService;
```

#### Deployment
```bash
# Self-hosted Whisper (Docker)
docker run -d \
  -p 8000:8000 \
  -e MODEL=base \
  openai/whisper-api
```

---

## Call Vendors (Telephony)

### Overview
Call vendors enable outbound interview invitations and real-time voice:
- Candidate invitation calls
- Auto-interview initiation
- HR availability signaling
- Call recording

### 4.1 Twilio

#### Setup
```javascript
// src/services/call/twilioService.js

const twilio = require('twilio');

class TwilioService {
  constructor(accountSid, authToken, fromNumber) {
    this.client = twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
  }

  async initiateInterviewCall(candidatePhone, interviewSessionId) {
    /**
     * Outbound call to candidate
     * TwiML routes to interview IVR
     */
    const twimlUrl = `${process.env.BASE_URL}/api/calls/twiml/${interviewSessionId}`;

    const call = await this.client.calls.create({
      to: candidatePhone,
      from: this.fromNumber,
      url: twimlUrl,
      record: 'record-from-answer',
      recordingStatusCallback: `${process.env.BASE_URL}/api/calls/recording/callback`,
      statusCallback: `${process.env.BASE_URL}/api/calls/status/callback`
    });

    return {
      callId: call.sid,
      status: call.status,
      timestamp: new Date()
    };
  }

  async recordCall(callSid) {
    /**
     * Start recording an active call
     */
    const recording = await this.client.calls(callSid).recordings.create();
    return { recordingId: recording.sid };
  }

  async transferCall(callSid, transferTo) {
    /**
     * Transfer call from AI to HR agent
     */
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.dial(transferTo, { timeout: 30 });

    return twiml.toString();
  }

  async getCallRecording(recordingSid) {
    /**
     * Retrieve call recording URL
     */
    const recording = await this.client.recordings(recordingSid).fetch();
    return {
      url: recording.uri,
      duration: recording.duration,
      size: recording.size
    };
  }
}

module.exports = TwilioService;
```

#### TwiML for Interview IVR
```javascript
// src/routes/callRoutes.js

app.post('/api/calls/twiml/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.say('Welcome to the interview system. Please wait while we connect you.');
  twiml.gather({
    numDigits: 1,
    action: `/api/calls/handle-dtmf/${sessionId}`,
    method: 'POST'
  }).say('Press 1 to continue with interview or 2 to speak with an HR representative.');

  res.type('text/xml');
  res.send(twiml.toString());
});
```

#### Pricing
- **Outbound calls:** $0.013/minute
- **Recording:** $0.0075/minute
- **Average 30-min interview:** ~$0.60

---

### 4.2 Asterisk AMI (On-Premise)

#### Setup
```javascript
// src/services/call/asteriskService.js

const AsteriskManager = require('asterisk.js');

class AsteriskService {
  constructor(host, port, username, secret) {
    this.client = new AsteriskManager(host, port, username, secret);
    this.client.connect();
  }

  async initiateCall(extension, destination, context = 'from-internal') {
    /**
     * Originate call from extension to destination
     */
    const response = await this.client.send({
      Action: 'Originate',
      Channel: `SIP/${extension}`,
      Exten: destination,
      Context: context,
      Priority: 1,
      Async: 'true'
    });

    return {
      callId: response['Uniqueid'],
      status: 'originating',
      timestamp: new Date()
    };
  }

  async recordCall(channel) {
    /**
     * Start recording for channel
     */
    return await this.client.send({
      Action: 'MixMonitor',
      Channel: channel,
      File: `/recordings/${Date.now()}`,
      Format: 'wav'
    });
  }

  async transferCall(channel, transferTo, context = 'from-internal') {
    /**
     * Blind transfer to another extension
     */
    return await this.client.send({
      Action: 'BlindTransfer',
      Channel: channel,
      Exten: transferTo,
      Context: context
    });
  }

  async getChannelInfo(channel) {
    /**
     * Get current channel/call info
     */
    return await this.client.send({
      Action: 'GetVar',
      Channel: channel,
      Variable: 'ALL'
    });
  }
}

module.exports = AsteriskService;
```

#### Configuration
```javascript
{
  "_id": "tenantconfig:acme",
  "call_vendor": {
    "provider": "asterisk",
    "asterisk": {
      "host": "pbx.company.com",
      "port": 5038,
      "context": "from-internal",
      "enabled": true
    }
  }
}
```

#### Advantages
- **No per-minute cost**
- Full control over call flow
- Better integration with SIP trunks
- On-premise/hybrid deployments

---

### 4.3 FreeSWITCH ESL (Event Socket Layer)

#### Setup
```javascript
// src/services/call/freeswitchService.js

const esl = require('modesl');

class FreeSwitchService {
  constructor(host, port, password) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.connections = new Map();
  }

  async initiateCall(fromExtension, toNumber, context = 'default') {
    /**
     * Originate call using FreeSWITCH originate API
     */
    const conn = await this.getConnection();

    const cmd = `originate {origination_uuid=${Date.now()}}sofia/gateway/provider/${toNumber} &echo`;
    
    return new Promise((resolve, reject) => {
      conn.api(cmd, (res) => {
        if (res.getHeader('Content-Type') === 'text/plain') {
          resolve({ callId: res.getBody(), status: 'originating' });
        } else {
          reject(new Error('Failed to originate call'));
        }
      });
    });
  }

  async recordCall(uuid) {
    /**
     * Start recording for session UUID
     */
    const conn = await this.getConnection();
    
    const cmd = `uuid_record ${uuid} start /recordings/${uuid}.wav`;
    return new Promise((resolve, reject) => {
      conn.api(cmd, (res) => resolve(res));
    });
  }

  async getConnection() {
    /**
     * Maintain persistent connection pool
     */
    if (!this.connections.has('default')) {
      const conn = new esl.Connection(this.host, this.port, this.password);
      await new Promise(resolve => {
        conn.on('esl::ready', resolve);
      });
      this.connections.set('default', conn);
    }
    return this.connections.get('default');
  }
}

module.exports = FreeSwitchService;
```

---

## SIP Providers

### Overview
SIP providers enable:
- Call routing between HR and AI
- Auto-interview call flow
- Promotion process escalations
- Call quality optimization

### 5.1 Asterisk SIP

#### Full Configuration
```javascript
{
  "_id": "sipprovider:asterisk:demo",
  "type": "sipprovider",
  "tenant_id": "demo",
  "provider_type": "asterisk",
  
  "sip_server": {
    "host": "sip.company.com",
    "port": 5060,
    "tls_port": 5061,
    "use_tls": true,
    "domain": "company.com"
  },
  
  // Auto-Interview Call Routing
  "call_routing": {
    "incoming_route": "interview_queue",
    "queue_strategy": "ring_all", // "ring_all", "round_robin", "leastrecent"
    "member_penalty": 0,
    "queue_timeout": 300, // 5 minutes
    "retry_interval": 60,
    "wrapup_time": 60,
    
    // Auto-answer settings
    "auto_answer_delay_ms": 1000,
    "hangup_on_silence": true,
    "silence_timeout_seconds": 30
  },
  
  // Codec Optimization
  "codecs": {
    "preferred": ["opus", "g722", "ulaw"],
    "fallback": ["pcmu", "pcma", "gsm"],
    "enable_dtmf": true,
    "dtmf_type": "rfc2833"
  },
  
  // Recording Settings
  "recording": {
    "enabled": true,
    "format": "wav",
    "storage": {
      "type": "s3", // "local", "s3", "gcs"
      "bucket": "interview-recordings",
      "path_prefix": "/${tenant_id}/${date}/"
    },
    "compression": "gsm",
    "quality": "8000" // Hz
  },
  
  // Promotion Process Escalations
  "escalation_queues": {
    "junior_level": "escalation_l1",
    "senior_level": "escalation_senior",
    "vip_candidates": "escalation_vip",
    "fast_track": "escalation_fast_track"
  },
  
  // Conference Support (for promotion discussions)
  "conference_settings": {
    "enabled": true,
    "max_participants": 5,
    "recording": true,
    "bridge_type": "softmix",
    "video_support": false
  }
}
```

#### Asterisk Dialplan for Auto-Interview
```
; /etc/asterisk/extensions.conf

[interview_context]
exten => 1000,1,Answer()
  same => n,Set(CHANNEL(language)=en)
  same => n,Set(INTERVIEW_SESSION=${UNIQUEID})
  same => n,MixMonitor(/recordings/${INTERVIEW_SESSION}.wav)
  same => n,GoSub(ai_interview,s,1(${INTERVIEW_SESSION}))
  same => n,Hangup()

[ai_interview]
; AI Interview Logic
exten => s,1,Playback(welcome)
  same => n,Set(QUESTION_COUNT=0)
  same => n,While($[${QUESTION_COUNT} < 5])
    same => n,GoSub(ask_question,s,1(${QUESTION_COUNT}))
    same => n,Set(QUESTION_COUNT=$[${QUESTION_COUNT} + 1])
  same => n,EndWhile()
  same => n,Playback(thank-you)
  same => n,Return()

[queue_hr]
exten => _X.,1,Queue(hr_interview_queue, ${EXTEN})
  same => n,Hangup()

; Escalation for senior candidates
[escalation]
exten => senior,1,Queue(escalation_senior, t)
  same => n,VoiceMail(u${EXTEN})
  same => n,Hangup()
```

---

### 5.2 FreeSWITCH SIP

#### Configuration
```javascript
{
  "_id": "sipprovider:freeswitch:demo",
  "type": "sipprovider",
  "provider_type": "freeswitch",
  
  "sip_server": {
    "host": "fs.company.com",
    "port": 5060,
    "tls_port": 5061,
    "use_tls": true,
    "domain": "company.com"
  },
  
  // Call Routing
  "call_routing": {
    "default_context": "interview",
    "failover_action": "voicemail",
    "park_extension": "9000-9100"
  },
  
  // IVR Settings
  "ivr": {
    "enabled": true,
    "lang": "en",
    "voice": "male",
    "speech_engine": "pocketsphinx",
    "dtmf_timeout": 5000,
    "max_silence": 30000
  }
}
```

---

## Vendor Selection Workflow

### 6.1 TenantAdmin Vendor Selection UI

```html
<!-- public/tenant-admin.html -->

<div class="vendor-selection-panel">
  <!-- LLM Selection -->
  <div class="vendor-card">
    <h3>AI Interview Engine (LLM)</h3>
    <select id="llm-vendor" onchange="updateLLMConfig()">
      <option value="openai">OpenAI GPT-4 (Most Capable)</option>
      <option value="anthropic">Anthropic Claude (Best Reasoning)</option>
      <option value="custom">Custom Endpoint (Self-Hosted)</option>
      <option value="none">Disabled</option>
    </select>
    
    <div id="llm-config">
      <!-- Dynamic config based on vendor -->
      <input type="text" placeholder="API Key" class="api-key-input">
      <input type="text" placeholder="Model" value="gpt-4">
      <button onclick="testVendorConnection('llm')">Test Connection</button>
    </div>
  </div>

  <!-- TTS Selection -->
  <div class="vendor-card">
    <h3>Natural Voice (TTS)</h3>
    <select id="tts-vendor" onchange="updateTTSConfig()">
      <option value="elevenlabs">ElevenLabs (Most Natural)</option>
      <option value="azure">Azure Speech (Enterprise)</option>
      <option value="google">Google Cloud TTS (Affordable)</option>
      <option value="browser">Browser Native (Free)</option>
    </select>
    
    <div id="tts-config">
      <input type="text" placeholder="API Key">
      <select id="tts-voice">
        <option>Professional Male</option>
        <option>Professional Female</option>
        <option>Friendly</option>
      </select>
      <button onclick="testVendorConnection('tts')">Test Connection</button>
    </div>
  </div>

  <!-- STT Selection -->
  <div class="vendor-card">
    <h3>Speech Recognition (STT)</h3>
    <select id="stt-vendor" onchange="updateSTTConfig()">
      <option value="deepgram">Deepgram (Fastest)</option>
      <option value="google">Google Cloud STT</option>
      <option value="whisper">Whisper Self-Hosted (Free)</option>
      <option value="browser">Browser Native (Free)</option>
    </select>
    
    <div id="stt-config">
      <input type="text" placeholder="API Key">
      <button onclick="testVendorConnection('stt')">Test Connection</button>
    </div>
  </div>

  <!-- Call Vendor Selection -->
  <div class="vendor-card">
    <h3>Telephony Provider</h3>
    <select id="call-vendor" onchange="updateCallVendorConfig()">
      <option value="twilio">Twilio (Cloud)</option>
      <option value="asterisk">Asterisk (On-Premise)</option>
      <option value="freeswitch">FreeSWITCH (On-Premise)</option>
      <option value="none">Disabled</option>
    </select>
    
    <div id="call-config">
      <!-- Dynamic based on vendor -->
      <button onclick="testVendorConnection('call')">Test Connection</button>
    </div>
  </div>

  <!-- SIP Provider Selection -->
  <div class="vendor-card">
    <h3>SIP Provider for Auto-Interview</h3>
    <select id="sip-provider" onchange="updateSIPConfig()">
      <option value="asterisk_sip">Asterisk SIP</option>
      <option value="freeswitch_sip">FreeSWITCH SIP</option>
      <option value="kamailio">Kamailio</option>
    </select>
    
    <div id="sip-config">
      <input type="text" placeholder="SIP Server Host">
      <input type="number" placeholder="Port" value="5060">
      <label>
        <input type="checkbox"> Use TLS
      </label>
      <button onclick="testVendorConnection('sip')">Test Connection</button>
    </div>
  </div>

  <button class="btn-primary" onclick="saveVendorConfiguration()">Save Configuration</button>
</div>

<script>
async function testVendorConnection(category) {
  const config = getVendorConfig(category);
  
  const response = await fetch('/api/tenant/vendor/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, ...config })
  });
  
  const result = await response.json();
  
  if (result.success) {
    showNotification('✅ Connection successful!', 'success');
  } else {
    showNotification(`❌ Connection failed: ${result.error}`, 'error');
  }
}

async function saveVendorConfiguration() {
  const config = {
    llm: getVendorConfig('llm'),
    tts: getVendorConfig('tts'),
    stt: getVendorConfig('stt'),
    call_vendor: getVendorConfig('call'),
    sip: getVendorConfig('sip')
  };
  
  const response = await fetch('/api/tenant/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  
  if (response.ok) {
    showNotification('✅ Configuration saved!', 'success');
  }
}
</script>
```

---

### 6.2 Backend Vendor Selection API

```javascript
// src/routes/vendorRoutes.js

const express = require('express');
const router = express.Router();
const vendorService = require('../services/vendorIntegrationService');

// Get available vendors for a category
router.get('/vendors/:category', authz('vendor:manage_all_vendors'), async (req, res) => {
  const category = req.params.category; // 'llm', 'tts', 'stt', 'call', 'sip'
  const vendors = await vendorService.getAvailableVendors(category);
  res.json(vendors);
});

// Select vendor for tenant
router.post('/vendor/select', authz('vendor:select_llm|vendor:select_tts|...'), async (req, res) => {
  const { tenantId, category, vendor, config } = req.body;
  
  // Validate permission
  const requiredPermission = `vendor:select_${category}`;
  if (!req.user.hasPermission(requiredPermission)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  
  // Save to database
  await vendorService.selectVendor(tenantId, category, vendor, config);
  
  res.json({ success: true });
});

// Test vendor connection
router.post('/vendor/test-connection', authz('vendor:test_connection'), async (req, res) => {
  const { category, vendor, config } = req.body;
  
  try {
    const result = await vendorService.testConnection(category, vendor, config);
    res.json({ success: true, ...result });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
```

---

## Testing & Validation

### 7.1 Connection Testing

```javascript
// src/services/vendorIntegrationService.js

class VendorIntegrationService {
  async testConnection(category, vendor, config) {
    switch (category) {
      case 'llm':
        return await this.testLLMConnection(vendor, config);
      case 'tts':
        return await this.testTTSConnection(vendor, config);
      case 'stt':
        return await this.testSTTConnection(vendor, config);
      case 'call':
        return await this.testCallConnection(vendor, config);
      case 'sip':
        return await this.testSIPConnection(vendor, config);
    }
  }

  async testLLMConnection(vendor, config) {
    // Quick API test
    const llmService = await LLMFactory.createService(vendor, config);
    const result = await llmService.generateInterviewQuestions('IT', 'IC', 'technical');
    
    return {
      vendor,
      status: 'connected',
      latency: result.duration_ms,
      sample_output: result.questions.slice(0, 1)
    };
  }

  async testTTSConnection(vendor, config) {
    const ttsService = await TTSFactory.createService(vendor, config);
    const result = await ttsService.synthesizeSpeech('Hello, this is a test.');
    
    return {
      vendor,
      status: 'connected',
      duration_ms: result.duration,
      audio_sample: result.audioUrl
    };
  }

  async testSTTConnection(vendor, config) {
    const sttService = await STTFactory.createService(vendor, config);
    const testAudio = generateTestAudio('This is a test message');
    const result = await sttService.transcribeAudio(testAudio);
    
    return {
      vendor,
      status: 'connected',
      confidence: result.confidence,
      sample_output: result.transcript
    };
  }

  async testCallConnection(vendor, config) {
    const callService = await CallFactory.createService(vendor, config);
    
    // Test without actually making a call
    if (vendor === 'twilio') {
      return await callService.testTwilioConnection();
    } else if (vendor === 'asterisk') {
      return await callService.testAsteriskConnection();
    }
  }

  async testSIPConnection(vendor, config) {
    // Verify SIP server is reachable
    const sip = new SIPClient(config);
    const result = await sip.register();
    
    return {
      vendor,
      status: result.registered ? 'connected' : 'failed',
      server: config.sip_server.host
    };
  }
}
```

---

### 7.2 Vendor Test Suite

```javascript
// tests/vendor-integration.test.js

describe('Vendor Integration', () => {
  
  describe('LLM Vendors', () => {
    it('should generate interview questions with OpenAI', async () => {
      const service = new OpenAIService(process.env.OPENAI_API_KEY);
      const questions = await service.generateInterviewQuestions('IT', 'IC', 'technical');
      
      expect(questions).toHaveLength(5);
      expect(questions[0]).toHaveProperty('question');
      expect(questions[0]).toHaveProperty('difficulty');
    });

    it('should evaluate answer with Claude', async () => {
      const service = new ClaudeService(process.env.ANTHROPIC_API_KEY);
      const evaluation = await service.evaluateAnswer(
        'What is OOP?',
        'Object-oriented programming is a programming paradigm...',
        { keywords: ['encapsulation', 'inheritance', 'polymorphism'] }
      );
      
      expect(evaluation).toHaveProperty('score');
      expect(evaluation).toHaveProperty('feedback');
    });
  });

  describe('TTS Vendors', () => {
    it('should synthesize speech with ElevenLabs', async () => {
      const service = new ElevenLabsService(
        process.env.ELEVENLABS_API_KEY,
        'EXAVITQu4vr4xnSDxMaL'
      );
      
      const result = await service.synthesizeSpeech('Welcome to the interview');
      
      expect(result).toHaveProperty('audioUrl');
      expect(result.format).toBe('mp3');
    });
  });

  describe('STT Vendors', () => {
    it('should transcribe audio with Deepgram', async () => {
      const service = new DeepgramService(process.env.DEEPGRAM_API_KEY);
      const audioBuffer = await loadTestAudio('sample_voice.wav');
      
      const result = await service.transcribeAudio(audioBuffer);
      
      expect(result).toHaveProperty('transcript');
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Call Vendors', () => {
    it('should initiate call with Twilio (mocked)', async () => {
      const service = new TwilioService(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        process.env.TWILIO_FROM_NUMBER
      );
      
      // Mock the actual call - don't charge!
      const result = await service.initiateInterviewCall('+1234567890', 'session123');
      
      expect(result).toHaveProperty('callId');
      expect(result.status).toBe('originating');
    });
  });
});
```

---

## Quick Reference

| Vendor | Category | Cost | Best For | Setup Complexity |
|--------|----------|------|----------|------------------|
| OpenAI | LLM | $0.025/interview | Powerful, versatile | Low |
| Claude | LLM | $0.012/interview | Reasoning, safety | Low |
| Whisper | STT | Free (self-hosted) | Budget-conscious | High |
| Deepgram | STT | $0.12/call | Fast, accurate | Low |
| ElevenLabs | TTS | $0.05/interview | Natural voice | Low |
| Google TTS | TTS | $0.024/min | Scalable, affordable | Medium |
| Twilio | Call | $0.60/interview | Cloud, reliable | Low |
| Asterisk | Call | Free (on-prem) | Full control, no fees | Very High |
| FreeSWITCH | Call | Free (on-prem) | Flexible, powerful | Very High |

