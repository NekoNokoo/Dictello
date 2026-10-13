// Generated brows and mouths; the eye rig and its blink stages remain unchanged.
// Each source is a full 1024×1024 transparent canvas. Runtime bitmap bounds are
// drawn back at their original position without scaling.
export const EXPRESSION_NAMES = ['curiosity', 'doubt', 'insight', 'relief', 'playfulness'];
export const EXPRESSION_BOUNDS = { brows: [280, 380, 744, 470], mouth: [460, 650, 570, 716] };

function pose(name, eyes, cheeks, label, extra = {}) {
  return { eyes, brows: `expression:${name}`, cheeks, mouth: `expression:${name}`, label, ...extra };
}
export const EXPRESSION_POSES = {
  curiosity: pose('curiosity', 'tracking', 'neutral', 'любопытство'),
  doubt: pose('doubt', 'worried', 'neutral', 'сомнение', { effect: 'question' }),
  insight: pose('insight', 'cheerful', 'cheerful', 'озарение', { effect: 'sparkles' }),
  relief: pose('relief', 'kind', 'kind', 'облегчение', { level: 2 }),
  playfulness: pose('playfulness', 'kind', 'bashful', 'игривость'),
};
export function expressionLayerPaths(part, name) {
  return EXPRESSION_BOUNDS[part] && EXPRESSION_NAMES.includes(name)
    ? [`expressions/${part}/${name}.png`] : [];
}
