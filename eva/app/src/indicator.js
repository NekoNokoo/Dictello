// indicator.js — «светодиод» заколки: синяя пилюля заколки перекрашивается по статусу.
// Ничего не рисует: выдаёт цвет, силу перекраски и свечение, рендерер их применяет.
//
// Приоритет показа: error > success (вспышка) > warning > loading > обычный синий.
//   error   — красный, держится пока ошибка не решена (setError(false)) или errorHoldMs;
//   success — короткая бирюзово-зелёная вспышка на «Готово», затем возврат;
//   warning — янтарный, пока статус не снят (мягкое предупреждение: нет микрофона, медленная сеть);
//   loading — приглушённый серый, пока статус не снят (модель загружается).

export const INDICATOR_STATUSES = ['warning', 'loading'];

const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));

export class ClipIndicator {
  constructor(settings) {
    this.settings = settings;
    this.reset();
  }

  setSettings(s) { this.settings = s; }

  reset() {
    this.status = null;        // 'warning' | 'loading' | null — держится до снятия
    this.errorOn = false;
    this.errorT = 0;
    this.flashT = -1;          // время с начала вспышки success, -1 = нет
    this.t = 0;
    this.amount = 0;           // 0 = исходный синий, 1 = полностью цвет статуса
    this.rgb = hexRgb(this.settings.colors.success);
    this.glow = 0;
  }

  setStatus(status) { this.status = INDICATOR_STATUSES.includes(status) ? status : null; }
  setError(on) {
    if (on) { this.errorOn = true; this.errorT = 0; } else this.errorOn = false;
  }
  flashSuccess() { this.flashT = 0; }

  /** Что показывается сейчас (для диагностики и рендера). */
  get active() {
    if (this.errorOn) return 'error';
    if (this.flashT >= 0) return 'success';
    return this.status || 'normal';
  }

  update(dt, { reducedMotion = false } = {}) {
    const s = this.settings;
    this.t += dt;
    if (this.errorOn) { this.errorT += dt; if (this.errorT >= s.errorHoldMs) this.errorOn = false; }
    if (this.flashT >= 0) {
      this.flashT += dt;
      if (this.flashT >= s.successRiseMs + s.successHoldMs + s.successFadeMs) this.flashT = -1;
    }

    const act = this.active;
    let targetAmount = act === 'normal' ? 0 : 1;
    let glow = 0;
    if (act === 'success') {
      // вспышка: быстрый подъём, удержание, плавный спад (к следующему по приоритету статусу)
      const f = this.flashT;
      const up = Math.min(1, f / Math.max(1, s.successRiseMs));
      const down = 1 - Math.max(0, (f - s.successRiseMs - s.successHoldMs) / Math.max(1, s.successFadeMs));
      targetAmount = up * down + (this.status ? 1 - up * down : 0);
      glow = s.successGlow * up * down;
    }
    if ((act === 'warning' || act === 'loading') && !reducedMotion) {
      // мягкая пульсация: предупреждение заметнее, загрузка — медленное «дыхание»
      const period = act === 'warning' ? s.warningPulseMs : s.loadingPulseMs;
      const depth = act === 'warning' ? 0.25 : 0.35;
      targetAmount *= 1 - depth * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.t) / Math.max(200, period)));
    }
    if (act === 'error') glow = s.errorGlow;

    // Цвет: к цвету активного статуса (для вспышки поверх статуса — смешение)
    const want = hexRgb(s.colors[act === 'normal' ? (this.status || 'success') : act]);
    const k = 1 - Math.exp(-dt / Math.max(1, s.colorMs / 3));
    for (let i = 0; i < 3; i++) this.rgb[i] += (want[i] - this.rgb[i]) * k;
    // Сила перекраски: быстро вверх, медленнее вниз (кроме вспышки, у неё своя огибающая)
    if (act === 'success') this.amount = targetAmount;
    else {
      const tau = (targetAmount > this.amount ? s.riseMs : s.fadeMs) / 3;
      this.amount += (targetAmount - this.amount) * (1 - Math.exp(-dt / Math.max(1, tau)));
    }
    this.glow += (glow - this.glow) * (1 - Math.exp(-dt / 80));
  }

  snapshot() {
    return {
      active: this.active,
      amount: +this.amount.toFixed(3),
      color: this.rgb.map((v) => Math.round(v)),
      glow: +this.glow.toFixed(3),
    };
  }
}
