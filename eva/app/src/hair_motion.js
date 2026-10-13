/** Deterministic pre-baked mascot hair motion; no spring integration, randomness, or wall clock. */
export const HAIR_DEFAULTS = Object.freeze({
  enabled: true, periodMs: 7600, idleAmp: 0.35,
  clickHz: 1.1, clickTauMs: 650, clickGain: 1.2,
  kickRadiusPx: 260, maxAmpMul: 1.6, minClickGapMs: 120,
  clickLifeMs: 3500, sleepWindMul: 0.4, sleepRampMs: 800,
});
const OWN_K = [2, 3, 2, 1], OWN_PHI = [0.9, 2.3, 3.7, 5.1];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class HairMotion {
  constructor(framesManifest, settings = {}) {
    if (!framesManifest?.strands?.length) throw new TypeError('hair_frames.json manifest required');
    this.strands = framesManifest.strands.map((s, i) => ({...s, i,
      cx: (s.bbox[0] + s.bbox[2]) / 2, cy: (s.root_y + s.tip_y) / 2}));
    this.settings = {...HAIR_DEFAULTS, ...settings};
    this.reset();
  }
  setSettings(s) { this.settings = {...this.settings, ...s}; }
  reset() {
    this.t = 0;
    this.clicks = [];
    this.lastClickAt = -Infinity;
    this.reducedMotion = false;
    this.asleep = false;
    this.gainAtTransition = 1;
    this.gainTarget = 1;
    this.transitionT = 0;
  }
  _gain(t) {
    const u = clamp((t - this.transitionT) / Math.max(1, this.settings.sleepRampMs), 0, 1);
    return this.gainAtTransition + (this.gainTarget - this.gainAtTransition) * u;
  }
  update(dtMs, {reducedMotion = false, asleep = false} = {}) {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('dtMs must be finite and >= 0');
    this.t += dtMs;
    if (asleep !== this.asleep) {
      this.gainAtTransition = this._gain(this.t);
      this.gainTarget = asleep ? this.settings.sleepWindMul : 1;
      this.transitionT = this.t;
      this.asleep = asleep;
    }
    if (reducedMotion && !this.reducedMotion) this.clicks = [];
    this.reducedMotion = reducedMotion;
    this.clicks = this.clicks.filter(c => this.t - c.tc <= this.settings.clickLifeMs);
  }
  /** Call ONLY from the genuine pointer click handler, not from drag/ripple. */
  click(point, strength = 0.85) {
    if (!this.settings.enabled || this.reducedMotion || !point ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isFinite(strength)) return false;
    if (this.t - this.lastClickAt < this.settings.minClickGapMs) return false;
    this.lastClickAt = this.t;
    this.clicks.push({tc: this.t, x: point.x, y: point.y, s: strength});
    return true;
  }
  offsets() {
    const out = {};
    const h = this.settings;
    if (!h.enabled || this.reducedMotion) {
      for (const s of this.strands) out[s.name] = 0;
      return out;
    }
    const w = 2 * Math.PI / Math.max(1, h.periodMs);
    const t = ((this.t % h.periodMs) + h.periodMs) % h.periodMs;
    const gain = this._gain(this.t);
    for (const s of this.strands) {
      const lag = (s.cx - 512) / 1024 * 0.9;
      const shared = 0.75 * Math.sin(w*t - lag) + 0.25 * Math.sin(2*w*t + 1.1 - lag);
      const own = Math.sin(OWN_K[s.i % 4]*w*t + OWN_PHI[s.i % 4]);
      let d = s.amp_px * h.idleAmp * gain * (0.8*shared + 0.2*own);
      for (const c of this.clicks) {
        const tau = this.t - c.tc;
        if (tau < 0 || tau > h.clickLifeMs) continue;
        const dist = Math.hypot(s.cx - c.x, s.cy - c.y);
        const f = Math.exp(-dist / h.kickRadiusPx) * c.s;
        const sign = s.cx >= c.x ? 1 : -1;
        const A = sign * f * s.amp_px * h.clickGain;
        d += A * Math.exp(-tau / h.clickTauMs) * Math.sin(2 * Math.PI * h.clickHz * tau / 1000);
      }
      out[s.name] = clamp(d, -s.amp_px*h.maxAmpMul, s.amp_px*h.maxAmpMul);
    }
    return out;
  }
  frames() {
    const offs = this.offsets(), result = {};
    for (const s of this.strands) {
      // Since N is odd, half-displacement maps exactly to the zero/rest frame.
      result[s.name] = clamp(Math.floor((offs[s.name]+s.dmax)/s.step + 0.5), 0, s.N-1);
    }
    return result;
  }
}
