// voice.js — гласные по голосу в реальном времени (рот в такт речи пользователя), не зависит от языка.
//
// Цепочка: PCM 16 кГц → кадры 25 мс через 10 мс → LPC-спектр → пики F1 / F2 → ближайшая из пяти
// «кардинальных» гласных A E I O U → голосование по последним кадрам. Текста и языка здесь нет:
// гласные разных языков занимают одни и те же места на плоскости F1/F2, поэтому русский, английский,
// испанский, японский и т. д. обрабатываются одинаково (звуки вне пяти — ближайшей гласной).
// Всё считается локально на CPU, звук нигде не сохраняется.

export const SAMPLE_RATE = 16000;
const FRAME = 400;          // 25 мс
const HOP = 160;            // 10 мс
const PITCH_WIN = 640;      // 40 мс для высоты тона: на окне 25 мс низкий мужской голос даёт ошибки на октаву
const LPC_RATE = 8000;      // форманты считаем на 8 кГц: выше ~4 кГц у гласных почти ничего нет, а шум там только мешает
const ORDER = 10;           // порядок LPC для 8 кГц (2 + fs/1000)
const ALT_ORDER = 8;        // запасной, ниже порядком: у высоких голосов близкие F1/F2 при 10 сливаются в один пик
const PRE = 0.95;           // предыскажение (у голоса спад ≈ −6 дБ/окт)
const MAX_LAG = 228;        // нижняя граница высоты тона ≈ 70 Гц
const MIN_LAG = 40;         // верхняя ≈ 400 Гц
const F_MIN = 200, F_MAX = 3600, F_STEP = 20;

/** Опорные форманты [F1, F2] пяти гласных, Гц (усреднённый взрослый голос; общие для языков). */
export const VOWEL_REF = {
  A: [730, 1250],
  E: [520, 1900],
  I: [310, 2300],
  O: [510, 950],
  U: [340, 850],
};
const SIGMA = [0.2, 0.22]; // разброс по ln F1 и ln F2

const FRAME_D = FRAME / 2;
const HAMMING = new Float64Array(FRAME_D).map((_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_D - 1)));
const LAG_WINDOW = new Float64Array(ORDER + 1).map((_, k) => Math.exp(-0.5 * ((2 * Math.PI * 60 * k) / LPC_RATE) ** 2));
// ФНЧ перед прореживанием ×2: окно Хэмминга на sinc, срез 3,6 кГц при 16 кГц
const DECIM = (() => {
  const taps = 31, mid = (taps - 1) / 2, fc = 3600 / SAMPLE_RATE;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const m = n - mid;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    h[n] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1)));
    sum += h[n];
  }
  return h.map((v) => v / sum);
})();
const GRID = [];
for (let f = F_MIN; f <= F_MAX; f += F_STEP) GRID.push(f);
const COS = GRID.map((f) => new Float64Array(ORDER + 1).map((_, k) => Math.cos((2 * Math.PI * f * k) / LPC_RATE)));
const SIN = GRID.map((f) => new Float64Array(ORDER + 1).map((_, k) => Math.sin((2 * Math.PI * f * k) / LPC_RATE)));

/** Кадровый анализ: на каждые 10 мс звука — {rms, voiced, f1, f2}. */
export class FormantAnalyzer {
  constructor() {
    this.pending = new Float32Array(0);
  }

  reset() { this.pending = new Float32Array(0); }

  /** samples: Float32Array в [-1, 1] (16 кГц, моно). Возвращает кадры, готовые на данный момент. */
  push(samples) {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    merged.set(samples, this.pending.length);
    const out = [];
    let at = 0;
    while (merged.length - at >= PITCH_WIN) {
      out.push(this._analyze(merged, at));
      at += HOP;
    }
    this.pending = merged.slice(at);
    return out;
  }

  _analyze(buf, at) {
    let sum = 0;
    for (let i = 0; i < FRAME; i++) { const v = buf[at + i]; sum += v * v; }
    const rms = Math.sqrt(sum / FRAME);
    if (rms < 1e-4) return { rms, voiced: false, f1: null, f2: null };

    // ФНЧ + прореживание до 8 кГц, предыскажение, окно
    const lp = new Float64Array(FRAME_D);
    const half = (DECIM.length - 1) / 2;
    for (let m = 0; m < FRAME_D; m++) {
      let acc = 0;
      for (let t = 0; t < DECIM.length; t++) {
        const idx = 2 * m + t - half;
        if (idx >= 0 && idx < FRAME) acc += DECIM[t] * buf[at + idx];
      }
      lp[m] = acc;
    }
    const x = new Float64Array(FRAME_D);
    let prev = 0;
    for (let i = 0; i < FRAME_D; i++) {
      x[i] = (lp[i] - PRE * prev) * HAMMING[i];
      prev = lp[i];
    }
    // Автокорреляция для LPC (достаточно ORDER лагов)
    const r = new Float64Array(ORDER + 1);
    for (let k = 0; k <= ORDER; k++) {
      let acc = 0;
      for (let i = k; i < FRAME_D; i++) acc += x[i] * x[i - k];
      r[k] = acc;
    }
    if (r[0] <= 1e-12) return { rms, voiced: false, f1: null, f2: null };

    // Звонкость и высота тона (Гц): NSDF по окну 40 мс, первый из сильных пиков — без ошибок на октаву
    const { f0, clarity } = pitch(buf, at);
    const periodicity = clarity;
    if (clarity < 0.5) return { rms, voiced: false, f1: null, f2: null, periodicity };

    const fit = lpc(r);
    if (!fit) return { rms, voiced: true, f0, f1: null, f2: null, periodicity };
    let { f1, f2 } = formants(fit.a);
    // Подозрительная пара (низкий F1 и F2 за 2,2 кГц: слились F1 и F2, а «F2» — это F3) → пересчёт на меньшем порядке
    if (f1 && f2 && f1 < 1000 && f2 > 2200) {
      const alt = formants(fit.alt);
      if (alt.f1 && alt.f2 && alt.f2 < 1900) ({ f1, f2 } = alt);
    }
    return { rms, voiced: true, f0, f1, f2, periodicity };
  }
}

/**
 * Высота тона по нормированной квадратичной разности (McLeod NSDF): первый «ключевой» пик не ниже 90 % от
 * наибольшего. Возвращает {f0, clarity}; clarity ≈ 1 у чистого голоса, у шума < 0,4.
 */
function pitch(buf, at) {
  const len = PITCH_WIN;
  const cum = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) cum[i + 1] = cum[i] + buf[at + i] * buf[at + i];
  const nsdf = new Float64Array(MAX_LAG + 2);
  for (let tau = MIN_LAG - 1; tau <= MAX_LAG + 1; tau++) {
    let acf = 0;
    for (let i = 0; i < len - tau; i++) acf += buf[at + i] * buf[at + i + tau];
    const m = cum[len - tau] + (cum[len] - cum[tau]);
    nsdf[tau] = m > 1e-12 ? (2 * acf) / m : 0;
  }
  // максимумы внутри положительных участков
  const keys = [];
  let tau = MIN_LAG;
  while (tau <= MAX_LAG) {
    if (nsdf[tau] > 0 && nsdf[tau] >= nsdf[tau - 1]) {
      let best = tau;
      while (tau <= MAX_LAG && nsdf[tau] > 0) { if (nsdf[tau] > nsdf[best]) best = tau; tau++; }
      if (best > MIN_LAG && best < MAX_LAG && nsdf[best] >= nsdf[best - 1] && nsdf[best] >= nsdf[best + 1]) keys.push(best);
    } else tau++;
  }
  if (!keys.length) return { f0: 0, clarity: 0 };
  const top = Math.max(...keys.map((k) => nsdf[k]));
  const lag = keys.find((k) => nsdf[k] >= 0.9 * top);
  const d = nsdf[lag - 1] - 2 * nsdf[lag] + nsdf[lag + 1];
  const refined = lag + (d !== 0 ? (0.5 * (nsdf[lag - 1] - nsdf[lag + 1])) / d : 0);
  return { f0: SAMPLE_RATE / refined, clarity: top };
}

/** Levinson–Durbin: автокорреляция → коэффициенты предсказателя (A(z) = 1 − Σ a_k z^-k) порядка ORDER и запасного ALT_ORDER. */
function lpc(r) {
  const R = new Float64Array(ORDER + 1);
  for (let k = 0; k <= ORDER; k++) R[k] = r[k] * LAG_WINDOW[k];
  R[0] *= 1.0001;
  let a = new Float64Array(ORDER + 1);
  let alt = null;
  let err = R[0];
  for (let i = 1; i <= ORDER; i++) {
    let acc = R[i];
    for (let j = 1; j < i; j++) acc -= a[j] * R[i - j];
    const k = acc / err;
    if (!Number.isFinite(k) || Math.abs(k) >= 1) return null;
    const next = a.slice();
    next[i] = k;
    for (let j = 1; j < i; j++) next[j] = a[j] - k * a[i - j];
    a = next;
    err *= 1 - k * k;
    if (err <= 0) return null;
    if (i === ALT_ORDER) alt = a.slice();
  }
  return { a, alt };
}

/** Огибающая 1/|A| на сетке частот → первые два пика. */
function formants(a) {
  const env = new Float64Array(GRID.length);
  for (let n = 0; n < GRID.length; n++) {
    let re = 1, im = 0;
    for (let k = 1; k <= ORDER; k++) { re -= a[k] * COS[n][k]; im += a[k] * SIN[n][k]; }
    env[n] = -10 * Math.log10(re * re + im * im + 1e-12); // дБ
  }
  const peaks = [];
  for (let n = 1; n < GRID.length - 1; n++) {
    if (env[n] > env[n - 1] && env[n] >= env[n + 1]) {
      // параболическая интерполяция
      const d = env[n - 1] - 2 * env[n] + env[n + 1];
      const shift = d !== 0 ? (0.5 * (env[n - 1] - env[n + 1])) / d : 0;
      peaks.push({ f: GRID[n] + shift * F_STEP, db: env[n] });
    }
  }
  if (peaks.length < 2) return { f1: null, f2: null };
  const f1 = peaks[0];
  const f2 = peaks.find((p) => p.f > f1.f + 220);
  return f2 ? { f1: f1.f, f2: f2.f } : { f1: null, f2: null };
}

/** По кадрам F1/F2 — гласная с уверенностью; подстраивается под голос (выше/ниже), голосует по 5 кадрам. */
export class VowelTracker {
  constructor() { this.reset(); }

  reset() {
    this.recent = [];
    this.n = 0;
    this.lnF0 = Math.log(130); // скользящая высота тона голоса
  }

  push(frame) {
    let item = null;
    if (frame.voiced && frame.f1 && frame.f2) {
      // Подстройка под голос: чем короче голосовые складки (выше тон), тем выше форманты —
      // примерно как f0^¼ (мужской ~110 Гц → ×0,93, женский ~210 → ×1,13, детский ~300 → ×1,23).
      if (frame.f0) {
        this.n++;
        this.lnF0 += (Math.log(clamp(frame.f0, 70, 400)) - this.lnF0) * (this.n < 20 ? 0.15 : 0.02);
      }
      const shift = clamp(0.25 * (this.lnF0 - Math.log(130)), -0.12, 0.3);
      item = classify(Math.log(frame.f1) - shift, Math.log(frame.f2) - shift);
    }
    this.recent.push(item);
    if (this.recent.length > 5) this.recent.shift();
  }

  /** Гласная по последним кадрам: {vowel, conf} или null, если звонких кадров мало. */
  current() {
    const score = {};
    let used = 0;
    for (const it of this.recent) {
      if (!it) continue;
      used++;
      score[it.vowel] = (score[it.vowel] || 0) + it.conf;
    }
    if (used < 2) return null;
    let best = null, total = 0;
    for (const [v, s] of Object.entries(score)) { total += s; if (!best || s > best.s) best = { v, s }; }
    return { vowel: best.v, conf: total ? best.s / total : 0 };
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** Ближайшая гласная в логарифмической плоскости F1/F2; conf — доля среди пяти. */
export function classify(l1, l2) {
  const w = {};
  let sum = 0;
  for (const [v, [r1, r2]] of Object.entries(VOWEL_REF)) {
    const d1 = (l1 - Math.log(r1)) / SIGMA[0], d2 = (l2 - Math.log(r2)) / SIGMA[1];
    w[v] = Math.exp(-0.5 * (d1 * d1 + d2 * d2));
    sum += w[v];
  }
  if (sum < 1e-6) return null; // далеко от всех пяти — не гласная
  let best = null;
  for (const [v, x] of Object.entries(w)) if (!best || x > best.x) best = { v, x };
  return { vowel: best.v, conf: best.x / sum };
}
