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
  get liveModel() { return localStorage.getItem('liveModel') || modelCache().live || 'gemini-2.5-flash-native-audio-preview-12-2025'; },
  set liveModel(v) { localStorage.setItem('liveModel', v.trim()); },
  get geminiVoice() { return localStorage.getItem('geminiVoice') !== '0'; },
  set geminiVoice(v) { localStorage.setItem('geminiVoice', v ? '1' : '0'); },
  get micProc() { return localStorage.getItem('micProc') || 'all'; },
  set micProc(v) { localStorage.setItem('micProc', v); },
  get micId() { return localStorage.getItem('micId') || ''; },
  set micId(v) { if (v) localStorage.setItem('micId', v); else localStorage.removeItem('micId'); },
  get micLabel() { return localStorage.getItem('micLabel') || ''; },
  set micLabel(v) { if (v) localStorage.setItem('micLabel', v); else localStorage.removeItem('micLabel'); },
  get callMode() { return localStorage.getItem('callMode') === '1'; },
  set callMode(v) { localStorage.setItem('callMode', v ? '1' : '0'); },
  get callReadKorean() { return localStorage.getItem('callReadKorean') === '1'; },
  set callReadKorean(v) { localStorage.setItem('callReadKorean', v ? '1' : '0'); },
  get echoEff() { return this.callMode ? 'mute' : this.echoMode; },        // 통화 모드에서는 번갈아 말하기(되울림 방지를 위해 번역 소리 중 마이크 차단)
  get echoMode() { return localStorage.getItem('echoMode') || 'smart'; },
  set echoMode(v) { localStorage.setItem('echoMode', v); },
  get muteOnPlay() { return this.echoEff !== 'off'; },
  get speed() { return localStorage.getItem('speed') || 'live'; },
  set speed(v) { localStorage.setItem('speed', v); },
  get model() { const c = modelCache(); return this.customModel || (this.speed === 'accurate' ? (c.accurate || 'gemini-flash-latest') : (c.fast || 'gemini-flash-lite-latest')); },
  get target() { return localStorage.getItem('target') || 'telugu'; },
  set target(v) { localStorage.setItem('target', v); },
  get autoSpeak() { return localStorage.getItem('autoSpeak') === '1'; },   // 기본: 글자로만 보기
  set autoSpeak(v) { localStorage.setItem('autoSpeak', v ? '1' : '0'); },
  get showPron() { return localStorage.getItem('showPron') !== '0'; },
  set showPron(v) { localStorage.setItem('showPron', v ? '1' : '0'); },
  get lite() { return localStorage.getItem('lite') === '1'; },
  set lite(v) { localStorage.setItem('lite', v ? '1' : '0'); },
  get liteAuto() { return localStorage.getItem('liteAuto') === '1'; },
  set liteAuto(v) { localStorage.setItem('liteAuto', v ? '1' : '0'); },
  get voiceEngine() { return localStorage.getItem('voiceEngine') || 'gemini'; },
  set voiceEngine(v) { localStorage.setItem('voiceEngine', v); },
  get gvoice() { return localStorage.getItem('gvoice') || 'Charon'; },
  set gvoice(v) { localStorage.setItem('gvoice', v); },
  get pitch() { return parseFloat(localStorage.getItem('pitch') || '0.9'); },
  set pitch(v) { localStorage.setItem('pitch', String(v)); },
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
  if (b.dataset.tab === 'settings') refreshMics(false);
});

// ---------- 음성 합성 (TTS) ----------

// ---------- Gemini 음성 합성 (자연스러운 목소리) ----------
const GVOICES = [['Charon', '남성 · 차분하고 설명하는 톤 (기본)'], ['Orus', '남성 · 단단하고 또렷함'], ['Alnilam', '남성 · 단단함'], ['Schedar', '남성 · 고르고 안정적'],
  ['Sadaltager', '남성 · 지적인 톤'], ['Kore', '여성 · 또렷함'], ['Sulafat', '여성 · 따뜻함'], ['Vindemiatrix', '여성 · 부드러움'], ['Achernar', '여성 · 부드럽고 낮음']];
async function geminiTTS(text, attempt = 0) {
  if (!S.apiKey) throw new Error('API 키가 없습니다');
  const model = modelCache().tts || 'gemini-2.5-flash-preview-tts';
  const prompt = `Read this aloud calmly, warmly and steadily, in a natural gentle tone at an even pace (never sad, tearful or whiny): ${text}`;
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey},
      body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseModalities: ['AUDIO'], speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: S.gvoice}}}}}),
    });
  } catch (e) { throw new Error(`연결 실패: ${e.message}`); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (attempt < 1 && (r.status === 404 || /no longer available|not found/i.test(d.error?.message || ''))) { await discoverModels(true); if (modelCache().tts && modelCache().tts !== model) return geminiTTS(text, attempt + 1); }
    throw new Error(`${r.status} ${(d.error?.message || '').slice(0, 160)} [모델: ${model}]`);
  }
  const inl = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!inl?.data) throw new Error('음성 데이터가 없습니다 [모델: ' + model + ']');
  const rate = +((inl.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000), bin = atob(inl.data), n = bin.length >> 1, f = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); f[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768; }
  return {samples: f, rate};
}
const GT = {
  ctx: null, gen: 0, next: 0, srcs: [], cache: new Map(),
  ensure() { if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); } if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; },
  active() { return !!this.ctx && this.ctx.currentTime < this.next; },
  flush() { this.gen++; this.srcs.forEach(s => { try { s.stop(); } catch {} }); this.srcs = []; this.next = 0; },
  schedule(pcm) {
    const ctx = this.ensure(), buf = ctx.createBuffer(1, pcm.samples.length, pcm.rate); buf.getChannelData(0).set(pcm.samples);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime + 0.05, this.next); src.start(t); this.next = t + buf.duration; this.srcs.push(src);
    src.onended = () => { this.srcs = this.srcs.filter(x => x !== src); if (!this.active() && !speechSynthesis.speaking) $('#stopBtn').hidden = true; };
  },
  fetch(text) {                                           // 같은 문장은 다시 요청하지 않음
    const k = S.gvoice + '|' + text;
    if (!this.cache.has(k)) { this.cache.set(k, geminiTTS(text).catch(e => { this.cache.delete(k); throw e; })); if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value); }
    return this.cache.get(k);
  },
  async enqueue(texts, langKey, warnEl) {
    const gen = this.gen, items = [].concat(texts).filter(t => t && t.trim());
    if (!items.length) return;
    // 첫 문장은 단독으로(빨리 시작), 이후 4문장(약 600자)씩 묶어 요청 수를 줄임 (음성 합성은 분당 요청 제한이 낮음)
    const groups = [[items[0]]]; let cur = [], len = 0;
    for (const t of items.slice(1)) { if (cur.length && (cur.length >= 4 || len + t.length > 600)) { groups.push(cur); cur = []; len = 0; } cur.push(t); len += t.length; }
    if (cur.length) groups.push(cur);
    $('#stopBtn').hidden = false; show(warnEl, '');
    let next = this.fetch(groups[0].join('\n\n')); next.catch(() => {});
    for (let i = 0; i < groups.length; i++) {
      if (gen !== this.gen) return;
      const cur = next;
      if (i + 1 < groups.length) { next = this.fetch(groups[i + 1].join('\n\n')); next.catch(() => {}); }   // 지금 구간이 재생되는 동안 다음 구간을 미리 받음
      let pcm;
      try { pcm = await cur; }
      catch (e) {                                          // 실패하면 이 구간만 기기 음성으로 대체
        if (gen !== this.gen) return;
        show(warnEl, `Gemini 음성을 만들지 못해 기기 음성으로 읽습니다 (${e.message.slice(0, 140)})`);
        if (this.ctx) await new Promise(r => setTimeout(r, Math.max(0, (this.next - this.ctx.currentTime) * 1000) + 50));
        if (gen === this.gen) TTS.deviceEnqueue(groups[i], langKey, null);
        continue;
      }
      if (gen !== this.gen) return;
      this.schedule(pcm);
    }
  },
};

const TTS = {
  voices: [],
  load() { this.voices = speechSynthesis.getVoices(); },
  // iOS Safari는 사용자 탭 안에서 한 번 speak 해야 이후(비동기) 낭독이 허용됨
  unlock() {
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
    GT.ensure();                                           // Gemini 음성 재생용 오디오도 사용자 탭 안에서 미리 활성화
  },
  voiceFor(locale) {
    const lang = locale.toLowerCase().replace('_', '-');
    const m = this.voices.filter(v => v.lang.toLowerCase().replace('_', '-') === lang);
    if (m.length) return m.find(v => /enhanced|premium/i.test(v.name)) || m[0];
    return this.voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || null;
  },
  speak(texts, langKey, warnEl) { speechSynthesis.cancel(); GT.flush(); this.enqueue(texts, langKey, warnEl); },
  // 진행 중인 낭독을 끊지 않고 뒤에 이어 붙임 (실시간 통역용)
  enqueue(texts, langKey, warnEl) {
    if (S.voiceEngine === 'gemini' && S.apiKey) return GT.enqueue(texts, langKey, warnEl);   // 기본: Gemini 음성
    return this.deviceEnqueue(texts, langKey, warnEl);
  },
  deviceEnqueue(texts, langKey, warnEl) {
    this.load();
    let missing = null;
    for (const t of [].concat(texts)) {
      if (!t || !t.trim()) continue;
      const key = langKey === 'both' ? scriptLang(t, langKey) : langKey;
      const Lk = LANGS[key] || LANGS.english, v = this.voiceFor(Lk.locale);
      if (!v && !missing) missing = Lk;
      const u = new SpeechSynthesisUtterance(t);
      u.lang = Lk.locale; if (v) u.voice = v;
      u.rate = S.rate; u.pitch = S.pitch;
      u.onend = u.onerror = () => { if (!speechSynthesis.speaking) $('#stopBtn').hidden = true; };
      speechSynthesis.speak(u); devBusy = true; devPoll = performance.now();          // 시작 즉시 재생 중으로 표시
    }
    if (warnEl) show(warnEl, missing ? `${missing.name} 음성이 설치되어 있지 않을 수 있습니다. iPhone 설정 > 손쉬운 사용 > 말하기 콘텐츠 > 음성에서 내려받아 주세요.` : '');
    $('#stopBtn').hidden = false;
  },
  stop() { speechSynthesis.cancel(); GT.flush(); devBusy = false; devPoll = performance.now(); $('#stopBtn').hidden = true; },
};
if ('speechSynthesis' in window) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }
$('#stopBtn').onclick = () => TTS.stop();

// ---------- 마이크 선택 (블루투스 스피커의 마이크 대신 폰·유선 마이크를 쓰기 위함) ----------
async function getMic() {
  const proc = S.micProc;       // all: 에코·잡음·자동볼륨 모두 / echo: 에코만 / raw: 모두 끔(원음)
  const base = {echoCancellation: proc !== 'raw', noiseSuppression: proc === 'all', autoGainControl: proc === 'all'};
  let stream;
  if (S.micId) {
    try { stream = await navigator.mediaDevices.getUserMedia({audio: {...base, deviceId: {exact: S.micId}}}); }
    catch (e) { if (e.name === 'NotAllowedError') throw e; S.micId = ''; S.micLabel = ''; show($('#warn'), '선택한 마이크를 찾지 못해 기본 마이크를 사용합니다.'); }   // 장치가 사라짐 → 기본 마이크
  }
  stream ||= await navigator.mediaDevices.getUserMedia({audio: base});
  const t = stream.getAudioTracks()[0]; $('#micName').textContent = t ? '🎙 ' + (t.label || '기본 마이크') : '';
  if (S.micId && t?.label) S.micLabel = t.label;
  return stream;
}
async function refreshMics(ask) {
  const sel = $('#micSel'); if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    if (ask) { const s = await navigator.mediaDevices.getUserMedia({audio: true}); s.getTracks().forEach(t => t.stop()); }   // 권한을 받아야 장치 이름이 보임
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId);
    sel.innerHTML = ''; sel.add(new Option('자동 (기기 기본)', ''));
    devs.forEach(d => sel.add(new Option(d.label || '마이크 (이름은 권한 허용 후 표시)', d.deviceId)));
    if (S.micId && ![...sel.options].some(o => o.value === S.micId))        // 권한 확인 전에는 장치 식별자가 안 보이므로, 저장해 둔 마이크를 표시용으로 남김
      sel.add(new Option((S.micLabel || '저장된 마이크') + ' (연결 확인 전)', S.micId));
    sel.value = S.micId || '';
  } catch (e) { show($('#swarn'), '마이크 목록을 가져오지 못했습니다: ' + e.message); }
}
// ---------- 폰 스피커 소리가 마이크로 다시 들어가는 것 방지 ----------
let lastEcho = -1e9;
// 'playing' = 번역 소리가 나는 중, 'tail' = 끝난 직후 0.25초(잔향), 'none' = 소리 없음
let devPoll = -1e9, devBusy = false;
function echoState(geminiPlaying) {
  const now = performance.now();
  if (now - devPoll > 250) { devPoll = now; devBusy = speechSynthesis.speaking || speechSynthesis.pending; }   // 기기 음성 상태 조회는 비싸므로 초당 4번만
  if (geminiPlaying || devBusy || GT.active()) { lastEcho = now; return 'playing'; }
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

// ---------- 사용 가능한 최신 모델 자동 탐색 (모델 이름은 자주 바뀌고 단종되므로 고정하지 않음) ----------
function modelCache() { try { return JSON.parse(localStorage.getItem('modelsCache') || '{}'); } catch { return {}; } }
async function discoverModels(force) {
  const c = modelCache();
  if (!S.apiKey) return c;
  if (!force && c.t && Date.now() - c.t < 864e5) return c;               // 하루 한 번
  let list = [], tok = '';
  try {
    for (let i = 0; i < 5; i++) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), {headers: {'x-goog-api-key': S.apiKey}});
      if (!r.ok) return c;
      const d = await r.json(); list = list.concat(d.models || []); tok = d.nextPageToken; if (!tok) break;
    }
  } catch { return c; }
  const name = m => m.name.replace(/^models\//, '');
  const can = (m, k) => (m.supportedGenerationMethods || []).includes(k);
  const ver = n => { const x = n.match(/gemini-(?:live-)?(\d+(?:\.\d+)?)/); return x ? parseFloat(x[1]) : 0; };
  const date = n => { const x = n.match(/(\d{2})-(\d{4})$/); return x ? +x[2] * 100 + +x[1] : 0; };
  const rank = n => [ver(n), /preview|exp/.test(n) ? 0 : 1, date(n)];       // 버전 → 정식판 우선 → 날짜
  const best = arr => arr.map(name).sort((x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; })[0];
  const text = list.filter(m => can(m, 'generateContent') && !/image|tts|embedding|audio|live|robotics|computer|-exp|customtools|-latest$/.test(m.name));
  const out = {
    t: Date.now(),
    fast: best(text.filter(m => /-flash-lite/.test(m.name))) || c.fast,
    accurate: best(text.filter(m => /-flash(?!-lite)/.test(m.name))) || c.accurate,
    live: best(list.filter(m => can(m, 'bidiGenerateContent'))) || c.live,
    tts: best(list.filter(m => can(m, 'generateContent') && /tts/.test(m.name) && /flash/.test(m.name))) || best(list.filter(m => can(m, 'generateContent') && /tts/.test(m.name))) || c.tts,
  };
  localStorage.setItem('modelsCache', JSON.stringify(out));
  return out;
}
function renderModelInfo() {
  const el = $('#modelInfo'); if (!el) return;
  el.textContent = `사용 중인 모델 — 빠름: ${S.speed === 'accurate' && !S.customModel ? modelCache().fast || '자동' : S.model} · 정확: ${modelCache().accurate || '자동'} · Live: ${S.liveModel} · 음성합성: ${modelCache().tts || '자동'}`;
}

let forceModel = '';
async function gemini(body, attempt = 0) {
  if (!S.apiKey) throw new Error('설정 탭에서 Gemini API 키를 입력해 주세요.');
  const model = forceModel || S.model; let r;
  const rejected = k => localStorage.getItem(`reject:${k}:${model}`) === '1';          // 이 모델이 이미 거부한 옵션인지
  if (/flash/.test(model) && !body.__noThink && !rejected('think')) (body.generationConfig ||= {}).thinkingConfig = {thinkingBudget: 0}; // 추론 생략으로 응답 속도 향상
  if (rejected('schema') && body.generationConfig?.responseSchema) { body = {...body, generationConfig: {...body.generationConfig}}; delete body.generationConfig.responseSchema; }
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey},
      body: JSON.stringify({...body, __noThink: undefined}),
    });
  } catch (e) {
    throw new Error(`[Gemini 서버 연결 실패] ${e.message} — 인터넷/VPN/콘텐츠 차단기를 확인하세요.`);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || '알 수 없는 오류';
    if (attempt < 2 && !S.customModel && (r.status === 404 || /no longer available|not found|deprecated/i.test(msg))) {
      await discoverModels(true);                                            // 단종된 모델 → 내 키로 쓸 수 있는 최신 모델을 다시 찾음
      if (S.model === model) {                                               // 못 찾았으면 오류가 권장한 모델을 사용
        const rec = msg.match(/models\/([\w.\-]+)/g)?.map(x => x.slice(7)).find(x => x !== model);
        if (rec) { const c = modelCache(); c[S.speed === 'accurate' ? 'accurate' : 'fast'] = rec; c.t = Date.now(); localStorage.setItem('modelsCache', JSON.stringify(c)); }
      }
      if (S.model !== model) { renderModelInfo(); return gemini(body, attempt + 1); }
    }
    if (attempt < 3 && r.status === 400) {                                  // 일부 모델이 거부하는 옵션을 단계적으로 빼고 재시도
      const gc = {...(body.generationConfig || {})};
      let dropped = '';
      if (gc.thinkingConfig) { delete gc.thinkingConfig; dropped = 'think'; }          // 1단계: 추론 생략 옵션 제거
      else if (gc.responseSchema) { delete gc.responseSchema; dropped = 'schema'; }    // 2단계: 응답 스키마 제거(JSON 형식은 유지)
      if (dropped) {
        const res = await gemini({...body, __noThink: true, generationConfig: gc}, attempt + 1);
        localStorage.setItem(`reject:${dropped}:${model}`, '1');                         // 성공했으면 이 모델은 해당 옵션을 거부하는 것으로 기억
        return res;
      }
    }
    const det = data.error?.details ? ' ' + JSON.stringify(data.error.details).slice(0, 240) : '';
    throw new Error(`Gemini 오류 (${r.status}): ${msg}${det} [모델: ${model}]`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).find(Boolean);
  if (!text) throw new Error('Gemini 응답을 해석하지 못했습니다.');
  return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
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
    this.stream = await getMic();
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
      generationConfig: {responseModalities: ['AUDIO'], ...(mode === 'min' ? {} : {speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: S.gvoice}}}})},
      systemInstruction: {parts: [{text: `You are a live simultaneous interpreter for a Christian gospel message. The speakers only use Korean, English or Telugu (never Spanish, Hindi or other languages); if a word sounds like another language, assume it is one of these three. ${directionPrompt(langKey)} You receive the talk in short fragments, each one possibly an incomplete sentence: translate each fragment immediately, like a simultaneous interpreter, keeping wording consistent with what you already said. Speak ONLY the translation: no commentary, no greetings, never answer questions, never add anything. Use the standard Bible wording of that language when a verse is quoted. If there is only silence or noise, say nothing.`}]},
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
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}   // iOS: 무음 스위치·블루투스 출력에서도 녹음과 재생을 함께 허용
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ictx = new AC(); this.pctx = new AC({sampleRate: 24000});         // 입력(마이크)·출력(Gemini 음성) 분리
    await this.ictx.resume(); await this.pctx.resume();                      // 사용자 탭 안에서 오디오 활성화
    this.stream = await getMic();
    this.pre = []; this.speaking = false; this.noise = 0.008; this.silMs = 0; this.segMs = 0;
    let lastErr;
    const tryModes = async () => {
      for (const mode of ['manual', 'auto', 'min']) {                        // 서버가 일부 옵션을 거부하면 더 단순한 설정으로 재시도
        try { this.mode = mode; await this.connect(langKey, mode); return null; }
        catch (e) { lastErr = e; }
      }
      return lastErr;
    };
    if (await tryModes() && !localStorage.getItem('liveModel')) {            // 모든 설정이 실패 → 모델이 단종됐을 수 있으니 최신 Live 모델을 찾아 한 번 더
      const before = S.liveModel; await discoverModels(true);
      if (S.liveModel !== before) { lastErr = null; await tryModes(); renderModelInfo(); }
    }
    if (lastErr && !this.ready) { await this.stop(); throw new Error(`Live 연결 실패: ${lastErr.message} (모델: ${S.liveModel})`); }
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
  endActivity() { this.send({realtimeInput: {activityEnd: {}}}); this.speaking = false; this.pre = []; this.cand = 0; this.h.onActivityEnd?.(); }
  // 마이크 한 조각(약 43ms) 처리: 재생 중 차단 → 말 시작/끝 감지 → 전송
  frame(d) {
    const ms = d.length / this.ictx.sampleRate * 1000;
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    let rms = Math.sqrt(s / d.length);
    // ── 폰 스피커의 번역 소리가 마이크로 다시 들어가는 것 방지 ──
    const st = echoState(this.pctx.currentTime < this.next), em = S.echoEff;
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
    const speech = rms > Math.max(0.02, this.noise * 3.5);
    if (!speech) this.noise = this.noise * 0.95 + rms * 0.05;                // 주변 소음에 적응
    if (!this.speaking) {
      this.pre.push(d); if (this.pre.length > 9) this.pre.shift();            // 말 시작 직전 약 0.4초 보존
      this.cand = speech ? (this.cand || 0) + 1 : Math.max(0, (this.cand || 0) - 1);   // 큰 소리가 약 0.2초 이상 이어질 때만 말로 인정
      if (this.cand >= 5) { this.cand = 0; this.send({realtimeInput: {activityStart: {}}}); this.pre.forEach(x => this.sendAudio(x)); this.pre = []; this.speaking = true; this.segMs = 0; this.silMs = 0; }
      return;
    }
    this.sendAudio(d); this.segMs += ms; this.silMs = speech ? 0 : this.silMs + ms;
    // 0.4초 쉬면 문장 끝 · 2.5초 넘게 말하다 잠깐 숨 쉬면 · 5초 넘으면 강제로 끊어 번역 시작
    if (this.silMs >= 400 || (this.segMs >= 2500 && this.silMs >= 120) || this.segMs >= 5000) this.endActivity();
  }
  // 통화 모드: 번역문이 텔루구어인 턴만 소리로 재생 (한국어는 글자로만). 언어는 번역 글자(outputTranscription)로 판단
  route(b) {
    if (!S.callMode) return this.play(b);
    const t = this.turn ||= {decided: false, play: false, buf: [], text: ''};
    if (t.decided) { if (t.play) this.play(b); return; }
    t.buf.push(b);
    if (!t.timer) t.timer = setTimeout(() => { if (!t.decided) { t.decided = true; t.play = true; t.buf.splice(0).forEach(x => this.play(x)); } }, 1500);   // 글자가 안 오면 1.5초 뒤 재생(안전장치)
  }
  decide(text) {
    if (!S.callMode) return;
    const t = this.turn ||= {decided: false, play: false, buf: [], text: ''};
    if (t.decided) return;
    t.text += text;
    const c = cleanOut(t.text); if (!c) return;
    t.decided = true; t.play = callSpeakOK(c); clearTimeout(t.timer);
    const buf = t.buf.splice(0); if (t.play) buf.forEach(x => this.play(x));
  }
  endTurn() { if (this.turn) { clearTimeout(this.turn.timer); this.turn = null; } }
  handle(m) {
    if (m.goAway) { this.h.onError('Live 세션이 곧 종료됩니다. 다시 시작해 주세요.'); return; }
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) { this.flush(); this.endTurn(); }
    if (sc.inputTranscription?.text) this.h.onInput(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.h.onOutput(sc.outputTranscription.text);
    if (sc.outputTranscription?.text) this.decide(sc.outputTranscription.text);
    for (const p of sc.modelTurn?.parts || []) {
      const d = p.inlineData;
      if (d?.data && /audio/.test(d.mimeType || '') && S.autoSpeak && S.geminiVoice) this.route(d.data);
    }
    if (sc.turnComplete) { this.endTurn(); this.h.onTurnEnd(); }
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
  $('#entries').prepend(el); pruneCards(); renderHint();
  pron.en = en; return pron;
}
function setPhase(p) {
  $('#mic').classList.toggle('rec', p === 'live');
  document.documentElement.classList.toggle('live-lite', p === 'live');       // 통역 중에는 화면 효과를 줄여 부드럽게 (끝나면 원래대로)
  $('#micLabel').textContent = p === 'live' ? (S.speed === 'live' ? 'Live 통역 중… 말씀하세요 (멈추려면 누르세요)' : '실시간 통역 중… 멈추려면 누르세요') : '눌러서 실시간 통역 시작';
  $('#meter').hidden = p !== 'live';
  if (p !== 'live') { $('#micName').textContent = ''; lvlV = 0; lvlT = 0; setLevel(0); const r = document.querySelector('#micRing'); r.style.transform = 'scale(1)'; r.style.opacity = '0'; (meterBar ||= document.querySelector('#meter i')).style.transform = 'scaleX(0)'; }
  $('#mic').dataset.phase = p;
}
function status() {
  if ($('#mic').dataset.phase === 'live') $('#micLabel').textContent = '실시간 통역 중' + (pending ? ` · 번역 중 ${pending}` : '') + ' — 멈추려면 누르세요';
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
    if (S.autoSpeak && callSpeakOK(r.translation)) TTS.enqueue(r.translation, langKey, $('#warn'));   // 낭독을 먼저 시작
    if (langKey === 'both' && isTelugu(r.transcript))                    // 텔루구어로 말함 → 영어 번역도 추가
      englishOf(r.transcript).then(t => { if (t) pron.en.textContent = '🇬🇧 ' + t; }).catch(() => {});
    const outLang = scriptLang(r.translation, langKey);
    if (S.showPron && outLang !== 'korean')                              // 한글 발음은 뒤따라 채움
      koreanPronunciation([r.translation], outLang).then(o => pron.textContent = o[0]).catch(() => {});
  });
}
// Live 모드: 한 번의 발화(turn)를 카드 하나로 표시
// 카드가 계속 쌓이면 화면이 무거워지므로 최근 40개만 유지
function pruneCards() { const cs = $('#entries').querySelectorAll('.card'); for (let i = 40; i < cs.length; i++) cs[i].remove(); if (entries.length > 40) entries.length = 40; }
// 마이크 크기 링 갱신: 초당 약 12번 이하, 변화가 클 때만 (스타일 갱신 부담 줄이기)
let lvlT = -1e9, lvlV = 0, ringEl = null, meterBar = null;
function setLevel(lv) {
  const now = performance.now();
  if (now - lvlT < 80 || Math.abs(lv - lvlV) < 0.04) return;
  lvlT = now; lvlV = lv;
  if (document.documentElement.classList.contains('lite')) { (meterBar ||= document.querySelector('#meter i')).style.transform = `scaleX(${lv.toFixed(2)})`; return; }
  const r = ringEl ||= document.querySelector('#micRing');
  r.style.transform = `scale(${(1 + lv * 0.42).toFixed(3)})`; r.style.opacity = Math.min(1, lv * 1.2).toFixed(2);   // 전용 요소만 바꿈 → 스타일 연쇄 계산 없음
}
// 모델이 '말 없음'을 나타내려고 내보내는 <no speech>, {pause}, [BLANK_AUDIO] 같은 제어 문구는 번역이 아니므로 제거
const cleanOut = s => s.replace(/<[^>]*>?|\{[^}]*\}?|\[[^\]]*\]?/g, '').replace(/\s{2,}/g, ' ').trim();
// ---------- 통화 모드: 번역문의 언어에 따라 소리로 읽을지(텔루구어) / 글자로만 보여 줄지(한국어) 결정 ----------
// 상대방(텔루구어) 말씀의 한국어 번역은 내가 눈으로 읽고, 내 말씀의 텔루구어 번역은 소리로 읽어 상대가 듣게 한다.
function callSpeakOK(text) {
  if (!S.callMode) return true;
  const l = scriptLang(cleanOut(text || ''), 'both');
  return l === 'telugu' || (l === 'korean' && S.callReadKorean);
}
function dirLabel(text) {
  const l = scriptLang(cleanOut(text || ''), 'both');
  return l === 'korean' ? 'in' : l === 'telugu' ? 'out' : '';
}
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
    el.hidden = true;                                       // 번역문이 실제로 나올 때까지 숨김 (소음·무음 턴이 화면에 뜨지 않게)
    el.append(b); $('#entries').prepend(el); pruneCards(); renderHint();
    return card = {el, inp, tr, pron, en, head, raw: '', text: ''};
  };
  return {
    onLevel: setLevel,
    onStatus: s => { if (live) $('#micLabel').textContent = s || 'Live 통역 중… 말씀하세요 (멈추려면 누르세요)'; },
    onMute: (m, mode) => { if (live) $('#micLabel').textContent = m ? (mode === 'smart' ? '🔊 번역 재생 중 — 큰 목소리만 인식' : '🔇 번역 재생 중 — 마이크 잠시 멈춤') : 'Live 통역 중… 말씀하세요 (멈추려면 누르세요)'; },
    onActivityEnd: () => { lastEnd = performance.now(); },
    onInput: t => { const c = open(); c.t0 ||= performance.now(); c.inp.textContent += t; },
    onOutput: t => {
      const c = open(); c.raw += t; c.text = cleanOut(c.raw);
      if (!c.text) return;                                      // 제어 문구뿐이면 무시
      c.tr.textContent = c.text; c.el.hidden = false;
      if (S.callMode && !c.dir) { c.dir = dirLabel(c.text); if (c.dir) c.el.dataset.dir = c.dir; }
      if (!c.shown && (lastEnd || c.t0)) { c.shown = true; c.head.textContent = `${S.callMode && c.dir ? (c.dir === 'in' ? '📞 상대방 말씀 → 한국어' : '📞 내 말씀 → 상대에게') : '인식된 말씀 (실시간)'} · ⏱ 말 끝→번역 ${((performance.now() - (lastEnd || c.t0)) / 1000).toFixed(1)}초`; }
    },
    onTurnEnd: () => {
      const c = card; card = null; if (!c) return;
      if (!c.text.trim()) { c.el.remove(); renderHint(); return; }
      if (!S.geminiVoice && S.autoSpeak && callSpeakOK(c.text)) TTS.enqueue(c.text, langKey, $('#warn'));
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
  const l = new Live(onSegment, setLevel);
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
// ---------- 통화 모드 ----------
function renderCall() {
  const on = S.callMode, b = $('#callToggle');
  b.textContent = on ? '📞 통화 모드 켜짐' : '📞 통화 모드'; b.classList.toggle('on', on);
  $('#callHelp').hidden = !on; $('#callMode').checked = on; document.documentElement.classList.toggle('callmode', on);
}
function setCall(v) {
  if (v) {                                           // 켤 때: 양방향 + 소리 읽기. 이전 번역 언어는 기억해 두었다가 끌 때 복원
    localStorage.callPrevTarget = S.target; localStorage.callPrevSpeak = S.autoSpeak ? '1' : '0';
    S.callMode = true; S.target = 'both'; S.autoSpeak = true; S.geminiVoice = true;
  } else {
    S.callMode = false; if (localStorage.callPrevTarget) S.target = localStorage.callPrevTarget; S.autoSpeak = localStorage.callPrevSpeak !== '0';
  }
  $('#target').value = S.target; $('#geminiVoice').checked = S.geminiVoice; renderSpeakToggle(); renderCall(); renderHint();
}
$('#callToggle').onclick = () => setCall(!S.callMode);
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
// 한 요청이 400으로 실패하면 반으로 나눠 다시 시도해서, 문제가 되는 절 하나 때문에 나머지가 막히지 않게 함
async function pronFor(chunk, stat) {
  try { return await koreanPronunciation(chunk, 'telugu'); }
  catch (e) {
    if (!/\(400\)|올바르지/.test(e.message)) throw e;
    if (chunk.length === 1) { stat.failed++; stat.last = e.message; return ['']; }
    const h = chunk.length >> 1;
    return (await pronFor(chunk.slice(0, h), stat)).concat(await pronFor(chunk.slice(h), stat));
  }
}
async function fillPron(token) {
  const missing = [...new Set(curTe.filter(t => t && !PCACHE.get(t)))];
  const apply = () => document.querySelectorAll('.pr').forEach(el => { const c = PCACHE.get(el.dataset.te); if (c) el.textContent = c; });
  apply();
  if (!missing.length || !S.apiKey) return;
  $('#pronSpin').hidden = false;
  const stat = {failed: 0, last: ''};
  try {
    const chunks = []; for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));
    for (let g = 0; g < chunks.length; g += 3) {                              // 10절씩, 3개 요청을 동시에
      if (token !== B.token) break;
      await Promise.all(chunks.slice(g, g + 3).map(async chunk => {
        const out = await pronFor(chunk, stat);
        chunk.forEach((t, j) => { if (out[j]) PCACHE.set(t, out[j]); });
        if (token === B.token) apply();
      }));
    }
    if (stat.failed && token === B.token) show($('#berr'), `${stat.failed}개 절의 발음은 만들지 못했습니다 (${stat.last.slice(0, 120)})`);
  } catch (e) { if (token === B.token) show($('#berr'), e.message); }
  $('#pronSpin').hidden = true;
}
$('#playChapter').onclick = () => { TTS.unlock(); TTS.speak(curTe, 'telugu', $('#bwarn')); };



// ---------- 화면 부담 자동 감지: 프레임이 자주 늦으면 효과를 줄여서 부드럽게 ----------
function applyLite() { document.documentElement.classList.toggle('lite', S.lite || S.liteAuto); const el = $('#lite'); if (el) el.checked = S.lite || S.liteAuto; }
(function jankWatch() {
  if (S.lite || S.liteAuto) return;
  let last = performance.now(), slow = 0, t0 = last, running = true;
  const tick = t => {
    if (!running) return;
    const d = t - last; last = t;
    if (!document.hidden && d > 80 && d < 2000) slow++;                      // 한 프레임이 0.08초 넘게 걸림(렉)
    if (t - t0 > 12000) { if (slow >= 10 && $('#mic').dataset.phase === 'live') { S.liteAuto = true; applyLite(); show($('#warn'), '화면이 버거워서 효과를 줄였어요. 설정에서 다시 켤 수 있어요.'); running = false; return; } slow = 0; t0 = t; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();


// ---------- 마이크 시험: 4초 녹음 → 소리 크기·잡음 분석 → 다시 듣기 → 받아쓰기 결과 ----------
function analyzeAudio(x, rate) {
  const N = 2048, rms = []; let peak = 0, clip = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; if (v >= 0.98) clip++; }
  for (let i = 0; i + N <= x.length; i += N) { let s = 0; for (let j = 0; j < N; j++) s += x[i + j] * x[i + j]; rms.push(Math.sqrt(s / N)); }
  const sorted = [...rms].sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  const noise = Math.max(q(0.1), 1e-5), voice = q(0.9), snr = 20 * Math.log10(Math.max(voice, 1e-5) / noise);
  const db = v => 20 * Math.log10(Math.max(v, 1e-5));
  const level = peak < 0.04 ? 'quiet' : (clip > 20 || peak >= 0.99) ? 'loud' : 'ok';
  const noisy = voice > 0.01 && snr < 12 || noise > 0.03;
  return {peak, voice, noise, snr, clip, level, noisy, voiceDb: db(voice), noiseDb: db(noise), seconds: x.length / rate};
}
async function micTest() {
  const box = $('#micTestOut'); box.hidden = false; box.innerHTML = '';
  const line = (t, cls) => { const d = document.createElement('div'); d.textContent = t; if (cls) d.className = cls; box.append(d); return d; };
  $('#micTestBtn').disabled = true;
  let stream, ctx;
  try {
    stream = await getMic(); ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const label = stream.getAudioTracks()[0]?.label || '기본 마이크';
    line('🎙 ' + label + ` · 처리: ${{all: '에코·잡음제거·자동볼륨', echo: '에코만', raw: '원음'}[S.micProc]} · ${ctx.sampleRate}Hz`);
    const prog = line('4초 동안 평소처럼 한국어로 말씀해 보세요…', 'tip');
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(2048, 1, 1), chunks = [];
    proc.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(ctx.destination);
    await new Promise(r => setTimeout(r, +(window.__micTestMs || 4000)));
    proc.disconnect(); src.disconnect();
    const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const an = analyzeAudio(all, ctx.sampleRate); prog.remove();
    const lv = {quiet: ['❌ 소리가 너무 작아요 — 마이크에 더 가까이(10~20cm) 말씀하세요', 'bad'], loud: ['⚠️ 소리가 너무 커서 찌그러져요 — 조금 멀리서 말씀하세요', 'warn'], ok: ['✅ 소리 크기 적당해요', 'good']}[an.level];
    line(`${lv[0]}  (목소리 ${an.voiceDb.toFixed(0)}dB · 최고점 ${(an.peak * 100).toFixed(0)}%)`, lv[1]);
    line(an.noisy ? `⚠️ 주변 잡음이 많아요 — 잡음 대비 ${an.snr.toFixed(0)}dB (12dB 이상이 좋아요). 조용한 곳이나 마이크를 입 가까이에` : `✅ 잡음 적어요 (잡음 대비 ${an.snr.toFixed(0)}dB)`, an.noisy ? 'warn' : 'good');
    if (/bluetooth|블루투스|pis|speaker|스피커|hands.?free/i.test(label)) line('⚠️ 블루투스 장치의 마이크로 보여요 — 소리가 작고 거칠게 들어올 수 있어요. 위의 마이크 선택에서 iPhone 마이크를 골라 보세요', 'warn');
    const wav = encodeWav(downsample(all, ctx.sampleRate, 16000), 16000);
    const au = document.createElement('audio'); au.controls = true; au.src = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'})); box.append(au);
    line('방금 녹음된 소리예요. ▶ 눌러서 직접 들어 보세요 (실제로 앱이 듣는 소리입니다)', 'tip');
    const w = line('받아쓰기 확인 중…', 'tip');
    forceModel = modelCache().accurate || 'gemini-flash-latest';
    try {
      const r = await gemini({contents: [{parts: [{text: 'Transcribe exactly what is said in this audio. The speaker uses Korean, English or Telugu. Return JSON {"transcript": "...", "language": "..."}. If you cannot make out any speech, return an empty transcript.'}, {inline_data: {mime_type: 'audio/wav', data: b64(wav)}}]}],
        generationConfig: {temperature: 0, responseMimeType: 'application/json', responseSchema: {type: 'OBJECT', properties: {transcript: {type: 'STRING'}, language: {type: 'STRING'}}, required: ['transcript', 'language']}}});
      w.className = ''; w.textContent = r.transcript ? `📝 정확한 모델이 받아쓴 결과: "${r.transcript}" (${r.language})` : '📝 말소리를 알아듣지 못했어요 — 마이크 위치·소리 크기를 확인하세요';
      line('이 결과가 말씀하신 것과 다르면 → 마이크/잡음 문제, 같으면 → 실시간 통역 모델의 인식 문제일 수 있어요.', 'tip');
    } catch (e) { w.className = 'bad'; w.textContent = '받아쓰기 실패: ' + e.message.slice(0, 160); }
    finally { forceModel = ''; }
  } catch (e) { line(e.name === 'NotAllowedError' ? '마이크 권한이 필요합니다. Safari 설정에서 허용해 주세요.' : '마이크 시험 실패: ' + e.message, 'bad'); }
  finally { stream?.getTracks().forEach(t => t.stop()); try { await ctx?.close(); } catch {} $('#micTestBtn').disabled = false; $('#micName').textContent = ''; }
}

// ---------- 진단: 어디서 막히는지 한 번에 확인 ----------
const APP_VERSION = 'v25';
async function runDiag() {
  const out = [], box = $('#diag');
  const log = (ok, t) => { out.push((ok === true ? '✅ ' : ok === false ? '❌ ' : '• ') + t); box.textContent = out.join('\n'); };
  box.hidden = false; $('#copyDiag').hidden = false; log(null, `앱 버전 ${APP_VERSION} · ${(navigator.userAgent.match(/OS [\d_]+/) || [''])[0]}`);
  if (!S.apiKey) return log(false, 'API 키가 비어 있습니다');
  try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); log(null, `마이크 ${ds.length}개: ${ds.map(d => d.label || '(이름 없음)').join(' / ')} · 선택: ${S.micId ? (ds.find(d => d.deviceId === S.micId)?.label || '저장된 장치') : '자동'}`); } catch {}
  log(null, `API 키 ${S.apiKey.slice(0, 4)}… (${S.apiKey.length}자)`);
  const base = 'https://generativelanguage.googleapis.com/v1beta/', hdr = {'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey};
  const call = async (url, init) => { try { const r = await fetch(url, init); const d = await r.json().catch(() => ({})); return {r, d}; } catch (e) { return {err: e.message}; } };
  const fmt = x => x.err ? `연결 실패: ${x.err}` : x.r.ok ? `정상 (${x.r.status})` : `${x.r.status} ${x.d.error?.message || ''}`.slice(0, 220);
  let x = await call(base + 'models?pageSize=1000', {headers: hdr});
  log(!x.err && x.r.ok, `모델 목록: ${x.err || x.r.ok ? (x.err ? fmt(x) : (x.d.models || []).length + '개 조회') : fmt(x)}`);
  const c = await discoverModels(true); renderModelInfo();
  log(null, `자동 선택 → 빠름: ${c.fast || '없음'} · 정확: ${c.accurate || '없음'} · Live: ${c.live || '없음'}`);
  const model = S.model, g = (extra) => ({method: 'POST', headers: hdr, body: JSON.stringify({contents: [{parts: [{text: 'Return a JSON array with one short string.'}]}], generationConfig: extra})});
  log(null, `시험에 쓸 모델: ${model}${S.customModel ? ' (직접 지정)' : ''}`);
  for (const [name, gc] of [['기본 요청', undefined], ['JSON 형식', {responseMimeType: 'application/json'}],
    ['JSON + 응답 스키마', {responseMimeType: 'application/json', responseSchema: {type: 'ARRAY', items: {type: 'STRING'}}}],
    ['JSON + 스키마 + 추론 생략', {responseMimeType: 'application/json', responseSchema: {type: 'ARRAY', items: {type: 'STRING'}}, thinkingConfig: {thinkingBudget: 0}}]]) {
    x = await call(`${base}models/${encodeURIComponent(model)}:generateContent`, g(gc));
    log(!x.err && x.r.ok, `${name}: ${fmt(x)}`);
  }
  const fr = await new Promise(res => { const v = []; let last = performance.now(), n = 0; const tk = t => { v.push(t - last); last = t; if (++n < 90) requestAnimationFrame(tk); else res(v.slice(1)); }; requestAnimationFrame(tk); });
  log(null, `화면 프레임(1.5초): 평균 ${(fr.reduce((a, b) => a + b, 0) / fr.length).toFixed(1)}ms · 최대 ${Math.max(...fr).toFixed(0)}ms · 효과 줄이기 ${document.documentElement.classList.contains('lite') ? '켜짐' : '꺼짐'}`);
  try { const o = await koreanPronunciation(['దేవుడు ప్రేమించెను'], 'telugu'); log(true, `한글 발음 변환: 정상 → ${o[0]}`); }
  catch (e) { log(false, `한글 발음 변환: ${e.message.slice(0, 260)}`); }
  const live = await new Promise(res => {
    const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(S.apiKey));
    const t = setTimeout(() => { try { ws.close(); } catch {} res('8초 안에 응답 없음'); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({setup: {model: 'models/' + S.liveModel.replace(/^models\//, ''), generationConfig: {responseModalities: ['AUDIO']}}}));
    ws.onmessage = async ev => { try { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); if (m.setupComplete) { clearTimeout(t); ws.close(); res(true); } } catch {} };
    ws.onclose = ev => { clearTimeout(t); res(`연결 종료 ${ev.code} ${ev.reason || ''}`.trim()); };
    ws.onerror = () => {};
  });
  log(live === true, `Live 연결 (${S.liveModel}): ${live === true ? '정상' : live}`);
  log(null, '진단 끝 — 아래 내용을 그대로 복사해서 보내 주세요');
}

// ---------- 설정 탭 ----------
$('#apiKey').value = S.apiKey; $('#model').value = S.customModel;
$('#voiceEngine').value = S.voiceEngine; $('#pitch').value = S.pitch; GVOICES.forEach(([v, d]) => $('#gvoice').add(new Option(`${v} — ${d}`, v))); $('#gvoice').value = S.gvoice;
$('#liveModel').value = localStorage.getItem('liveModel') || ''; $('#liveModel').placeholder = S.liveModel; $('#geminiVoice').checked = S.geminiVoice; $('#echoMode').value = S.echoMode; $('#autoSpeak').checked = S.autoSpeak; $('#showPron').checked = S.showPron; $('#rate').value = S.rate;
$('#apiKey').onchange = e => { S.apiKey = e.target.value; discoverModels(true).then(renderModelInfo); };
$('#model').onchange = e => S.customModel = e.target.value;
$('#voiceEngine').onchange = e => S.voiceEngine = e.target.value;
$('#gvoice').onchange = e => S.gvoice = e.target.value;
$('#pitch').oninput = e => S.pitch = parseFloat(e.target.value);
$('#liveModel').onchange = e => { if (e.target.value.trim()) S.liveModel = e.target.value; else localStorage.removeItem('liveModel'); renderModelInfo(); };
$('#geminiVoice').onchange = e => S.geminiVoice = e.target.checked;
$('#echoMode').onchange = e => S.echoMode = e.target.value;
$('#autoSpeak').onchange = e => setSpeak(e.target.checked);
$('#callMode').onchange = e => setCall(e.target.checked);
$('#callReadKorean').checked = S.callReadKorean; $('#callReadKorean').onchange = e => S.callReadKorean = e.target.checked;
$('#micProc').value = S.micProc; $('#micProc').onchange = e => S.micProc = e.target.value;
$('#micTestBtn').onclick = () => micTest();
$('#micSel').onchange = e => { S.micId = e.target.value; S.micLabel = e.target.value ? e.target.selectedOptions[0].textContent.replace(/ \(연결 확인 전\)$/, '') : ''; };
$('#refreshMic').onclick = () => refreshMics(true);
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener?.('devicechange', () => refreshMics(false));
$('#lite').onchange = e => { S.lite = e.target.checked; S.liteAuto = false; applyLite(); };
$('#showPron').onchange = e => S.showPron = e.target.checked;
$('#rate').oninput = e => S.rate = parseFloat(e.target.value);
$('#testKey').onclick = async () => {
  const out = $('#keyResult'); out.textContent = '확인 중…';
  S.apiKey = $('#apiKey').value; S.customModel = $('#model').value;
  try {
    await discoverModels(true); renderModelInfo();
    await gemini({contents: [{parts: [{text: 'Reply with JSON {"ok": true}'}]}], generationConfig: {responseMimeType: 'application/json'}});
    out.textContent = `✅ 연결 성공 (모델: ${S.model})`;
  } catch (e) { out.textContent = '❌ ' + e.message; }
};
$('#runDiag').onclick = () => runDiag();
$('#copyDiag').onclick = async () => { try { await navigator.clipboard.writeText($('#diag').textContent); $('#copyDiag').textContent = '복사됨 ✓'; } catch { $('#copyDiag').textContent = '길게 눌러 직접 복사하세요'; } };
$('#testVoice').onclick = () => { TTS.unlock(); TTS.speak('దేవుడు నిన్ను ప్రేమిస్తున్నాడు', 'telugu', $('#swarn')); };

$('#appVer').textContent = APP_VERSION; applyLite(); renderCall(); renderModelInfo(); if (S.apiKey) discoverModels(false).then(renderModelInfo);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded && !live) { reloaded = true; location.reload(); } });   // 새 버전이 설치되면 자동으로 새로고침 (통역 중에는 제외)
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });   // 앱으로 돌아올 때마다 새 버전 확인
  }).catch(() => {});
}
