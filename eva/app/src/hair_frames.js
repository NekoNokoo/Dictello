/** Ready-frame bank: integer portrait coordinates, no runtime deformation or blending. */
export function validateHairManifest(meta) {
  if (meta?.version !== 1 || meta.canvas?.join() !== '1024,1024' || !meta.strands?.length ||
      !Array.isArray(meta.static_layers) || !Array.isArray(meta.draw_order)) throw new TypeError('Invalid hair frame manifest');
  const safeFile = f => typeof f === 'string' && /^[\w./-]+\.png$/.test(f) && !f.startsWith('/') && !f.split('/').includes('..');
  const validImage = f => safeFile(f.file) && [f.x,f.y,f.w,f.h].every(Number.isInteger) &&
    f.x >= 0 && f.y >= 0 && f.w > 0 && f.h > 0 && f.x + f.w <= 1024 && f.y + f.h <= 1024;
  const names = new Set();
  for (const layer of [...meta.static_layers, ...meta.strands]) {
    if (typeof layer.name !== 'string' || names.has(layer.name)) throw new TypeError('Duplicate/invalid hair layer');
    names.add(layer.name);
  }
  for (const s of meta.strands) {
    if (!Number.isInteger(s.N) || s.N < 3 || s.N % 2 !== 1 || s.rest_index !== (s.N - 1) / 2 ||
        !Number.isFinite(s.step) || s.step <= 0 || !Number.isFinite(s.dmax) || s.dmax <= 0 ||
        Math.abs(s.step * (s.N - 1) / 2 - s.dmax) > 1e-6 ||
        !Array.isArray(s.frames) || s.frames.length !== s.N ||
        !Array.isArray(s.bbox) || s.bbox.length !== 4 || !s.bbox.every(Number.isFinite) ||
        ![s.root_x,s.root_y,s.tip_y,s.amp_px].every(Number.isFinite) || s.tip_y <= s.root_y || s.amp_px <= 0 ||
        s.frames.some((f,i) => !validImage(f) || !Number.isFinite(f.d) || Math.abs(f.d - (i*s.step - s.dmax)) > 1e-6)) {
      throw new TypeError(`Invalid hair group: ${s.name}`);
    }
  }
  if (meta.static_layers.some(f => !validImage(f)) || !safeFile(meta.mask_file) ||
      meta.draw_order.length !== names.size || new Set(meta.draw_order).size !== names.size ||
      meta.draw_order.some(n => !names.has(n))) throw new TypeError('Invalid hair draw order/assets');
  return meta;
}

export function drawHairFrames(ctx, bank, indices = {}, reducedMotion = false) {
  for (const name of bank.meta.draw_order) {
    const layer = bank.layers.get(name);
    let frame = layer;
    if (layer.frames) {
      const i = reducedMotion ? layer.rest_index : indices[name];
      frame = layer.frames[Number.isInteger(i) && i >= 0 && i < layer.N ? i : layer.rest_index];
    }
    ctx.drawImage(frame.bmp, frame.x, frame.y);
  }
}

export async function loadHairFrames(derivedUrl, { readImage, makeBitmap = image => createImageBitmap(image), onError = () => {} }) {
  const base = derivedUrl + 'hair_relaxed/';
  const created = [];
  try {
    const response = await fetch(base + 'hair_frames.json', { cache: 'no-cache' });
    if (!response.ok) {
      if (response.status !== 404) onError(`Hair manifest HTTP ${response.status}`);
      return null;
    }
    const meta = validateHairManifest(await response.json());
    const images = [...meta.static_layers, ...meta.strands.flatMap(s => s.frames)];
    const decoded = new Map();
    let next = 0;
    // Bound decoding concurrency; all files are ready before a bank can be drawn.
    const workers = Array.from({ length: Math.min(8, images.length) }, async () => {
      while (next < images.length) {
        const frame = images[next++];
        const bmp = await makeBitmap(await readImage(base + frame.file));
        created.push(bmp);
        if (bmp.width !== frame.w || bmp.height !== frame.h) throw new Error(`Hair dimensions: ${frame.file}`);
        decoded.set(frame, { ...frame, bmp });
      }
    });
    const outcomes = await Promise.allSettled(workers);
    const failed = outcomes.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    const mask = await readImage(base + meta.mask_file);
    if (mask.width !== 1024 || mask.height !== 1024) throw new Error('Hair mask must be 1024 square');
    const layers = new Map(meta.static_layers.map(f => [f.name, decoded.get(f)]));
    for (const s of meta.strands) layers.set(s.name, { ...s, frames: s.frames.map(f => decoded.get(f)) });
    return { meta, layers, mask };
  } catch (error) {
    for (const bmp of created) bmp.close?.();
    onError(String(error.message || error));
    return null;
  }
}
