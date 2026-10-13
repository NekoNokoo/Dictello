/**
 * Сценарии волос на готовых позах («ветерок», перемещение, клик). Без случайности, пружин и смешивания:
 * поза — детерминированная функция времени и событий; смена позы — жёсткая, как в ограниченной анимации.
 */
export const POSE_DEFAULTS = Object.freeze({
  enabled: true,
  aeLoop: false,                // ветерок = анимация из AE по порядку (meta.ae), вместо короткого сценария
  poseSet: 'wan',               // набор кадров: 'wan' (видео Wan 3.0) | 'codex' (hair_stability_v2) | 'ag' (Antigravity)
  aeCodex: true,                // устар.: false — принудительно 'ag'
  aeFps: 16,                    // 8 — как в AE, 16 — вдвое быстрее по просьбе
  windFps: 16, kickFps: 24, gustFps: 16, travelFps: 24, // «ветер» вдвое быстрее прежних 8/12
  sleepWindFps: 8,                                       // во сне ветерок вдвое медленнее
  minClickGapMs: 120,
  // ветерок в покое: полный цикл клипа (покой → вправо → влево → покой) раз в everyMs; между циклами волосы неподвижны
  windCycle: { enabled: true, everyMs: 30000, firstMs: 8000 },
  restHoldMs: 900,              // после перемещения/клика/порыва: покой, и только потом ветерок
  travel: {
    enabled: true,
    levelVx: [120, 450, 1000],  // пороги скорости окна (px/с экрана) для уровней 1..3
    releaseMul: 0.7,            // гистерезис: уровень держится, пока скорость > порог × releaseMul
    smoothMs: 90, idleMs: 140,  // сглаживание скорости; без событий move дольше idleMs — скорость 0
    clickCounterLevels: 1,      // клик: после основного размаха — по инерции небольшой откат в другую сторону (ступеней лесенки; 0 — без отката); пакет может задать свои значения (counter)
    clickCounterHoldMs: 90,     // пауза на пике отката, мс
    clickPeakHoldMs: 125,       // клик играет те же кадры лесенки и с теми же шагами, что и перемещение; на пике — столько мс
    riseStepMs: 50, fallStepMs: 110, // подъём быстрый, возврат — медленнее (ограниченная анимация ~9 к/с)
    flutterMs: 0,               // >0 — на установившемся уровне ≥2 раз в период «подхватывает» уровень ниже (по умолчанию выкл.: давало «моргание»)
    counterSwingMs: 0,          // >0 — обратный взмах после остановки (по умолчанию выкл.: N0↔R1 почти неразличимы и «дёргаются»)
  },
  breeze: { autoEveryMs: 0 },   // 0 — только по событию breeze; иначе порыв каждые N мс, стороны чередуются
});

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function validatePoseManifest(m) {
  const names = m && m.poses ? Object.keys(m.poses) : [];
  const known = new Set(names);
  const okSeq = (s) => Array.isArray(s) && s.length > 0 && s.every((n) => known.has(n));
  if (!m || m.version !== 1 || !names.includes('N0') || !m.rect || !m.ramps ||
      !okSeq(m.ramps.trail_left) || !okSeq(m.ramps.trail_right) || !okSeq(m.wind) ||
      !m.kick || !okSeq(m.kick.left) || !okSeq(m.kick.right) ||
      !m.gust || !okSeq(m.gust.left) || !okSeq(m.gust.right) ||
      !Object.values(m.sets || {}).every((p) => known.has(p.rest) && okSeq(p.ramps.trail_left) && okSeq(p.ramps.trail_right) && okSeq(p.wind) &&
        okSeq(p.kick.left) && okSeq(p.kick.right) && okSeq(p.gust.left) && okSeq(p.gust.right)) ||
      (m.ae !== undefined && !(okSeq(m.ae.frames) && m.ae.frames.length >= 2 &&
        Object.values(m.ae.sets || {}).every((s) => okSeq(s) && s.length >= 2)))) throw new TypeError('Invalid hair pose manifest');
  for (const n of names) {
    const f = m.poses[n].file;
    if (typeof f !== 'string' || !/^[\w.-]+\.(png|webp)$/.test(f)) throw new TypeError(`Invalid pose file: ${n}`);
  }
  return m;
}

/** Имена кадров, которые нужны набору: покой, лесенки, ветерок, порыв, клик, цикл AE. */
export function poseNamesForSet(meta, set) {
  const pk = set && set !== 'ag' && meta.sets && meta.sets[set];
  const names = new Set();
  const add = (a) => (a || []).forEach((n) => names.add(n));
  if (pk) {
    names.add(pk.rest);
    add(pk.ramps.trail_left); add(pk.ramps.trail_right); add(pk.wind);
    if (pk.counter) Object.values(pk.counter).forEach((v) => Array.isArray(v) && add(v));
    add(pk.gust.left); add(pk.gust.right); add(pk.kick.left); add(pk.kick.right);
    add(meta.ae && meta.ae.sets && meta.ae.sets[set]);
  } else {
    names.add('N0');
    add(meta.ramps.trail_left); add(meta.ramps.trail_right); add(meta.wind);
    add(meta.gust.left); add(meta.gust.right); add(meta.kick.left); add(meta.kick.right);
    add(meta.ae && meta.ae.frames);
  }
  return names;
}

/** set: 'wan' | 'codex' | 'ag' — грузить только кадры этого набора (приложение); без set — все (стенд). */
export async function loadHairPoses(derivedUrl, { readImage, makeBitmap = (i) => createImageBitmap(i), onError = () => {}, set = null }) {
  const base = derivedUrl + 'hair_poses/';
  const created = [];
  try {
    const response = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!response.ok) {
      if (response.status !== 404) onError(`Hair poses HTTP ${response.status}`);
      return null;
    }
    const meta = validatePoseManifest(await response.json());
    const bmps = new Map();
    const wanted = set ? poseNamesForSet(meta, set) : null;
    await Promise.all(Object.keys(meta.poses).filter((n) => !wanted || wanted.has(n)).map(async (n) => {
      const bmp = await makeBitmap(await readImage(base + meta.poses[n].file));
      created.push(bmp);
      if (bmp.width !== meta.rect.w || bmp.height !== meta.rect.h) throw new Error(`Pose dimensions: ${n}`);
      bmps.set(n, bmp);
    }));
    return { meta, bmps };
  } catch (error) {
    for (const bmp of created) bmp.close?.();
    onError(String(error.message || error));
    return null;
  }
}

export class HairPoseScenes {
  constructor(meta, settings = {}) {
    this.meta = validatePoseManifest(meta);
    this.setSettings(settings);
    this.reset();
  }
  setSettings(s) {
    this.settings = { ...POSE_DEFAULTS, ...s, travel: { ...POSE_DEFAULTS.travel, ...(s.travel || {}) },
      windCycle: { ...POSE_DEFAULTS.windCycle, ...(s.windCycle || {}) },
      breeze: { ...POSE_DEFAULTS.breeze, ...(s.breeze || {}) } };
  }
  reset() {
    this.t = 0;
    this.reducedMotion = false;
    this.asleep = false;
    this.windT0 = 0;
    this.windDelay = null;     // null — первый цикл через windCycle.firstMs; после любого сценария — через everyMs
    this.kick = null;          // {t0, seq}
    this.gustRun = null;       // {t0, seq}
    this.lastClickAt = -Infinity;
    this.gustCount = 0;
    this.nextAutoGust = this.settings.breeze.autoEveryMs || Infinity;
    // перемещение
    this.rawVx = 0; this.vx = 0; this.lastMoveAt = -Infinity;
    this.side = null; this.level = 0;   // side: 'trail_left' | 'trail_right'; level 0 — покой
    this.peak = 0; this.peakSide = null;
    this.stepAcc = 0;
    this.counter = null;       // {side, t0}
    this.flutterT0 = 0;
    this.targetLevel = 0; this.targetSide = null;
  }

  update(dtMs, { reducedMotion = false, asleep = false } = {}) {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('dtMs must be finite and >= 0');
    this.t += dtMs;
    if (asleep !== this.asleep) { this.asleep = asleep; this.windT0 = this.t; this.windDelay = this.settings.windCycle.everyMs; }
    if (reducedMotion && !this.reducedMotion) { this.kick = null; this.gustRun = null; this._resetTravel(); }
    this.reducedMotion = reducedMotion;
    if (reducedMotion) return;
    const g = this.settings.breeze;
    if (g.autoEveryMs > 0 && this.t >= this.nextAutoGust && !this.gustRun) {
      this.gust(this.gustCount % 2 === 0 ? 'left' : 'right');
      this.nextAutoGust = this.t + g.autoEveryMs;
    }
    if (this.kick && this.t - this.kick.t0 >= this.kick.total) {
      this.windT0 = this.t + this.settings.restHoldMs; this.windDelay = this.settings.windCycle.everyMs; this.kick = null;
    }
    if (this.gustRun && this.t - this.gustRun.t0 >= this.gustRun.seq.length * 1000 / this._fps('gust')) {
      this.windT0 = this.t + this.settings.restHoldMs; this.windDelay = this.settings.windCycle.everyMs; this.gustRun = null;
    }
    this._travel(dtMs);
    if (this.level > 0 || this.counter) { this.windT0 = this.t + this.settings.restHoldMs; this.windDelay = this.settings.windCycle.everyMs; } // после перемещения — покой, потом ветерок
  }

  _resetTravel() {
    this.rawVx = 0; this.vx = 0; this.side = null; this.level = 0; this.peak = 0; this.counter = null;
    this.targetLevel = 0; this.targetSide = null; this.stepAcc = 0;
  }

  _setName() { return this.settings.aeCodex === false ? 'ag' : (this.settings.poseSet || 'codex'); }

  /** Активный пакет сценариев: набор Codex (meta.sets.codex) или прежний Antigravity (поля meta верхнего уровня). */
  _pack() {
    const name = this._setName();
    const cx = name !== 'ag' && this.meta.sets && this.meta.sets[name];
    return cx || { rest: 'N0', ramps: this.meta.ramps, wind: this.meta.wind, kick: this.meta.kick, gust: this.meta.gust, fps: null, travel: null, counter: null };
  }
  _clickSteps(rampName) {
    const pk = this._pack();
    const c = pk.travel ? { ...this.settings.travel, ...pk.travel } : this.settings.travel;
    const ramp = pk.ramps[rampName].slice(0, Math.max(1, c.levelVx.length)); // ровно те ступени, до которых доходит перемещение
    const steps = ramp.map((p) => ({ p, ms: c.riseStepMs }));
    steps[steps.length - 1].ms += c.clickPeakHoldMs;
    for (let i = ramp.length - 2; i >= 0; i--) steps.push({ p: ramp[i], ms: c.fallStepMs });
    // по инерции: проходим покой и немного уходим в противоположную сторону (теми же кадрами клипа), затем возврат
    const other = rampName === 'trail_right' ? 'trail_left' : 'trail_right';
    // откат: список кадров пакета (counter[сторона] = ['W10','W11']) либо число первых ступеней противоположной лесенки
    const spec = pk.counter && pk.counter[other];
    const back = Array.isArray(spec) ? spec
      : pk.ramps[other].slice(0, Math.min(Number.isInteger(spec) ? spec : (c.clickCounterLevels | 0), Math.ceil(ramp.length / 2)));
    if (back.length > 0) {
      steps.push({ p: pk.rest, ms: c.fallStepMs });
      back.forEach((p) => steps.push({ p, ms: c.riseStepMs }));
      steps[steps.length - 1].ms += c.clickCounterHoldMs;
      for (let i = back.length - 2; i >= 0; i--) steps.push({ p: back[i], ms: c.fallStepMs });
    }
    return steps;
  }
  _fps(name) { const p = this._pack(); return (p.fps && p.fps[name]) || this.settings[name + 'Fps']; }

  /** Скорость перемещения окна (px/с экрана, + вправо). Хост шлёт при каждом сдвиге. */
  move(vx) {
    if (!this.settings.enabled || !this.settings.travel.enabled || this.reducedMotion || !Number.isFinite(vx)) return false;
    this.rawVx = vx; this.lastMoveAt = this.t;
    return true;
  }

  _travel(dtMs) {
    const pk = this._pack();
    const c = pk.travel ? { ...this.settings.travel, ...pk.travel } : this.settings.travel;
    const raw = this.t - this.lastMoveAt > c.idleMs ? 0 : this.rawVx;
    this.vx += (raw - this.vx) * (1 - Math.exp(-dtMs / Math.max(1, c.smoothMs)));
    if (Math.abs(this.vx) < 1) this.vx = 0;
    // желаемая сторона и уровень со скорости (с гистерезисом вниз)
    const sideWanted = this.vx > 0 ? 'trail_left' : this.vx < 0 ? 'trail_right' : null;
    const av = Math.abs(this.vx);
    let lvl = 0;
    for (let i = 0; i < c.levelVx.length; i++) {
      const th = c.levelVx[i] * (this.side === sideWanted && this.level > i ? c.releaseMul : 1);
      if (av >= th) lvl = i + 1;
    }
    const cap = sideWanted ? pk.ramps[sideWanted].length : 0;
    this.targetLevel = Math.min(lvl, cap);
    this.targetSide = this.targetLevel > 0 ? sideWanted : null;

    if (this.counter) {
      if (this.t - this.counter.t0 >= c.counterSwingMs) this.counter = null;
      else return;
    }
    if (this.level === 0 && this.targetLevel === 0) { this.stepAcc = 0; return; }
    // смена стороны: сначала в покой, потом наверх с другой стороны
    const goal = this.side && this.targetSide !== this.side ? 0 : this.targetLevel;
    if (this.level === goal) { this.stepAcc = 0; return; }
    const stepMs = goal > this.level ? c.riseStepMs : c.fallStepMs;
    this.stepAcc += dtMs;
    while (this.stepAcc >= stepMs && this.level !== goal) {
      this.stepAcc -= stepMs;
      if (this.level === 0) { this.side = this.targetSide; this.peak = 0; }
      this.level += goal > this.level ? 1 : -1;
      this.peak = Math.max(this.peak, this.level);
      this.flutterT0 = this.t;
      if (this.level === 0) {
        if (this.peak >= 2 && this.targetLevel === 0 && c.counterSwingMs > 0) {
          this.counter = { side: this.side === 'trail_left' ? 'trail_right' : 'trail_left', t0: this.t };
        }
        this.side = null; this.peak = 0;
      }
    }
    if (this.level === goal) this.stepAcc = 0;
  }

  /** Клик — только из настоящего pointer.click. */
  click(point) {
    if (!this.settings.enabled || this.reducedMotion || !point || !Number.isFinite(point.x)) return false;
    if (this.t - this.lastClickAt < this.settings.minClickGapMs) return false;
    this.lastClickAt = this.t;
    // клик в левой половине бросает правую часть вправо (лесенка trail_right) и наоборот — теми же кадрами и шагами, что при перемещении
    const steps = this._clickSteps(point.x < 512 ? 'trail_right' : 'trail_left');
    this.kick = { t0: this.t, steps, total: steps.reduce((s, x) => s + x.ms, 0) };
    return true;
  }

  /** Порыв ветерка: side 'left' | 'right' | 'auto' (чередуется). */
  gust(side = 'auto') {
    if (!this.settings.enabled || this.reducedMotion) return false;
    const s = side === 'left' || side === 'right' ? side : (this.gustCount % 2 === 0 ? 'left' : 'right');
    this.gustCount++;
    this.gustRun = { t0: this.t, seq: this._pack().gust[s] };
    return true;
  }

  _travelPose() {
    const pk = this._pack();
    if (this.counter) return pk.ramps[this.counter.side][0];
    if (this.level === 0) return null;
    const ramp = pk.ramps[this.side];
    let lvl = this.level;
    // «колыхание» на установившемся уровне ≥2: каждый 4-й тик на ступень ниже
    if (this.settings.travel.flutterMs > 0 && lvl >= 2 && this.level === this.targetLevel && this.side === this.targetSide) {
      const tick = Math.floor((this.t - this.flutterT0) / Math.max(1, this.settings.travel.flutterMs));
      if (tick % 4 === 3) lvl -= 1;
    }
    return ramp[clamp(lvl, 1, ramp.length) - 1];
  }

  /** Имя позы банка на текущий момент. */
  pose() {
    const pk = this._pack();
    if (!this.settings.enabled || this.reducedMotion) return pk.rest;
    const tr = this._travelPose();
    if (tr) return tr;
    const s = this.settings;
    if (this.gustRun) {
      const k = Math.floor((this.t - this.gustRun.t0) * this._fps('gust') / 1000);
      return this.gustRun.seq[clamp(k, 0, this.gustRun.seq.length - 1)];
    }
    if (this.kick) {
      let left = this.t - this.kick.t0;
      for (const st of this.kick.steps) { if (left < st.ms) return st.p; left -= st.ms; }
      return pk.rest;
    }
    const sets = this.meta.ae && this.meta.ae.sets;
    const setName = this._setName();
    const ae = s.aeLoop && this.meta.ae ? ((setName !== 'ag' && sets && sets[setName]) || this.meta.ae.frames) : null;
    const native = (this.meta.ae && this.meta.ae.native_fps && this.meta.ae.native_fps[ae && setName !== 'ag' ? setName : 'ag']) || 8;
    const fps = this.asleep ? s.sleepWindFps : (ae ? s.aeFps * native / 8 : this._fps('wind'));
    const k = Math.floor((this.t - this.windT0) * fps / 1000);
    if (k < 0) return pk.rest; // удержание покоя после сценария
    // ветерок в покое — один полный цикл клипа раз в windCycle.everyMs, как в исходном видео, на частоте набора
    const wc = s.windCycle;
    if (!ae && wc && wc.enabled) {
      const frames = sets && ((setName !== 'ag' && sets[setName]) || this.meta.ae.frames);
      if (frames && frames.length > 1) {
        const nat = (this.meta.ae.native_fps && this.meta.ae.native_fps[setName !== 'ag' ? setName : 'ag']) || 8;
        const cf = this.asleep ? s.sleepWindFps : ((pk.fps && pk.fps.wind) || nat);
        const delay = this.windDelay == null ? wc.firstMs : this.windDelay;
        const e = this.t - this.windT0 - delay;
        if (e < 0) return pk.rest;
        const lt = e % Math.max(1000, wc.everyMs);
        const idx = Math.floor(lt * cf / 1000);
        return idx < frames.length ? frames[idx] : pk.rest;
      }
    }
    const seq = ae || pk.wind;
    return seq[k % seq.length];
  }
}
