// assets.js — loads both manifests, layer bounds and every layer the runtime
// needs. Each 1024×1024 layer is cropped to its opaque bbox (derived/layer_bounds.json)
// so drawing stays cheap; the crop is drawn back at (x0, y0) in portrait space.
//
// Any failed file is reported by name — no silent placeholders.

import { BLINK_STAGES, SHAPES, PART_NAMES, eyeLayerPaths, partLayerPaths, EYE_SETS, EYE_STYLES } from './face.js';
import { parseV2, V2_PREFIX } from './v2.js';
import { EXPRESSION_NAMES, EXPRESSION_BOUNDS, expressionLayerPaths } from './expressions.js';
import { loadHairFrames, drawHairFrames } from './hair_frames.js';
import { loadHairPoses } from './hair_poses.js';

// Кадры глаз v4 (Кодекс) лежат целым холстом 1024, но непрозрачное — только в этой области
// (объединение альфа-границ всех 37 кадров: [301,478,723,606) + запас). Рисуем обрезанными,
// как остальные слои, — иначе 37 битмапов по 4 МБ. Тест проверяет границы по source_check.json.
export const EYES4_BOUNDS = [296, 472, 728, 612];

export const CLIP_LED = 'derived/clip_led_mask.png'; // маска синей пилюли заколки (индикатор статуса)

export class AssetLoadError extends Error {
  constructor(failures) {
    super(`Не удалось загрузить ${failures.length} файл(ов): ${failures.map((f) => f.path).join(', ')}`);
    this.failures = failures;
  }
}

async function fetchJson(url, label, failures) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    failures.push({ path: label, reason: String(e.message || e) });
    return null;
  }
}

// Сайт: не более 8 загрузок разом и до 4 попыток на файл (см. Scripts/build-site-eva.sh).
let inFlight = 0;
const waiting = [];
function slot() { return inFlight < 8 ? (inFlight++, Promise.resolve()) : new Promise((r) => waiting.push(r)); }
function release() { const next = waiting.shift(); if (next) next(); else inFlight--; }
function loadImageOnce(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load error'));
    img.src = url;
  });
}
async function loadImage(url) {
  await slot();
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await loadImageOnce(attempt ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url); }
      catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
    }
  } finally { release(); }
}

/** Every layer path (relative to assets/mascot/) the live renderer can draw. */
export function requiredLayerPaths() {
  const set = new Set(['base.png', 'components/nose/neutral.png', CLIP_LED]);
  for (const name of EXPRESSION_NAMES) for (const part of Object.keys(EXPRESSION_BOUNDS)) {
    for (const path of expressionLayerPaths(part, name)) set.add(path);
  }
  for (const es of Object.values(EYE_SETS)) for (const p of [es.whites, es.lids, ...es.irises]) if (p) set.add(p);
  for (const s of SHAPES) {
    for (const p of eyeLayerPaths(s, 'open')) set.add(p);
    for (const st of BLINK_STAGES) for (const p of eyeLayerPaths(s, st)) set.add(p);
    for (const part of PART_NAMES) for (const p of partLayerPaths(part, s)) set.add(p);
  }
  for (const st of BLINK_STAGES) for (const p of eyeLayerPaths('tracking', st)) set.add(p);
  // кадры глаз остальных наборов (v4/v4old: eyes4/…): формы × стадии, tracking и laugh
  for (const style of EYE_STYLES) {
    for (const shape of ['tracking', ...SHAPES]) for (const st of ['open', ...BLINK_STAGES]) for (const p of eyeLayerPaths(shape, st, style)) set.add(p);
  }
  return [...set];
}

export async function loadAssets({ poseSet = null, legacyHair = true, assetsUrl = '../assets/mascot/', derivedUrl = './derived/', v2Url = '../assets/mascot_v2/', eyes3Url = '../assets/mascot_eyes_v3/', eyes4Url = '../assets/mascot_eyes_v4/frames/', expressionsUrl = '../assets/mascot_expressions/', onProgress } = {}) {
  const urlOf = (p) => (p.startsWith('derived/') ? derivedUrl + p.slice(8) : p.startsWith('eyes3/') ? eyes3Url + p.slice(6)
    : p.startsWith('eyes4/') ? eyes4Url + p.slice(6) : p.startsWith('expressions/') ? expressionsUrl + p.split('/')[2] : assetsUrl + p);
  const labelOf = (p) => (p.startsWith('derived/') ? 'app/' + p : p.startsWith('eyes3/') ? 'assets/mascot_eyes_v3/' + p.slice(6)
    : p.startsWith('eyes4/') ? 'assets/mascot_eyes_v4/frames/' + p.slice(6)
    : p.startsWith('expressions/') ? 'assets/mascot_expressions/' + p.split('/')[2] : 'assets/mascot/' + p);
  const failures = [];
  const [manifest, anim, bounds] = await Promise.all([
    fetchJson(assetsUrl + 'manifest.json', 'assets/mascot/manifest.json', failures),
    fetchJson(assetsUrl + 'animation/manifest.json', 'assets/mascot/animation/manifest.json', failures),
    fetchJson(derivedUrl + 'layer_bounds.json', 'app/derived/layer_bounds.json', failures),
  ]);
  if (failures.length) throw new AssetLoadError(failures);

  const paths = requiredLayerPaths();
  const layers = new Map();
  let done = 0;
  const total = paths.length + 2;
  const tick = () => { done++; if (onProgress) onProgress(done, total); };

  await Promise.all(paths.map(async (path) => {
    try {
      const img = await loadImage(urlOf(path));
      const b = bounds[path] || (path.startsWith('eyes3/') ? [0, 0, 1024, 1024] : path.startsWith('eyes4/') ? EYES4_BOUNDS
        : path.startsWith('expressions/') ? EXPRESSION_BOUNDS[path.split('/')[1]] : null);
      if (!b) throw new Error('нет записи в layer_bounds.json');
      const [x0, y0, x1, y1] = b;
      if (x1 <= x0 || y1 <= y0) { layers.set(path, null); tick(); return; }
      const bmp = await createImageBitmap(img, x0, y0, x1 - x0, y1 - y0);
      layers.set(path, { bmp, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } catch (e) {
      failures.push({ path: labelOf(path), reason: String(e.message || e) });
    }
    tick();
  }));

  const eyeMasks = {};
  let hairMask = null;
  await Promise.all([
    // маски радужки: old — derived/eye_inner_mask.png; v3 — альфа белка (eye_sclera)
    loadImage(derivedUrl + 'eye_inner_mask.png').then((i) => { eyeMasks.old = i; tick(); })
      .catch(() => failures.push({ path: 'app/derived/eye_inner_mask.png', reason: 'image load error' })),
    loadImage(urlOf(EYE_SETS.v3.whites)).then((i) => { eyeMasks.v3 = i; })
      .catch(() => failures.push({ path: labelOf(EYE_SETS.v3.whites), reason: 'image load error' })),
    loadImage(assetsUrl + manifest.hair.ascii_mask).then((i) => { hairMask = i; tick(); })
      .catch(() => failures.push({ path: 'assets/mascot/' + manifest.hair.ascii_mask, reason: 'image load error' })),
  ]);
  if (failures.length) throw new AssetLoadError(failures);

  let hairLoadError = null;
  const hairPoses = await loadHairPoses(derivedUrl, { readImage: loadImage, set: poseSet, onError: e => { hairLoadError = e; } });
  // старый векторный банк нужен только как запасной путь: при наличии поз приложение его не грузит (память, размер сборки)
  const hairFrames = hairPoses && legacyHair === false ? null
    : await loadHairFrames(derivedUrl, { readImage: loadImage, onError: e => { hairLoadError = hairLoadError || e; } });
  const originalHairMask = hairMask;
  const originalHairMaskAlpha = readAlpha(originalHairMask);
  if (hairFrames) hairMask = hairFrames.mask;
  const v2 = await loadV2(v2Url, layers, failures);
  if (failures.length) throw new AssetLoadError(failures);

  const hairMaskAlpha = readAlpha(hairMask);
  const baseAlpha = readAlpha(await loadImage(assetsUrl + 'base.png'));
  let hairBaseAlpha = null;
  if (hairFrames) {
    const rest = document.createElement('canvas');
    rest.width = rest.height = 1024;
    drawHairFrames(rest.getContext('2d'), hairFrames);
    hairBaseAlpha = readAlpha(rest);
  } else if (hairPoses) {
    // попадание по персонажу — по силуэту позы покоя набора
    const pk = hairPoses.meta.sets && hairPoses.meta.sets[poseSet || 'wan'];
    const bmp = hairPoses.bmps.get(pk ? pk.rest : 'N0');
    if (bmp) {
      const rest = document.createElement('canvas');
      rest.width = rest.height = 1024;
      rest.getContext('2d').drawImage(bmp, hairPoses.meta.rect.x, hairPoses.meta.rect.y);
      hairBaseAlpha = readAlpha(rest);
    }
  }

  const emotions = manifest.emotions;
  const emotionByName = new Map(emotions.map((e) => [e.name, e]));
  const framesByName = new Map(anim.emotion_frames.map((e) => [e.name, e]));
  const bridgeByName = new Map(anim.bridges.map((b) => [b.name, b]));

  return {
    assetsUrl, manifest, anim, bounds, layers, hairFrames, hairPoses, hairLoadError, originalHairMask, originalHairMaskAlpha, v2,
    eyeMasks, eyeMask: eyeMasks.old, hairMask, hairMaskAlpha, baseAlpha, hairBaseAlpha,
    emotions, emotionByName, framesByName,
    bridges: anim.bridges, bridgeByName,
    blinkStagesMs: anim.blink_timing_ms.slice(1, 6),
    reference: (path) => loadReference(assetsUrl, path),
  };
}

/**
 * Принятая часть mascot_v2 (рты Tier C, эффекты Tier E). Нет манифеста — функции выключены (null);
 * манифест есть, а файл не грузится — явная ошибка с именем файла. Слои рисуются целым холстом 1024.
 */
async function loadV2(v2Url, layers, failures) {
  let man;
  try {
    const r = await fetch(v2Url + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    man = await r.json();
  } catch { return null; }
  const v2 = parseV2(man);
  if (!v2) return null;
  await Promise.all(v2.files.map(async (f) => {
    try {
      const img = await loadImage(v2Url + f);
      layers.set(V2_PREFIX + f, { bmp: await createImageBitmap(img), x: 0, y: 0, w: 1024, h: 1024 });
    } catch {
      failures.push({ path: 'assets/mascot_v2/' + f, reason: 'image load error' });
    }
  }));
  return v2;
}

const refCache = new Map();
/** Lazily loads a flat reference overlay (emotion / emotion_frames / bridge file). */
function loadReference(assetsUrl, path) {
  if (!refCache.has(path)) {
    refCache.set(path, loadImage(assetsUrl + path).catch(() => {
      refCache.delete(path);
      throw new AssetLoadError([{ path: 'assets/mascot/' + path, reason: 'image load error' }]);
    }));
  }
  return refCache.get(path);
}

function readAlpha(img) {
  const side = 1024;
  const c = document.createElement('canvas');
  c.width = side; c.height = side;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, side, side);
  const data = x.getImageData(0, 0, side, side).data;
  const out = new Uint8Array(side * side);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = data[j];
  return out;
}
