'use strict';
const $ = s => document.querySelector(s);
const LANGS = {
  telugu:  {name: 'తెలుగు (텔루구어)', prompt: 'Telugu (తెలుగు script)', locale: 'te-IN'},
  english: {name: 'English', prompt: 'English', locale: 'en-US'},
  korean:  {name: '한국어', prompt: 'Korean (한국어)', locale: 'ko-KR'},
  hindi:   {name: 'हिन्दी (힌디어)', prompt: 'Hindi (देवनागरी script)', locale: 'hi-IN'},
};
const BIBLES = [{id: 'nkjv', label: 'NKJV'}, {id: 'krv', label: '개역한글'}];

// ---------- 설정 ----------
const S = {
  get apiKey() { return localStorage.getItem('apiKey') || ''; },
  set apiKey(v) { localStorage.setItem('apiKey', v.replace(/[^\x21-\x7E]/g, '')); }, // 공백·줄바꿈·한글 등 제거
  get model() { return localStorage.getItem('model') || 'gemini-2.5-flash'; },
  set model(v) { localStorage.setItem('model', v.trim()); },
  get target() { return localStorage.getItem('target') || 'telugu'; },
  set target(v) { localStorage.setItem('target', v); },
  get autoSpeak() { return localStorage.getItem('autoSpeak') !== '0'; },
  set autoSpeak(v) { localStorage.setItem('autoSpeak', v ? '1' : '0'); },
  get showPron() { return localStorage.getItem('showPron') !== '0'; },
  set showPron(v) { localStorage.setItem('showPron', v ? '1' : '0'); },
  get rate() { return parseFloat(localStorage.getItem('rate') || '0.85'); },
  set rate(v) { localStorage.setItem('rate', String(v)); },
};

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
  speak(texts, langKey, warnEl) {
    speechSynthesis.cancel();
    const L = LANGS[langKey];
    this.load();
    const v = this.voiceFor(L.locale);
    show(warnEl, v ? '' : `${L.name} 음성이 설치되어 있지 않을 수 있습니다. iPhone 설정 > 손쉬운 사용 > 말하기 콘텐츠 > 음성에서 내려받아 주세요.`);
    for (const t of [].concat(texts)) {
      if (!t || !t.trim()) continue;
      const u = new SpeechSynthesisUtterance(t);
      u.lang = L.locale; if (v) u.voice = v;
      u.rate = S.rate;
      u.onend = u.onerror = () => { if (!speechSynthesis.speaking) $('#stopBtn').hidden = true; };
      speechSynthesis.speak(u);
    }
    $('#stopBtn').hidden = false;
  },
  stop() { speechSynthesis.cancel(); $('#stopBtn').hidden = true; },
};
if ('speechSynthesis' in window) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }
$('#stopBtn').onclick = () => TTS.stop();

// ---------- 녹음 (16kHz mono WAV) ----------
class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = []; this.samples = 0; this.level = 0;
    this.proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d)); this.samples += d.length;
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(s / d.length) * 6);
      if (this.onlevel) this.onlevel(this.level);
      if (this.samples / this.ctx.sampleRate > 300 && this.onlimit) this.onlimit(); // 5분 상한
    };
    this.src.connect(this.proc); this.proc.connect(this.ctx.destination); // 출력은 무음
  }
  async stop() {
    const rate = this.ctx.sampleRate;
    this.proc.disconnect(); this.src.disconnect();
    this.stream.getTracks().forEach(t => t.stop());
    await this.ctx.close();
    const all = new Float32Array(this.samples); let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    return encodeWav(downsample(all, rate, 16000), 16000);
  }
}
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
  const prompt = `You are an interpreter for a Christian gospel message.
The attached audio is spoken in Korean or English (possibly mixed, with an accent or unclear pronunciation).
1. Transcribe exactly what was said, in its original language and script. Use context (Bible / gospel vocabulary) to resolve unclear pronunciation.
2. Translate it into natural, clear ${LANGS[langKey].prompt} suitable for being read aloud.
   If a Bible verse is quoted, use the wording familiar from that language's standard Bible translation.
3. Write "pronunciation_ko": how the translation sounds, spelled in Hangul (한글) so a Korean reader can read it aloud phonetically, syllable by syllable, separating words with spaces and keeping the same sentence breaks. If the target language is Korean, return an empty string.
4. If the audio has no intelligible speech, return empty strings.
Respond only with JSON.`;
  return gemini({
    contents: [{parts: [{text: prompt}, {inline_data: {mime_type: 'audio/wav', data: b64(wav)}}]}],
    generationConfig: {
      temperature: 0.2, responseMimeType: 'application/json',
      responseSchema: {type: 'OBJECT', properties: {
        detected_language: {type: 'STRING'}, transcript: {type: 'STRING'},
        translation: {type: 'STRING'}, pronunciation_ko: {type: 'STRING'}},
        required: ['detected_language', 'transcript', 'translation', 'pronunciation_ko']},
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

// 구절별 발음 캐시
const PCACHE = (() => {
  let m = {}; try { m = JSON.parse(localStorage.getItem('pron') || '{}'); } catch {}
  const h = s => { let x = 5381; for (const c of s) x = ((x * 33) ^ c.codePointAt(0)) >>> 0; return x.toString(36); };
  return {get: s => m[h(s)], set(s, v) { m[h(s)] = v; try { localStorage.setItem('pron', JSON.stringify(m)); } catch {} }};
})();

// ---------- 통역 탭 ----------
const rec = new Recorder();
let phase = 'idle';
const entries = [];

function renderHint() {
  $('#hint').textContent = entries.length ? '' :
    `아래 버튼을 눌러 한국어/영어로 말씀하세요.\n다시 누르면 ${LANGS[S.target].name}로 번역해 읽어 줍니다.`;
}
function addEntry(r, langKey) {
  entries.unshift({r, langKey});
  const el = document.createElement('div'); el.className = 'card';
  const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; return d; };
  el.append(mk('small', `${r.detected_language} · 인식된 말씀`), mk('', r.transcript), document.createElement('hr'),
    mk('tr', r.translation));
  if (S.showPron && r.pronunciation_ko) el.append(mk('pron', r.pronunciation_ko));
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = '🔊 다시 듣기';
  b.onclick = () => { TTS.unlock(); TTS.speak(r.translation, langKey, $('#warn')); };
  el.append(b);
  $('#entries').prepend(el); renderHint();
}
function setPhase(p) {
  phase = p;
  $('#mic').classList.toggle('rec', p === 'recording');
  $('#mic').disabled = p === 'processing';
  $('#micIcon').textContent = p === 'recording' ? '⏹' : p === 'processing' ? '…' : '🎤';
  $('#micLabel').textContent = {idle: '눌러서 말하기', recording: '듣는 중… 끝나면 다시 누르세요', processing: '번역 중…'}[p];
  $('#meter').hidden = p !== 'recording';
}
async function stopAndTranslate() {
  setPhase('processing');
  try {
    const wav = await rec.stop();
    if (wav.length < 16000) throw new Error('녹음이 너무 짧습니다.');
    const langKey = S.target;
    const r = await interpret(wav, langKey);
    if (!r.translation) throw new Error('음성을 인식하지 못했습니다.');
    addEntry(r, langKey);
    if (S.autoSpeak) TTS.speak(r.translation, langKey, $('#warn'));
  } catch (e) { show($('#err'), e.message); }
  setPhase('idle');
}
$('#mic').onclick = async () => {
  show($('#err'), '');
  if (phase === 'recording') return stopAndTranslate();
  if (phase !== 'idle') return;
  TTS.unlock(); TTS.stop();
  try {
    await rec.start();
    rec.onlevel = l => $('#meter i').style.width = (l * 100) + '%';
    rec.onlimit = () => { rec.onlimit = null; stopAndTranslate(); };
    setPhase('recording');
  } catch (e) {
    show($('#err'), e.name === 'NotAllowedError' ? '마이크 권한이 필요합니다. Safari 설정에서 마이크를 허용해 주세요.' : e.message);
  }
};
const targetSel = $('#target');
for (const [k, v] of Object.entries(LANGS)) targetSel.add(new Option(v.name, k));
targetSel.value = S.target;
targetSel.onchange = () => { S.target = targetSel.value; renderHint(); };
renderHint();

// ---------- 성경 탭 ----------
const bibleData = {};
const B = {primary: 'nkjv', book: 42, chapter: 2, token: 0};
async function loadBible(id) {
  if (!bibleData[id]) {
    let r;
    try { r = await fetch(`bibles/${id}.json`); }
    catch (e) { throw new Error(`[성경 파일 ${id} 불러오기 실패] ${e.message} — 네트워크가 끊겼거나 파일이 너무 커서 실패했을 수 있습니다.`); }
    if (!r.ok) throw new Error(`[성경 파일 ${id}] 서버 응답 ${r.status}`);
    bibleData[id] = await r.json();
  }
  return bibleData[id];
}
const verses = (bible, book, ch) => bible?.books.find(b => b.index === book)?.chapters[ch] || [];

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
  try { [prim, te] = await Promise.all([loadBible(B.primary), loadBible('telugu')]); }
  catch (e) { return show($('#berr'), e.message); }
  if (token !== B.token) return;

  const sel = $('#book');
  if (!sel.options.length || sel.dataset.bible !== B.primary) {
    sel.innerHTML = ''; prim.books.forEach(b => sel.add(new Option(b.name, b.index)));
    sel.dataset.bible = B.primary;
  }
  sel.value = B.book;
  const count = Math.max(prim.books.find(b => b.index === B.book)?.chapters.length || 0,
                         te.books.find(b => b.index === B.book)?.chapters.length || 0);
  B.chapter = Math.max(0, Math.min(B.chapter, count - 1));
  $('#chLabel').textContent = `${B.chapter + 1}장`;

  const pv = verses(prim, B.book, B.chapter); curTe = verses(te, B.book, B.chapter);
  const box = $('#verses'); box.innerHTML = '';
  const n = Math.max(pv.length, curTe.length);
  for (let i = 0; i < n; i++) {
    if (!pv[i] && !curTe[i]) continue;
    const d = document.createElement('div'); d.className = 'v';
    const p = document.createElement('div');
    const num = document.createElement('span'); num.className = 'n'; num.textContent = i + 1;
    p.append(num, pv[i] || ''); d.append(p);
    if (curTe[i]) {
      const t = document.createElement('div'); t.className = 'te'; t.textContent = curTe[i];
      const pr = document.createElement('div'); pr.className = 'pr'; pr.dataset.te = curTe[i];
      pr.textContent = S.showPron ? (PCACHE.get(curTe[i]) || '') : '';
      const b = document.createElement('button'); b.textContent = '🔊 텔루구어로 듣기';
      b.onclick = () => { TTS.unlock(); TTS.speak(curTe[i], 'telugu', $('#bwarn')); };
      d.append(t, pr, b);
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
$('#apiKey').value = S.apiKey; $('#model').value = S.model;
$('#autoSpeak').checked = S.autoSpeak; $('#showPron').checked = S.showPron; $('#rate').value = S.rate;
$('#apiKey').onchange = e => S.apiKey = e.target.value;
$('#model').onchange = e => S.model = e.target.value || 'gemini-2.5-flash';
$('#autoSpeak').onchange = e => S.autoSpeak = e.target.checked;
$('#showPron').onchange = e => S.showPron = e.target.checked;
$('#rate').oninput = e => S.rate = parseFloat(e.target.value);
$('#testKey').onclick = async () => {
  const out = $('#keyResult'); out.textContent = '확인 중…';
  S.apiKey = $('#apiKey').value; S.model = $('#model').value || 'gemini-2.5-flash';
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
