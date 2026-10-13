// embed.js — маскот для встраивания в приложение (WKWebView): тот же контроллер и рендер,
// что в стенде, но без панели и карточек. Прозрачный фон, холст вписан в окно.
//
// Приложение → маскот: window.mascot.* (координаты — CSS px окна, начало в левом верхнем углу).
// Маскот → приложение: webkit.messageHandlers.mascot.postMessage({type, ...}).
// Параметры адреса: ?fps=30 — предел частоты кадров (по умолчанию 30); ?poseSet=wan|codex|ag — набор поз волос (по умолчанию wan);
// ?legacyHair=1 — грузить и старый векторный банк прядей (по умолчанию нет).
import { loadAssets } from './assets.js';
import { AsciiHair } from './ascii.js';
import { Controller } from './controller.js';
import { Renderer } from './renderer.js';
import { cloneDefaults } from './config.js';

const params = new URLSearchParams(location.search);
const FPS = Math.max(10, Math.min(60, Number(params.get('fps')) || 30));

function post(msg) {
  try { window.webkit?.messageHandlers?.mascot?.postMessage(msg); } catch { /* вне WKWebView */ }
}

async function boot() {
  let assets;
  try {
    assets = await loadAssets({ poseSet: params.get('poseSet') || 'wan', legacyHair: params.get('legacyHair') === '1' });
  } catch (e) {
    const failures = e && e.failures ? e.failures.map((f) => `${f.path}: ${f.reason}`) : [String(e && e.message || e)];
    console.error(e);
    post({ type: 'error', message: failures.join('; ') });
    return;
  }

  const canvas = document.getElementById('portrait');
  const settings = cloneDefaults();
  settings.poses.poseSet = params.get('poseSet') || 'wan';
  settings.gaze.cursorIdleMs = Number(params.get('idle') ?? 1500); // следит, пока мышь двигается; стоит 1,5 с — взгляд в центр
  const ascii = new AsciiHair({ mask: assets.hairMask, maskAlpha: assets.hairMaskAlpha, seed: settings.seed, settings: settings.ascii });
  const controller = new Controller({ settings, data: assets, ascii });
  const renderer = new Renderer(canvas, assets);
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const toPortrait = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? renderer.clientToPortrait(p.x, p.y) : p);
  let active = true;

  function layout() {
    const size = Math.max(40, Math.floor(Math.min(innerWidth, innerHeight)));
    renderer.resize(size, window.devicePixelRatio || 1);
  }
  addEventListener('resize', layout);
  layout();

  // Цели взгляда в координатах окна: {record, result, error, caret}. Их обновляет приложение
  // (например, record — плашка диктовки на экране). Пока не заданы — взгляд перед собой, чуть вниз.
  let targets = {};
  function applyTargets() {
    const fallback = { x: 512, y: 760 };
    const out = {};
    for (const n of ['record', 'result', 'error', 'caret']) out[n] = targets[n] ? renderer.clientToPortrait(targets[n].x, targets[n].y) : fallback;
    controller.setCards(out);
  }

  const api = {
    /** Событие маскота: {type, target?: {x,y} в координатах окна | имя цели, text?}. */
    dispatch(ev) {
      if (!ev) return false;
      if (ev.type === 'done.quiet') {
        // «Готово» без своей фразы: рот уже проговаривал ответ ассистента
        const say = settings.speech.sayOnDone;
        settings.speech.sayOnDone = '';
        try { return controller.dispatch({ type: 'done', target: toPortrait(ev.target) }); } finally { settings.speech.sayOnDone = say; }
      }
      // vx — скорость перемещения окна (pt/с экрана, + вправо) для события move; side — сторона порыва ветерка
      return controller.dispatch({ type: ev.type, name: ev.name, target: toPortrait(ev.target), text: ev.text, level: ev.level, vx: ev.vx, side: ev.side });
    },
    /** Глобальный курсор, пересчитанный в координаты окна (может быть вне окна). Возвращает «над персонажем». */
    pointer(x, y) {
      controller.dispatch({ type: 'pointer.move', target: renderer.clientToPortrait(x, y) });
      return renderer.hitTest(x, y);
    },
    /** Звук с микрофона: base64 от Int16 LE, 16 кГц, моно. Рот шевелится в такт гласным (видимым и записывающим окнам). */
    pcm(b64) {
      const bin = atob(b64);
      const n = bin.length >> 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const lo = bin.charCodeAt(2 * i), hi = bin.charCodeAt(2 * i + 1);
        out[i] = (((hi << 8) | lo) << 16 >> 16) / 32768;
      }
      return controller.pushVoicePcm(out);
    },
    pointerLeave() { return controller.dispatch({ type: 'pointer.leave' }); },
    hitTest(x, y) { return renderer.hitTest(x, y); },
    /** Клик приложения (окно ловит мышь само). Засчитывается только по непрозрачной части. */
    click(x, y) {
      if (!renderer.hitTest(x, y)) return false;
      return controller.dispatch({ type: 'pointer.click', target: renderer.clientToPortrait(x, y) });
    },
    setTargets(t) { targets = { ...targets, ...(t || {}) }; applyTargets(); return true; },
    /** Окно скрыто — цикл останавливается целиком; при показе — без «догоняния» времени. */
    setActive(on) { active = !!on; last = performance.now(); return active; },
    state() { return { state: controller.state, phase: controller.phase }; },
  };
  window.mascot = api;
  window.lab = { assets, controller, renderer, ascii, settings, dispatch: api.dispatch }; // для отладки
  applyTargets();

  let last = performance.now();
  let acc = 0;
  const frameMs = 1000 / FPS;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!active || document.hidden) { last = now; return; }
    acc += now - last;
    last = now;
    // Порог с запасом (85 %): rAF идёт с дрожанием, и «≥ ровно 33 мс» иногда пропускал тик → кадры 33/50 мс вперемешку.
    if (acc < frameMs * 0.85) return;
    const dt = Math.min(100, acc);
    acc = 0;

    if ((window.devicePixelRatio || 1) !== renderer.dpr) layout();
    controller.update(dt);
    const reduced = motionQuery.matches;
    controller.reducedMotion = reduced;
    const b = settings.breath;
    const body = controller.idle.breath(dt, b, reduced);
    renderer.draw({
      list: controller.face.drawList(),
      referencePath: null,
      gaze: controller.attention.offset,
      inwardFactor: settings.gaze.inwardFactor,
      breathScale: body.scale,
      offsetY: body.dy,
      pivotY: b.pivotY,
      ascii: settings.ascii.enabled ? ascii : null,
      asciiOpts: { reducedMotion: reduced },
      indicator: settings.indicator.enabled ? controller.indicator.snapshot() : null,
      effects: controller.effects,
      reducedMotion: reduced,
      hairPose: controller.hairPoseName(),
      hair: !controller.hairPoseName() && settings.hair.enabled && controller.hair ? { frames: controller.hair.frames() } : null,
    });
  }
  // Отладочная телеметрия (?debug=1): раз в 3 с шлёт приложению, как приходят кадры rAF и сколько стоит кадр.
  if (params.get('debug')) {
    const st = { raf: [], draw: [], cost: [], lastRaf: performance.now(), lastDraw: performance.now() };
    const rawDraw = renderer.draw.bind(renderer);
    renderer.draw = (o) => {
      const t = performance.now();
      const r = rawDraw(o);
      st.cost.push(performance.now() - t); st.draw.push(t - st.lastDraw); st.lastDraw = t;
      return r;
    };
    const tick = (now) => { requestAnimationFrame(tick); st.raf.push(now - st.lastRaf); st.lastRaf = now; };
    requestAnimationFrame(tick);
    const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return +(b[Math.min(b.length - 1, Math.floor(b.length * p))] || 0).toFixed(1); };
    setInterval(() => {
      post({ type: 'perf', rafN: st.raf.length, rafMean: q(st.raf, .5), rafP95: q(st.raf, .95), rafMax: q(st.raf, 1),
        drawN: st.draw.length, drawMean: q(st.draw, .5), drawP95: q(st.draw, .95), drawMax: q(st.draw, 1),
        costP50: q(st.cost, .5), costP95: q(st.cost, .95), costMax: q(st.cost, 1), hidden: document.hidden, state: controller.state });
      st.raf.length = 0; st.draw.length = 0; st.cost.length = 0;
    }, 3000);
  }

  requestAnimationFrame(frame);
  post({ type: 'ready' });
}

boot();
