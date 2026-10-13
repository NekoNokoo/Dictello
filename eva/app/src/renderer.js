// renderer.js — рисует портрет на Canvas 2D. Всё собирается в системе 1024×1024
// и масштабируется целиком (с учётом devicePixelRatio). Дыхание — одна общая
// трансформация для всех слоёв и ASCII вокруг опоры у низа бюста.
//
// Радужка tracking рисуется в отдельный маленький холст: сдвиг на offset × factor,
// затем destination-in маской внутренней области глаз (derived/eye_inner_mask.png).

import { CLIP_LED } from './assets.js';
import { effectParts } from './v2.js';
import { drawHairFrames } from './hair_frames.js';
import { buildPoseMasks } from './hair_ascii_mask.js';

/** Лёгкая анимация эффекта вокруг его якоря: {dx, dy, s, a}. В reduced motion — только прозрачность. */
function effectMotion(name, part, t, i, reduced) {
  if (reduced) return { dx: 0, dy: 0, s: 1, a: 1 };
  const T = t / 1000;
  switch (name) {
    case 'anger': return { dx: 0, dy: 0, s: 1 + 0.1 * Math.abs(Math.sin(T * Math.PI * 2.2)), a: 1 };
    case 'sweat_drop': return { dx: 0, dy: Math.min(1, T / 0.8) * 10, s: 1, a: 1 };
    case 'tears': return { dx: 0, dy: (T % 1.6) / 1.6 * 14, s: 1, a: 1 - Math.max(0, (T % 1.6) / 1.6 - 0.7) / 0.3 };
    case 'sleep_zz': { const p = (T % 2.6) / 2.6; return { dx: 6 * p, dy: -16 * p, s: 0.9 + 0.15 * p, a: Math.min(1, p * 4, (1 - p) * 3) }; }
    case 'heart': return { dx: 0, dy: -3 * Math.sin(T * 3), s: Math.min(1, T / 0.18) * (1 + 0.06 * Math.sin(T * 7)), a: 1 };
    case 'question': return { dx: 0, dy: 3 * Math.sin(T * 3.4), s: 1, a: 1 };
    case 'sparkles': return { dx: 0, dy: 0, s: 0.85 + 0.2 * Math.abs(Math.sin(T * 4 + i * 1.7)), a: 0.55 + 0.45 * Math.abs(Math.sin(T * 3 + i * 2.1)) };
    case 'eye_stars': return { dx: 0, dy: 0, s: 0.9 + 0.12 * Math.abs(Math.sin(T * 5 + i)), a: 0.8 + 0.2 * Math.sin(T * 6 + i) };
    default: return { dx: 0, dy: 0, s: 1, a: 1 };
  }
}

const SIDE = 1024;
const LED_PAD = 24; // запас вокруг пилюли заколки под свечение
// bbox внутренней области глаз из derived/derived_manifest.json + запас на сдвиг радужки
const IRIS_BOX = { x: 300, y: 480, w: 424, h: 140 };

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.cssSize = 320;
    this.dpr = 1;
    this.scale = 1; // 1 + дыхание
    this.dy = 0;    // сдвиг портрета вниз, px портрета (вздох, зевок)
    this.pivotY = 1001;
    this.irisCanvas = document.createElement('canvas');
    this.irisCtx = this.irisCanvas.getContext('2d');
    this.pivotCache = new Map(); // ось сплющивания глаз при моргании по наборам
    this.refImages = new Map(); // path → Image | 'loading' | Error
    this.ledCanvas = document.createElement('canvas');
    this.ledCtx = this.ledCanvas.getContext('2d');
  }

  /** Размер портрета в CSS px; буфер = css × dpr. */
  resize(cssSize, dpr = window.devicePixelRatio || 1) {
    const px = Math.max(1, Math.round(cssSize * dpr));
    this.cssSize = cssSize;
    this.dpr = dpr;
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    const k = px / SIDE;
    const iw = Math.max(1, Math.ceil(IRIS_BOX.w * k)), ih = Math.max(1, Math.ceil(IRIS_BOX.h * k));
    if (this.irisCanvas.width !== iw || this.irisCanvas.height !== ih) {
      this.irisCanvas.width = iw;
      this.irisCanvas.height = ih;
    }
  }

  get k() { return this.canvas.width / SIDE; }

  /** Портретная трансформация (масштаб буфера + дыхание вокруг опоры). */
  _portraitTransform(ctx) {
    const k = this.k, s = this.scale, py = this.pivotY;
    // x' = k·(512 + s·(x − 512)), y' = k·(py + s·(y − py) + dy)
    ctx.setTransform(k * s, 0, 0, k * s, k * 512 * (1 - s), k * (py * (1 - s) + this.dy));
  }

  /** Нижняя граница белка: ось, к которой сплющиваются глаза при моргании (нижнее веко стоит на месте). */
  _pivotY(path) {
    if (this.pivotCache.has(path)) return this.pivotCache.get(path);
    const l = this.assets.layers.get(path);
    if (!l) return 600;
    // Слои v3 хранятся целым холстом: низ белка — по самой нижней непрозрачной строке, а не по границе слоя
    const c = document.createElement('canvas');
    c.width = l.w; c.height = l.h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(l.bmp, 0, 0);
    const d = x.getImageData(0, 0, l.w, l.h).data;
    let bottom = -1;
    for (let y = l.h - 1; y >= 0 && bottom < 0; y--) {
      for (let px = 0; px < l.w; px += 2) if (d[(y * l.w + px) * 4 + 3] > 40) { bottom = y; break; }
    }
    const pivot = l.y + (bottom >= 0 ? bottom + 1 : l.h);
    this.pivotCache.set(path, pivot);
    return pivot;
  }

  _layer(ctx, path, alpha = 1, squash = null, pivotPath = null) {
    const l = this.assets.layers.get(path);
    if (!l) return;
    ctx.globalAlpha = alpha;
    if (squash != null && squash !== 1) {
      const py = this._pivotY(pivotPath || path);
      ctx.save();
      ctx.transform(1, 0, 0, squash, 0, py * (1 - squash));
      ctx.drawImage(l.bmp, l.x, l.y, l.w, l.h);
      ctx.restore();
    } else {
      ctx.drawImage(l.bmp, l.x, l.y, l.w, l.h);
    }
    ctx.globalAlpha = 1;
  }

  _iris(ctx, item, gaze) {
    const l = this.assets.layers.get(item.path);
    if (!l) return;
    const gx = gaze.x * item.factor, oy = gaze.y * item.factor;
    // Каждая радужка двигается в ту же сторону; к носу — с коэффициентом inward
    // (у внутреннего угла tracking-слоя нет белка, дальний сдвиг даёт срез по контуру).
    const inward = item.inwardFactor ?? 1;
    const oxL = gx > 0 ? gx * inward : gx; // левый глаз (x < 512): к носу = вправо
    const oxR = gx < 0 ? gx * inward : gx; // правый глаз: к носу = влево
    const ic = this.irisCtx, k = this.k;
    ic.setTransform(1, 0, 0, 1, 0, 0);
    ic.globalCompositeOperation = 'source-over';
    ic.clearRect(0, 0, this.irisCanvas.width, this.irisCanvas.height);
    ic.setTransform(k, 0, 0, k, -IRIS_BOX.x * k, -IRIS_BOX.y * k);
    // item.offsets: постоянный сдвиг радужки [левый, правый] (старая радужка в глазах v3 — по центру разреза)
    const [offL, offR] = item.offsets || [[0, 0], [0, 0]];
    for (const [ox, x0, x1, off] of [[oxL, IRIS_BOX.x, 512, offL], [oxR, 512, IRIS_BOX.x + IRIS_BOX.w, offR]]) {
      ic.save();
      ic.beginPath();
      ic.rect(x0, IRIS_BOX.y, x1 - x0, IRIS_BOX.h);
      ic.clip();
      ic.drawImage(l.bmp, l.x + ox + off[0], l.y + oy + off[1], l.w, l.h);
      ic.restore();
    }
    ic.globalCompositeOperation = 'destination-in';
    if (item.squash != null && item.squash !== 1) {
      // Моргание: маска (форма глаза) сплющена к нижнему веку, радужка остаётся на месте и обрезается ею
      const py = this._pivotY(item.pivotPath || item.path);
      ic.save();
      ic.transform(1, 0, 0, item.squash, 0, py * (1 - item.squash));
      ic.drawImage((this.assets.eyeMasks && this.assets.eyeMasks[item.mask]) || this.assets.eyeMask, 0, 0, SIDE, SIDE);
      ic.restore();
    } else {
      ic.drawImage((this.assets.eyeMasks && this.assets.eyeMasks[item.mask]) || this.assets.eyeMask, 0, 0, SIDE, SIDE);
    }
    ic.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.irisCanvas, IRIS_BOX.x, IRIS_BOX.y, this.irisCanvas.width / k, this.irisCanvas.height / k);
  }

  /**
   * Индикатор на заколке: синяя пилюля перекрашивается в цвет статуса с силой amount,
   * плюс мягкое свечение. amount = 0 — исходный синий из base.png без изменений.
   */
  _led(ctx, ind) {
    if (!ind || (ind.amount <= 0.004 && ind.glow <= 0.004)) return;
    const l = this.assets.layers.get(CLIP_LED);
    if (!l) return;
    const k = this.k;
    const w = l.w + LED_PAD * 2, h = l.h + LED_PAD * 2;
    const cw = Math.max(1, Math.ceil(w * k)), ch = Math.max(1, Math.ceil(h * k));
    const c = this.ledCanvas, x = this.ledCtx;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, cw, ch);
    x.setTransform(k, 0, 0, k, -(l.x - LED_PAD) * k, -(l.y - LED_PAD) * k);
    x.drawImage(l.bmp, l.x, l.y, l.w, l.h);
    x.globalCompositeOperation = 'source-in';
    const [r, g, b] = ind.color;
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(l.x - LED_PAD, l.y - LED_PAD, w, h);
    x.globalCompositeOperation = 'source-over';
    ctx.save();
    if (ind.glow > 0.004) {
      ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, ind.glow)})`;
      ctx.shadowBlur = 16 * k * this.scale;
      ctx.globalAlpha = Math.min(1, ind.glow) * 0.6;
      ctx.drawImage(c, l.x - LED_PAD, l.y - LED_PAD, w, h);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = Math.min(1, ind.amount);
    ctx.drawImage(c, l.x - LED_PAD, l.y - LED_PAD, w, h);
    ctx.restore();
  }

  /** Эффекты Tier E поверх лица: каждый слой масштабируется и сдвигается вокруг своего якоря. */
  _effects(ctx, effects, reduced) {
    for (const e of effects) {
      effectParts(this.assets.v2, e.name).forEach((part, i) => {
        const l = this.assets.layers.get(part.path);
        if (!l) return;
        const m = effectMotion(e.name, part, e.t, i, reduced);
        const [ax, ay] = part.anchor;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, e.a * m.a));
        ctx.translate(ax + m.dx, ay + m.dy);
        ctx.scale(m.s, m.s);
        ctx.translate(-ax, -ay);
        ctx.drawImage(l.bmp, l.x, l.y, l.w, l.h);
        ctx.restore();
      });
    }
  }

  /** Эталонный полный оверлей (lazy). null — ещё грузится; Error — не загрузился. */
  reference(path) {
    const v = this.refImages.get(path);
    if (v === undefined) {
      this.refImages.set(path, 'loading');
      this.assets.reference(path)
        .then((img) => this.refImages.set(path, img))
        .catch((e) => this.refImages.set(path, e));
      return null;
    }
    return v === 'loading' ? null : v;
  }

  /**
   * frame: {
   *   list        — Face.drawList() (послойно) или null,
   *   referencePath — путь полного оверлея (режим «эталоном») или null,
   *   gaze        — {x, y} смещение радужки,
   *   breathScale — 1 ± амплитуда,
   *   ascii       — AsciiHair | null, asciiOpts — опции draw(),
   * }
   * Возвращает ошибку загрузки эталона, если она есть.
   */
  draw({ list, referencePath = null, gaze = { x: 0, y: 0 }, inwardFactor = 1, breathScale = 1, pivotY = 1001, ascii = null, asciiOpts = {}, indicator = null, hair = null, hairPose = null, effects = null, reducedMotion = false, offsetY = 0 }) {
    const ctx = this.ctx;
    this.scale = breathScale;
    this.dy = offsetY;
    this.pivotY = pivotY;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._portraitTransform(ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const bank = !referencePath && hair && this.assets.hairFrames;
    this.hairBankActive = !!bank;
    this._poseHit = false;
    const poses = !referencePath && !bank && hairPose && this.assets.hairPoses;
    const poseBmp = poses && poses.bmps.get(hairPose);
    if (bank) {
      drawHairFrames(ctx, bank, hair.frames, reducedMotion);
    } else if (poseBmp) {
      this._poseHit = true;
      ctx.drawImage(poseBmp, poses.meta.rect.x, poses.meta.rect.y); // целая поза вместо base.png
    } else this._layer(ctx, 'base.png');
    // ASCII сразу поверх основы: он внутри маски волос, черты лица рисуются выше
    if (ascii) {
      if (poseBmp) {
        // маска из самой позы: статичная маска base.png не совпадает с контурами перерисованных кадров
        const pm = this._poseAsciiMasks(poses);
        ascii.setMask(pm.unionCanvas, pm.unionAlpha);
        ascii.setClip(this._poseClip(pm, hairPose));
      } else {
        ascii.setClip(null);
        ascii.setMask(bank ? this.assets.hairMask : this.assets.originalHairMask,
          bank ? this.assets.hairMaskAlpha : this.assets.originalHairMaskAlpha);
      }
      ascii.draw(ctx, { portraitCssSize: this.cssSize, dpr: this.dpr, ...asciiOpts });
    }
    this._portraitTransform(ctx); // ascii мог сбросить состояние
    this._led(ctx, indicator);

    let refError = null;
    if (referencePath) {
      const img = this.reference(referencePath);
      if (img instanceof Error) refError = img;
      else if (img) ctx.drawImage(img, 0, 0, SIDE, SIDE);
    } else if (list) {
      for (const item of list) {
        if (item.path === 'base.png') continue;
        if (item.iris) this._iris(ctx, { ...item, inwardFactor }, gaze);
        else this._layer(ctx, item.path, item.alpha, item.squash, item.pivotPath);
      }
    }
    if (effects && effects.length) this._effects(ctx, effects, reducedMotion);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return refError;
  }

  _poseAsciiMasks(poses) {
    if (this._pam && this._pam.src === poses) return this._pam;
    const make = (w, h) => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
      const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    };
    const m = buildPoseMasks(poses, { side: 512, makeCanvas: make });
    const toCanvas = (cov) => {
      const c = make(m.side, m.side), x = c.getContext('2d');
      const id = x.createImageData(m.side, m.side);
      for (let i = 0, j = 0; i < cov.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = cov[i]; }
      x.putImageData(id, 0, 0);
      return c;
    };
    this._pam = { src: poses, unionAlpha: m.union, unionCanvas: toCanvas(m.union), byName: m.byName, side: m.side,
      clipCanvas: make(m.side, m.side), clipName: null, toCanvas };
    return this._pam;
  }

  _poseClip(pm, name) {
    if (pm.clipName !== name) {
      const cov = pm.byName.get(name) || pm.unionAlpha;
      const x = pm.clipCanvas.getContext('2d');
      const id = x.createImageData(pm.side, pm.side);
      for (let i = 0, j = 0; i < cov.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = cov[i]; }
      x.putImageData(id, 0, 0);
      pm.clipName = name;
    }
    return pm.clipCanvas;
  }

  /** Клиентские координаты страницы → координаты портрета (с обратным дыханием). */
  clientToPortrait(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * SIDE;
    const y = ((clientY - r.top) / r.height) * SIDE;
    const s = this.scale || 1;
    return { x: 512 + (x - 512) / s, y: this.pivotY + (y - this.dy - this.pivotY) / s };
  }

  /** Портрет → клиентские координаты (для отладки/подсветки мишеней). */
  portraitToClient(px, py) {
    const r = this.canvas.getBoundingClientRect();
    const s = this.scale || 1;
    const x = 512 + (px - 512) * s, y = this.pivotY + (py - this.pivotY) * s + this.dy;
    return { x: r.left + (x / SIDE) * r.width, y: r.top + (y / SIDE) * r.height };
  }

  /** Clicks follow the rest silhouette of the art currently being rendered. */
  hitTest(clientX, clientY, threshold = 40) {
    const p = this.clientToPortrait(clientX, clientY);
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return false;
    const alpha = (this.hairBankActive || this._poseHit) && this.assets.hairBaseAlpha ? this.assets.hairBaseAlpha : this.assets.baseAlpha;
    return alpha[y * SIDE + x] > threshold;
  }

  /**
   * Сборка без дыхания и ASCII в отдельный холст SIDE×SIDE — для автоматического
   * сравнения послойной сборки с эталонным оверлеем.
   */
  composeOffscreen({ list = null, referenceImg = null, gaze = { x: 0, y: 0 } } = {}) {
    const c = document.createElement('canvas');
    c.width = SIDE; c.height = SIDE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const saved = { canvas: this.canvas, irisCanvas: this.irisCanvas, irisCtx: this.irisCtx };
    // временно рисуем в масштабе 1
    this.canvas = c;
    this.irisCanvas = document.createElement('canvas');
    this.irisCanvas.width = IRIS_BOX.w; this.irisCanvas.height = IRIS_BOX.h;
    this.irisCtx = this.irisCanvas.getContext('2d');
    this.scale = 1;
    this.dy = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._layer(ctx, 'base.png');
    if (referenceImg) ctx.drawImage(referenceImg, 0, 0, SIDE, SIDE);
    else if (list) for (const item of list) {
      if (item.path === 'base.png') continue;
      if (item.iris) this._iris(ctx, item, gaze);
      else this._layer(ctx, item.path, item.alpha, item.squash, item.pivotPath);
    }
    Object.assign(this, saved);
    return c;
  }
}
