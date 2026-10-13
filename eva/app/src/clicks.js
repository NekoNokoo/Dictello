// Скользящие окна кликов по монотонному времени. Высокий порог проверяется первым.
export class ClickTracker {
  constructor(settings) { this.settings = settings; this.times = []; this.episode = null; }

  setSettings(s) { this.settings = s; }
  reset() { this.times = []; this.episode = null; }

  count(now, windowMs) {
    let n = 0;
    for (const t of this.times) if (now - t <= windowMs) n++;
    return n;
  }

  inEpisode(now) { return !!this.episode && now - this.episode.start < this.settings.cooldownMs; }

  // Возвращает кандидата: 'angry' | 'annoyed' | 'single' | 'suppressed'.
  // Эпизод начинается только через begin(), когда контроллер действительно запустил реакцию.
  register(now) {
    const s = this.settings;
    this.times.push(now);
    const keep = Math.max(s.angryWindowMs, s.annoyedWindowMs);
    this.times = this.times.filter((t) => now - t <= keep);
    const nAngry = this.count(now, s.angryWindowMs);
    const nAnnoyed = this.count(now, s.annoyedWindowMs);
    const inEp = this.inEpisode(now);
    // Эскалация annoyed → angry только пока идёт само раздражение (до конца успокоения),
    // иначе новое раздражение ждёт cooldown от начала предыдущего.
    const escalate = inEp && this.episode.level === 'annoyed' && now - this.episode.start < s.irritationMs + s.composureMs;
    if (nAngry >= s.angryCount && (!inEp || escalate)) return 'angry';
    if (nAnnoyed >= s.annoyedCount) return inEp ? 'suppressed' : 'annoyed';
    if (inEp && this.episode.level === 'angry' && now - this.episode.start < s.irritationMs + s.composureMs) return 'suppressed';
    return 'single';
  }

  begin(level, now) { this.episode = { start: now, level }; }

  stats(now) {
    const s = this.settings;
    return {
      inAnnoyedWindow: this.count(now, s.annoyedWindowMs),
      inAngryWindow: this.count(now, s.angryWindowMs),
      episode: this.episode ? { ...this.episode, active: this.inEpisode(now) } : null,
    };
  }
}
