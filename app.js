'use strict';
const $ = s => document.querySelector(s);
const LANGS = {
  telugu:  {name: 'తెలుగు (텔루구어)', prompt: 'Telugu (తెలుగు script)', locale: 'te-IN'},
  english: {name: 'English', prompt: 'English', locale: 'en-US'},
  korean:  {name: '한국어', prompt: 'Korean (한국어)', locale: 'ko-KR'},
  hindi:   {name: 'हिन्दी (힌디어)', prompt: 'Hindi (देवनागरी script)', locale: 'hi-IN'},
  both:    {name: '⇄ 양방향 (한국어·영어 ↔ 텔루구어, 텔루구어는 한국어+영어)', prompt: 'Telugu or Korean (two-way)', locale: 'te-IN'},
};
const BIBLES = [{id: 'nkjv', label: 'NKJV'}, {id: 'krv', label: '개역한글'}, {id: 'telugu', label: '텔루구어'}];

// ---------- 설정 ----------
const S = {
  get apiKey() { return localStorage.getItem('apiKey') || ''; },
  set apiKey(v) { localStorage.setItem('apiKey', v.replace(/[^\x21-\x7E]/g, '')); }, // 공백·줄바꿈·한글 등 제거
  // 직접 입력한 모델이 있으면 우선, 없으면 속도 모드에 따라 선택
  get customModel() { return localStorage.getItem('modelCustom') || ''; },
  set customModel(v) { localStorage.setItem('modelCustom', v.trim()); },
  get liveModel() { return localStorage.getItem('liveModel') || 'gemini-2.5-flash-native-audio-preview-12-2025'; },
  set liveModel(v) { localStorage.setItem('liveModel', v.trim()); },
  get geminiVoice() { return localStorage.getItem('geminiVoice') !== '0'; },
  set geminiVoice(v) { localStorage.setItem('geminiVoice', v ? '1' : '0'); },
  get echoMode() { return localStorage.getItem('echoMode') || 'smart'; },
  set echoMode(v) { localStorage.setItem('echoMode', v); },
  get muteOnPlay() { return this.echoMode !== 'off'; },
  get speed() { return localStorage.getItem('speed') || 'live'; },
  set speed(v) { localStorage.setItem('speed', v); },
  get model() { return this.customModel || (this.speed === 'accurate' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite'); },
  get target() { return localStorage.getItem('target') || 'telugu'; },
  set target(v) { localStorage.setItem('target', v); },
  get autoSpeak() { return localStorage.getItem('autoSpeak') === '1'; },   // 기본: 글자로만 보기
  set autoSpeak(v) { localStorage.setItem('autoSpeak', v ? '1' : '0'); },
  get showPron() { return localStorage.getItem('showPron') !== '0'; },
  set showPron(v) { localStorage.setItem('showPron', v ? '1' : '0'); },
  get rate() { return parseFloat(localStorage.getItem('rate') || '0.85'); },
  set rate(v) { localStorage.setItem('rate', String(v)); },
};


// 번역문의 글자(문자 체계)로 실제 출력 언어를 판별 — 양방향 모드에서 낭독 음성·발음 표기를 고르는 데 사용
function scriptLang(text, fallback) {
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'korean';
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  return fallback === 'both' ? 'english' : fallback;
}
// 번역 방향 지시문 (실시간·문장 단위 공통)
function directionPrompt(langKey) {
  if (langKey === 'both')
    return 'Two-way interpreting: if the speech is Korean or English, translate it into Telugu (తెలుగు script); if the speech is Telugu, translate it into Korean (한국어). Never translate into the language that was just spoken.';
  const T = LANGS[langKey].prompt;
  return `The speaker may use any language (typically Korean, English or Telugu). Translate everything into ${T}. If the speech is already in ${T} (for example an echo of the interpreter's own voice), say or output nothing.`;
}

function show(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

// ---------- 탭 ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'bible') renderBible();
});

// ---------- 음성 합성 (TTS) ----------
const TTS = {
  voices: [],
  load() { this.voices = speechSynthesis.getVoices(); },
  // iOS Safari는 사용자 탭 안에서 한 번 speak 해야 이후(비동기) 낭독이 허용됨
  unlock() {
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
  },
  voiceFor(locale) {
    const lang = locale.toLowerCase().replace('_', '-');
    const m = this.voices.filter(v => v.lang.toLowerCase().replace('_', '-') === lang);
    if (m.length) return m.find(v => /enhanced|premium/i.test(v.name)) || m[0];
    return this.voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || null;
  },
  speak(texts, langKey, warnEl) { speechSynthesis.cancel(); this.enqueue(texts, langKey, warnEl); },
  // 진행 중인 낭독을 끊지 않고 뒤에 이어 붙임 (실시간 통역용)
  enqueue(texts, langKey, warnEl) {
    this.load();
    let missing = null;
    for (const t of [].concat(texts)) {
      if (!t || !t.trim()) continue;
      const key = langKey === 'both' ? scriptLang(t, langKey) : langKey;
      const Lk = LANGS[key] || LANGS.english, v = this.voiceFor(Lk.locale);
      if (!v && !missing) missing = Lk;
      const u = new SpeechSynthesisUtterance(t);
      u.lang = Lk.locale; if (v) u.voice = v;
      u.rate = S.rate;
      u.onend = u.onerror = () => { if (!speechSynthesis.speaking) $('#stopBtn').hidden = true; };
      speechSynthesis.speak(u);
    }
    show(warnEl, missing ? `${missing.name} 음성이 설치되어 있지 않을 수 있습니다. iPhone 설정 > 손쉬운 사용 > 말하기 콘텐츠 > 음성에서 내려받아 주세요.` : '');
    $('#stopBtn').hidden = false;
  },
  stop() { speechSynthesis.cancel(); $('#stopBtn').hidden = true; },
};
if ('speechSynthesis' in window) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }
$('#stopBtn').onclick = () => TTS.stop();

// ---------- 폰 스피커 소리가 마이크로 다시 들어가는 것 방지 ----------
let lastEcho = -1e9;
// 'playing' = 번역 소리가 나는 중, 'tail' = 끝난 직후 0.25초(잔향), 'none' = 소리 없음
function echoState(geminiPlaying) {
  const now = performance.now();
  if (geminiPlaying || speechSynthesis.speaking || speechSynthesis.pending) { lastEcho = now; return 'playing'; }
  return now - lastEcho < 250 ? 'tail' : 'none';
}
// 문장 단위 모드용: 설정이 꺼져 있지 않으면 번역 소리가 나는 동안 입력을 완전히 무시
function echoMuted(geminiPlaying) { return S.muteOnPlay && echoState(geminiPlaying) !== 'none'; }

// ---------- 오디오 유틸 ----------
function downsample(buf, from, to) {
  if (from === to) return buf;
  const ratio = from / to, n = Math.floor(buf.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += buf[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}
function encodeWav(f32, rate) {
  const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
function b64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

// ---------- Gemini ----------
async function gemini(body) {
  if (/flash/.test(S.model)) (body.generationConfig ||= {}).thinkingConfig = {thinkingBudget: 0}; // 추론 생략으로 응답 속도 향상
  if (!S.apiKey) throw new Error('설정 탭에서 Gemini API 키를 입력해 주세요.');
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.model)}:generateContent`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey},
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`[Gemini 서버 연결 실패] ${e.message} — 인터넷/VPN/콘텐츠 차단기를 확인하세요.`);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini 오류 (${r.status}): ${data.error?.message || '알 수 없는 오류'}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).find(Boolean);
  if (!text) throw new Error('Gemini 응답을 해석하지 못했습니다.');
  return JSON.parse(text);
}

function interpret(wav, langKey) {
  // 출력 토큰(특히 텔루구어·한글 발음)이 응답 시간을 좌우하므로 최소한만 요청한다. 발음은 별도 요청.
  const prompt = `Interpreter for a Christian gospel message (the speaker may be accented). ${directionPrompt(langKey)}
Return JSON: "transcript" = exact words spoken (original language); "translation" = the natural translation for reading aloud (use the standard Bible wording if a verse is quoted).
If there is no intelligible speech or only noise, return empty strings.`;
  return gemini({
    contents: [{parts: [{text: prompt}, {inline_data: {mime_type: 'audio/wav', data: b64(wav)}}]}],
    generationConfig: {
      temperature: 0.2, responseMimeType: 'application/json',
      responseSchema: {type: 'OBJECT', properties: {transcript: {type: 'STRING'}, translation: {type: 'STRING'}},
        required: ['transcript', 'translation'], propertyOrdering: ['translation', 'transcript']},
    },
  });
}

async function koreanPronunciation(texts, langKey) {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = `Spell how each of these ${LANGS[langKey].prompt} lines sounds in Hangul (한글), so a Korean reader can read it aloud phonetically.
Separate words with spaces. Do not translate. Return a JSON array of strings with exactly ${texts.length} items, in order.

${numbered}`;
  const out = await gemini({
    contents: [{parts: [{text: prompt}]}],
    generationConfig: {temperature: 0.1, responseMimeType: 'application/json',
      responseSchema: {type: 'ARRAY', items: {type: 'STRING'}}},
  });
  if (!Array.isArray(out) || out.length !== texts.length) throw new Error('발음 변환 결과가 올바르지 않습니다.');
  return out;
}

// 텔루구어 → 영어 (양방향 모드에서 텔루구어로 말했을 때 한국어와 함께 영어도 보여 주기 위함)
async function englishOf(text) {
  const out = await gemini({
    contents: [{parts: [{text: `Translate this Telugu into natural English. Return JSON {"english": "..."}.\n\n${text}`}]}],
    generationConfig: {temperature: 0.1, responseMimeType: 'application/json',
      responseSchema: {type: 'OBJECT', properties: {english: {type: 'STRING'}}, required: ['english']}},
  });
  return out.english || '';
}
const isTelugu = t => /[\u0C00-\u0C7F]/.test(t || '');

// 구절별 발음 캐시
const PCACHE = (() => {
  let m = {}; try { m = JSON.parse(localStorage.getItem('pron') || '{}'); } catch {}
  const h = s => { let x = 5381; for (const c of s) x = ((x * 33) ^ c.codePointAt(0)) >>> 0; return x.toString(36); };
  return {get: s => m[h(s)], set(s, v) { m[h(s)] = v; try { localStorage.setItem('pron', JSON.stringify(m)); } catch {} }};
})();


// ---------- 실시간 문장 분할 (침묵 감지) ----------
class Live {
  constructor(onSegment, onLevel) { this.onSegment = onSegment; this.onLevel = onLevel; }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC(); if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.rate = this.ctx.sampleRate;
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.pre = []; this.cur = null; this.noise = 0.008; this.silenceMs = 0; this.speechMs = 0; this.curMs = 0;
    this.proc.onaudioprocess = e => this.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.src.connect(this.proc); this.proc.connect(this.ctx.destination);
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
  }
  feed(d) {
    if (echoMuted(false)) d = new Float32Array(d.length);      // 번역 소리가 나는 동안은 무음으로 취급
    const ms = d.length / this.rate * 1000;
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    const rms = Math.sqrt(s / d.length);
    this.onLevel(Math.min(1, rms * 6));
    const speech = rms > Math.max(0.015, this.noise * 3);
    if (!speech) this.noise = this.noise * 0.95 + rms * 0.05;   // 주변 소음 크기에 적응
    if (this.cur) {
      this.cur.push(d); this.curMs += ms;
      if (speech) { this.silenceMs = 0; this.speechMs += ms; } else this.silenceMs += ms;
      if ((this.silenceMs >= 400 && this.speechMs >= 350) || this.curMs >= 15000) this.cut();   // 문장 끝 / 최대 15초
      else if (this.silenceMs >= 1500 && this.speechMs < 400) this.cur = null;                   // 소음만 있었음
    } else {
      this.pre.push(d); if (this.pre.length > 4) this.pre.shift();                              // 말 시작 직전 약 0.3초 보존
      if (speech) { this.cur = this.pre; this.pre = []; this.curMs = this.cur.length * ms; this.speechMs = ms; this.silenceMs = 0; }
    }
  }
  cut() {
    const chunks = this.cur; this.cur = null;
    const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    this.onSegment(encodeWav(downsample(all, this.rate, 16000), 16000));
  }
  async stop() {
    if (this.cur && this.speechMs >= 300) this.cut();
    this.proc.disconnect(); this.src.disconnect();
    this.stream.getTracks().forEach(t => t.stop());
    try { await this.wake?.release(); } catch {}
    await this.ctx.close();
  }
}


// ---------- Gemini Live API (WebSocket 실시간 통역) ----------
class GeminiLive {
  constructor(h) { this.h = h; this.ready = false; this.next = 0; this.srcs = []; }
  setupMsg(langKey, mode) {
    const setup = {
      model: 'models/' + S.liveModel.replace(/^models\//, ''),
      generationConfig: {responseModalities: ['AUDIO']},
      systemInstruction: {parts: [{text: `You are a live simultaneous interpreter for a Christian gospel message. ${directionPrompt(langKey)} You receive the talk in short fragments, each one possibly an incomplete sentence: translate each fragment immediately, like a simultaneous interpreter, keeping wording consistent with what you already said. Speak ONLY the translation: no commentary, no greetings, never answer questions, never add anything. Use the standard Bible wording of that language when a verse is quoted. If there is only silence or noise, say nothing.`}]},
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    // manual: 앱이 말 시작/끝을 직접 알려 줌(말하는 도중에도 문장 단위로 번역) · auto: 서버가 판단 · min: 기본 설정
    if (mode === 'manual') setup.realtimeInputConfig = {activityHandling: 'NO_INTERRUPTION', automaticActivityDetection: {disabled: true}};
    else if (mode === 'auto') setup.realtimeInputConfig = {activityHandling: 'NO_INTERRUPTION', automaticActivityDetection: {startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', silenceDurationMs: 600}};
    return {setup};
  }
  connect(langKey, mode) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(S.apiKey));
      this.ws = ws; this.ready = false;
      const timer = setTimeout(() => { reject(new Error('연결 시간 초과 (10초)')); try { ws.close(); } catch {} }, 10000);
      ws.onopen = () => ws.send(JSON.stringify(this.setupMsg(langKey, mode)));
      ws.onerror = () => {};
      ws.onclose = ev => {
        clearTimeout(timer);
        const why = `연결 종료 (${ev.code}${ev.reason ? ': ' + ev.reason : ''})`;
        if (!this.ready) reject(new Error(why)); else if (!this.closing && this.ws === ws) this.lost(why);
      };
      ws.onmessage = async ev => {
        let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
        if (m.setupComplete) { this.ready = true; clearTimeout(timer); resolve(); return; }
        this.handle(m);
      };
    });
  }
  async lost(why) {                                  // 연결이 끊기면 마이크·재생은 그대로 두고 자동 재연결
    this.ready = false; this.h.onStatus?.('🔄 연결이 끊겨 다시 연결 중…');
    for (let i = 0; i < 3 && !this.closing; i++) {
      try { this.speaking = false; this.pre = []; await this.connect(this.langKey, this.mode); this.h.onStatus?.(null); return; }
      catch { await new Promise(r => setTimeout(r, 600 * (i + 1))); }
    }
    if (!this.closing) this.h.onClose(why + ' (재연결 실패)');
  }
  async start(langKey) {
    this.langKey = langKey;
    if (!S.apiKey) throw new Error('설정 탭에서 Gemini API 키를 입력해 주세요.');
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ictx = new AC(); this.pctx = new AC({sampleRate: 24000});         // 입력(마이크)·출력(Gemini 음성) 분리
    await this.ictx.resume(); await this.pctx.resume();                      // 사용자 탭 안에서 오디오 활성화
    this.stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    this.pre = []; this.speaking = false; this.noise = 0.008; this.silMs = 0; this.segMs = 0;
    let lastErr;
    for (const mode of ['manual', 'auto', 'min']) {                          // 서버가 일부 옵션을 거부하면 더 단순한 설정으로 재시도
      try { this.mode = mode; await this.connect(langKey, mode); lastErr = null; break; }
      catch (e) { lastErr = e; }
    }
    if (lastErr) { await this.stop(); throw new Error(`Live 연결 실패: ${lastErr.message} (모델: ${S.liveModel})`); }
    this.src = this.ictx.createMediaStreamSource(this.stream);
    this.proc = this.ictx.createScriptProcessor(2048, 1, 1);   // 약 43ms 단위로 전송
    this.proc.onaudioprocess = e => this.frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.src.connect(this.proc); this.proc.connect(this.ictx.destination);
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  sendAudio(d) {
    const f = downsample(d, this.ictx.sampleRate, 16000), pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    this.send({realtimeInput: {audio: {data: b64(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000'}}});
  }
  endActivity() { this.send({realtimeInput: {activityEnd: {}}}); this.speaking = false; this.pre = []; this.h.onActivityEnd?.(); }
  // 마이크 한 조각(약 43ms) 처리: 재생 중 차단 → 말 시작/끝 감지 → 전송
  frame(d) {
    const ms = d.length / this.ictx.sampleRate * 1000;
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    let rms = Math.sqrt(s / d.length);
    // ── 폰 스피커의 번역 소리가 마이크로 다시 들어가는 것 방지 ──
    const st = echoState(this.pctx.currentTime < this.next), em = S.echoMode;
    const active = st !== 'none' && em !== 'off';
    let gate = false;                                       // true → 이 조각은 에코로 보고 무음 처리
    if (active) {
      if (st === 'tail' || em === 'mute') gate = true;
      else {                                                // 스마트: 에코 크기를 학습해서 그보다 확연히 큰 소리만 통과
        if (!this.echoOn) { this.echoOn = true; this.echoT0 = performance.now(); this.echoLvl = 0; }
        const grace = performance.now() - this.echoT0 < 300;          // 재생 시작 직후 0.3초는 에코가 커지는 구간이라 학습만
        const over = !grace && rms > Math.max(0.03, this.echoLvl * 2.2);
        if (!over) { this.echoLvl = grace ? Math.max(this.echoLvl * 0.7, rms) : this.echoLvl * 0.85 + rms * 0.15; gate = true; }
      }
    } else this.echoOn = false;
    if (active !== this.muted) { this.muted = active; this.h.onMute?.(active, em); }
    if (gate) { d = new Float32Array(d.length); rms = 0; }
    this.h.onLevel(Math.min(1, rms * 6));
    if (!this.ws || this.ws.readyState !== 1 || !this.ready) return;
    if (this.mode !== 'manual') return this.sendAudio(d);                    // 서버가 말 끝을 판단하는 모드
    const speech = rms > Math.max(0.015, this.noise * 3);
    if (!speech) this.noise = this.noise * 0.95 + rms * 0.05;                // 주변 소음에 적응
    if (!this.speaking) {
      this.pre.push(d); if (this.pre.length > 5) this.pre.shift();            // 말 시작 직전 약 0.2초 보존
      if (speech) { this.send({realtimeInput: {activityStart: {}}}); this.pre.forEach(x => this.sendAudio(x)); this.pre = []; this.speaking = true; this.segMs = 0; this.silMs = 0; }
      return;
    }
    this.sendAudio(d); this.segMs += ms; this.silMs = speech ? 0 : this.silMs + ms;
    // 0.4초 쉬면 문장 끝 · 2.5초 넘게 말하다 잠깐 숨 쉬면 · 5초 넘으면 강제로 끊어 번역 시작
    if (this.silMs >= 400 || (this.segMs >= 2500 && this.silMs >= 120) || this.segMs >= 5000) this.endActivity();
  }
  handle(m) {
    if (m.goAway) { this.h.onError('Live 세션이 곧 종료됩니다. 다시 시작해 주세요.'); return; }
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) this.flush();
    if (sc.inputTranscription?.text) this.h.onInput(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.h.onOutput(sc.outputTranscription.text);
    for (const p of sc.modelTurn?.parts || []) {
      const d = p.inlineData;
      if (d?.data && /audio/.test(d.mimeType || '') && S.autoSpeak && S.geminiVoice) this.play(d.data);
    }
    if (sc.turnComplete) this.h.onTurnEnd();
  }
  play(b64data) {                                                            // 24kHz 16bit PCM 이어붙여 재생
    const bin = atob(b64data), n = bin.length >> 1;
    const buf = this.pctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); ch[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768; }
    const src = this.pctx.createBufferSource(); src.buffer = buf; src.connect(this.pctx.destination);
    // 첫 조각은 0.1초 여유를 두고 시작 (네트워크 지연으로 인한 끊김 방지)
    const t = Math.max(this.pctx.currentTime + 0.1, this.next); src.start(t); this.next = t + buf.duration;
    this.srcs.push(src); src.onended = () => { this.srcs = this.srcs.filter(x => x !== src); };
  }
  flush() { this.srcs.forEach(s => { try { s.stop(); } catch {} }); this.srcs = []; this.next = 0; }
  async stop() {
    if (this.speaking) this.endActivity();
    this.closing = true;
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
    try { await this.wake?.release(); } catch {}
    try { this.ws?.close(); } catch {}
    this.flush();
    try { await this.ictx?.close(); await this.pctx?.close(); } catch {}
  }
}

// ---------- 통역 탭 ----------
let live = null, pending = 0, chain = Promise.resolve();
const entries = [];
function renderHint() {
  $('#hint').textContent = entries.length ? '' :
    `아래 버튼을 누르고 말씀하세요. (한국어·영어·텔루구어 모두 가능)\n문장이 끝날 때마다 ${LANGS[S.target].name}(으)로 번역해 ${S.autoSpeak ? '글자와 소리로' : '글자로'} 보여 줍니다.\n위의 🔊 버튼으로 읽어주기를 켜고 끌 수 있습니다.`;
}
function addEntry(r, langKey, secs) {
  entries.unshift({r, langKey});
  const el = document.createElement('div'); el.className = 'card';
  const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; return d; };
  const pron = mk('pron', ''), en = mk('en', '');
  el.append(mk('small', `인식된 말씀 · ⏱ ${secs.toFixed(1)}초`), mk('', r.transcript), document.createElement('hr'),
    mk('tr', r.translation), pron, en);
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = '🔊 다시 듣기';
  b.onclick = () => { TTS.unlock(); TTS.speak(r.translation, langKey, $('#warn')); };
  el.append(b);
  $('#entries').prepend(el); renderHint();
  pron.en = en; return pron;
}
function setPhase(p) {
  $('#mic').classList.toggle('rec', p === 'live');
  $('#micIcon').textContent = p === 'live' ? '⏹' : '🎤';
  $('#micLabel').textContent = p === 'live' ? (S.speed === 'live' ? '🔴 Live 통역 중… 말씀하세요 (멈추려면 누르세요)' : '🔴 실시간 통역 중… 멈추려면 누르세요') : '눌러서 실시간 통역 시작';
  $('#meter').hidden = p !== 'live';
  $('#mic').dataset.phase = p;
}
function status() {
  if ($('#mic').dataset.phase === 'live') $('#micLabel').textContent = '🔴 실시간 통역 중' + (pending ? ` · 번역 중 ${pending}` : '') + ' — 멈추려면 누르세요';
}
function onSegment(wav) {
  const langKey = S.target, t0 = performance.now();
  const p = interpret(wav, langKey).catch(e => ({error: e}));   // 바로 요청 시작 (여러 문장 동시 처리)
  pending++; status();
  chain = chain.then(async () => {                              // 표시·낭독은 말한 순서대로
    const r = await p; pending--; status();
    if (r.error) return show($('#err'), r.error.message);
    if (!r.translation || !r.translation.trim()) return;
    show($('#err'), '');
    const pron = addEntry(r, langKey, (performance.now() - t0) / 1000);
    if (S.autoSpeak) TTS.enqueue(r.translation, langKey, $('#warn'));   // 낭독을 먼저 시작
    if (langKey === 'both' && isTelugu(r.transcript))                    // 텔루구어로 말함 → 영어 번역도 추가
      englishOf(r.transcript).then(t => { if (t) pron.en.textContent = '🇬🇧 ' + t; }).catch(() => {});
    const outLang = scriptLang(r.translation, langKey);
    if (S.showPron && outLang !== 'korean')                              // 한글 발음은 뒤따라 채움
      koreanPronunciation([r.translation], outLang).then(o => pron.textContent = o[0]).catch(() => {});
  });
}
// Live 모드: 한 번의 발화(turn)를 카드 하나로 표시
function makeLiveHandlers(langKey) {
  let card = null, lastEnd = 0;
  const open = () => {
    if (card) return card;
    const el = document.createElement('div'); el.className = 'card';
    const mk = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const head = mk('small'); head.textContent = '인식된 말씀 (실시간)';
    const inp = mk(''), hr = document.createElement('hr'), tr = mk('tr'), pron = mk('pron'), en = mk('en');
    el.append(head, inp, hr, tr, pron, en);
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = '🔊 기기 음성으로 다시 듣기';
    b.onclick = () => { TTS.unlock(); TTS.speak(tr.textContent, langKey, $('#warn')); };
    el.append(b); $('#entries').prepend(el); renderHint();
    return card = {inp, tr, pron, en, head, text: ''};
  };
  return {
    onLevel: lv => $('#meter i').style.width = (lv * 100) + '%',
    onStatus: s => { if (live) $('#micLabel').textContent = s || '🔴 Live 통역 중… 말씀하세요 (멈추려면 누르세요)'; },
    onMute: (m, mode) => { if (live) $('#micLabel').textContent = m ? (mode === 'smart' ? '🔊 번역 재생 중 — 큰 목소리만 인식' : '🔇 번역 재생 중 — 마이크 잠시 멈춤') : '🔴 Live 통역 중… 말씀하세요 (멈추려면 누르세요)'; },
    onActivityEnd: () => { lastEnd = performance.now(); },
    onInput: t => { const c = open(); c.t0 ||= performance.now(); c.inp.textContent += t; },
    onOutput: t => {
      const c = open(); c.text += t; c.tr.textContent = c.text;
      if (!c.shown && (lastEnd || c.t0)) { c.shown = true; c.head.textContent = `인식된 말씀 (실시간) · ⏱ 말 끝→번역 ${((performance.now() - (lastEnd || c.t0)) / 1000).toFixed(1)}초`; }
    },
    onTurnEnd: () => {
      const c = card; card = null; if (!c) return;
      if (!c.text.trim()) { c.tr.parentElement.remove(); return; }
      if (!S.geminiVoice && S.autoSpeak) TTS.enqueue(c.text, langKey, $('#warn'));
      if (langKey === 'both' && isTelugu(c.inp.textContent))               // 텔루구어로 말함 → 영어 번역도 추가
        englishOf(c.inp.textContent).then(t => { if (t) c.en.textContent = '🇬🇧 ' + t; }).catch(() => {});
      const outLang = scriptLang(c.text, langKey);
      if (S.showPron && outLang !== 'korean')
        koreanPronunciation([c.text], outLang).then(o => c.pron.textContent = o[0]).catch(() => {});
    },
    onError: msg => show($('#err'), msg),
    onClose: msg => { show($('#err'), msg + ' — 다시 시작해 주세요.'); live = null; setPhase('idle'); },
  };
}
$('#mic').onclick = async () => {
  show($('#err'), '');
  if (live) { const l = live; live = null; setPhase('idle'); await l.stop(); return; }
  TTS.unlock(); TTS.stop();
  if (S.speed === 'live') {
    $('#micLabel').textContent = 'Gemini Live 연결 중…';
    const l = new GeminiLive(makeLiveHandlers(S.target));
    live = l;
    try { await l.start(S.target); if (live === l) setPhase('live'); }
    catch (e) { live = null; setPhase('idle'); show($('#err'), e.name === 'NotAllowedError' ? '마이크 권한이 필요합니다. Safari 설정에서 마이크를 허용해 주세요.' : e.message); }
    return;
  }
  const l = new Live(onSegment, lv => $('#meter i').style.width = (lv * 100) + '%');
  try { await l.start(); live = l; setPhase('live'); }
  catch (e) { show($('#err'), e.name === 'NotAllowedError' ? '마이크 권한이 필요합니다. Safari 설정에서 마이크를 허용해 주세요.' : e.message); }
};
const targetSel = $('#target');
for (const [k, v] of Object.entries(LANGS)) targetSel.add(new Option(v.name, k));
targetSel.value = S.target;
targetSel.onchange = () => { S.target = targetSel.value; renderHint(); };
function renderSpeakToggle() {
  const b = $('#speakToggle'); b.textContent = S.autoSpeak ? '🔊 읽어주기 켜짐' : '🔇 글자로만 보기';
  b.classList.toggle('on', S.autoSpeak); $('#autoSpeak').checked = S.autoSpeak; renderHint();
}
function setSpeak(v) {
  S.autoSpeak = v; renderSpeakToggle();
  if (!v) { TTS.stop(); live?.flush?.(); }                 // 끄면 진행 중인 낭독도 즉시 멈춤
  else TTS.unlock();
}
$('#speakToggle').onclick = () => setSpeak(!S.autoSpeak);
renderSpeakToggle();
const speedSel = $('#speed'); speedSel.value = S.speed; speedSel.onchange = () => { S.speed = speedSel.value; };
renderHint();

// ---------- 성경 탭 ----------
const bibleIdx = {}, bookCache = {};
const B = {primary: 'nkjv', book: 42, chapter: 2, token: 0};
async function getJSON(path, label) {
  let r;
  try { r = await fetch(path); }
  catch (e) { throw new Error(`[성경 파일 ${label} 불러오기 실패] ${e.message} — 네트워크를 확인하세요.`); }
  if (!r.ok) throw new Error(`[성경 파일 ${label}] 서버 응답 ${r.status}`);
  return r.json();
}
async function loadIndex(id) { return bibleIdx[id] || (bibleIdx[id] = await getJSON(`bibles/${id}/index.json`, id)); }
// 필요한 책 한 권만 받아온다 (수십~수백 KB)
async function loadBook(id, book) {
  const k = id + ':' + book;
  if (!bookCache[k]) {
    const has = (await loadIndex(id)).books.some(b => b.index === book);
    bookCache[k] = has ? await getJSON(`bibles/${id}/${book}.json`, `${id}/${book}`) : [];
  }
  return bookCache[k];
}

const seg = $('#primarySeg');
BIBLES.forEach(b => {
  const btn = document.createElement('button'); btn.textContent = b.label; btn.dataset.id = b.id;
  btn.onclick = () => { B.primary = b.id; renderBible(); }; seg.append(btn);
});
$('#book').onchange = e => { B.book = +e.target.value; B.chapter = 0; renderBible(); };
$('#chPrev').onclick = () => { if (B.chapter > 0) { B.chapter--; renderBible(); } };
$('#chNext').onclick = () => { B.chapter++; renderBible(); };

let curTe = [];
async function renderBible() {
  const token = ++B.token;
  show($('#berr'), '');
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === B.primary));
  let prim, te;
  try { [prim, te] = await Promise.all([loadIndex(B.primary), loadIndex('telugu')]); }
  catch (e) { return show($('#berr'), e.message); }
  if (token !== B.token) return;

  const sel = $('#book');
  if (!sel.options.length || sel.dataset.bible !== B.primary) {
    sel.innerHTML = ''; prim.books.forEach(b => sel.add(new Option(b.name, b.index)));
    sel.dataset.bible = B.primary;
  }
  sel.value = B.book;
  const count = Math.max(prim.books.find(b => b.index === B.book)?.chapters || 0,
                         te.books.find(b => b.index === B.book)?.chapters || 0);
  B.chapter = Math.max(0, Math.min(B.chapter, count - 1));
  $('#chLabel').textContent = `${B.chapter + 1}장`;

  let pb, tb;
  try { [pb, tb] = await Promise.all([loadBook(B.primary, B.book), loadBook('telugu', B.book)]); }
  catch (e) { return show($('#berr'), e.message); }
  if (token !== B.token) return;
  const pv = pb[B.chapter] || []; curTe = tb[B.chapter] || [];
  const box = $('#verses'); box.innerHTML = '';
  const n = Math.max(pv.length, curTe.length);
  for (let i = 0; i < n; i++) {
    if (!pv[i] && !curTe[i]) continue;
    const teOnly = B.primary === 'telugu';                       // 텔루구어 단독 보기: 본문을 한 번만 표시하고 아래에 한글 발음
    const d = document.createElement('div'); d.className = 'v' + (teOnly ? ' teonly' : '');
    const p = document.createElement('div');
    const num = document.createElement('span'); num.className = 'n'; num.textContent = i + 1;
    p.append(num, pv[i] || ''); d.append(p);
    if (curTe[i]) {
      const t = document.createElement('div'); t.className = 'te'; t.textContent = curTe[i];
      const pr = document.createElement('div'); pr.className = 'pr'; pr.dataset.te = curTe[i];
      pr.textContent = S.showPron ? (PCACHE.get(curTe[i]) || '') : '';
      const b = document.createElement('button'); b.textContent = '🔊 텔루구어로 듣기';
      b.onclick = () => { TTS.unlock(); TTS.speak(curTe[i], 'telugu', $('#bwarn')); };
      if (teOnly) d.append(pr, b); else d.append(t, pr, b);
    }
    box.append(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="small">이 장의 데이터가 없습니다.</p>';
  $('.tab.active').scrollTop = 0;
  if (S.showPron) fillPron(token);
}
async function fillPron(token) {
  const missing = curTe.filter(t => t && !PCACHE.get(t));
  const apply = () => document.querySelectorAll('.pr').forEach(el => { const c = PCACHE.get(el.dataset.te); if (c) el.textContent = c; });
  apply();
  if (!missing.length || !S.apiKey) return;
  $('#pronSpin').hidden = false;
  try {
    for (let i = 0; i < missing.length; i += 20) {
      if (token !== B.token) break;
      const chunk = missing.slice(i, i + 20);
      const out = await koreanPronunciation(chunk, 'telugu');
      chunk.forEach((t, j) => PCACHE.set(t, out[j]));
      if (token === B.token) apply();
    }
  } catch (e) { if (token === B.token) show($('#berr'), e.message); }
  $('#pronSpin').hidden = true;
}
$('#playChapter').onclick = () => { TTS.unlock(); TTS.speak(curTe, 'telugu', $('#bwarn')); };

// ---------- 설정 탭 ----------
$('#apiKey').value = S.apiKey; $('#model').value = S.customModel;
$('#liveModel').value = S.liveModel; $('#geminiVoice').checked = S.geminiVoice; $('#echoMode').value = S.echoMode; $('#autoSpeak').checked = S.autoSpeak; $('#showPron').checked = S.showPron; $('#rate').value = S.rate;
$('#apiKey').onchange = e => S.apiKey = e.target.value;
$('#model').onchange = e => S.customModel = e.target.value;
$('#liveModel').onchange = e => S.liveModel = e.target.value || 'gemini-2.5-flash-native-audio-preview-12-2025';
$('#geminiVoice').onchange = e => S.geminiVoice = e.target.checked;
$('#echoMode').onchange = e => S.echoMode = e.target.value;
$('#autoSpeak').onchange = e => setSpeak(e.target.checked);
$('#showPron').onchange = e => S.showPron = e.target.checked;
$('#rate').oninput = e => S.rate = parseFloat(e.target.value);
$('#testKey').onclick = async () => {
  const out = $('#keyResult'); out.textContent = '확인 중…';
  S.apiKey = $('#apiKey').value; S.customModel = $('#model').value;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.model)}:generateContent`, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey},
      body: JSON.stringify({contents: [{parts: [{text: 'Say OK'}]}]}),
    });
    const d = await r.json().catch(() => ({}));
    out.textContent = r.ok ? '✅ 연결 성공 (키·모델 정상)' : `❌ 오류 ${r.status}: ${d.error?.message || ''}`;
  } catch (e) { out.textContent = '❌ Gemini 서버 연결 실패: ' + e.message; }
};
$('#testVoice').onclick = () => { TTS.unlock(); TTS.speak('దేవుడు నిన్ను ప్రేమిస్తున్నాడు', 'telugu', $('#swarn')); };

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
