// controller.js — поведение маскота. Не рисует и не знает про DOM.
//
// Три независимых слоя решения:
//   рабочее состояние  — idle / listening / processing / done / error / sleep / waking;
//   краткая реакция    — клик, раздражение, успокоение, «заметил курсор», жест;
//   внимание           — Attention (reaction > event > cursor > calm).
// Поза вычисляется каждый кадр заново: manual > reaction > state. Поэтому когда
// реакция заканчивается, показывается актуальное состояние, а не сохранённое.
//
// Время идёт только через update(dt) → Scheduler; все отложенные шаги разложены
// по группам ('state', 'reaction', 'scenario') и отменяются одним вызовом.
//
// Единый вход событий: dispatch({ type, target? }). target — точка {x, y}
// в координатах портрета (0..1024) или имя карточки ('record' | 'result' | 'error').
// Перевод из координат страницы делает main.js.

import { Face, poseForEmotion, poseForBridge, EYE_CENTER, LEVELS } from './face.js';
import { Attention } from './attention.js';
import { Scheduler } from './scheduler.js';
import { ClickTracker } from './clicks.js';
import { mulberry32 } from './rng.js';
import { ClipIndicator } from './indicator.js';
import { HairMotion } from './hair_motion.js';
import { HairPoseScenes } from './hair_poses.js';
import { textToVisemes } from './v2.js';
import { FormantAnalyzer, VowelTracker } from './voice.js';
import { EXPRESSION_POSES } from './expressions.js';
import { IdleLife } from './idlelife.js';

/**
 * Пять выражений из expressions.js используют сгенерированные брови и рты с исходным ригом глаз.
 * Остальные сочетания используют готовые части; рот 'v2:…' — Tier C, effect — Tier E.
 */
export const EXTRA_POSES = {
  ...EXPRESSION_POSES,
  surprised_open: { eyes: 'neutral', brows: 'cheerful', cheeks: 'neutral', mouth: 'v2:neutral/open_wide', label: 'удивление, рот открыт' },
  excited_stars: { eyes: 'cheerful', brows: 'cheerful', cheeks: 'cheerful', mouth: 'v2:kind/open_mid', effect: 'eye_stars', label: 'восторг, звёзды в глазах' },
  laugh_teeth: { eyes: 'laugh', level: 3, brows: 'laugh', cheeks: 'v2:blush_soft', mouth: 'v2:kind/smile_teeth', label: 'смех с зубками' },
  pout_bashful: { eyes: 'bashful', brows: 'bashful', cheeks: 'v2:blush_dense', mouth: 'v2:neutral/pout', label: 'надулась, смущённо' },
  confused: { eyes: 'worried', brows: 'worried', cheeks: 'neutral', mouth: 'v2:neutral/pout', effect: 'question', label: 'замешательство' },
  sad_tears: { eyes: 'worried', brows: 'worried', cheeks: 'worried', mouth: 'worried', effect: 'tears', label: 'грусть со слезами' },
  nervous_sweat: { eyes: 'worried', brows: 'worried', cheeks: 'neutral', mouth: 'v2:neutral/open_small', effect: 'sweat_drop', label: 'неловко, капля пота' },
  sleepy_zz: { eyes: 'sleepy', level: 3, brows: 'sleepy', cheeks: 'sleepy', mouth: 'sleepy', effect: 'sleep_zz', label: 'дремлет, «Zz»' },
  love: { eyes: 'laugh', level: 3, brows: 'bashful', cheeks: 'v2:blush_strong', mouth: 'kind', effect: 'heart', label: 'нравится, сердечко' },
};
const KIND_MOUTHS = new Set(['kind', 'cheerful', 'bashful', 'laugh']);

export const APP_EVENTS = ['idle', 'listening', 'processing', 'done', 'error', 'sleep', 'wake'];
export const INPUT_EVENTS = ['pointer.move', 'pointer.leave', 'pointer.click', 'hotkey'];
// Статус заколки: не меняет рабочее состояние, держится до status.clear
export const STATUS_EVENTS = ['status.warning', 'status.loading', 'status.clear'];

// Приоритет кратких реакций: error (5) > done (4) > раздражение (3) > клик/наведение (2) > жест (1).
// done и error — состояния, они блокируют реакции ниже себя на время своей активной фазы.
const PRIORITY = { gesture: 1, mood: 1, click: 2, notice: 2, pet: 2, anticipate: 2, celebrate: 2, irritation: 3, composure: 3, greet: 3, grab: 3 };
const LOCK = { waking: 3, done: 4, error: 5 };

// Позы рабочих состояний. eyes: 'tracking' — базовые глаза с подвижной радужкой.
const STATE_POSES = {
  idle:        { eyes: 'tracking', brows: 'neutral', cheeks: 'neutral', mouth: 'neutral', label: 'покой (tracking)' },
  listening:   { eyes: 'tracking', brows: 'neutral', cheeks: 'neutral', mouth: 'kind', label: 'слушает (tracking + kind mouth)' },
  processing:  { eyes: 'tracking', brows: 'kind', cheeks: 'neutral', mouth: 'sleepy', label: 'обрабатывает (tracking + kind brows + sleepy mouth)' },
  done:        { eyes: 'tracking', brows: 'kind', cheeks: 'kind', mouth: 'kind', label: 'готово (tracking + kind)' },
  errorGlance: { eyes: 'tracking', brows: 'worried', cheeks: 'worried', mouth: 'worried', label: 'ошибка: взгляд на карточку (tracking + worried)' },
  asleep:      { eyes: 'sleepy', level: 3, brows: 'sleepy', cheeks: 'sleepy', mouth: 'sleepy', label: 'сон (sleepy closed)' },
};

// Обычный клик: короткая улыбка или удивление. Глаза остаются tracking, чтобы
// взгляд на место клика был виден; брови/румянец/рот берутся из эмоции-образца.
const CLICK_VARIANTS = ['kind_smile', 'bright_smile', 'surprised'];

const STATE_LABELS = {
  idle: 'Покой', listening: 'Слушает', processing: 'Обрабатывает', done: 'Готово',
  error: 'Ошибка', sleep: 'Сон', waking: 'Вернулся',
};

export class Controller {
  /**
   * @param {object} o
   * @param {object} o.settings  изменяемая копия DEFAULTS (config.js)
   * @param {object} o.data      { emotionByName, framesByName, bridgeByName } из assets.js
   * @param {object} [o.ascii]   AsciiHair или null (тесты)
   */
  constructor({ settings, data, ascii = null }) {
    this.settings = settings;
    this.data = data;
    this.ascii = ascii;
    this.sched = new Scheduler();
    this.face = new Face({
      stagesMs: settings.blink.stagesMs,
      preCenterMs: settings.gaze.preCenterMs,
      closedHoldMs: settings.transitions.closedHoldMs,
      partFadeMs: settings.transitions.partFadeMs,
    });
    this.attention = new Attention(settings.gaze);
    this.clicks = new ClickTracker(settings.clicks);
    this.indicator = new ClipIndicator(settings.indicator);
    this.hair = data.hairFrames ? new HairMotion(data.hairFrames.meta, settings.hair) : null;
    this.poses = data.hairPoses ? new HairPoseScenes(data.hairPoses.meta, settings.poses) : null;
    this.reducedMotion = false; // выставляет main.js каждый кадр
    this.cards = {};
    this.cursor = null;
    this.voice = { level: 0, floor: 1, peak: 0, env: 0, at: -1e9, pcmAt: -1e9, shape: 'closed', since: 0, vowel: 0, voiced: false, info: null, loudAt: -1e9 }; // рот в такт голосу (voice.level / voice.pcm)
    this.formants = new FormantAnalyzer();
    this.vowels = new VowelTracker();
    this.cursorMovedAt = 0;
    this.cursorIdleCleared = false; // взгляд уже отпущен: курсор стоит дольше gaze.cursorIdleMs
    this.log = [];
    this.idle = new IdleLife(this);
    this.reset();
  }

  get now() { return this.sched.now; }

  // ───────────────────────────────────────────────────────── настройки ──

  setSettings(s) {
    this.settings = s;
    this.face.configure({
      stagesMs: s.blink.stagesMs,
      preCenterMs: s.gaze.preCenterMs,
      closedHoldMs: s.transitions.closedHoldMs,
      partFadeMs: s.transitions.partFadeMs,
    });
    this.attention.setSettings(s.gaze);
    this.clicks.setSettings(s.clicks);
    this.indicator.setSettings(s.indicator);
    if (this.hair) this.hair.setSettings(s.hair);
    if (this.poses) this.poses.setSettings(s.poses);
    if (this.ascii) this.ascii.setSettings(s.ascii);
  }

  /** Карточки-мишени в координатах портрета: { record, result, error } → {x, y}. */
  setCards(cards) { this.cards = { ...cards }; }

  /** Полный сброс: отменяет все отложенные шаги, реакции, сценарий и ручной режим. */
  reset() {
    this.sched.clear();
    this.rng = mulberry32(this.settings.seed);
    this.state = 'idle';
    this.phase = '';
    this.stateSince = this.now;
    this.lockUntil = 0;
    this.lockPriority = 0;
    this.reaction = null;
    this.manual = null;
    this.scenario = false;
    this.sleepAuto = false;
    this.near = false;
    this.lastNoticeAt = -Infinity;
    this.lastInputAt = this.now;
    this.lastCursor = this.cursor;
    this.pendingDouble = false;
    this.doubleNow = false;
    this.blinksStarted = 0;
    this.blush = this.settings.blush.restAlpha;
    this.blushBump = 0;
    this.speech = null;
    this.effects = []; // [{ name, a, t, on }]
    this.face.mouthOverride = null;
    this.nearSince = null;
    this.errorStreak = 0;
    this.lastErrorAt = -Infinity;
    this.lastProcessingMs = 0;
    this.lastShyAt = -Infinity;
    this.nextMoodAt = this.now + this.rng.range(this.settings.moods.idleMinMs, this.settings.moods.idleMaxMs);
    this.clicks.reset();
    this.attention.reset();
    this.indicator.reset();
    if (this.hair) this.hair.reset();
    if (this.poses) this.poses.reset();
    this.eventCard = null;
    this.petTrack = null;
    if (this.cursor) { this.attention.set('cursor', this.cursor, { label: 'курсор' }); this.cursorMovedAt = this.now; this.cursorIdleCleared = false; }
    this.face.setPose(STATE_POSES.idle, { instant: true });
    this.seenBlinks = this.face.eyes.blinkCount;
    this.idle.reset();
    this.nextBlinkAt = this.now + this._blinkInterval();
    if (this.ascii) {
      this.ascii.setSeed(this.settings.seed);
      this.ascii.reset();
      this.ascii.setMode('idle');
    }
    this._log('сброс');
  }

  // ───────────────────────────────────────────────────── вход событий ──

  /** Единый вход: { type, target? }. Возвращает true, если событие принято. */
  dispatch(ev) {
    if (!ev || typeof ev.type !== 'string') return false;
    const target = this._resolveTarget(ev.target);
    switch (ev.type) {
      case 'pointer.move': return this._onPointerMove(target);
      case 'pointer.leave': return this._onPointerLeave();
      case 'pointer.click': return this._onClick(target);
      case 'hotkey': return this._onHotkey();
      case 'status.warning': this.indicator.setStatus('warning'); this._log('заколка: предупреждение'); return true;
      case 'status.loading': this.indicator.setStatus('loading'); this._log('заколка: загрузка модели'); return true;
      case 'status.clear': this.indicator.setStatus(null); this._log('заколка: статус снят'); return true;
      case 'reset': this.reset(); return true;
      case 'speech': return this.speak(ev.text);
      case 'silence': return this._onSilence();
      case 'anticipate': return this._onAnticipate();
      case 'speech.stop': this.stopSpeech(); return true;
      case 'greet': return this._onGreet(target, ev.text === 'bye');
      case 'move': return this.poses ? this.poses.move(Number(ev.vx)) : false; // скорость перемещения окна, px/с (+ вправо)
      case 'breeze': return this.poses ? this.poses.gust(ev.side) : false;       // порыв ветерка: side left|right|auto
      case 'drag.start': return this._onDragStart();
      case 'drag.end': return this._onDragEnd();
      case 'voice.level': return this.setVoiceLevel(ev.level);
      case 'voice.pcm': return this.pushVoicePcm(ev.pcm);
      case 'speech.append': return this.appendSpeech(ev.text);
      case 'emotion': {
        const pose = Object.hasOwn(EXPRESSION_POSES, ev.name) ? EXPRESSION_POSES[ev.name] : null;
        return !!pose && this.settings.moods.enabled && this._startReaction('mood', {
          pose: { ...pose }, ms: this.settings.moods.idleMoodMs,
        });
      }
      default: break;
    }
    if (!APP_EVENTS.includes(ev.type)) return false;
    if (this.scenario) this._stopScenario('прерван событием');
    this._enter(ev.type, target, 'событие');
    return true;
  }

  _resolveTarget(t) {
    if (typeof t === 'string') return this.cards[t] ? { ...this.cards[t], label: `карточка ${t}` } : null;
    if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y, label: t.label || 'точка' };
    return null;
  }

  _card(name) {
    const c = this.cards[name];
    return c ? { x: c.x, y: c.y, label: `карточка ${name}`, card: name } : null;
  }

  // ────────────────────────────────────────────── рабочие состояния ──

  _enter(type, target = null, why = '') {
    const b = this.settings.behavior;
    const prevState = this.state, prevMs = this.now - this.stateSince;
    if (prevState === 'processing') this.lastProcessingMs = prevMs;
    this.sched.cancelGroup('state');
    this.attention.clear('event');
    // Красные ASCII-символы и заколка держатся, пока ошибка не решена: любое новое событие запускает возврат
    if (this.ascii) this.ascii.setAlert(type === 'error');
    this.indicator.setError(type === 'error');
    // Новое состояние завершает рабочую мимику; прямое взаимодействие с пользователем сохраняется.
    if (this.reaction && ['idle', 'listening', 'processing'].includes(type)
      && ['mood', 'gesture', 'anticipate', 'notice', 'celebrate'].includes(this.reaction.kind)) this._endReaction();
    this.lockUntil = 0;
    this.lockPriority = 0;
    this.phase = '';
    this.stateSince = this.now;
    this.sleepAuto = false; // автосон выставляет флаг сам, после входа

    switch (type) {
      case 'idle':
        this.state = 'idle';
        this._ascii('idle');
        break;

      case 'listening': {
        this.state = 'listening';
        this._ascii('listening');
        this._eventGaze(target || this._card('record'), b.listeningCardGazeMs);
        break;
      }

      case 'processing':
        this.state = 'processing';
        this._ascii('processing');
        this._scheduleGlance();
        this._scheduleGesture();
        break;

      case 'done': {
        this._endReaction();
        this.state = 'done';
        this._lock(LOCK.done, b.doneToIdleMs);
        if (this.ascii) this.ascii.triggerWave();
        this.indicator.flashSuccess();
        // Взгляд — туда, куда ушёл текст (курсор ввода), иначе на карточку результата
        const result = target || (b.doneLookAtCaret && this._card('caret')) || this._card('result');
        this.phase = 'result';
        this._eventGaze(result, b.doneResultGazeMs, () => {
          this.phase = 'cursor';
          const c = this.lastCursor;
          if (c) this._eventGaze({ x: c.x, y: c.y, label: 'последний курсор' }, b.doneCursorGazeMs);
        });
        if (this.settings.speech.sayOnDone) this.speak(this.settings.speech.sayOnDone);
        this.sched.after(b.doneToIdleMs, () => {
          if (b.doneRelief) {
            this.phase = 'relief';
            this.sched.after(b.reliefMs, () => this._enter('idle', null, 'после готово'), 'state');
          } else {
            this._enter('idle', null, 'после готово');
            this._celebrate();
          }
        }, 'state');
        break;
      }

      case 'error': {
        this._endReaction();
        this.errorStreak = this.now - this.lastErrorAt <= this.settings.moods.errorStreakMs ? this.errorStreak + 1 : 1;
        this.lastErrorAt = this.now;
        this.state = 'error';
        this.phase = 'glance';
        this._lock(LOCK.error, b.errorCardGazeMs);
        if (this.ascii) this.ascii.triggerStall();
        if (this.settings.speech.sayOnError) this.speak(this.settings.speech.sayOnError);
        this._eventGaze(target || this._card('error'), b.errorCardGazeMs, () => { this.phase = 'worried'; });
        break;
      }

      case 'sleep':
        this._endReaction();
        this.stopSpeech();
        this.state = 'sleep';
        this.phase = 'onset';
        this._ascii('sleep');
        this.sched.after(b.sleepOnsetMs, () => { this.phase = 'asleep'; }, 'state');
        break;

      case 'wake':
        this._endReaction();
        this.state = 'waking';
        this.phase = 'bridge';
        this._lock(LOCK.waking, b.wakeBridgeMs);
        this._ascii('idle');
        this.sched.after(b.wakeBridgeMs, () => {
          this.phase = 'look';
          const c = this.cursor || this.lastCursor;
          if (c) this._eventGaze({ x: c.x, y: c.y, label: 'курсор после пробуждения' }, b.wakeCursorMs);
          this.sched.after(b.wakeCursorMs, () => this._enter('idle', null, 'после пробуждения'), 'state');
        }, 'state');
        break;

      default: return;
    }
    this._log(`${STATE_LABELS[this.state]}${why ? ` (${why})` : ''}`);
  }

  _lock(priority, ms) { this.lockPriority = priority; this.lockUntil = this.now + ms; }
  _stateLock() { return this.now < this.lockUntil ? this.lockPriority : 0; }

  _ascii(mode) { if (this.ascii) this.ascii.setMode(mode); }

  /** Взгляд-событие на ms, затем then(). Всё в группе 'state'. Карточка отслеживается каждый кадр. */
  _eventGaze(point, ms, then) {
    this.eventCard = point && point.card ? point.card : null;
    if (point) this.attention.set('event', point, { label: point.label || 'событие' });
    this.sched.after(ms, () => {
      this.attention.clear('event');
      this.eventCard = null;
      if (then) then();
    }, 'state');
  }

  _scheduleGlance() {
    const b = this.settings.behavior;
    this.sched.after(this.rng.range(b.processingGlanceMinMs, b.processingGlanceMaxMs), () => {
      const card = this._card('record');
      if (card) {
        this.attention.set('event', card, { label: card.label });
        this.sched.after(b.processingGlanceMs, () => this.attention.clear('event'), 'state');
      }
      this._scheduleGlance();
    }, 'state');
  }

  _scheduleGesture() {
    const b = this.settings.behavior;
    this.sched.after(this.rng.range(b.processingGestureMinMs, b.processingGestureMaxMs), () => {
      const m = this.settings.moods, long = this.now - this.stateSince;
      // жест: задумчивость; при долгой обработке — сосредоточенность / решимость, совсем долго — усталость
      const pool = ['thinking'];
      if (m.enabled && long >= m.longProcessingMs) pool.push('focused', 'determined');
      if (m.enabled && long >= m.tiredProcessingMs) pool.push('tired_neutral');
      const pick = pool[Math.floor(this.rng() * pool.length)];
      if (pick === 'thinking') {
        const br = this.data.bridgeByName.get('thinking');
        if (br) this._startReaction('gesture', { pose: { ...poseForBridge(br), label: 'жест: bridge thinking' }, ms: b.gestureMs });
      } else {
        this._startReaction('gesture', { pose: this._emotionPose(pick, `обработка: ${pick}`), ms: b.gestureMs + 400 });
      }
      this._scheduleGesture();
    }, 'state');
  }

  // ─────────────────────────────────────────────────────── реакции ──

  _canReact(kind) {
    if (this.manual) return false;
    const p = PRIORITY[kind];
    if (this.reaction && PRIORITY[this.reaction.kind] > p) return false;
    if (this._stateLock() >= p) return false;
    if (this.state === 'sleep') return false;
    return true;
  }

  /** Запускает реакцию, если позволяет приоритет. Без очереди: отказ = реакция просто не случается. */
  _startReaction(kind, { pose, ms, gaze = null, onEnd = null }) {
    if (!this._canReact(kind)) return false;
    this.sched.cancelGroup('reaction');
    this.attention.clear('reaction');
    this.reaction = { kind, pose, since: this.now, until: this.now + ms };
    if (gaze) this.attention.set('reaction', gaze.point, { strength: gaze.strength ?? 1, label: gaze.label || kind });
    this.sched.after(ms, () => (onEnd ? onEnd() : this._endReaction()), 'reaction');
    this._log(`реакция: ${pose.label || kind}`);
    return true;
  }

  _endReaction() {
    this.sched.cancelGroup('reaction');
    this.attention.clear('reaction');
    this.reaction = null;
  }

  _emotionPose(name, label) {
    const e = this.data.emotionByName.get(name);
    return { ...poseForEmotion(e), label: label || name };
  }

  _clickPose(name) {
    if (name === 'oh') return { eyes: 'tracking', brows: 'cheerful', cheeks: 'neutral', mouth: 'v2:neutral/O', label: 'клик: «ой!» (tracking + рот O из v2)' };
    const e = this.data.emotionByName.get(name);
    return { eyes: 'tracking', brows: e.upper_face, cheeks: e.upper_face, mouth: e.mouth, label: `клик: ${name} (tracking + части)` };
  }

  _onClick(point) {
    const c = this.settings.clicks;
    const p = point || { x: EYE_CENTER.x, y: EYE_CENTER.y };
    this.lastInputAt = this.now;
    if (this.hair && !this.reducedMotion && this.settings.hair.triggers?.click !== false) this.hair.click(p);
    if (this.poses && this.settings.hair.triggers?.click !== false) this.poses.click(p);
    if (this.manual) { this._log('клик в ручном режиме — без реакции'); return true; }
    if (this.state === 'sleep') { this._enter('wake', null, 'клик разбудил'); this._ripple(p, 0.6); return true; }

    // Активная фаза «Готово» / «Ошибка» / пробуждения: клик не реагирует и не копится в окнах
    if (this._stateLock() >= PRIORITY.click) { this._log('клик во время события — пропущен'); return true; }

    const kind = this.clicks.register(this.now);
    // Cooldown ограничивает мимику, а волна откликается на каждый клик.
    this._ripple(p, kind === 'angry' || kind === 'annoyed' ? 1 : 0.85);
    if (kind === 'suppressed') { this._log('клик: раздражение уже идёт — без продления'); return true; }

    if (kind === 'angry' || kind === 'annoyed') {
      if (!this._canReact('irritation')) { this._log(`клик: ${kind} заблокирован состоянием`); return true; }
      this.clicks.begin(kind, this.now);
      const angry = kind === 'angry';
      if (this.ascii) this.ascii.triggerShiver(angry ? 1 : 0.6);
      // Сердитый взгляд — в сторону от места клика, ослабленный
      const away = { x: 2 * EYE_CENTER.x - p.x, y: 2 * EYE_CENTER.y - p.y };
      this._startReaction('irritation', {
        pose: angry ? this._emotionPose('fierce_angry', 'раздражение: fierce_angry') : this._emotionPose('annoyed', 'раздражение: annoyed'),
        ms: c.irritationMs,
        gaze: angry
          ? { point: away, strength: c.angryGazeStrength, label: 'в сторону от клика' }
          : { point: p, strength: 1, label: 'клик' },
        onEnd: () => this._startComposure(),
      });
      return true;
    }

    // single
    this.blushBump = this.settings.blush.clickBump;
    // второй клик подряд — «ну-ну»: надулась / хитро / самодовольно (до раздражения ещё один клик)
    if (this.settings.moods.enabled && this.clicks.stats(this.now).inAnnoyedWindow === c.annoyedCount - 1) {
      this._startReaction('click', {
        pose: { ...EXTRA_POSES.playfulness, label: 'второй клик: mischievous (игривость)' }, ms: c.clickReactionMs + 300,
        gaze: { point: p, strength: 1, label: 'место клика' },
      });
      return true;
    }
    const variants = this.data.v2 ? [...CLICK_VARIANTS, 'oh'] : CLICK_VARIANTS;
    const name = variants[Math.floor(this.rng() * variants.length)];
    this._startReaction('click', {
      pose: this._clickPose(name), ms: c.clickReactionMs,
      gaze: { point: p, strength: 1, label: 'место клика' },
    });
    return true;
  }

  _ripple(p, strength) {
    if (this.ascii) this.ascii.triggerRipple(p.x, p.y, strength);
  }

  /** Горячая клавиша диктовки: мгновенно «встрепенулась» (anticipation), ещё до начала записи. */
  _onHotkey() {
    this.lastInputAt = this.now;
    if (this.manual) return true;
    if (this.state === 'sleep') this._enter('wake', null, 'горячая клавиша');
    this._ripple({ x: 512, y: 110 }, 0.6);
    // Глаза остаются базовыми (смена формы глаз идёт через закрытие и съела бы весь отклик):
    // мгновенно меняются брови, румянец и рот — «оживилась», взгляд на пользователя.
    this.blushBump = Math.max(this.blushBump, this.settings.blush.clickBump * 0.6);
    this._startReaction('anticipate', {
      pose: { eyes: 'tracking', brows: 'cheerful', cheeks: 'kind', mouth: 'cheerful', label: 'горячая клавиша: оживилась (tracking + cheerful)' },
      ms: this.settings.behavior.hotkeyMs,
      gaze: { point: { x: EYE_CENTER.x, y: EYE_CENTER.y - 40 }, strength: 1, label: 'на пользователя' },
    });
    return true;
  }

  /** Поглаживание: медленные штрихи туда-сюда над макушкой с разворотами. */
  _updatePet(p) {
    const c = this.settings.pet;
    if (!c.enabled || this.manual) { this.petTrack = null; return; }
    const inZone = ((p.x - c.cx) / c.rx) ** 2 + ((p.y - c.cy) / c.ry) ** 2 <= 1;
    if (!inZone) { this.petTrack = null; return; }
    const now = this.now;
    const t = this.petTrack;
    if (!t) { this.petTrack = { x: p.x, dir: 0, anchorX: p.x, anchorT: now, revs: [] }; return; }
    const dx = p.x - t.x;
    if (Math.abs(dx) < 0.5) return;
    const dir = Math.sign(dx);
    if (t.dir !== 0 && dir !== t.dir) {
      // разворот: прошлый штрих засчитывается, если он достаточно длинный и не слишком быстрый
      const len = Math.abs(t.x - t.anchorX), dur = now - t.anchorT;
      if (len >= c.minStrokePx && dur > 0 && (len / dur) * 1000 <= c.maxSpeedPx) {
        t.revs.push(now);
        this._ripple({ x: t.x, y: p.y }, c.rippleStrength);
      } else t.revs = [];
      t.anchorX = t.x; t.anchorT = now;
    }
    t.dir = dir;
    t.x = p.x;
    t.revs = t.revs.filter((r) => now - r <= c.windowMs);
    if (t.revs.length >= c.reversals) this._pet();
  }

  _pet() {
    const c = this.settings.pet;
    if (this.reaction && this.reaction.kind === 'irritation') { this._log('погладили — успокаивается'); this._startComposure(); return; }
    if (this.reaction && this.reaction.kind === 'pet') {
      // продолжают гладить — просто продлеваем, без очереди; дольше — «нравится» с сердечком
      if (this.reaction.phase === 'shy' && this.now - this.reaction.since >= this.settings.moods.petLoveAfterMs) {
        this.reaction.phase = 'love';
        this.reaction.pose = this._petLovePose();
      }
      this.lastShyAt = this.now;
      this.sched.cancelGroup('reaction');
      this.reaction.until = this.now + c.holdMs;
      this.sched.after(c.holdMs, () => this._endReaction(), 'reaction');
      return;
    }
    const shy = this.settings.moods.enabled;
    this.lastShyAt = this.now; // поглаживание уже смущение — «долгое внимание» сразу не повторяем
    if (this._startReaction('pet', {
      pose: shy
        ? { eyes: 'bashful', brows: 'bashful', cheeks: this.data.v2 ? 'v2:blush_dense' : 'bashful', mouth: 'bashful', label: 'гладят: смущается' }
        : this._petLovePose(),
      ms: c.holdMs,
    })) this.reaction.phase = shy ? 'shy' : 'love';
  }

  _petLovePose() {
    return { eyes: 'laugh', level: 3, brows: 'bashful', cheeks: this.data.v2 ? 'v2:blush_strong' : 'bashful', mouth: 'kind', effect: 'heart', label: 'гладят: жмурится, сердечко' };
  }

  /** Радость после «Готово» (уже в покое): после долгой обработки — восторг со звёздами. */
  _celebrate() {
    const m = this.settings.moods;
    if (!m.enabled || !m.celebrate) return;
    let pose;
    if (this.lastProcessingMs >= m.longProcessingMs) pose = { ...EXTRA_POSES.relief, label: 'готово после долгой обработки: облегчение' };
    else {
      const name = ['joyful', 'excited', 'laughing', 'bright_smile'][Math.floor(this.rng() * 4)];
      pose = this._emotionPose(name, `готово: ${name}`);
    }
    this._startReaction('celebrate', { pose, ms: m.celebrateMs });
  }

  /**
   * Маскота взяли и тянут (событие drag.start): сначала «ой!» от неожиданности, пока несут — смеётся, как на
   * аттракционе. drag.end: отпустили — довольная улыбка, затем покой.
   */
  _onDragStart() {
    const surprised = this.data.v2 ? { ...EXTRA_POSES.surprised_open, label: 'подняли: «ой!»' } : { ...this._clickPose('oh') };
    const carried = this.data.v2 ? { ...EXTRA_POSES.laugh_teeth, label: 'несут: смеётся' } : this._emotionPose('laughing', 'несут: смеётся');
    return this._startReaction('grab', {
      pose: surprised,
      ms: 450,
      onEnd: () => {
        this.reaction = null;
        this._startReaction('grab', { pose: carried, ms: 120000 }); // держится, пока не придёт drag.end
      },
    });
  }

  _onDragEnd() {
    if (!this.reaction || this.reaction.kind !== 'grab') return false;
    this._endReaction();
    return this._startReaction('celebrate', { pose: this._emotionPose('bright_smile', 'отпустили: довольна'), ms: 900 });
  }

  /**
   * Приветствие/прощание с кнопкой приложения (значок маскота в боковой панели или «чёлке»): смотрит на значок
   * и улыбается; приходя (hello) — с искорками. target — где значок (портретные координаты, может быть за кадром).
   */
  _onGreet(target, bye = false) {
    const pose = bye
      ? this._emotionPose('joyful', 'прощается со значком')
      : { ...this._emotionPose('bright_smile', 'здоровается со значком'), effect: this.data.v2 ? 'sparkles' : undefined };
    const gaze = target ? { point: { x: target.x, y: target.y }, strength: 1, label: 'значок' } : null;
    return this._startReaction('greet', { pose, ms: bye ? 1000 : 1500, gaze });
  }

  /** Тишина в записи (событие silence): заминка с «?». */
  _onSilence() {
    const br = this.data.bridgeByName.get('hesitation');
    if (!br) return false;
    const pose = this.settings.moods.enabled ? EXTRA_POSES.doubt : { ...poseForBridge(br), effect: 'question' };
    this._startReaction('notice', { pose: { ...pose, label: 'тишина: заминка (hesitation)' }, ms: this.settings.moods.silenceMs });
    return true;
  }

  /** Результат вот-вот будет (событие anticipate): ожидание. */
  _onAnticipate() {
    const br = this.data.bridgeByName.get('anticipation');
    if (!br) return false;
    const pose = this.settings.moods.enabled ? EXTRA_POSES.insight : poseForBridge(br);
    this._startReaction('anticipate', { pose: { ...pose, label: 'ожидание результата (anticipation)' }, ms: this.settings.moods.anticipateMs });
    return true;
  }

  /** Покой: редкая смена настроения, долгое внимание — смущение. Только в покое и без реакций. */
  _updateMoods() {
    const m = this.settings.moods;
    if (!m.enabled || this.manual || this.state !== 'idle' || this.scenario) return;
    if (this.reaction) { this.nextMoodAt = Math.max(this.nextMoodAt, this.now + 3000); return; }
    if (this._drowsy()) return;
    if (this.nearSince != null && this.now - this.nearSince >= m.shyAfterMs && this.now - this.lastShyAt >= m.shyCooldownMs) {
      this.lastShyAt = this.now;
      this._startReaction('notice', {
        pose: { eyes: 'tracking', brows: 'bashful', cheeks: this.data.v2 ? 'v2:blush_dense' : 'bashful', mouth: 'bashful', label: 'долгое внимание: смущается' },
        ms: m.shyMs, gaze: { point: { ...this.cursor }, strength: 1, label: 'курсор рядом' },
      });
      return;
    }
    if (this.now < this.nextMoodAt) return;
    this.nextMoodAt = this.now + this.rng.range(m.idleMinMs, m.idleMaxMs);
    // глаза остаются базовыми (взгляд продолжает работать), меняются брови, румянец и рот
    const pool = [
      { brows: 'neutral', cheeks: 'kind', mouth: 'kind', label: 'настроение: content' },
      { brows: 'kind', cheeks: 'kind', mouth: 'cheerful', label: 'настроение: soft_happy' },
      { brows: 'kind', cheeks: 'neutral', mouth: 'neutral', label: 'настроение: reassuring' },
      { brows: 'bashful', cheeks: 'bashful', mouth: 'kind', label: 'настроение: bashful_soft' },
      { brows: 'worried', cheeks: 'neutral', mouth: 'neutral', label: 'настроение: задумалась' },
    ];
    const p = pool[Math.floor(this.rng() * pool.length)];
    if (this.rng() < 0.15) {
      this._startReaction('mood', { pose: this._emotionPose('deadpan', 'настроение: deadpan'), ms: m.idleMoodMs });
    } else {
      this._startReaction('mood', { pose: { eyes: 'tracking', ...p }, ms: m.idleMoodMs });
    }
  }

  _drowsy() {
    const m = this.settings.moods;
    if (!m.enabled || this.state !== 'idle' || this.manual || this.scenario) return false;
    const left = this.settings.behavior.sleepAfterMs - (this.now - Math.max(this.lastInputAt, this.stateSince));
    return left <= m.drowsyMs;
  }

  /** Румянец: цель по позе/вниманию/состоянию, плавный подъём и спад. */
  _updateBlush(dt, pose) {
    const b = this.settings.blush;
    if (!b.enabled || this.manual) { this.face.blush = 1; return; }
    if (this.cursor && this.near) { if (this.nearSince == null) this.nearSince = this.now; } else this.nearSince = null;
    let target = b.restAlpha;
    if (this.nearSince != null && this.now - this.nearSince >= b.attentionAfterMs && this.state !== 'sleep') target = Math.max(target, b.attentionAlpha);
    if (pose.cheeks === 'bashful') target = Math.max(target, b.bashfulAlpha);
    if (this.reaction && this.reaction.kind === 'irritation') target = Math.max(target, b.irritationAlpha);
    if (this.state === 'sleep') target = Math.min(target, b.sleepAlpha);
    this.blushBump = Math.max(0, this.blushBump - (dt / Math.max(1, b.bumpDecayMs)) * b.clickBump);
    target = Math.min(1, target + this.blushBump);
    const tau = Math.max(1, (target > this.blush ? b.riseMs : b.fallMs) / 3);
    this.blush += (target - this.blush) * (1 - Math.exp(-dt / tau));
    this.face.blush = this.blush;
  }

  _startComposure() {
    const br = this.data.bridgeByName.get('composure');
    const ms = this.settings.clicks.composureMs;
    // Успокоение того же приоритета, что раздражение: заменяет его без очереди.
    this.reaction = null;
    if (!br || !this._startReaction('composure', { pose: { ...poseForBridge(br), label: 'успокоение: bridge composure' }, ms })) this._endReaction();
  }

  _onPointerMove(p) {
    if (!p) return false;
    const prev = this.cursor;
    const moved = !prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1.5;
    const wasReleased = this.cursorIdleCleared;
    this.cursor = { x: p.x, y: p.y };
    this.lastCursor = this.cursor;
    if (moved) this.idle.onCursor(prev, p, wasReleased);
    // gaze.cursorIdleMs > 0: неподвижный курсор взгляд не возвращает, пока его не сдвинут
    if (moved || !this.cursorIdleCleared) this.attention.set('cursor', this.cursor, { label: 'курсор' });
    if (!moved) return true;
    this.cursorMovedAt = this.now;
    this.cursorIdleCleared = false;
    this.lastInputAt = this.now;
    if (this.state !== 'sleep') this._updatePet(this.cursor);
    // Автосон будит любое движение; сон по кнопке имитации — только клик или «Вернулся».
    if (this.state === 'sleep' && this.sleepAuto && !this.manual) this._enter('wake', null, 'курсор разбудил');
    return true;
  }

  _onPointerLeave() {
    this.cursor = null;
    this.petTrack = null;
    this.near = false;
    this.attention.clear('cursor');
    return true;
  }

  /** Курсор не двигался дольше gaze.cursorIdleMs — взгляд плавно возвращается в центр (0 — не возвращать). */
  _updateCursorIdle() {
    const idle = this.settings.gaze.cursorIdleMs;
    if (!(idle > 0) || !this.cursor || this.cursorIdleCleared) return;
    if (this.now - this.cursorMovedAt >= idle) {
      this.cursorIdleCleared = true;
      this.attention.clear('cursor');
    }
  }

  _updateNear() {
    if (!this.cursor) return;
    const b = this.settings.behavior;
    const d = Math.hypot(this.cursor.x - EYE_CENTER.x, this.cursor.y - EYE_CENTER.y) / 1024;
    if (!this.near && d < b.nearEnterFactor) {
      this.near = true;
      if (this.state === 'idle' && !this.reaction && this.now - this.lastNoticeAt >= b.noticeCooldownMs) {
        const br = this.data.bridgeByName.get('attention');
        if (br && this._startReaction('notice', {
          pose: { ...(this.settings.moods.enabled ? EXTRA_POSES.curiosity : poseForBridge(br)), label: 'заметил курсор: любопытство (attention)' }, ms: b.noticeMs,
          gaze: { point: { ...this.cursor }, strength: 1, label: 'курсор рядом' },
        })) this.lastNoticeAt = this.now;
      }
    } else if (this.near && d > b.nearExitFactor) {
      this.near = false;
    }
  }

  _updateSleepTimer() {
    // фоновые настроения (приоритет 1) сну не мешают
    if (this.state !== 'idle' || this.manual || this.scenario) return;
    if (this.reaction && PRIORITY[this.reaction.kind] > 1) return;
    const since = Math.max(this.lastInputAt, this.stateSince);
    if (this.now - since >= this.settings.behavior.sleepAfterMs) {
      this._enter('sleep', null, `нет ввода ${Math.round(this.settings.behavior.sleepAfterMs / 1000)} s`);
      this.sleepAuto = true;
    }
  }

  // ──────────────────────────────────────────────────────── моргание ──

  _blinkInterval() {
    const b = this.settings.blink;
    // интервал берётся из основного потока как раньше; «по ситуации» только масштабирует его
    return this.rng.range(b.minIntervalMs, b.maxIntervalMs) * this.idle.blinkPlan().intervalMul;
  }

  _updateBlink() {
    const bs = this.settings.blink;
    const eyes = this.face.eyes;
    if (eyes.blinkCount !== this.seenBlinks) {
      this.seenBlinks = eyes.blinkCount;
      if (this.pendingDouble) {
        this.pendingDouble = false;
        this.doubleNow = true;
        this.nextBlinkAt = this.now + bs.doubleGapMs;
      }
    }
    if (this.now < this.nextBlinkAt) return;
    if (!bs.enabled || this.manual) { this.doubleNow = false; this.nextBlinkAt = this.now + this._blinkInterval(); return; }
    if (!eyes.canBlink()) {
      // Глаза заняты (переход, закрытая поза, laugh). Двойное не откладываем — просто пропускаем.
      if (this.doubleNow) { this.doubleNow = false; this.nextBlinkAt = this.now + this._blinkInterval(); }
      else this.nextBlinkAt = this.now + 250;
      return;
    }
    eyes.requestBlink(this.idle.blinkPlan().scale);
    this.blinksStarted++;
    if (this.doubleNow) this.doubleNow = false;
    else this.pendingDouble = this.rng.chance(bs.doubleChance);
    this.nextBlinkAt = this.now + this._blinkInterval();
  }

  /** Кнопка «одно моргание». false — если сейчас глаза закрыты/в переходе/laugh. */
  blinkOnce() {
    const ok = this.face.eyes.requestBlink();
    this._log(ok ? 'моргание по кнопке' : 'моргание невозможно: глаза закрыты, в переходе или laugh');
    return ok;
  }

  // ───────────────────────────────────────────────────── ручной режим ──

  setManualEmotion(name, { reference = this.manual?.reference || false } = {}) {
    const e = this.data.emotionByName.get(name);
    if (!e) return false;
    const level = e.upper_face === 'laugh' ? 3 : (this.manual?.kind === 'emotion' ? this.manual.level : 0);
    this.manual = { kind: 'emotion', name, reference, level };
    this._endReaction();
    this._log(`ручной: ${name}`);
    return true;
  }

  setManualBridge(name, { reference = this.manual?.reference || false } = {}) {
    const b = this.data.bridgeByName.get(name);
    if (!b) return false;
    this.manual = { kind: 'bridge', name, reference, level: b.blink ? LEVELS.indexOf(b.blink) : 0 };
    this._endReaction();
    this._log(`ручной bridge: ${name}`);
    return true;
  }

  /** Новое выражение из сочетаний (EXTRA_POSES); нужен принятый mascot_v2. */
  setManualExtra(name) {
    if (!EXTRA_POSES[name] || !this.data.v2) return false;
    this.manual = { kind: 'extra', name, reference: false, level: EXTRA_POSES[name].level || 0 };
    this._endReaction();
    this._log(`ручной: сочетание ${name}`);
    return true;
  }

  /** Стадия 0..3 (open, closing_35, closing_70, closed) для ручной эмоции. */
  setManualLevel(level) {
    const m = this.manual;
    if (!m || m.kind !== 'emotion') return false;
    const e = this.data.emotionByName.get(m.name);
    m.level = e.upper_face === 'laugh' ? 3 : Math.max(0, Math.min(3, level | 0));
    return true;
  }

  setManualReference(on) { if (this.manual) this.manual.reference = !!on; }

  exitManual() {
    if (!this.manual) return;
    this.manual = null;
    this.lastInputAt = this.now;
    this._log('выход из ручного режима');
  }

  _manualPose() {
    const m = this.manual;
    if (m.kind === 'extra') return { ...EXTRA_POSES[m.name], label: `ручной: ${EXTRA_POSES[m.name].label}` };
    if (m.kind === 'emotion') {
      const e = this.data.emotionByName.get(m.name);
      return { ...poseForEmotion(e), level: e.upper_face === 'laugh' ? 3 : m.level, label: `ручной: ${m.name}` };
    }
    const b = this.data.bridgeByName.get(m.name);
    return { ...poseForBridge(b), label: `ручной bridge: ${m.name}` };
  }

  /** Путь эталонного полного оверлея для ручного режима «эталоном», иначе null. */
  referencePath() {
    const m = this.manual;
    if (!m || !m.reference || m.kind === 'extra') return null;
    if (m.kind === 'bridge') return this.data.bridgeByName.get(m.name).file;
    const e = this.data.emotionByName.get(m.name);
    const stage = LEVELS[m.level];
    if (stage === 'open' || e.upper_face === 'laugh') return e.file;
    const fr = this.data.framesByName.get(m.name);
    return fr && fr.frames ? fr.frames[stage] : e.file;
  }

  // ──────────────────────────────────────────────────── автосценарий ──

  startScenario() {
    this._stopScenario();
    this.manual = null;
    const sc = this.settings.scenario;
    this.scenario = true;
    this._enter('idle', null, 'автосценарий');
    this.sched.after(Math.max(0, sc.idleMs - this.settings.behavior.hotkeyLeadMs), () => {
      this._onHotkey();
    }, 'scenario');
    this.sched.after(sc.idleMs, () => {
      this._enter('listening', null, 'автосценарий');
      this.sched.after(sc.listeningMs, () => {
        this._enter('processing', null, 'автосценарий');
        this.sched.after(Math.max(0, sc.processingMs - this.settings.moods.anticipateMs), () => this._onAnticipate(), 'scenario');
        this.sched.after(sc.processingMs, () => {
          this.scenario = false;
          this._enter('done', null, 'автосценарий');
        }, 'scenario');
      }, 'scenario');
    }, 'scenario');
  }

  _stopScenario(why) {
    if (this.scenario && why) this._log(`автосценарий ${why}`);
    this.sched.cancelGroup('scenario');
    this.scenario = false;
  }

  stopScenario() { this._stopScenario('остановлен'); }

  // ─────────────────────────────────────────────────────────── кадр ──

  currentPose() {
    if (this.manual) return this._manualPose();
    if (this.reaction) return this.reaction.pose;
    return this._statePose();
  }

  _statePose() {
    switch (this.state) {
      case 'listening': return STATE_POSES.listening;
      case 'processing': return STATE_POSES.processing;
      case 'done':
        if (this.phase === 'relief') return this._bridgePose('relief');
        return STATE_POSES.done;
      case 'error': {
        if (this.phase === 'glance') return STATE_POSES.errorGlance;
        const m = this.settings.moods;
        if (m.enabled && this.errorStreak >= 3) {
          return this.data.v2 ? { ...EXTRA_POSES.sad_tears, label: 'ошибка снова: слёзы' } : this._emotionPose('panic', 'ошибка снова: panic');
        }
        if (m.enabled && this.errorStreak === 2) return this._emotionPose('nervous', 'вторая ошибка подряд: nervous');
        if (m.enabled && this.now - this.stateSince >= m.errorSadAfterMs) return this._emotionPose('sad_quiet', 'ошибка: грустно');
        return this._emotionPose('worried', 'ошибка: worried');
      }
      case 'sleep':
        return this.phase === 'onset' ? this._bridgePose('sleep_onset') : STATE_POSES.asleep;
      case 'waking':
        return this.phase === 'bridge' ? this._bridgePose('wake_up') : STATE_POSES.idle;
      default:
        if (this._drowsy()) return this._emotionPose('sleepy', 'клюёт носом перед сном');
        return STATE_POSES.idle;
    }
  }

  _bridgePose(name) {
    return { ...poseForBridge(this.data.bridgeByName.get(name)), label: `bridge ${name}` };
  }

  /** Один шаг логики. dt ограничен 100 ms: после паузы ничего не «догоняется». */
  update(dt) {
    dt = Math.max(0, Math.min(dt, 100));
    this.sched.advance(dt);
    // Взгляд на карточку следит за её текущим положением (курсор ввода сдвигается после вставки текста)
    if (this.eventCard && this.attention.has('event') && this.cards[this.eventCard]) {
      const c = this.cards[this.eventCard];
      this.attention.set('event', c, { label: `карточка ${this.eventCard}` });
    }
    this._updateSleepTimer();
    this._updateCursorIdle();
    this._updateNear();
    this._updateBlink();
    this._updateMoods();
    this.idle.update(dt);
    const pose = this.currentPose();
    this._updateBlush(dt, pose);
    this.face.eyeStyle = this.settings.eyes ? this.settings.eyes.style : 'old';
    this.face.setPose(pose);
    this._updateSpeech(dt, pose);
    this._updateEffects(dt, pose);
    this.face.update(dt);
    this.attention.update(dt);
    this.indicator.update(dt, { reducedMotion: this.reducedMotion });
    if (this.hair) this.hair.update(dt, { reducedMotion: this.reducedMotion, asleep: this.state === 'sleep' });
    if (this.poses) this.poses.update(dt, { reducedMotion: this.reducedMotion, asleep: this.state === 'sleep' });
    if (this.ascii) this.ascii.update(dt);
  }

  /** Имя позы волос для рендера или null (нет банка поз / выключено — работает прежний путь). */
  hairPoseName() {
    return this.poses && this.settings.poses.enabled ? this.poses.pose() : null;
  }

  // ──────────────────────────────────────────────── речь и эффекты ──

  /** Говорить текст: рот проходит формы Tier C (гласные / губные / паузы). */
  speak(text) {
    if (!this.data.v2 || !this.settings.speech.enabled) return false;
    const seq = textToVisemes(text, this.settings.speech.rate);
    if (!seq.length) return false;
    this.speech = { seq, i: 0, t: 0, text: String(text) };
    this._log(`говорит: «${String(text).slice(0, 40)}»`);
    return true;
  }

  /** Дописать речь (потоковый ответ): идёт речь — формы добавляются в хвост, иначе — как speak. */
  appendSpeech(text) {
    if (!this.speech) return this.speak(text);
    if (!this.data.v2 || !this.settings.speech.enabled) return false;
    const more = textToVisemes(text, this.settings.speech.rate);
    if (!more.length) return false;
    this.speech.seq.push(...more);
    this.speech.text += String(text);
    return true;
  }

  stopSpeech() {
    this.speech = null;
    this.face.mouthOverride = null;
  }

  /**
   * Громкость голоса пользователя 0..1 (с микрофона, шкала приложения). Рот шевелится в такт слогам,
   * пока идёт запись: абсолютных порогов нет — берётся огибающая относительно фона и пика.
   */
  setVoiceLevel(level) {
    if (!Number.isFinite(level) || !this.settings.speech.voiceEnabled) return false;
    const v = this.voice;
    if (this.now - v.pcmAt < 400) return true; // идёт сам звук — уровень берём из него
    v.level = Math.min(1, Math.max(0, level));
    v.at = this.now;
    return true;
  }

  /**
   * Сам звук с микрофона (Float32Array, 16 кГц, моно): уровень громкости и гласные по формантам.
   * Не зависит от языка: гласные различаются акустически (см. voice.js).
   */
  pushVoicePcm(samples) {
    if (!samples || !samples.length || !this.settings.speech.voiceEnabled) return false;
    const v = this.voice;
    for (const f of this.formants.push(samples)) {
      v.level = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(f.rms, 1e-7)) + 60) / 60)); // та же шкала, что у приложения
      v.at = this.now;
      v.pcmAt = this.now;
      v.voiced = f.voiced;
      this.vowels.push(f);
      v.info = this.vowels.current();
    }
    return true;
  }

  /** Форма рта по голосу: null — голос не слышен (рот по позе). */
  _voiceMouth(dt, pose) {
    const v = this.voice, cfg = this.settings.speech;
    if (this.state !== 'listening' || this.now - v.at > cfg.voiceStaleMs || !this.data.v2) {
      v.floor = 1; v.peak = 0; v.env = 0;
      if (v.info || v.voiced) { this.vowels.reset(); this.formants.reset(); v.info = null; v.voiced = false; }
      return null;
    }
    // Фон: быстро падает вслед за тишиной, медленно ползёт вверх (шум комнаты, дыхание)
    v.floor = Math.min(v.floor, v.level);
    v.floor += 0.00001 * dt; // ~0,01 за секунду
    v.floor = Math.min(v.floor, v.level + 0.02);
    v.peak = Math.max(v.level, v.peak - 0.0002 * dt, v.floor + cfg.voiceMinRange);
    const n = Math.min(1, Math.max(0, (v.level - v.floor - cfg.voiceGate) / (v.peak - v.floor)));
    // Быстро открывается, чуть медленнее закрывается — как настоящий рот на слоге
    const k = 1 - Math.exp(-dt / (n > v.env ? cfg.voiceAttackMs : cfg.voiceReleaseMs));
    v.env += (n - v.env) * k;
    const e = v.env;
    if (e >= 0.10) v.loudAt = this.now;
    // Голоса нет дольше паузы между словами — рот по позе (улыбка/нейтральный), а не «замёрзший» закрытый
    if (e < 0.10 && this.now - (v.loudAt ?? -1e9) > cfg.voicePauseMs) { v.shape = 'closed'; return null; }
    let shape;
    const fresh = this.now - v.pcmAt < 150;
    if (e < 0.10) shape = 'closed';
    else if (fresh) {
      // Есть звук: гласная по формантам, громкость определяет, насколько открыт рот
      const hit = v.voiced && v.info && v.info.conf >= cfg.vowelMinConf ? v.info.vowel : null;
      if (hit) shape = e < 0.2 ? 'open_small' : hit === 'A' && e > 0.7 ? 'open_wide' : hit;
      else shape = e < 0.45 ? 'open_small' : 'open_mid'; // шипящие, согласные: рот приоткрыт
    } else if (e < 0.30) shape = 'open_small';
    else {
      // Открытый рот чередует гласные, иначе он «застывает» одной формой
      const pool = e < 0.6 ? ['E', 'I', 'U', 'open_mid'] : ['A', 'O', 'open_wide', 'A'];
      if (v.shape === 'closed' || v.shape === 'open_small' || this.now - v.since >= cfg.voiceVowelMs) v.vowel = (v.vowel + 1) % pool.length;
      shape = pool[v.vowel % pool.length];
      if (v.shape === shape) return this._mouthPath(shape, pose);
    }
    if (shape !== v.shape) {
      if (this.now - v.since < cfg.voiceMinHoldMs && v.shape !== 'closed') shape = v.shape; // не мелькать
      else { v.shape = shape; v.since = this.now; }
    }
    return this._mouthPath(shape, pose);
  }

  _mouthPath(shape, pose) {
    const mood = KIND_MOUTHS.has(pose.mouth) || String(pose.mouth).startsWith('v2:kind') ? 'kind' : 'neutral';
    return this.data.v2.mouths[mood][shape] || null;
  }

  _updateSpeech(dt, pose) {
    const sp = this.speech;
    if (!sp || this.manual) { this.face.mouthOverride = this.manual ? null : this._voiceMouth(dt, pose); return; }
    sp.t += dt;
    while (sp.i < sp.seq.length && sp.t >= sp.seq[sp.i].ms) { sp.t -= sp.seq[sp.i].ms; sp.i++; }
    if (sp.i >= sp.seq.length) { this.stopSpeech(); return; }
    const mood = KIND_MOUTHS.has(pose.mouth) || String(pose.mouth).startsWith('v2:kind') ? 'kind' : 'neutral';
    this.face.mouthOverride = this.data.v2.mouths[mood][sp.seq[sp.i].v] || null;
  }

  /** Какой эффект Tier E показывать сейчас: поза → реакция → состояние. */
  _wantEffect(pose) {
    const fx = this.settings.effects;
    if (!fx.enabled || !this.data.v2) return null;
    if (pose.effect) return pose.effect;
    if (this.manual) return null;
    if (this.reaction && this.reaction.kind === 'irritation') return 'anger';
    if (this.state === 'error' && (this.errorStreak === 2 || this.now - this.stateSince < fx.errorSweatMs)) return 'sweat_drop';
    if (this.state === 'done') return 'sparkles';
    if (this.state === 'sleep' && this.phase === 'asleep') return 'sleep_zz';
    return null;
  }

  _updateEffects(dt, pose) {
    const want = this._wantEffect(pose);
    const fade = Math.max(1, this.settings.effects.fadeMs);
    if (want && !this.effects.some((e) => e.name === want && e.on)) {
      for (const e of this.effects) e.on = false;
      this.effects.push({ name: want, a: 0, t: 0, on: true });
    }
    for (const e of this.effects) {
      if (e.name !== want) e.on = false;
      e.t += dt;
      e.a = e.on ? Math.min(1, e.a + dt / fade) : Math.max(0, e.a - dt / fade);
    }
    this.effects = this.effects.filter((e) => e.on || e.a > 0);
  }

  // ───────────────────────────────────────────────────── диагностика ──

  _log(text) {
    this.log.push({ t: Math.round(this.now), text });
    if (this.log.length > 40) this.log.shift();
  }

  diagnostics() {
    const pose = this.currentPose();
    return {
      timeMs: Math.round(this.now),
      state: this.state,
      stateLabel: STATE_LABELS[this.state],
      phase: this.phase,
      reaction: this.reaction ? this.reaction.kind : null,
      manual: this.manual ? { ...this.manual } : null,
      pose: pose.label || '',
      attention: this.attention.describe(),
      attentionSource: this.attention.active,
      gazeOffset: { x: +this.attention.offset.x.toFixed(2), y: +this.attention.offset.y.toFixed(2) },
      clicks: this.clicks.stats(this.now),
      face: this.face.snapshot(),
      seed: this.settings.seed,
      timers: this.sched.size,
      blinks: this.face.eyes.blinkCount,
      blush: +this.face.blush.toFixed(2),
      indicator: this.indicator.snapshot(),
      petting: this.petTrack ? this.petTrack.revs.length : 0,
      effects: this.effects.map((e) => `${e.name}×${e.a.toFixed(2)}`),
      voice: this.state === 'listening' && this.now - this.voice.at < 400 ? `${this.voice.info ? `${this.voice.info.vowel} ${Math.round(this.voice.info.conf * 100)}%` : this.voice.voiced ? 'звонкий' : 'шум'} · громкость ${this.voice.level.toFixed(2)} · рот ${this.voice.shape}` : null,
      speech: this.speech ? `${this.speech.seq[this.speech.i]?.v} (${this.speech.i + 1}/${this.speech.seq.length})` : null,
      scenario: this.scenario,
      sleepInMs: this.state === 'idle' && !this.manual && !this.reaction && !this.scenario
        ? Math.max(0, Math.round(this.settings.behavior.sleepAfterMs - (this.now - Math.max(this.lastInputAt, this.stateSince))))
        : null,
      ascii: this.ascii ? this.ascii.stats() : null,
      log: this.log.slice(-10),
    };
  }
}
