// idlelife.js — «жизнь» в покое: микро-саккады, редкие взгляды по сторонам, моргание по ситуации,
// лестница скуки (вздох → зевок → сон) и дыхание по состоянию. Ничего не рисует и не добавляет ассетов:
// двигает взгляд (источник 'calm' у Attention), запускает реакции готовых поз и отдаёт рендереру масштаб
// и сдвиг портрета.
//
// Отдельный ГПСЧ: основной поток контроллера (интервалы морганий и настроений) не сдвигается, поэтому
// поведение остальных сценариев и их тесты не зависят от того, включена ли эта «жизнь».
//
// Приоритеты: всё здесь самое низкое. Курсор, событие, реакция или ручной режим сразу забирают взгляд;
// зевок и вздох — реакции вида 'mood' (приоритет 1), их перебивает любая другая и отменяет возвращение ввода.

import { EYE_CENTER } from './face.js';
import { mulberry32 } from './rng.js';

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export class IdleLife {
  constructor(ctrl) {
    this.c = ctrl;
    this.reset();
  }

  get cfg() { return this.c.settings.idle; }

  reset() {
    const now = this.c.now;
    const cfg = this.cfg;
    this.rng = mulberry32((this.c.settings.seed ^ 0x9e3779b9) >>> 0);
    this.nextSaccadeAt = now + this.rng.range(cfg.saccadeMinMs, cfg.saccadeMaxMs);
    this.nextGlanceAt = now + this.rng.range(cfg.glanceMinMs, cfg.glanceMaxMs);
    this.glanceUntil = 0;
    this.nextSighAt = now + this.rng.range(cfg.sighMinMs, cfg.sighMaxMs);
    this.prevAfk = 0;
    this.sighDone = false;
    this.yawnDone = false;
    this.lastJumpBlinkAt = -Infinity;
    this.body = null;          // { kind: 'sigh' | 'yawn', t0, ms } — огибающая движения корпуса
    this.breathPhase = 0;
    this.owned = false;        // 'calm' выставлен этим модулем
    this.freeSince = null;     // с какого момента ничто не держит взгляд
  }

  // ─────────────────────────────────────────────────── вспомогательное ──

  _afkMs() {
    const c = this.c;
    return c.now - Math.max(c.lastInputAt, c.stateSince);
  }

  /** Можно ли сейчас жить своей жизнью: покой, ничего не занимает лицо. */
  _calm() {
    const c = this.c;
    return this.cfg.enabled && c.state === 'idle' && !c.manual && !c.scenario && !c.speech;
  }

  _mouth(name, fallback) { return this.c.data.v2 ? `v2:${name}` : fallback; }

  _release() {
    if (this.owned) { this.c.attention.clear('calm'); this.owned = false; }
  }

  // ──────────────────────────────────────────────── моргание по ситуации ──

  /** Во сне глаз тяжелеет: моргания чаще и медленнее. */
  blinkPlan() {
    const cfg = this.cfg;
    if (!cfg.enabled || !this.c._drowsy()) return { intervalMul: 1, scale: 1 };
    return { intervalMul: cfg.drowsyBlinkIntervalMul, scale: cfg.drowsyBlinkSlow };
  }

  /** Моргание, начатое «жизнью»: считается как обычное и сдвигает ближайшее автоморгание. */
  _blink(scale = 1) {
    const c = this.c;
    if (!c.settings.blink.enabled || c.manual) return false;
    if (!c.face.eyes.requestBlink(scale)) return false;
    c.blinksStarted++;
    c.nextBlinkAt = Math.max(c.nextBlinkAt, c.now + 1200);
    return true;
  }

  /** Резкий уход взгляда (курсор появился/прыгнул далеко) — моргание «прикрывает» смену. */
  onCursor(prev, next, wasReleased) {
    const cfg = this.cfg, c = this.c;
    if (!cfg.enabled || c.reducedMotion || !next || c.state !== 'idle' || c.manual) return;
    const far = Math.hypot(next.x - EYE_CENTER.x, next.y - EYE_CENTER.y) > cfg.cursorJumpPx * 0.5;
    const jump = prev ? Math.hypot(next.x - prev.x, next.y - prev.y) : 0;
    const appeared = wasReleased || !prev; // взгляд был отпущен или курсора раньше не было вовсе
    if (!((appeared && far) || jump > cfg.cursorJumpPx)) return;
    if (c.now - this.lastJumpBlinkAt < cfg.jumpBlinkCooldownMs) return;
    this.lastJumpBlinkAt = c.now;
    if (this.rng.chance(cfg.blinkOnCursorJump)) this._blink(1);
  }

  // ───────────────────────────────────────────────────────────── кадр ──

  update(dt) {
    const c = this.c, cfg = this.cfg;
    const afk = this._afkMs();
    const newEpisode = afk < this.prevAfk; // ввод сбросил отсчёт: новая «скука»
    this.prevAfk = afk;
    if (newEpisode) {
      this.sighDone = false;
      this.yawnDone = false;
      // зевок и вздох прерываются, как только человек вернулся
      if (c.reaction && c.reaction.idle) c._endReaction();
      this.body = null;
    }
    if (!this._calm()) {
      this._release();
      // вернулись в покой после работы — не вздыхать тут же из-за накопившегося таймера
      if (c.now >= this.nextSighAt) this.nextSighAt = c.now + this.rng.range(10000, 30000);
      return;
    }

    this._gaze(afk);
    this._ladder(afk);
  }

  /** Саккады и взгляды по сторонам — только когда курсор, событие и реакция не держат взгляд. */
  _gaze(afk) {
    const c = this.c, cfg = this.cfg, a = c.attention;
    const free = !c.reaction && !a.has('cursor') && !a.has('event') && !a.has('reaction') && !c.reducedMotion;
    const now = c.now;
    if (!free) { this._release(); this.freeSince = null; return; }
    if (this.freeSince == null) this.freeSince = now;
    // после ухода курсора взгляд сначала плавно возвращается в центр и только потом оживает
    if (!this.owned && now - this.freeSince < cfg.settleMs) return;
    const drowsy = c._drowsy();
    if (this.glanceUntil && now >= this.glanceUntil) {
      this.glanceUntil = 0;
      this.nextSaccadeAt = now + this.rng.range(cfg.saccadeMinMs, cfg.saccadeMaxMs);
      this._saccade(drowsy);
      return;
    }
    if (this.glanceUntil) return; // держит взгляд в сторону
    if (!drowsy && now >= this.nextGlanceAt) {
      this.nextGlanceAt = now + this.rng.range(cfg.glanceMinMs, cfg.glanceMaxMs);
      this._glance();
      return;
    }
    if (now >= this.nextSaccadeAt || !this.owned) {
      this.nextSaccadeAt = now + this.rng.range(cfg.saccadeMinMs, cfg.saccadeMaxMs) * (drowsy ? 1.8 : 1);
      this._saccade(drowsy);
    }
  }

  _saccade(drowsy) {
    const cfg = this.cfg, c = this.c;
    const amp = cfg.saccadeAmpPx * (drowsy ? 0.4 : 1);
    let x = EYE_CENTER.x + this.rng.range(-amp, amp);
    let y = EYE_CENTER.y + this.rng.range(-amp * 0.5, amp * 0.5);
    if (drowsy) y += cfg.drowsyLookDownPx; // тяжёлый взгляд чуть вниз
    c.attention.set('calm', { x, y }, { label: drowsy ? 'сонный дрейф' : 'саккада' });
    this.owned = true;
  }

  /** Короткий взгляд «на что-то»: на карточку, если они заданы, иначе в случайную сторону. */
  _glance() {
    const cfg = this.cfg, c = this.c;
    const cards = Object.values(c.cards || {}).filter((p) => p && Number.isFinite(p.x));
    let p;
    if (cards.length && this.rng.chance(0.35)) {
      p = cards[Math.floor(this.rng() * cards.length)];
    } else {
      const ang = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0.55, 1) * cfg.glanceRadiusPx;
      p = { x: EYE_CENTER.x + Math.cos(ang) * r, y: EYE_CENTER.y + Math.sin(ang) * r * 0.55 };
    }
    // крупный уход взгляда прикрывается морганием
    if (this.rng.chance(cfg.blinkBeforeGlance)) this._blink(1);
    c.attention.set('calm', p, { label: 'осмотрелась' });
    this.owned = true;
    this.glanceUntil = c.now + cfg.glanceMs * this.rng.range(0.7, 1.4);
    c._log('покой: осмотрелась');
  }

  // ───────────────────────────────────────────── лестница скуки, вздох ──

  _ladder(afk) {
    const c = this.c, cfg = this.cfg, b = c.settings.behavior;
    if (!c.settings.moods.enabled) return;
    if (c.reaction && !(c.reaction.kind === 'mood' && !c.reaction.idle)) return;
    const left = b.sleepAfterMs - afk;
    // 35 с без ввода: зевок, после него — сонное лицо до самого сна
    if (cfg.yawn && !this.yawnDone && left <= c.settings.moods.drowsyMs + cfg.yawnLeadMs && left > 1200) {
      this.yawnDone = true;
      this._yawn();
      return;
    }
    if (!cfg.sigh || c._drowsy()) return;
    const episodeSigh = !this.sighDone && afk >= cfg.sighAfkMs;
    if (episodeSigh || c.now >= this.nextSighAt) {
      this.sighDone = this.sighDone || episodeSigh;
      this.nextSighAt = c.now + this.rng.range(cfg.sighMinMs, cfg.sighMaxMs);
      this._sigh();
    }
  }

  _chain(steps) {
    const c = this.c;
    const run = (i) => {
      if (i >= steps.length) { c._endReaction(); return; }
      const s = steps[i];
      const ok = c._startReaction('mood', {
        pose: s.pose, ms: s.ms, onEnd: () => run(i + 1),
      });
      if (ok && c.reaction) c.reaction.idle = true;
    };
    run(0);
  }

  _yawn() {
    const c = this.c, cfg = this.cfg;
    const total = cfg.yawnMs;
    this.body = { kind: 'yawn', t0: c.now, ms: total };
    this._chain([
      { ms: total * 0.25, pose: { eyes: 'sleepy', level: 1, brows: 'neutral', cheeks: 'neutral', mouth: this._mouth('neutral/open_small', 'neutral'), label: 'зевает: вдох' } },
      { ms: total * 0.5, pose: { eyes: 'sleepy', level: 3, brows: 'worried', cheeks: 'neutral', mouth: this._mouth('neutral/open_wide', 'sleepy'), label: 'зевает' } },
      { ms: total * 0.25, pose: { eyes: 'sleepy', level: 2, brows: 'sleepy', cheeks: 'sleepy', mouth: this._mouth('neutral/open_small', 'sleepy'), label: 'зевает: выдох' } },
    ]);
    c._log('покой: зевает');
  }

  _sigh() {
    const c = this.c, cfg = this.cfg;
    const total = cfg.sighMs;
    this.body = { kind: 'sigh', t0: c.now, ms: total };
    this._chain([
      { ms: total * 0.4, pose: { eyes: 'tracking', brows: 'neutral', cheeks: 'neutral', mouth: this._mouth('neutral/open_small', 'neutral'), label: 'вздох: вдох' } },
      { ms: total * 0.6, pose: { eyes: 'tracking', brows: 'sleepy', cheeks: 'neutral', mouth: this._mouth('neutral/open_small', 'sleepy'), label: 'вздох: выдох' } },
    ]);
    // на выдохе веки опускаются медленно
    c.sched.after(total * 0.4, () => { if (c.state === 'idle' && c.reaction && c.reaction.idle) this._blink(cfg.drowsyBlinkSlow); }, 'idlelife');
    c._log('покой: вздохнула');
  }

  // ──────────────────────────────────────────────────────────── дыхание ──

  /** Масштаб портрета и сдвиг вниз (px портрета) для рендера. dt — мс кадра. */
  breath(dt, b, reduced) {
    const c = this.c, cfg = this.cfg;
    if (reduced) return { scale: 1, dy: 0 };
    const asleep = c.state === 'sleep' && c.phase === 'asleep';
    const slow = cfg.enabled && asleep ? cfg.sleepBreathSlow : 1;
    this.breathPhase += dt / Math.max(500, b.periodMs * slow);
    let scale = 1;
    if (b.enabled) scale += b.amplitude * (cfg.enabled && asleep ? 1.25 : 1) * Math.sin(2 * Math.PI * this.breathPhase);
    let dy = 0;
    const body = this.body;
    if (body && cfg.enabled) {
      const t = (c.now - body.t0) / body.ms;
      if (t >= 1) this.body = null;
      else if (body.kind === 'sigh') {
        // вдох поднимает плечи (масштаб растёт), выдох опускает голову
        const up = t < 0.4 ? smooth(t / 0.4) : 1 - smooth((t - 0.4) / 0.6);
        scale += cfg.sighBreathAmp * up;
        dy = cfg.sighDipPx * Math.sin(Math.PI * smooth(t)) ** 2;
      } else {
        // зевок: вдох, затем голова чуть откидывается и оседает
        const up = t < 0.35 ? smooth(t / 0.35) : 1 - smooth((t - 0.35) / 0.65);
        scale += cfg.sighBreathAmp * 1.4 * up;
        dy = cfg.yawnDipPx * Math.sin(Math.PI * smooth(t));
      }
    }
    return { scale, dy };
  }
}
