// face.js — модель лица: какой набор слоёв сейчас показан и как он меняется.
// Ничего не рисует и не знает про DOM: рендерер читает snapshot(), контроллер
// задаёт позы через setPose(). Время — только через update(dtMs).
//
// Глаза: всегда ровно один набор. Смена формы идёт через закрытие:
//   исходная форма закрывается → на closed подменяется → открывается целевая.
// Брови, рот, румянец: fade-out текущего, затем fade-in нового.

import { expressionLayerPaths } from './expressions.js';

export const SHAPES = ['annoyed', 'bashful', 'cheerful', 'fierce', 'kind', 'laugh', 'neutral', 'sleepy', 'worried'];
export const BLINK_STAGES = ['closing_35', 'closing_70', 'closed'];
export const LEVELS = ['open', ...BLINK_STAGES]; // индекс = уровень закрытия 0..3
export const PART_NAMES = ['cheeks', 'brows', 'mouth'];
// Два набора подвижных глаз (переключатель «eyes.style» в настройках):
//   old — исходные tracking-глаза пакета: белки с веками (derived/tracking_whites_clean.png,
//         без тёмной дуги старой радужки) + радужка, обрезанная маской derived/eye_inner_mask.png;
//   v3  — пересобранные в Photoshop (assets/mascot_eyes_v3): белок (он же маска радужки) →
//         две радужки → веки с ресницами поверх.
export const EYE_SETS = {
  old: {
    whites: 'derived/tracking_whites_clean.png',
    irises: ['tracking/irises_center.png'],
    lids: null,
    mask: 'old',
  },
  // глаза v3 (белок и веки) со старой радужкой пакета, поставленной по центру разреза v3
  v3old: {
    whites: 'eyes3/eye_sclera.png',
    irises: ['tracking/irises_center.png'],
    irisOffsets: [[-8, 9], [7, 8]],
    lids: 'eyes3/eye_lids.png',
    mask: 'v3',
  },
  v3: {
    whites: 'eyes3/eye_sclera.png',
    irises: ['eyes3/eye_iris_left.png', 'eyes3/eye_iris_right.png'],
    lids: 'eyes3/eye_lids.png',
    mask: 'v3',
  },
};
// Наборы с цельными кадрами глаз Кодекса (assets/mascot_eyes_v4/frames/<форма>/<стадия>.png,
// 1024×1024, альфа и контур совпадают с исходными кадрами пакета). Формы и стадии моргания берутся
// из них (префикс 'eyes4/'), laugh — eyes4/laugh/closed.png.
//   v4    — всё из новых кадров, в том числе tracking (= новый kind): рисунок радужки запечён в кадр,
//           отдельного слоя радужки нет, поэтому в слежении радужка НЕ двигается (irises: []);
//   v4old — формы и моргание новые; в слежении (tracking — основной режим: покой, слушает,
//           обрабатывает) остаётся набор v3old: белок и веки v3 + подвижная старая радужка.
export const EYE_FRAMES_V4 = 'eyes4';
EYE_SETS.v4 = {
  frames: EYE_FRAMES_V4,
  whites: 'eyes4/tracking/open.png',
  irises: [],
  lids: null,
  mask: null,
};
EYE_SETS.v4old = { ...EYE_SETS.v3old, frames: EYE_FRAMES_V4 };
export const EYE_STYLES = Object.keys(EYE_SETS);
export const TRACKING = {
  ...EYE_SETS.old,
  blinkProfile: 'kind', // у слежения нет своих кадров моргания
};
// Центр между глазами (среднее якорей eye_left/eye_right из manifest.json).
export const EYE_CENTER = { x: 512, y: 545 };

/** Пути слоёв глаз для формы и уровня. tracking на open — только белки, радужка отдельно. */
export function eyeLayerPaths(shape, level, style = 'old') {
  const stage = typeof level === 'number' ? LEVELS[level] : level;
  const set = EYE_SETS[style] || EYE_SETS.old;
  if (set.frames) {
    // цельные кадры v4; tracking с подвижной радужкой (v4old) остаётся на своей ветке ниже
    if (shape === 'laugh') return [`${set.frames}/laugh/closed.png`];
    if (shape !== 'tracking' || set.irises.length === 0) return [`${set.frames}/${shape}/${stage}.png`];
  }
  if (shape === 'laugh') return ['components/eyes_left/laugh.png', 'components/eyes_right/laugh.png'];
  if (shape === 'tracking') {
    if (stage === 'open') return [set.whites];
    return [`animation/blink/${TRACKING.blinkProfile}/${stage}/eyes.png`];
  }
  if (stage === 'open') return [`components/eyes_left/${shape}.png`, `components/eyes_right/${shape}.png`];
  return [`animation/blink/${shape}/${stage}/eyes.png`];
}

export function partLayerPaths(part, variant) {
  if (typeof variant === 'string' && variant.startsWith('expression:')) {
    return expressionLayerPaths(part, variant.slice('expression:'.length));
  }
  // 'v2:…' — принятые слои поставки mascot_v2: рты Tier C ('v2:kind/open_mid') и румянец Tier E ('v2:blush_dense')
  if (typeof variant === 'string' && variant.startsWith('v2:')) {
    const rest = variant.slice(3);
    return [part === 'mouth' ? `v2/tier_c/${rest}/full.png` : `v2/tier_e/${rest}.png`];
  }
  if (part === 'mouth') return [`components/mouths/${variant}.png`];
  return [`components/${part}_left/${variant}.png`, `components/${part}_right/${variant}.png`];
}

export function poseForEmotion(e) {
  return { eyes: e.upper_face, level: e.upper_face === 'laugh' ? 3 : 0, brows: e.upper_face, cheeks: e.upper_face, mouth: e.mouth };
}

export function poseForBridge(b) {
  const level = b.blink ? LEVELS.indexOf(b.blink) : 0;
  return { eyes: b.eyes, level, brows: b.brows, cheeks: b.cheeks, mouth: b.mouth };
}

// ─────────────────────────────────────────────────────────────── глаза ──

/** Насколько глаз ещё открыт на стадиях моргания (closing_35 → 65 %, closing_70 → 30 %). */
export const SQUASH_OPEN = { 1: 0.65, 2: 0.3 };

export class EyeChannel {
  /**
   * @param {object} o
   * @param {number[]} o.stagesMs  [c35↓, c70↓, closed, c70↑, c35↑]
   * @param {number} o.preCenterMs  возврат радужки в центр перед закрыванием
   * @param {number} o.closedHoldMs удержание closed при смене формы
   */
  constructor({ stagesMs, preCenterMs = 60, closedHoldMs = 180, irisReturnMs = 120 } = {}) {
    this.stagesMs = stagesMs;
    this.preCenterMs = preCenterMs;
    this.closedHoldMs = closedHoldMs;
    this.irisReturnMs = irisReturnMs;
    this.keepIris = false; // true: зрачок остаётся на месте при моргании (веки закрывают его слоями, без готовых кадров)
    this.snap('tracking', 0);
  }

  configure({ stagesMs, preCenterMs, closedHoldMs }) {
    if (stagesMs) this.stagesMs = stagesMs;
    if (preCenterMs != null) this.preCenterMs = preCenterMs;
    if (closedHoldMs != null) this.closedHoldMs = closedHoldMs;
  }

  /** Мгновенно (без анимации): сброс, ручной просмотр стадий. */
  snap(shape, level = 0) {
    if (shape === 'laugh') level = 3;
    this.shape = shape;
    this.level = level;
    this.target = { shape, level };
    this.dwell = 0;          // сколько показан текущий уровень
    this.swapped = false;    // на этом closed уже была подмена формы
    this.blink = null;       // { closedReached }
    this.precenter = 0;      // прогресс фазы pre-center, мс
    this.irisFactor = level === 0 ? 1 : 0;
    this.blinkCount = 0;
  }

  setTarget(shape, level = 0) {
    if (shape === 'laugh') level = 3;
    if (this.target.shape === shape && this.target.level === level) return;
    this.target = { shape, level };
  }

  /** Одно моргание из открытого состояния. scale > 1 — медленнее (сонное). false — если сейчас нельзя. */
  requestBlink(scale = 1) {
    if (!this.canBlink()) return false;
    this.blink = { closedReached: false, scale: scale > 0 ? scale : 1 };
    return true;
  }

  canBlink() {
    return !this.blink && this.isSettled() && this.level === 0 && this.shape !== 'laugh';
  }

  isSettled() {
    return this.shape === this.target.shape && this.level === this.target.level && !this.blink && this.precenter === 0;
  }

  /** Глаза, которые сейчас могут следить (только открытые tracking-глаза). */
  get tracking() { return this.shape === 'tracking' && this.level === 0; }

  _goal() {
    if (this.shape !== this.target.shape) return 3;
    if (this.blink) return this.blink.closedReached ? this.target.level : 3;
    return this.target.level;
  }

  _leaveMs(goingUp) {
    const s = this.stagesMs;
    const k = this.blink && this.blink.scale ? this.blink.scale : 1; // медленное моргание растягивает стадии
    switch (this.level) {
      case 1: return (goingUp ? s[0] : s[4]) * k;
      case 2: return (goingUp ? s[1] : s[3]) * k;
      case 3: {
        // closed: обычное моргание держит s[2]; смена формы — closedHoldMs, поровну до и после подмены
        if (this.shape !== this.target.shape) return this.swapped ? 0 : Math.max(s[2], this.closedHoldMs) / 2;
        return this.swapped ? Math.max(s[2], this.closedHoldMs) / 2 : s[2] * k;
      }
      default: return 0;
    }
  }

  update(dt) {
    // Радужка возвращается к мишени после открытия
    if (this.tracking && this.precenter === 0 && this.irisFactor < 1) {
      this.irisFactor = Math.min(1, this.irisFactor + dt / this.irisReturnMs);
    }
    this.dwell += dt;
    for (let guard = 0; guard < 16; guard++) {
      if (this.level === 3 && this.blink) this.blink.closedReached = true;

      // На closed: подмена формы после половины удержания
      if (this.level === 3 && this.shape !== this.target.shape) {
        const need = this._leaveMs(true);
        if (this.dwell < need) return;
        this.dwell -= need;
        this.shape = this.target.shape;
        this.swapped = true;
        this.irisFactor = 0;
        continue;
      }

      const goal = this._goal();
      if (goal === this.level) {
        if (this.precenter > 0) this.precenter = 0; // закрывание отменили — радужка вернётся к мишени
        if (this.blink && this.blink.closedReached && this.level === this.target.level) {
          this.blink = null;
          this.blinkCount++;
        }
        return;
      }
      const up = goal > this.level;

      // Pre-center: только у открытых tracking-глаз, отдельная фаза до закрывания
      if (up && this.level === 0 && this.shape === 'tracking' && this.preCenterMs > 0 && !this.keepIris) {
        this.precenter += dt;
        this.dwell = 0;
        this.irisFactor = Math.max(0, 1 - this.precenter / this.preCenterMs);
        if (this.precenter < this.preCenterMs) return;
        this.precenter = 0;
        this.irisFactor = 0;
        this.level = 1;
        this.swapped = false;
        continue;
      }
      if (up && this.level === 0) {
        this.level = 1; this.dwell = 0; this.swapped = false; continue;
      }

      const need = this._leaveMs(up);
      if (this.dwell < need) return;
      this.dwell -= need;
      this.level += up ? 1 : -1;
      if (this.level !== 3) this.swapped = false;
      if (this.level === 0) {
        this.dwell = 0;
        if (this.shape === 'tracking' && !this.keepIris) this.irisFactor = 0;
      }
    }
  }

  snapshot() {
    return { shape: this.shape, level: this.level, stage: LEVELS[this.level], irisFactor: this.irisFactor, blinking: !!this.blink };
  }
}

// ─────────────────────────────────────────────── брови / рот / румянец ──

export class PartChannel {
  constructor(name, variant = 'neutral', fadeMs = 180) {
    this.name = name;
    this.fadeMs = fadeMs;
    this.snap(variant);
  }

  snap(variant) { this.current = variant; this.pending = null; this.alpha = 1; }

  set(variant) {
    if (this.pending === null) {
      if (variant !== this.current) this.pending = variant;
    } else {
      // уже гаснет: если вернули прежний вариант — просто проявляемся обратно
      this.pending = variant === this.current ? null : variant;
    }
  }

  get settled() { return this.pending === null && this.alpha >= 1; }

  update(dt) {
    const half = Math.max(1, this.fadeMs / 2);
    if (this.pending !== null) {
      this.alpha -= dt / half;
      if (this.alpha <= 0) { this.alpha = 0; this.current = this.pending; this.pending = null; }
    } else if (this.alpha < 1) {
      this.alpha = Math.min(1, this.alpha + dt / half);
    }
  }
}

// ─────────────────────────────────────────────────────────────── лицо ──

export class Face {
  constructor({ stagesMs, preCenterMs, closedHoldMs, partFadeMs }) {
    this.eyes = new EyeChannel({ stagesMs, preCenterMs, closedHoldMs });
    this.blush = 1; // множитель прозрачности румянца (эмоция), 1 = как в ассете
    this.mouthOverride = null; // речь: форма рта v2 поверх позы, мгновенно, без затухания
    this.eyeStyle = 'old';     // набор глаз: 'old' | 'v3old' | 'v3' | 'v4' | 'v4old' (EYE_SETS)
    this.parts = {
      cheeks: new PartChannel('cheeks', 'neutral', partFadeMs),
      brows: new PartChannel('brows', 'neutral', partFadeMs),
      mouth: new PartChannel('mouth', 'neutral', partFadeMs),
    };
  }

  configure({ stagesMs, preCenterMs, closedHoldMs, partFadeMs }) {
    this.eyes.configure({ stagesMs, preCenterMs, closedHoldMs });
    if (partFadeMs != null) for (const p of Object.values(this.parts)) p.fadeMs = partFadeMs;
  }

  /** pose: { eyes, level?, brows, cheeks, mouth } */
  setPose(pose, { instant = false } = {}) {
    if (instant) {
      this.eyes.snap(pose.eyes, pose.level || 0);
      for (const k of PART_NAMES) this.parts[k].snap(pose[k]);
      return;
    }
    this.eyes.setTarget(pose.eyes, pose.level || 0);
    for (const k of PART_NAMES) this.parts[k].set(pose[k]);
  }

  update(dt) {
    this.eyes.keepIris = !!(EYE_SETS[this.eyeStyle] && EYE_SETS[this.eyeStyle].lids);
    this.eyes.update(dt);
    for (const p of Object.values(this.parts)) p.update(dt);
  }

  get settled() {
    return this.eyes.isSettled() && PART_NAMES.every((k) => this.parts[k].settled);
  }

  /**
   * Упорядоченный список отрисовки. Элемент: { path, alpha } или
   * { iris: true, path, factor } — радужка, которую рендерер сдвигает и режет маской.
   */
  drawList() {
    const out = [{ path: 'base.png', alpha: 1 }];
    const part = (name) => {
      const p = this.parts[name];
      const alpha = name === 'cheeks' ? p.alpha * this.blush : p.alpha;
      if (alpha <= 0) return;
      for (const path of partLayerPaths(name, p.current)) out.push({ path, alpha });
    };
    part('cheeks');
    const eset = EYE_SETS[this.eyeStyle] || EYE_SETS.old;
    const lvl = this.eyes.level;
    // Глаза v3: моргание полузакрытыми стадиями — теми же слоями (белок, зрачок на месте, веки), сплющенными
    // к нижнему веку. Зрачок обрезается сжимающимся белком, как будто его прикрывает веко, и никуда не уезжает.
    const squash = eset.lids && this.eyes.shape === 'tracking' && (lvl === 1 || lvl === 2) ? SQUASH_OPEN[lvl] : null;
    if (squash != null) {
      out.push({ path: eset.whites, alpha: 1, squash, pivotPath: eset.whites });
      for (const path of eset.irises) out.push({ iris: true, path, mask: eset.mask, offsets: eset.irisOffsets, factor: 1, squash, pivotPath: eset.whites });
      out.push({ path: eset.lids, alpha: 1, squash, pivotPath: eset.whites });
    } else {
      for (const path of eyeLayerPaths(this.eyes.shape, lvl, this.eyeStyle)) out.push({ path, alpha: 1 });
      if (this.eyes.tracking) {
        for (const path of eset.irises) out.push({ iris: true, path, mask: eset.mask, offsets: eset.irisOffsets, factor: this.eyes.irisFactor });
        if (eset.lids) out.push({ path: eset.lids, alpha: 1 }); // веки с ресницами поверх радужки
      }
    }
    part('brows');
    out.push({ path: 'components/nose/neutral.png', alpha: 1 });
    if (this.mouthOverride) out.push({ path: this.mouthOverride, alpha: 1 });
    else part('mouth');
    return out;
  }

  snapshot() {
    return {
      eyes: this.eyes.snapshot(),
      cheeks: this.parts.cheeks.current, brows: this.parts.brows.current, mouth: this.parts.mouth.current,
      speechMouth: this.mouthOverride,
    };
  }
}
