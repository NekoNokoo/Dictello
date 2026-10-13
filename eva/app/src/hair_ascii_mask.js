/**
 * Маска ASCII-слоя для банка поз: покрытие «заливка волос» из самого кадра позы (альфа × светлота × не кожа).
 * Исходная маска пакета строилась так же — по base.png: белое с покрытием в альфе, без кожи, тёмных контуров и заколки.
 * Для кадров, нарисованных заново (Codex, Wan), статичная маска base.png не совпадает с контурами чёлки и прядей —
 * ASCII-заливка закрывала линии, поэтому маска берётся из текущей позы.
 */
export function hairCoverage(rgba, n = rgba.length >> 2) {
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3];
    if (a === 0) continue;
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    let c = (luma - 110) / 60;               // контур, одежда, заколка — тёмные
    if (c <= 0) continue;
    if (c > 1) c = 1;
    let w = (12 - (r - b)) / 8;              // кожа — тёплая (r заметно больше b)
    if (w <= 0) continue;
    if (w > 1) w = 1;
    out[i] = Math.round(a * c * w);
  }
  return out;
}

/** Маски всех поз банка на сетке side×side (по умолчанию 512): union для набора ячеек и покадровые покрытия. */
export function buildPoseMasks(poses, { side = 512, makeCanvas } = {}) {
  const { meta, bmps } = poses;
  const canvas = makeCanvas(side, side);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const k = side / 1024;
  const byName = new Map();
  const union = new Uint8Array(side * side);
  for (const [name, bmp] of bmps) {
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(bmp, meta.rect.x * k, meta.rect.y * k, bmp.width * k, bmp.height * k);
    const cov = hairCoverage(ctx.getImageData(0, 0, side, side).data, side * side);
    byName.set(name, cov);
    for (let i = 0; i < union.length; i++) if (cov[i] > union[i]) union[i] = cov[i];
  }
  return { side, byName, union };
}
