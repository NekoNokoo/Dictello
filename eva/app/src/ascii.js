// ascii.js — decorative ASCII overlay drawn only inside the mascot's hair.
//
// Self-contained ES module (no deps). Works in browsers (Canvas 2D) and is
// importable in node for logic tests: no DOM access at module top level, the
// offscreen canvas is created lazily inside draw(), and `maskAlpha` can be
// injected so tests never need a canvas.
//
// Two separate processes:
//   update(dtMs) — LOGICAL step: decides which (few) cells change their glyph.
//                  Frame-rate independent via a fractional change budget.
//   draw(ctx, …) — VISUAL step: per-cell alpha modulation (pulse, flow band,
//                  wave, stall jitter) from timeMs; never changes glyphs.

export const ASCII_MODES = ['idle', 'listening', 'processing', 'sleep'];

export const ASCII_CHARSET = ['.', ':', '+', '*', '#', '@', '%', '/', '\\', '|', '0', '1'];

export const ASCII_DEFAULTS = {
  enabled: true,
  opacity: 0.55,              // overall layer opacity (applied when compositing)
  idleChangeRate: 0.026,      // fraction of cells changing glyph per second (+30% к ориентиру ТЗ 2%)
  listeningChangeRate: 0.026,
  processingChangeRate: 0.104, // +30% к ориентиру ТЗ 8%
  sleepChangeRate: 0.0052,
  reducedMotionChangeRate: 0.005, // cap when reducedMotion is on
  listeningPulseMs: 2000,
  waveMs: 800,
  stallMs: 250,
  errorCalmMs: 2500,          // sparse calm pattern after a stall, then eases back
  modeFadeMs: 400,            // behaviour cross-fade between modes
  sleepIntensity: 0.35,
  baseCellPx: 24,             // cell size (portrait px) at portraitCssSize >= refCssSize
  minCellPx: 24,
  maxCellPx: 48,
  refCssSize: 320,
  cellBucketPx: 2,            // cell size is quantised to this step -> grid rebuilds only on bucket change
  alphaThreshold: 128,        // a cell exists only if mask alpha at its centre > this
  fontScale: 1.2,             // glyph font size relative to cell size (glyphs a bit larger than the cell pitch)
  flowSpeedPx: 150,           // processing band speed along strands (portrait px / s)
  flowWavelengthPx: 300,
  flowBoost: 0.55,
  waveBoost: 0.6,
  waveWidth: 0.12,            // wave band half-width in normalised strand phase
  waveChangeProb: 0.3,        // chance a cell swaps glyph when the wave front passes it
  maxOffscreenPx: 1024,
  // matrix rain: glyphs slowly slide down their column, new ones enter at the top
  rainSpeedPx: 20,            // portrait px / s in idle
  rainProcessingMul: 1.8,
  rainSleepMul: 0.3,
  // error alert: glyphs turn red, stay red until the error is resolved (or alertHoldMs), then fade back to blue
  alertRiseMs: 300,
  alertHoldMs: 10000,
  alertFadeMs: 2500,
  alertBoost: 0.35,           // extra glyph intensity while red
  // click ripple: a ring travelling outward from the click point through the hair
  rippleMs: 1100,
  rippleSpeedPx: 620,         // ring radius growth, portrait px / s
  rippleWidthPx: 46,          // ring half-width
  rippleBoost: 1.6,           // extra alpha on the ring
  rippleReveal: 0.8,          // ring also reveals glyphs hidden by the density mask
  rippleDisplacePx: 10,       // glyphs pushed outward by the ring (portrait px)
  rippleChangeProb: 0.35,     // chance a glyph swaps once when the ring passes it
  maxRipples: 3,              // newest replaces oldest; no queue
  // irritation shiver: short jitter of all glyphs, decaying
  shiverMs: 480,
  shiverAmpPx: 6,             // max jitter at strength 1 (portrait px)
  shiverChangeFrac: 0.12,     // fraction of glyphs swapped once at the start (strength 1)
  reducedMotion: false,       // force reduced motion (draw() option also enables it)
};

// Strand directions: cubic Béziers in portrait (1024) coordinates, top -> down.
// Designed against assets/mascot/base.png: bangs fanning from the crown over the
// forehead, face-framing locks, side hair falling down and outward, and the back
// hair visible below the ears.
export const STRAND_CURVES = [
  { name: 'bangC',  p: [[512, 80], [508, 230], [500, 380], [505, 500]] },
  { name: 'bangL',  p: [[490, 85], [450, 220], [425, 360], [440, 490]] },
  { name: 'bangLL', p: [[470, 90], [400, 210], [360, 330], [370, 450]] },
  { name: 'bangR',  p: [[535, 85], [575, 220], [600, 360], [590, 500]] },
  { name: 'bangRR', p: [[560, 90], [640, 210], [690, 340], [700, 480]] },
  { name: 'lockL',  p: [[440, 95], [330, 220], [280, 450], [350, 830]] },
  { name: 'sideL',  p: [[420, 85], [280, 180], [200, 420], [215, 790]] },
  { name: 'outerL', p: [[400, 70], [230, 140], [140, 380], [120, 740]] },
  { name: 'lockR',  p: [[590, 95], [700, 230], [750, 450], [680, 825]] },
  { name: 'sideR',  p: [[610, 85], [750, 180], [830, 420], [805, 790]] },
  { name: 'outerR', p: [[630, 70], [800, 140], [890, 380], [910, 720]] },
  { name: 'backL',  p: [[330, 620], [350, 680], [380, 730], [420, 780]] },
  { name: 'backR',  p: [[700, 620], [680, 680], [650, 730], [600, 780]] },
];

const PALETTE = ['#2f5fd0', '#3c78e6', '#1f3f9a', '#6f9cf0'];
// Error alert: the same four tones in red; colours are blended per frame by the alert tint.
const ALERT_PALETTE = ['#c8141b', '#e0262b', '#8c0a10', '#e8403f'];
const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const PALETTE_RGB = PALETTE.map(hexRgb);
const ALERT_RGB = ALERT_PALETTE.map(hexRgb);
const PALETTE_WEIGHTS = [0.34, 0.3, 0.2, 0.16];
const FONT_STACK = 'Menlo, Monaco, Consolas, monospace';

// Glyph indices into ASCII_CHARSET.
const G_SLASH = 7, G_BACKSLASH = 8, G_PIPE = 9;
// "Ink" compensation: heavy glyphs get lower alpha so nothing pops.
const GLYPH_INK = new Float32Array([1.0, 1.0, 0.9, 0.85, 0.62, 0.58, 0.66, 0.9, 0.9, 0.92, 0.8, 0.92]);
// Idle/general weights: light glyphs dominate, heavy ones are rare.
const W_GENERAL = [6, 5, 3, 2, 0.8, 0.4, 0.6, 1, 1, 1.5, 2, 2.5];
// Sleep: almost only dots and colons.
const W_SLEEP = [9, 6, 1.2, 0.4, 0, 0, 0, 0.3, 0.3, 0.6, 0.6, 0.8];

function cumulative(w) {
  const out = new Float32Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i] / s; out[i] = acc; }
  out[w.length - 1] = 1;
  return out;
}
const CUM_GENERAL = cumulative(W_GENERAL);
const CUM_SLEEP = cumulative(W_SLEEP);
const CUM_PALETTE = cumulative(PALETTE_WEIGHTS);

function sampleCum(cum, r) {
  for (let i = 0; i < cum.length; i++) if (r < cum[i]) return i;
  return cum.length - 1;
}

// mulberry32 PRNG — deterministic, tiny, fast.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ ((b | 0) * 0x27d4eb2f), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Cheap stateless hash -> [0,1) for per-frame jitter (no PRNG state consumed).
function hash01(i, k) {
  let h = Math.imul(i ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(k + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

// Pre-sample the strand curves into polylines with arc length + tangents.
const CURVE_SAMPLES = 48;
function sampleCurves(curves) {
  const out = [];
  for (const c of curves) {
    const p = c.p;
    const n = CURVE_SAMPLES;
    const xs = new Float32Array(n + 1), ys = new Float32Array(n + 1);
    const ss = new Float32Array(n + 1), tx = new Float32Array(n + 1), ty = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      xs[k] = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
      ys[k] = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
      // derivative
      const dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
      const dy = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
      const l = Math.hypot(dx, dy) || 1;
      tx[k] = dx / l; ty[k] = dy / l;
    }
    // arc length offset by start y so phases of different strands line up
    // roughly as "distance travelled downward from the crown".
    ss[0] = p[0][1];
    for (let k = 1; k <= n; k++) ss[k] = ss[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
    out.push({ xs, ys, ss, tx, ty, n });
  }
  return out;
}
const SAMPLED_CURVES = sampleCurves(STRAND_CURVES);

const MODE_INDEX = { idle: 0, listening: 1, processing: 2, sleep: 3 };

export class AsciiHair {
  constructor({ mask = null, maskAlpha = null, seed = 1, settings = {} } = {}) {
    this.mask = mask;
    this._maskAlpha = maskAlpha || null;
    this._maskSide = maskAlpha ? Math.round(Math.sqrt(maskAlpha.length)) : 1024;
    this.settings = { ...ASCII_DEFAULTS, ...settings };
    this.seed = seed >>> 0;

    this._cssSize = this.settings.refCssSize;
    this._cellPx = 0;          // current effective cell size (0 = not built)
    this._count = 0;
    this._built = false;

    // offscreen render target (created lazily in draw)
    this._off = null;
    this._offCtx = null;
    this._offSide = 0;
    this._fontKey = '';
    this._reducedMotionSeen = false;

    // change-rate telemetry: 10 buckets x 100 ms
    this._buckets = new Uint32Array(10);
    this._bucketIdx = 0;
    this._bucketT = 0;
    this._totalChanges = 0;

    this._modeW = new Float32Array(4);
    this._resetState();
    this._rebuild();
  }

  // ---------------------------------------------------------------- public API

  setSettings(partial = {}) {
    const prevCell = this._cellPx;
    const prevThreshold = this.settings.alphaThreshold;
    Object.assign(this.settings, partial);
    const next = this._cellSizeFor(this._cssSize);
    if (next !== prevCell || this.settings.alphaThreshold !== prevThreshold || !this._built) this._rebuild();
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    this._rng = makeRng(hashSeed(this.seed, 0x51ed));
    this._rebuild();
  }

  setMode(mode) {
    // Convenience aliases for spec states that are one-shot events.
    if (mode === 'done') { this.triggerWave(); return; }
    if (mode === 'error') { this.triggerStall(); this.setAlert(true); return; }
    if (!(mode in MODE_INDEX)) return;
    if (mode === this.mode) return;
    this.mode = mode;
    // A new working/listening state ends the sparse post-error calm.
    if (mode !== 'idle' && mode !== 'sleep') this._calmT = -1;
  }

  triggerWave() {
    // Restart, never stack/queue.
    this._waveT = 0;
    this._wavePtr = 0;
    this._stallT = -1;
    this.mode = 'idle';
  }

  triggerStall() {
    this._stallT = 0;
    this._waveT = -1;
    this._calmT = -1;
    this.mode = 'idle';
    this._budget = 0;
  }

  /** Ring from a click point (portrait coords). strength 0..1. Never queued: at most maxRipples alive. */
  triggerRipple(x, y, strength = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.settings.reducedMotion || this._reducedMotionSeen) return; // reduced motion: nothing travels
    const r = { x, y, t: 0, prevR: -1, strength: clamp01(strength) };
    this._ripples.push(r);
    while (this._ripples.length > Math.min(8, Math.max(1, this.settings.maxRipples))) this._ripples.shift();
  }

  /** Error alert on/off. On: glyphs turn red and stay red up to alertHoldMs. Off: fade back to blue. */
  setAlert(on) {
    if (on) { this._alertOn = true; this._alertT = 0; }
    else this._alertOn = false;
  }

  /** Short decaying jitter of all glyphs (irritation). Restarts, never stacks. */
  triggerShiver(strength = 1) {
    if (this.settings.reducedMotion || this._reducedMotionSeen) return;
    this._shiverT = 0;
    this._shiverS = clamp01(strength);
    const n = this._count;
    let k = Math.round(n * this.settings.shiverChangeFrac * this._shiverS);
    while (k-- > 0 && n > 0) this._changeCell(Math.floor(this._rng() * n), false);
  }

  reset() {
    this._resetState();
    this._rebuild();
  }

  /** Switch the fixed clip mask when choosing the original or regenerated art. */
  /** Покадровая обрезка слоя (маска текущей позы) без пересборки набора ячеек: null — обрезать по маске набора. */
  setClip(clip) { this._clip = clip || null; }

  setMask(mask, maskAlpha = null) {
    if (this.mask === mask && this._maskAlpha === maskAlpha) return;
    this.mask = mask;
    this._maskAlpha = maskAlpha;
    this._maskSide = maskAlpha ? Math.round(Math.sqrt(maskAlpha.length)) : 1024;
    this._maskAlphaFailed = false;
    this._rebuild();
  }

  /** Optional: tell the layer the portrait CSS size outside of draw() (draw also does it). */
  setPortraitCssSize(px) {
    if (!(px > 0)) return;
    this._cssSize = px;
    const c = this._cellSizeFor(px);
    if (c !== this._cellPx) this._rebuild();
  }

  /** Effective cell size (portrait px) for a given portrait CSS size. */
  cellSizeFor(cssSize) { return this._cellSizeFor(cssSize); }

  update(dtMs) {
    if (!(dtMs > 0)) return;
    if (dtMs > 100) dtMs = 100;
    const s = this.settings;
    this._clock += dtMs;
    this._advanceTelemetry(dtMs);
    if (!this._built) this._tryLazyBuild();

    // --- error alert tint (colour only, so it also runs in reduced motion)
    if (this._alertOn) {
      this._alertT += dtMs;
      if (this._alertT >= s.alertHoldMs) this._alertOn = false;
    }
    if (this._alertOn) this._alert = Math.min(1, this._alert + dtMs / Math.max(1, s.alertRiseMs));
    else if (this._alert > 0) this._alert = Math.max(0, this._alert - dtMs / Math.max(1, s.alertFadeMs));

    // --- ripples / shiver timers; ring front swaps glyphs it crosses (once per ripple)
    if (this._shiverT >= 0) { this._shiverT += dtMs; if (this._shiverT >= s.shiverMs) this._shiverT = -1; }
    if (this._ripples.length) {
      const cxs = this._cx, cys = this._cy, n0 = this._count;
      for (const r of this._ripples) {
        r.t += dtMs;
        const R = (s.rippleSpeedPx * r.t) / 1000;
        const p = s.rippleChangeProb * r.strength;
        if (p > 0) {
          for (let i = 0; i < n0; i++) {
            const d = Math.hypot(cxs[i] - r.x, cys[i] - r.y);
            if (d > r.prevR && d <= R && this._rng() < p) this._changeCell(i, true);
          }
        }
        r.prevR = R;
      }
      this._ripples = this._ripples.filter((r) => r.t < s.rippleMs);
    }

    // --- mode cross-fade (behaviour weights)
    const step = dtMs / Math.max(1, s.modeFadeMs);
    const target = MODE_INDEX[this.mode];
    let sum = 0;
    for (let m = 0; m < 4; m++) {
      let w = this._modeW[m];
      w = m === target ? Math.min(1, w + step) : Math.max(0, w - step);
      this._modeW[m] = w;
      sum += w;
    }
    if (sum > 0) for (let m = 0; m < 4; m++) this._modeW[m] /= sum;

    // --- timers
    let stalled = false;
    if (this._stallT >= 0) {
      this._stallT += dtMs;
      if (this._stallT >= s.stallMs) { this._stallT = -1; this._calmT = 0; }
      else stalled = true;
    } else if (this._calmT >= 0) {
      this._calmT += dtMs;
      if (this._calmT >= s.errorCalmMs) this._calmT = -1;
    }

    const reduced = s.reducedMotion || this._reducedMotionSeen;
    const n = this._count;
    if (n === 0) {
      if (this._waveT >= 0) { this._waveT += dtMs; if (this._waveT >= s.waveMs) this._waveT = -1; }
      return;
    }

    // --- wave: cells crossed by the travelling front may swap glyph once
    if (this._waveT >= 0) {
      this._waveT += dtMs;
      const prog = Math.min(1, this._waveT / s.waveMs);
      if (!reduced) {
        const front = this._waveFront(prog);
        const order = this._phaseOrder, ph = this._phaseN;
        while (this._wavePtr < n && ph[order[this._wavePtr]] <= front) {
          const i = order[this._wavePtr++];
          if (this._rng() < s.waveChangeProb) this._changeCell(i, true);
        }
      }
      if (this._waveT >= s.waveMs) this._waveT = -1;
    }

    // --- matrix rain (stops during the error stall; none in reduced motion)
    if (!stalled && !reduced && s.rainSpeedPx > 0) {
      const mul = this._modeW[0] + this._modeW[1] + this._modeW[2] * s.rainProcessingMul + this._modeW[3] * s.rainSleepMul;
      this._rainY += (s.rainSpeedPx * mul * dtMs) / 1000;
      const cellPx = this._cellPx || 1;
      while (this._rainY >= cellPx) { this._rainY -= cellPx; this._rainShift(); }
    }

    // --- regular, frame-rate independent glyph changes
    if (stalled) { this._budget = 0; return; }
    const w = this._modeW;
    let rate = w[0] * s.idleChangeRate + w[1] * s.listeningChangeRate +
               w[2] * s.processingChangeRate + w[3] * s.sleepChangeRate;
    if (this._calmT >= 0) rate = Math.min(rate, s.idleChangeRate);
    if (reduced) rate = Math.min(rate, s.reducedMotionChangeRate);
    this._budget += rate * n * dtMs / 1000;
    let k = Math.floor(this._budget);
    this._budget -= k;
    while (k-- > 0) {
      const i = Math.floor(this._rng() * n);
      this._changeCell(i, false);
    }
  }

  draw(ctx, { portraitCssSize = 320, dpr = 1, reducedMotion = false, timeMs } = {}) {
    const s = this.settings;
    if (!s.enabled || !(s.opacity > 0) || !ctx) return;
    this._reducedMotionSeen = !!reducedMotion;
    if (portraitCssSize > 0 && portraitCssSize !== this._cssSize) this.setPortraitCssSize(portraitCssSize);
    if (!this._built) this._tryLazyBuild();
    const n = this._count;
    if (n === 0) return;
    if (!this._ensureOffscreen(portraitCssSize, dpr)) return;

    const reduced = s.reducedMotion || !!reducedMotion;
    const t = typeof timeMs === 'number' ? timeMs : this._clock;
    const off = this._off, octx = this._offCtx;
    const k = this._offSide / 1024;

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.globalAlpha = 1;
    octx.clearRect(0, 0, this._offSide, this._offSide);
    octx.setTransform(k, 0, 0, k, 0, 0);
    if (this._fontKey !== this._wantFont) { octx.font = this._wantFont; this._fontKey = this._wantFont; }
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';

    // ---- per-frame scalars (no allocations)
    const w = this._modeW;
    const wIdle = w[0], wListen = w[1], wProc = w[2], wSleep = w[3];
    let pulse = 0.6;
    if (!reduced) pulse = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(200, s.listeningPulseMs));
    // intensity per mode (state is readable even when static)
    const iIdle = 0.8;
    const iListen = reduced ? 0.9 : 0.72 + 0.3 * pulse;
    const iProc = 0.9;
    const iSleep = s.sleepIntensity;
    let intensity = wIdle * iIdle + wListen * iListen + wProc * iProc + wSleep * iSleep;
    // density: fraction of cells visible
    const dListen = reduced ? 0.85 : 0.68 + 0.27 * pulse;
    let density = wIdle * 0.86 + wListen * dListen + wProc * 0.95 + wSleep * 0.62;

    // post-error calm sparse pattern (eases back over the last 40%)
    if (this._calmT >= 0) {
      const p = this._calmT / s.errorCalmMs;
      const back = smooth01((p - 0.6) / 0.4);
      density *= 0.55 + 0.45 * back;
      intensity *= 0.85 + 0.15 * back;
    }
    // error alert: red glyphs a little denser and stronger so the state reads at a glance
    if (this._alert > 0) { const k = smooth01(this._alert); intensity *= 1 + s.alertBoost * k; density += 0.12 * k; }
    // stall: slight dim + jitter
    const stalled = this._stallT >= 0;
    let jitterAmp = 0, jitterFrame = 0;
    if (stalled) {
      intensity *= 0.85;
      if (!reduced) { jitterAmp = this._cellPx * 0.16; jitterFrame = Math.floor(t / 45); }
    }
    // processing flow band along strands
    const flowAmp = reduced ? 0 : wProc * s.flowBoost;
    const flowShift = (s.flowSpeedPx * t) / 1000;
    const flowK = (2 * Math.PI) / Math.max(40, s.flowWavelengthPx);
    // wave
    let waveAmp = 0, waveFront = 0, waveUniform = 0;
    const invWaveW = 1 / Math.max(0.02, s.waveWidth);
    if (this._waveT >= 0) {
      const prog = Math.min(1, this._waveT / s.waveMs);
      const env = smooth01(prog / 0.15) * smooth01((1 - prog) / 0.2);
      if (reduced) waveUniform = 0.15 * env; // static acknowledgement, nothing travels
      else { waveAmp = s.waveBoost * env; waveFront = this._waveFront(prog); }
    }
    // click ripples: ring radius + fading envelope per ripple (reduced motion: none are created)
    const rips = this._ripples;
    const nR = rips.length;
    for (let q = 0; q < nR; q++) {
      const r = rips[q];
      const prog = Math.min(1, r.t / s.rippleMs);
      this._ripR[q] = (s.rippleSpeedPx * r.t) / 1000;
      this._ripE[q] = r.strength * smooth01(prog / 0.08) * (1 - smooth01((prog - 0.35) / 0.65));
    }
    const invRipW = 1 / Math.max(4, s.rippleWidthPx);
    // matrix rain sub-cell offset
    const rainOff = reduced ? 0 : this._rainY;
    const rainFrac = this._cellPx > 0 ? rainOff / this._cellPx : 0;
    // irritation shiver
    let shiverAmp = 0, shiverFrame = 0;
    if (this._shiverT >= 0 && !reduced) {
      const p = this._shiverT / s.shiverMs;
      shiverAmp = s.shiverAmpPx * this._shiverS * (1 - p) * (1 - p);
      shiverFrame = Math.floor(t / 35);
    }
    // listening: soft phase offset along strands so the pulse "breathes" from the crown
    const listenSpatial = reduced ? 0 : wListen * 0.12;

    const cx = this._cx, cy = this._cy, glyph = this._glyph, baseA = this._baseA;
    const rank = this._rank, phase = this._phase, phaseN = this._phaseN;
    const order = this._toneOrder, toneStart = this._toneStart;
    const chars = ASCII_CHARSET;

    for (let tone = 0; tone < 4; tone++) {
      const a0 = toneStart[tone], a1 = toneStart[tone + 1];
      if (a1 <= a0) continue;
      if (this._alert > 0) {
        const k = smooth01(this._alert), b = PALETTE_RGB[tone], r = ALERT_RGB[tone];
        octx.fillStyle = `rgb(${Math.round(b[0] + (r[0] - b[0]) * k)},${Math.round(b[1] + (r[1] - b[1]) * k)},${Math.round(b[2] + (r[2] - b[2]) * k)})`;
      } else octx.fillStyle = PALETTE[tone];
      for (let j = a0; j < a1; j++) {
        const i = order[j];
        // click ripples: ring brightens glyphs, reveals hidden ones and pushes them outward
        let x = cx[i], y = cy[i] + rainOff, ring = 0;
        for (let q = 0; q < nR; q++) {
          const e = this._ripE[q];
          if (e <= 0) continue;
          const rx = cx[i] - rips[q].x, ry = cy[i] - rips[q].y;
          const dist = Math.hypot(rx, ry) || 1;
          const u = (dist - this._ripR[q]) * invRipW;
          if (u <= -3 || u >= 3) continue;
          const g = e * Math.exp(-u * u);
          ring += g;
          const push = s.rippleDisplacePx * g;
          x += (rx / dist) * push; y += (ry / dist) * push;
        }
        // density mask with a soft edge (no popping)
        let dens = density + ring * s.rippleReveal;
        if (listenSpatial > 0) dens += listenSpatial * Math.cos(2 * Math.PI * (t / s.listeningPulseMs - phaseN[i] * 0.35));
        const vis = clamp01((dens - rank[i]) / 0.12 + 0.5);
        if (vis <= 0) continue;
        let boost = 1 + waveUniform + s.rippleBoost * ring;
        if (flowAmp > 0) {
          const c = 0.5 + 0.5 * Math.cos((phase[i] - flowShift) * flowK);
          boost += flowAmp * c * c * c;
        }
        if (waveAmp > 0) {
          const d = (phaseN[i] - waveFront) * invWaveW;
          if (d > -3 && d < 3) boost += waveAmp * Math.exp(-d * d);
        }
        let a = baseA[i] * GLYPH_INK[glyph[i]] * intensity * vis * boost;
        if (rainFrac > 0) {
          if (this._above[i] < 0) a *= Math.min(1, rainFrac * 1.6);      // проявляется сверху столбца
          if (this._below[i] < 0) a *= 1 - rainFrac;                     // уходит внизу столбца
        }
        if (a < 0.02) continue;
        if (a > 1) a = 1;
        octx.globalAlpha = a;
        if (shiverAmp > 0) {
          x += (hash01(i + 104729, shiverFrame) - 0.5) * 2 * shiverAmp;
          y += (hash01(i + 130363, shiverFrame) - 0.5) * 2 * shiverAmp;
        }
        if (jitterAmp > 0) {
          x += (hash01(i, jitterFrame) - 0.5) * 2 * jitterAmp;
          y += (hash01(i + 7919, jitterFrame) - 0.5) * 2 * jitterAmp;
        }
        octx.fillText(chars[glyph[i]], x, y);
      }
    }

    // clip to the hair mask
    const clipMask = this._clip || this.mask;
    if (clipMask) {
      octx.globalAlpha = 1;
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(clipMask, 0, 0, 1024, 1024);
      octx.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.globalAlpha = clamp01(s.opacity);
    ctx.drawImage(off, 0, 0, 1024, 1024);
    ctx.restore();
  }

  stats() {
    let changed = 0;
    for (let i = 0; i < 10; i++) changed += this._buckets[i];
    return {
      cells: this._count,
      changedLastSecond: changed,
      mode: this.mode,
      waveActive: this._waveT >= 0,
      stallActive: this._stallT >= 0,
      // extras (diagnostics)
      cellPx: this._cellPx,
      totalChanges: this._totalChanges,
      calmActive: this._calmT >= 0,
      ripples: this._ripples.length,
      shiverActive: this._shiverT >= 0,
      alert: +this._alert.toFixed(2),
    };
  }

  /** Read-only views for diagnostics/tests (do not mutate). */
  debugCells() {
    return {
      count: this._count, cellPx: this._cellPx,
      x: this._cx, y: this._cy, glyph: this._glyph,
      phase: this._phase, dirX: this._dirX, dirY: this._dirY,
    };
  }

  /** Current glyphs as a string (one char per cell) — handy for snapshots. */
  glyphString() {
    let out = '';
    for (let i = 0; i < this._count; i++) out += ASCII_CHARSET[this._glyph[i]];
    return out;
  }

  // ---------------------------------------------------------------- internals

  _resetState() {
    this.mode = 'idle';
    this._modeW.fill(0); this._modeW[0] = 1;
    this._waveT = -1; this._wavePtr = 0;
    this._stallT = -1;
    this._calmT = -1;
    this._ripples = [];
    this._ripR = new Float32Array(8);
    this._ripE = new Float32Array(8);
    this._shiverT = -1;
    this._shiverS = 0;
    this._alertOn = false;
    this._alertT = 0;
    this._alert = 0;
    this._budget = 0;
    this._clock = 0;
    this._rng = makeRng(hashSeed(this.seed, 0x51ed));
    this._buckets.fill(0); this._bucketIdx = 0; this._bucketT = 0;
    this._totalChanges = 0;
  }

  _waveFront(prog) {
    const ww = this.settings.waveWidth;
    return -ww * 1.5 + prog * (1 + ww * 3);
  }

  _cellSizeFor(cssSize) {
    const s = this.settings;
    const css = cssSize > 0 ? cssSize : s.refCssSize;
    let c = s.baseCellPx * (s.refCssSize / css);
    if (c < s.minCellPx) c = s.minCellPx;
    if (c > s.maxCellPx) c = s.maxCellPx;
    const b = Math.max(1, s.cellBucketPx);
    return Math.max(4, Math.round(c / b) * b);
  }

  _advanceTelemetry(dtMs) {
    this._bucketT += dtMs;
    while (this._bucketT >= 100) {
      this._bucketT -= 100;
      this._bucketIdx = (this._bucketIdx + 1) % 10;
      this._buckets[this._bucketIdx] = 0;
    }
  }

  _changeCell(i, fromWave) {
    const g0 = this._glyph[i];
    let g = this._pickGlyph(i, fromWave);
    if (g === g0) g = this._pickGlyph(i, false);
    if (g === g0) g = (g0 + 1 + Math.floor(this._rng() * (ASCII_CHARSET.length - 1))) % ASCII_CHARSET.length;
    this._glyph[i] = g;
    this._buckets[this._bucketIdx]++;
    this._totalChanges++;
  }

  _pickGlyph(i, preferDir) {
    const w = this._modeW;
    const pDir = preferDir ? 0.6 : w[2] * 0.55 + w[0] * 0.06 + w[1] * 0.06;
    const r = this._rng();
    if (r < pDir) return this._dirGlyph[i];
    if (this._rng() < w[3]) return sampleCum(CUM_SLEEP, this._rng());
    return sampleCum(CUM_GENERAL, this._rng());
  }

  _tryLazyBuild() {
    if (this._maskAlpha || this._maskAlphaFailed) return;
    const a = this._computeMaskAlpha();
    if (a) { this._maskAlpha = a; this._maskSide = Math.round(Math.sqrt(a.length)); this._rebuild(); }
  }

  _computeMaskAlpha() {
    const m = this.mask;
    if (!m) return null;
    if (typeof m.complete === 'boolean' && (!m.complete || !m.naturalWidth)) return null;
    const side = 1024;
    let c = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(side, side);
      else if (typeof document !== 'undefined') { c = document.createElement('canvas'); c.width = side; c.height = side; }
      if (!c) return null;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.clearRect(0, 0, side, side);
      x.drawImage(m, 0, 0, side, side);
      const data = x.getImageData(0, 0, side, side).data;
      const out = new Uint8Array(side * side);
      for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = data[j];
      return out;
    } catch (e) {
      this._maskAlphaFailed = true; // e.g. tainted canvas: stop retrying every frame
      return null;
    }
  }

  _rebuild() {
    const s = this.settings;
    const cell = this._cellSizeFor(this._cssSize);
    this._cellPx = cell;
    this._wantFont = `${Math.max(4, Math.round(cell * s.fontScale))}px ${FONT_STACK}`;
    const alpha = this._maskAlpha;
    if (!alpha) {
      this._allocate(0);
      this._built = false;
      return;
    }
    const side = this._maskSide;
    const scale = side / 1024;
    const thr = s.alphaThreshold;

    // collect cell centres inside the mask
    const cols = Math.floor(1024 / cell), rows = Math.floor(1024 / cell);
    const ox = (1024 - cols * cell) / 2 + cell / 2, oy = (1024 - rows * cell) / 2 + cell / 2;
    const tmpX = [], tmpY = [];
    const gridIdx = new Int32Array(rows * cols).fill(-1);
    const tmpRC = [];
    for (let r = 0; r < rows; r++) {
      const y = oy + r * cell;
      const py = Math.min(side - 1, Math.floor(y * scale));
      for (let c = 0; c < cols; c++) {
        const x = ox + c * cell;
        const px = Math.min(side - 1, Math.floor(x * scale));
        if (alpha[py * side + px] > thr) { gridIdx[r * cols + c] = tmpX.length; tmpX.push(x); tmpY.push(y); tmpRC.push(r * cols + c); }
      }
    }
    const n = tmpX.length;
    this._allocate(n);
    // matrix rain: neighbour above / below in the same column (-1 = column segment edge)
    for (let i = 0; i < n; i++) {
      const rc = tmpRC[i];
      this._above[i] = rc >= cols ? gridIdx[rc - cols] : -1;
      this._below[i] = rc + cols < rows * cols ? gridIdx[rc + cols] : -1;
    }
    this._rainY = 0;
    const rng = makeRng(hashSeed(this.seed, cell * 131 + 7));
    let minS = Infinity, maxS = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = tmpX[i], y = tmpY[i];
      this._cx[i] = x; this._cy[i] = y;
      this._strandField(i, x, y);
      const ph = this._phase[i];
      if (ph < minS) minS = ph;
      if (ph > maxS) maxS = ph;
      this._glyph[i] = sampleCum(CUM_GENERAL, rng());
      this._baseA[i] = 0.38 + 0.62 * rng();
      this._tone[i] = sampleCum(CUM_PALETTE, rng());
      this._rank[i] = rng();
    }
    const span = maxS - minS || 1;
    for (let i = 0; i < n; i++) this._phaseN[i] = (this._phase[i] - minS) / span;

    // order by tone (constant per cell -> one fillStyle per tone per frame)
    const counts = new Uint32Array(5);
    for (let i = 0; i < n; i++) counts[this._tone[i] + 1]++;
    for (let t = 1; t < 5; t++) counts[t] += counts[t - 1];
    this._toneStart = Uint32Array.from(counts);
    const fill = Uint32Array.from(counts);
    for (let i = 0; i < n; i++) this._toneOrder[fill[this._tone[i]]++] = i;

    // order by normalised phase (for the wave front sweep)
    const idx = Array.from({ length: n }, (_, i) => i);
    const phN = this._phaseN;
    idx.sort((a, b) => phN[a] - phN[b]);
    for (let i = 0; i < n; i++) this._phaseOrder[i] = idx[i];

    this._initialGlyph = Uint8Array.from(this._glyph);
    this._wavePtr = 0;
    this._built = true;
  }

  _allocate(n) {
    this._count = n;
    this._cx = new Float32Array(n);
    this._cy = new Float32Array(n);
    this._glyph = new Uint8Array(n);
    this._dirGlyph = new Uint8Array(n);
    this._baseA = new Float32Array(n);
    this._tone = new Uint8Array(n);
    this._rank = new Float32Array(n);
    this._phase = new Float32Array(n);
    this._phaseN = new Float32Array(n);
    this._dirX = new Float32Array(n);
    this._dirY = new Float32Array(n);
    this._toneOrder = new Uint32Array(n);
    this._toneStart = new Uint32Array(5);
    this._phaseOrder = new Uint32Array(n);
    this._above = new Int32Array(n);
    this._below = new Int32Array(n);
  }

  /** Matrix rain step: every glyph (with its alpha/visibility) moves one cell down its column. */
  _rainShift() {
    const n = this._count, up = this._above;
    const g = this._glyph, a = this._baseA, rk = this._rank;
    // cells are stored top-to-bottom, so walking backwards reads each source before it is overwritten
    for (let i = n - 1; i >= 0; i--) {
      const j = up[i];
      if (j >= 0) { g[i] = g[j]; a[i] = a[j]; rk[i] = rk[j]; }
      else { g[i] = this._pickGlyph(i, false); a[i] = 0.38 + 0.62 * this._rng(); rk[i] = this._rng(); }
    }
  }

  // Blend the two nearest strands (inverse-square distance) for a smooth field.
  _strandField(i, x, y) {
    let d1 = Infinity, d2 = Infinity;
    let s1 = y, s2 = y, ax1 = 0, ay1 = 1, ax2 = 0, ay2 = 1;
    for (let c = 0; c < SAMPLED_CURVES.length; c++) {
      const cv = SAMPLED_CURVES[c];
      let best = Infinity, bk = 0;
      for (let k = 0; k <= cv.n; k++) {
        const dx = cv.xs[k] - x, dy = cv.ys[k] - y;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bk = k; }
      }
      // extend strand beyond its tip/root along the tangent so phase keeps growing
      let sv = cv.ss[bk];
      if (bk === cv.n || bk === 0) sv += (x - cv.xs[bk]) * cv.tx[bk] + (y - cv.ys[bk]) * cv.ty[bk];
      if (best < d1) {
        d2 = d1; s2 = s1; ax2 = ax1; ay2 = ay1;
        d1 = best; s1 = sv; ax1 = cv.tx[bk]; ay1 = cv.ty[bk];
      } else if (best < d2) {
        d2 = best; s2 = sv; ax2 = cv.tx[bk]; ay2 = cv.ty[bk];
      }
    }
    const w1 = 1 / (d1 + 64), w2 = 1 / (d2 + 64);
    // far from all strands -> fall back to straight down
    const far = smooth01((Math.sqrt(d1) - 90) / 120);
    const wf = far * (w1 + w2);
    const sum = w1 + w2 + wf;
    const sv = (s1 * w1 + s2 * w2 + y * wf) / sum;
    let tx = (ax1 * w1 + ax2 * w2) / sum;
    let ty = (ay1 * w1 + ay2 * w2 + wf) / sum;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    this._phase[i] = sv;
    this._dirX[i] = tx; this._dirY[i] = ty;
    // screen coords: moving down-right reads as '\', down-left as '/'
    this._dirGlyph[i] = Math.abs(tx) < 0.28 * Math.abs(ty) ? G_PIPE : (tx * ty > 0 ? G_BACKSLASH : G_SLASH);
  }

  _ensureOffscreen(cssSize, dpr) {
    const want = Math.max(64, Math.min(this.settings.maxOffscreenPx, Math.round((cssSize || 320) * (dpr || 1))));
    if (this._off && this._offSide === want) return true;
    try {
      if (!this._off) {
        if (typeof OffscreenCanvas !== 'undefined') this._off = new OffscreenCanvas(want, want);
        else if (typeof document !== 'undefined') this._off = document.createElement('canvas');
        else return false;
        this._offCtx = this._off.getContext('2d');
      }
      this._off.width = want;
      this._off.height = want;
      this._offSide = want;
      this._fontKey = ''; // resizing resets context state
      return !!this._offCtx;
    } catch (e) {
      return false;
    }
  }
}
