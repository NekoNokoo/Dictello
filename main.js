/* Dictello site. No dependencies. */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, still ? 0 : ms));

/* ───── i18n: Russian lives in the markup, English here ───── */
const EN = {
  nav1:'Assistant', nav2:'Voice', nav3:'Documents', nav4:'Eva', get:'Download', getMac:'Download for macOS',
  tickLocal:'LOCAL OR VIA OPENROUTER', heroLine:'Assistant, dictation and translation.<br><em>On your Mac.</em>', hint:'The symbols are alive — touch them',
  contents:'Contents', rail1:'Your knowledge base', rail2:'Speak instead of typing', rail3:'Translate a document',
  askTitleA:'A knowledge base', askTitleB:'you build yourself',
  askBody:'Put your own contracts, policies and manuals into it. The answer is assembled from them, including what the internet has never seen. Every claim leads to a line in a document.',
  replay:'↻ replay', scope:'Contracts', files:'files', brainLocal:'model on Mac', tSem:'by meaning', tLex:'by words', tTop:'best', tWeb:'web',
  src1:'from your base', src2:'from the web',
  srcWeb:'manufacturer site', v1h:'7. Warranty', v1a:'7.1. The Supplier warrants that the equipment conforms to this contract.', v1b:'7.2. The warranty period for pumping equipment is 12 months from the date of delivery.', v1c:'7.3. The warranty does not cover consumables and seals.',
  v2h:'Warranty for N-series pumps', v2a:'We stand behind every pump that leaves the factory.', v2b:'The manufacturer warranty for the whole N series is 24 months from commissioning.', v2c:'Keep the serial number to register the warranty.',
  moreTitle:'And also', laneDocs:'documents', laneWeb:'web', m1T:'Deep search', m1B:'Works in steps: from a document to the web and back. Compares the sources and shows where they disagree.',
  m2T:'Translate from the screen', m2a:'Settings', m2b:'Turn on two-factor sign-in', m2c:'Show recovery codes', m2B:'Frame an area and the translation lands on top, in the same font and the same places.',
  m4T:'The notch', m4a:'Translating manual_v3.pdf', m4b:'Done · 12 pages', m4c:'Ask Eva…', m4B:'A work centre at the screen notch: task progress, quick chat, a shelf for files. On a display without a notch it is virtual.',
  wLocal:'LOCAL', wCloud:'CLOUD', wMac:'your Mac', wDocs:'documents', wVec:'vectors', wAudio:'voice', wModel:'model', wSent:'the question and the passages found', wAny:'any model', wKey:'your key',
  alwA:'Vectors always stay with you.', alwAT:'The knowledge base and its index live on the Mac in either mode.', alwB:'A base can be shared.', alwBT:'One file with the documents and ready vectors, password-protected if you like.',
  pg:'p.', art:'art.',
  pg:'p.', n2T:'“…12 months from delivery”', n3:'web query', n3T:'consumer law, warranty', art:'art.', n4T:'“…no less than two years”',
  ansLabel:'Answer',
  askF1:'Search by meaning and by exact words at once', askF2:'A citation opens the exact page of the document', askF4:'A web query built from a document leaves only with your consent',
  voiceTitleA:'Speak.', voiceTitleB:'The text is already there',
  voiceBody:'Hold fn in any app. Speech is recognised on the Mac and typed at once. Need another language? It is translated live, while you talk.',
  voiceBar:'listening locally', noTr:'no translation',
  voiceF1:'Whisper runs on device, audio never leaves', voiceF2:'Punctuation and insertion into the active field',
  docsTitleA:'Document translation', docsTitleB:'that keeps the formatting',
  docsBody:'PDF and DOCX come back with the same tables, columns and fonts. Fast and offline, or through an LLM that keeps the context and terms of the whole document.',
  docLocal:'local', docLlm:'LLM with context',
  docsF1:'Scans are recognised and translated the same way', docsF2:'Your glossary and what must not be translated',
  evaTitleA:'This is', evaTitleB:'Eva',
  evaBody:'Here she is the same as in the app: follows the cursor, blinks, yawns. The symbols in her hair are what she is busy with. Click her.',
  mood1:'listening', mood2:'thinking', mood3:'done', mood4:'asleep',
  ctaWord:'GET IT', req:'Apple Silicon · macOS 26 or later · free', releases:'All releases',
};
const RU = {};
let lang = 'ru';
const T = (ru, en) => lang === 'ru' ? ru : en;
function setLang(next) {
  lang = next;
  document.documentElement.lang = lang;
  for (const el of $$('[data-i18n]')) {
    const k = el.dataset.i18n;
    if (!(k in RU)) RU[k] = el.innerHTML;
    el.innerHTML = lang === 'ru' ? RU[k] : (EN[k] ?? RU[k]);
  }
  $('#lang').textContent = lang === 'ru' ? 'EN' : 'RU';
  try { localStorage.setItem('lang', lang); } catch {}
  playAsk(); startVoice(); whereText(); field.rebuild?.();
}

/* ───── hero: a field of falling glyphs. Where the stream is dense it draws Eva and the name;
   every glyph is a particle on a spring and can be pushed around. ───── */
function field() {
  const hero = $('#hero'), pin = $('.hero__pin', hero), cv = $('#field'), ctx = cv.getContext('2d');
  const GL = '01+:.*=#%·';
  const COLORS = ['#6f8fe0', '#cfe6ff', '#3d66ff', '#bcd6ff', '#4d74ff', '#4d74ff', '#ffffff', '#dcebff', '#7df0ff'];   // dust, hair, line, skin, name, name ∩ Eva, head, name ∩ Eva's lines
  const BG = 0, HAIR = 1, LINE = 2, SKIN = 3, NAME = 4, BOTH = 5, HEAD = 6, BOTHLINE = 7, TINT = 8;
  const BW = 4, BH = 3;                       // the cursor works in coarse blocks of cells, so its footprint is pixel-shaped, not round
  const img = new Image(); img.src = 'assets/eva-blank.webp';       // the faceless template: a silhouette, not a portrait
  let cols = 0, rows = 0, cw = 0, ch = 0, dpr = 1, n = 0, atlas = [], ready = false;
  let kind, base, glyph, lit, ox, oy, vx, vy, head, speed, kindA, baseA, kindB, baseB, thr, st;
  let prog = 0, lastY = scrollY, rush = 0, tint, ripples = [];
  const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, on: false };

  const build = async () => {
    const W = pin.clientWidth, H = pin.clientHeight; if (!W || !H) return;
    ready = false;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cw = W < 620 ? 4 : W < 1100 ? 6 : 8; ch = Math.round(cw * 1.25);
    cols = Math.ceil(W / cw); rows = Math.ceil(H / ch); n = cols * rows;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);

    // glyph atlas: one strip per colour, so a frame is plain drawImage calls
    const gw = Math.round(cw * dpr), gh = Math.round(ch * dpr);
    atlas = COLORS.map(col => {
      const a = document.createElement('canvas'); a.width = gw * GL.length; a.height = gh;
      const c = a.getContext('2d'); c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${cw * 1.34 * dpr}px "Martian Mono", monospace`;
      for (let i = 0; i < GL.length; i++) c.fillText(GL[i], (i + .5) * gw, gh * .54);
      return a;
    });

    // masks, sampled at cell centres
    const m = document.createElement('canvas'); m.width = cols; m.height = rows;
    const mc = m.getContext('2d', { willReadFrequently: true });
    const size = Math.min(W * .96, H * .9, 900), ex = (W - size) / 2, ey = H - size * (W < 620 ? 1.16 : 1);
    mc.drawImage(img, ex / cw, ey / ch, size / cw, size / ch);
    const eva = mc.getImageData(0, 0, cols, rows).data;
    mc.clearRect(0, 0, cols, rows);
    await document.fonts.load('800 100px Handjet').catch(() => {});
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tc = t.getContext('2d'); tc.font = '800 100px Handjet, monospace';
    const fs = 100 * (W * .94) / tc.measureText('DICTELLO').width;
    tc.font = `800 ${fs}px Handjet, monospace`; tc.textAlign = 'center'; tc.textBaseline = 'middle'; tc.fillStyle = '#fff';
    tc.fillText('DICTELLO', W / 2, W < 620 ? H * .3 : H * .46);
    mc.drawImage(t, 0, 0, cols, rows);
    const name = mc.getImageData(0, 0, cols, rows).data;

    kind = new Uint8Array(n); base = new Float32Array(n); glyph = new Uint8Array(n); lit = new Float32Array(n);
    tint = new Float32Array(n); ox = new Float32Array(n); oy = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4, inEva = eva[j + 3] > 90, inName = name[j + 3] > 110;
      glyph[i] = Math.random() * GL.length | 0;
      if (inEva) {
        const r = eva[j], g = eva[j + 1], b = eva[j + 2], lum = (.3 * r + .59 * g + .11 * b) / 255;
        // the hairclip sits at a fixed spot of the drawing; it is drawn white so it does not sink into the blue name
        const u = ((i % cols + .5) * cw - ex) / size, v = (((i / cols | 0) + .5) * ch - ey) / size;
        if (u > .665 && u < .785 && v > .275 && v < .395 && (lum < .45 || (b > 180 && r < 90))) { kind[i] = HEAD; base[i] = 1; }
        else if (inName) { kind[i] = lum < .4 ? BOTHLINE : BOTH; base[i] = lum < .4 ? 1 : .86; }
        else if (b > 200 && r > 150 && b - r > 12 && b - r < 110) { kind[i] = HAIR; base[i] = .5 + lum * .4; }
        else if (r > 225 && r - b > 18) { kind[i] = SKIN; base[i] = .26; glyph[i] = (i + (i / cols | 0)) % 2 ? 4 : 9; }
        else { kind[i] = lum < .4 ? LINE : HAIR; base[i] = lum < .4 ? 1 : .75; }
      } else if (inName) { kind[i] = NAME; base[i] = .82; }
      else { kind[i] = BG; base[i] = Math.random() < .3 ? .05 + Math.random() * .07 : 0; }
    }
    // second picture: the heading of the next section, built from the same cells
    mc.clearRect(0, 0, cols, rows); tc.clearRect(0, 0, W, H);
    const lines = lang === 'ru' ? ['ГОВОРИТЕ.', 'СПРАШИВАЙТЕ.', 'ПЕРЕВОДИТЕ.'] : ['SPEAK.', 'ASK.', 'TRANSLATE.'];
    tc.font = '800 100px Handjet, monospace';
    const hs = Math.min(100 * (W * .88) / Math.max(...lines.map(l => tc.measureText(l).width)), H * .74 / (lines.length * .82));
    tc.font = `800 ${hs}px Handjet, monospace`;
    lines.forEach((l, k) => tc.fillText(l, W / 2, H / 2 + (k - (lines.length - 1) / 2) * hs * .82));
    mc.drawImage(t, 0, 0, cols, rows);
    const next = mc.getImageData(0, 0, cols, rows).data;
    kindA = kind.slice(); baseA = base.slice(); kindB = new Uint8Array(n); baseB = new Float32Array(n); thr = new Float32Array(n); st = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (next[i * 4 + 3] > 110) { kindB[i] = HAIR; baseB[i] = .9; } else { kindB[i] = BG; baseB[i] = kindA[i] === BG ? baseA[i] : 0; }
      thr[i] = .1 + .5 * ((i / cols | 0) / rows) + Math.random() * .22;       // Eva lets go from the top down
    }
    head = new Float32Array(cols); speed = new Float32Array(cols);
    for (let x = 0; x < cols; x++) { head[x] = -Math.random() * rows * 1.5; speed[x] = .12 + Math.random() * .34; }
    ready = true;
    if (still) draw();
  };

  const step = () => {
    // scrolling is a force: it speeds the stream up and, past each cell's threshold, moves the cell to the next picture
    const span = hero.offsetHeight - innerHeight;
    prog = span > 0 ? Math.min(1, Math.max(0, (scrollY - hero.offsetTop) / span)) : 0;
    rush += (Math.min(6, Math.abs(scrollY - lastY) * .12) - rush) * .2; lastY = scrollY;
    pin.style.setProperty('--p', prog.toFixed(3));
    for (let i = 0; i < n; i++) {
      const want = prog > thr[i] ? 1 : 0;
      if (want === st[i]) continue;
      st[i] = want; kind[i] = want ? kindB[i] : kindA[i]; base[i] = want ? baseB[i] : baseA[i];
      vy[i] += (want ? 1 : -1) * (4 + Math.random() * 5); lit[i] = 1; glyph[i] = Math.random() * GL.length | 0;
    }
    // the stream: one head per column leaves a fading trail and reshuffles the glyphs it passes
    for (let x = 0; x < cols; x++) {
      const before = Math.floor(head[x]); head[x] += speed[x] * (1 + rush); const now = Math.floor(head[x]);
      if (now !== before && now >= 0 && now < rows) { const i = now * cols + x; lit[i] = 1; glyph[i] = Math.random() * GL.length | 0; }
      if (head[x] > rows + 6) { head[x] = -Math.random() * rows * .9; speed[x] = .12 + Math.random() * .34; }
    }
    const reach = cw < 6 ? 6 : 4, pbx = Math.floor(ptr.x / cw / BW), pby = Math.floor(ptr.y / ch / BH);
    for (const r of ripples) r.t += .45;
    ripples = ripples.filter(r => r.t < 26);
    for (let i = 0; i < n; i++) {
      lit[i] *= .955; tint[i] = 0;
      const bx = (i % cols) / BW | 0, by = (i / cols | 0) / BH | 0;
      if (ptr.on) {
        const d = Math.abs(bx - pbx) + Math.abs(by - pby);                 // stepped diamond around the cursor
        if (d < reach) {
          const f = 1 - d / reach; tint[i] = f;
          if (Math.random() < f * .1) glyph[i] = (glyph[i] + 1 + (Math.random() * (GL.length - 1) | 0)) % GL.length;   // a glyph turns into another one
        }
      }
      for (const r of ripples) {                                             // a click sends a square ring across the grid
        if (Math.max(Math.abs(bx - r.bx), Math.abs(by - r.by)) === (r.t | 0)) { tint[i] = Math.max(tint[i], 1 - r.t / 26); if (Math.random() < .5) glyph[i] = Math.random() * GL.length | 0; }
      }
      if (!ox[i] && !oy[i] && !vx[i] && !vy[i]) continue;
      vx[i] = (vx[i] - ox[i] * .045) * .9; vy[i] = (vy[i] - oy[i] * .045) * .9;   // spring home (used by the scroll transition)
      ox[i] += vx[i]; oy[i] += vy[i];
      if (Math.abs(ox[i]) < .01 && Math.abs(vx[i]) < .01) { ox[i] = 0; vx[i] = 0; }
      if (Math.abs(oy[i]) < .01 && Math.abs(vy[i]) < .01) { oy[i] = 0; vy[i] = 0; }
    }
    ptr.vx *= .8; ptr.vy *= .8;
  };

  const draw = () => {
    const gw = Math.round(cw * dpr), gh = Math.round(ch * dpr);
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < n; i++) {
      const moved = Math.abs(vx[i]) + Math.abs(vy[i]);
      let a = base[i] + lit[i] * (kind[i] === BG ? .55 : .35) + Math.min(.5, moved * .06);
      if (a < .03 && !tint[i]) continue;
      const k = lit[i] > .86 ? HEAD : kind[i];
      ctx.globalAlpha = a > 1 ? 1 : a;
      const x = ((i % cols) * cw + ox[i]) * dpr, y = ((i / cols | 0) * ch + oy[i]) * dpr;
      ctx.drawImage(atlas[k], glyph[i] * gw, 0, gw, gh, x, y, gw, gh);
      if (tint[i]) { ctx.globalAlpha = Math.min(1, (a + .25) * tint[i] * .8); ctx.drawImage(atlas[TINT], glyph[i] * gw, 0, gw, gh, x, y, gw, gh); }
    }
    ctx.globalAlpha = 1;
  };

  const loop = () => {
    requestAnimationFrame(loop);
    if (!ready || pin.getBoundingClientRect().bottom < 0 || document.hidden) return;
    step(); draw();
  };

  const at = e => {
    const b = pin.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    if (ptr.on) { ptr.vx = x - ptr.x; ptr.vy = y - ptr.y; }
    ptr.x = x; ptr.y = y; ptr.on = true;
  };
  hero.addEventListener('pointermove', at);
  hero.addEventListener('pointerleave', () => { ptr.on = false; });
  hero.addEventListener('pointerdown', e => {
    at(e); if (!ready || still) return;
    ripples.push({ bx: Math.floor(ptr.x / cw / BW), by: Math.floor(ptr.y / ch / BH), t: 0 });
  });
  const start = () => build().then(() => { if (!still && !field.running) { field.running = true; loop(); } });
  img.complete && img.naturalWidth ? start() : img.addEventListener('load', start);
  addEventListener('resize', () => { clearTimeout(field.t); field.t = setTimeout(build, 180); });
  field.rebuild = () => { if (img.naturalWidth) build(); };
}

/* ───── pixel dissolve strips ───── */
function dissolves() {
  for (const cv of $$('.dissolve')) {
    const paint = () => {
      const px = innerWidth < 700 ? 10 : 16;
      const w = Math.ceil(cv.clientWidth / px), h = Math.ceil(cv.clientHeight / px);
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      c.fillStyle = cv.dataset.from; c.fillRect(0, 0, w, h);
      c.fillStyle = cv.dataset.to;
      let seed = 7 + cv.dataset.to.length * 13 + w;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let y = 0; y < h; y++) {
        const p = Math.pow(y / (h - 1), 1.7);
        for (let x = 0; x < w; x++) if (rnd() < p) c.fillRect(x, y, 1, 1);
      }
    };
    paint(); addEventListener('resize', paint);
  }
}

/* ───── 01: the assistant answering from the knowledge base ───── */
let askRun = 0, brain = 'local';
async function playAsk() {
  const root = $('#demoAsk'); if (!root) return;
  const run = ++askRun, live = () => run === askRun;
  const q = $('#askQ'), out = $('#askAnswer'), where = $('#askWhere');
  $$('.on, .hot', root).forEach(e => e.classList.remove('on', 'hot'));
  q.textContent = ''; out.innerHTML = '';
  where.textContent = brain === 'local' ? T('отвечает модель на Mac · векторы на Mac', 'answered by a model on the Mac · vectors on the Mac') : T('ответ пишет модель через OpenRouter · векторы остались на Mac', 'the answer is written via OpenRouter · vectors stayed on the Mac');
  const type = async (el, html, ms) => { let acc = ''; for (const w of html.split(/(?<=\s)/)) { if (!live()) return; acc += w; el.innerHTML = acc; await sleep(ms); } };
  await type(q, T('Какая у нас гарантия на насосы и что обещает производитель?', 'What warranty do we have on the pumps, and what does the maker promise?'), 45);
  for (const s of ['sem', 'lex', 'top', 'web']) { if (!live()) return; $(`[data-step="${s}"]`, root).classList.add('on'); await sleep(520); }
  if (!live()) return;
  await type(out, T(
    'По договору — 12 месяцев со дня поставки<sup data-cite="1">[1]</sup>. <mark>Производитель даёт 24 месяца<sup data-cite="2">[2]</sup></mark> — у поставщика можно просить больше.',
    'The contract gives 12 months from delivery<sup data-cite="1">[1]</sup>. <mark>The maker gives 24 months<sup data-cite="2">[2]</sup></mark> — there is room to ask the supplier for more.'), 50);
  for (const c of $$('.src', root)) { if (!live()) return; c.classList.add('on'); await sleep(180); }
  if (live()) showSource('1');
}
// the page the answer was taken from, with the key line outlined
function showSource(n) {
  const root = $('#demoAsk'), view = $('#askView');
  $$('.src', root).forEach(c => c.classList.toggle('hot', c.dataset.src === n));
  $$('[data-view]', view).forEach(v => { v.hidden = v.dataset.view !== n; });
  view.classList.remove('on'); void view.offsetWidth; view.classList.add('on');
}
function askWiring() {
  const root = $('#demoAsk'); if (!root) return;
  const hot = showSource;
  root.addEventListener('click', e => {
    const cite = e.target.closest('[data-cite]'), src = e.target.closest('.src'), b = e.target.closest('[data-brain]');
    if (cite) hot(cite.dataset.cite);
    if (src) hot(src.dataset.src);
    if (b) { brain = b.dataset.brain; $$('[data-brain]', root).forEach(x => x.classList.toggle('is-on', x === b)); playAsk(); }
  });
}

/* ───── local or cloud ───── */
let whereMode = 'local';
function whereText() {
  const el = $('#whereSay'); if (!el) return;
  el.textContent = whereMode === 'local'
    ? T('Модель работает на Mac. Интернет не нужен совсем.', 'The model runs on the Mac. No internet at all.')
    : T('Любая модель через ваш ключ OpenRouter. Уходят только вопрос и найденные фрагменты.', 'Any model through your OpenRouter key. Only the question and the passages found leave.');
}
function whereWiring() {
  for (const b of $$('[data-where]')) b.addEventListener('click', () => {
    whereMode = b.dataset.where;
    $$('[data-where]').forEach(x => x.classList.toggle('is-on', x === b));
    $('#wire').classList.toggle('is-cloud', whereMode === 'cloud');
    whereText();
  });
  whereText();
}

/* ───── 02: live dictation with live translation ───── */
const VOICE = {
  ru: ['Напиши', 'Анне,', 'что', 'смета', 'готова,', 'и', 'предложи', 'созвон', 'в', 'четверг.'],
  en: ['Tell', 'Anna', 'the', 'estimate', 'is', 'ready', 'and', 'suggest', 'a', 'call', 'on', 'Thursday.'],
  ja: ['見積もりが', 'できたと', 'アンナに', '伝えて、', '木曜日の', '打ち合わせを', '提案して。'],
};
let voiceMode = 'en', voiceRun = 0, waveTimer = 0, speaking = false;
function wave() {
  const el = $('.wave'); if (!el || el.children.length) return;
  for (let i = 0; i < 64; i++) el.append(document.createElement('i'));
  const bars = [...el.children];
  clearInterval(waveTimer);
  waveTimer = setInterval(() => {
    const t = performance.now() / 260;
    bars.forEach((b, i) => {
      const env = speaking ? .35 + .65 * Math.abs(Math.sin(t + i * .27)) * Math.abs(Math.sin(t * .37 + i * .11)) : .04;
      b.style.setProperty('--h', (env * (speaking ? .25 + Math.random() * .75 : 1)).toFixed(2));
    });
  }, still ? 1e9 : 90);
}
async function startVoice() {
  const said = $('#vSaid'), tr = $('#vTr'), trRow = $('.lines .tr'); if (!said) return;
  const run = ++voiceRun, live = () => run === voiceRun;
  $('#vTo').textContent = voiceMode === 'ja' ? 'JA' : 'EN';
  trRow.classList.toggle('off', voiceMode === 'off');
  while (live()) {
    said.textContent = ''; tr.textContent = '';
    const src = VOICE.ru, dst = voiceMode === 'off' ? [] : VOICE[voiceMode];
    speaking = true;
    for (let i = 0; i < src.length; i++) {
      if (!live()) return;
      said.textContent += (i ? ' ' : '') + src[i];
      const upto = Math.floor((i + 1) / src.length * dst.length * .92);      // translation trails the voice slightly
      tr.textContent = dst.slice(0, upto).join(voiceMode === 'ja' ? '' : ' ');
      await sleep(230 + Math.random() * 160);
    }
    speaking = false;
    await sleep(350); if (!live()) return;
    tr.textContent = dst.join(voiceMode === 'ja' ? '' : ' ');
    await sleep(still ? 1e9 : 3200);
  }
}

/* ───── 03: original / translation slider ───── */
function docs() {
  const root = $('#demoDocs'); if (!root) return;
  const sheet = $('.sheet', root), range = $('.cutrange', root);
  const set = v => { sheet.style.setProperty('--cut', v + '%'); sheet.style.setProperty('--cutf', v / 100); };
  range.addEventListener('input', () => set(range.value)); set(range.value);
  for (const b of $$('[data-doc]', root)) b.addEventListener('click', () => {
    $$('[data-doc]', root).forEach(x => x.classList.toggle('is-on', x === b));
    sheet.classList.toggle('is-llm', b.dataset.doc === 'llm');
    range.value = 8; set(8);                                                 // show the translated page, where the wording changes
  });
}

/* ───── 04: Eva — the mascot itself, the same page and assets the Mac app embeds ───── */
function eva() {
  const stage = $('#evaStage'), frame = $('#evaLive'); if (!frame) return;
  const mascot = () => { try { return frame.contentWindow.mascot; } catch { return null; } };
  addEventListener('message', e => { if (e.origin === location.origin && e.data?.eva === 'ready') stage.classList.add('is-live'); });
  eva.load = () => { if (!frame.src) frame.src = frame.dataset.src; };          // ~8 MB, so only when the section is near
  let asleep = false;
  for (const b of $$('[data-mood]')) b.addEventListener('click', () => {
    const m = mascot(); if (!m) return;
    $$('[data-mood]').forEach(x => x.classList.toggle('is-on', x === b));
    const type = b.dataset.mood, go = () => m.dispatch({ type });
    if (asleep && type !== 'sleep') { m.dispatch({ type: 'wake' }); setTimeout(go, 1600); } else go();
    asleep = type === 'sleep';
    if (type === 'done') setTimeout(() => b.classList.remove('is-on'), 2600);
  });
}

/* ───── scroll: reveal, rail, autoplay ───── */
function scrolling() {
  // Plain geometry checks instead of IntersectionObserver: nothing can stay hidden if an observer misfires.
  let pending = $$('.chapter__head, .demo, .facts, .more__title, .mini, .where > *, .eva__text, .eva__stage, .cta > *');
  pending.forEach(e => e.classList.add('rv'));
  const chapters = $$('.chapter'), rail = $$('[data-rail]');
  const tick = () => {
    const vh = innerHeight;
    pending = pending.filter(e => {
      const r = e.getBoundingClientRect();
      if (r.top > vh * .9 || r.bottom < 0) return true;
      e.classList.add('in');
      if (e.id === 'demoAsk') playAsk();
      if (e.id === 'demoVoice') { wave(); startVoice(); }
      return false;
    });
    const e = $('#eva'); if (e && e.getBoundingClientRect().top < vh * 2.2) eva.load?.();
    let current = '';
    for (const c of chapters) if (c.getBoundingClientRect().top < vh * .45) current = c.id;
    rail.forEach(a => a.classList.toggle('is-on', a.dataset.rail === current));
  };
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
  setInterval(tick, 500);
  tick();
}

/* ───── boot ───── */
askWiring(); whereWiring();
field(); dissolves(); docs(); eva(); scrolling();
$('[data-replay="ask"]').addEventListener('click', playAsk);
for (const b of $$('[data-voice]')) b.addEventListener('click', () => {
  $$('[data-voice]').forEach(x => x.classList.toggle('is-on', x === b));
  voiceMode = b.dataset.voice; wave(); startVoice();
});
$('#lang').addEventListener('click', () => setLang(lang === 'ru' ? 'en' : 'ru'));
let saved = null; try { saved = localStorage.getItem('lang'); } catch {}
if (saved === 'en' || (!saved && !/^(ru|uk|be|kk)/i.test(navigator.language || 'ru'))) setLang('en');
})();
