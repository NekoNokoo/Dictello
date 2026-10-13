// v2.js — принятая часть поставки assets/mascot_v2: рты для речи (Tier C) и эффекты (Tier E).
// Слои Tier A и глаза Tier B ещё дорабатываются и здесь НЕ используются.
// Все файлы — холст 1024×1024 в той же системе координат, что assets/mascot; рисуются как есть.

export const V2_PREFIX = 'v2/'; // ключ слоя в assets.layers: 'v2/' + путь из манифеста v2

/** Группы эффектов, которые показываются вместе. */
export const EFFECT_GROUPS = {
  sparkles: ['sparkle_1', 'sparkle_2', 'sparkle_3'],
  tears: ['tear_left', 'tear_right'],
  eye_stars: ['eye_star_left', 'eye_star_right'],
};

/** Разбор манифеста v2 → { mouths: {mood: {shape: key}}, effects: {name: {path, anchor}}, files }. */
export function parseV2(man) {
  const C = man && man.tiers && man.tiers.C && man.tiers.C.profiles;
  const E = man && man.tiers && man.tiers.E && man.tiers.E.effects;
  if (!C || !E) return null;
  const mouths = {}, effects = {}, files = [];
  for (const [mood, shapes] of Object.entries(C)) {
    mouths[mood] = {};
    for (const [shape, v] of Object.entries(shapes)) {
      if (!v.full) continue;
      mouths[mood][shape] = V2_PREFIX + v.full;
      files.push(v.full);
    }
  }
  for (const [name, v] of Object.entries(E)) {
    if (!v.file || name === 'eye_stars') continue; // общий превью-файл; рисуем левый и правый отдельно
    effects[name] = { path: V2_PREFIX + v.file, anchor: v.anchor || [512, 512] };
    files.push(v.file);
  }
  return { mouths, effects, files };
}

/** Слои одного эффекта (с учётом групп). */
export function effectParts(v2, name) {
  if (!v2) return [];
  return (EFFECT_GROUPS[name] || [name]).map((n) => ({ name: n, ...v2.effects[n] })).filter((e) => e.path);
}

// ─────────────────────────────────────────────────────────── речь ──

const VOWELS = {
  а: 'A', я: 'A', a: 'A',
  о: 'O', ё: 'O', o: 'O',
  у: 'U', ю: 'U', u: 'U', w: 'U',
  и: 'I', ы: 'I', i: 'I', y: 'I',
  е: 'E', э: 'E', e: 'E',
};
const LIPS = new Set(['м', 'б', 'п', 'в', 'ф', 'm', 'b', 'p', 'v', 'f']); // губы смыкаются
const PAUSE = new Set([',', '.', '!', '?', ';', ':', '—', '–', '…', '\n']);

/**
 * Текст → последовательность форм рта {v, ms}. Простое приближение (без фонем):
 * гласные — свои формы, губные согласные — закрытый рот, прочие — чуть приоткрытый.
 * rate > 1 — быстрее.
 */
export function textToVisemes(text, rate = 1) {
  const k = 1 / Math.max(0.2, rate);
  const out = [];
  const push = (v, ms) => {
    const last = out[out.length - 1];
    if (last && last.v === v) last.ms += ms * k; // одинаковые формы подряд сливаем
    else out.push({ v, ms: ms * k });
  };
  // Длительности подобраны под мультяшный рот: медленнее реальной речи, без мелькания
  for (const ch of String(text || '').toLowerCase()) {
    if (VOWELS[ch]) push(VOWELS[ch], 175);
    else if (LIPS.has(ch)) push('closed', 105);
    else if (ch === ' ') push('closed', 130);
    else if (PAUSE.has(ch)) push('closed', 340);
    else if (/[a-zа-яё]/.test(ch)) push('open_small', 80);
  }
  if (out.length) push('closed', 160);
  // Слишком короткие формы (одиночная согласная между гласными) отдаём соседу — рот не дёргается
  const MIN = 90 * k;
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].ms < MIN && out[i].v === 'open_small') { out[i - 1].ms += out[i].ms; out.splice(i, 1); i--; }
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].v === out[i - 1].v) { out[i - 1].ms += out[i].ms; out.splice(i, 1); i--; }
  }
  return out;
}
