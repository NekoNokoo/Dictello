// attention.js — куда смотрит персонаж. Несколько источников с приоритетами:
//   reaction > event > cursor > calm.
// Точки задаются в портретных координатах (0..1024). Выход — сглаженное
// смещение радужки в px портрета, ограниченное maxX / maxY.

import { EYE_CENTER } from './face.js';

export const SOURCES = ['reaction', 'event', 'cursor', 'calm'];

export class Attention {
  constructor(settings) {
    this.settings = settings;
    this.sources = new Map(); // name → { x, y, strength, label }
    this.offset = { x: 0, y: 0 };
    this.active = 'calm';
  }

  setSettings(s) { this.settings = s; }
  reset() { this.sources.clear(); this.offset = { x: 0, y: 0 }; this.active = 'calm'; }

  /** point: {x, y} в портретных координатах; strength 0..1. */
  set(source, point, { strength = 1, label = '' } = {}) {
    this.sources.set(source, { x: point.x, y: point.y, strength, label });
  }

  clear(source) { this.sources.delete(source); }
  has(source) { return this.sources.has(source); }

  /** Текущий победитель по приоритету. */
  winner() {
    for (const s of SOURCES) if (this.sources.has(s)) return { source: s, ...this.sources.get(s) };
    return { source: 'calm', x: EYE_CENTER.x, y: EYE_CENTER.y, strength: 1, label: 'центр' };
  }

  /** Неограниченная мишень → смещение радужки (px портрета). */
  targetOffset(w) {
    const g = this.settings;
    const range = 1024 * g.rangeFactor;
    let dx = (w.x - EYE_CENTER.x) / range;
    let dy = (w.y - EYE_CENTER.y) / range;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { x: dx * g.maxX * w.strength, y: dy * g.maxY * w.strength };
  }

  update(dt) {
    const g = this.settings;
    const w = this.winner();
    this.active = w.source;
    const t = g.enabled ? this.targetOffset(w) : { x: 0, y: 0 };
    // Возврат к центру (calm без явной точки) медленнее, чем слежение
    const returning = w.source === 'calm' && !this.sources.has('calm');
    const tau = Math.max(1, (returning ? g.returnMs : g.smoothMs) / 3); // ~95% за smoothMs
    const k = 1 - Math.exp(-dt / tau);
    this.offset.x += (t.x - this.offset.x) * k;
    this.offset.y += (t.y - this.offset.y) * k;
  }

  describe() {
    const w = this.winner();
    return w.label ? `${w.source}: ${w.label}` : w.source;
  }
}
