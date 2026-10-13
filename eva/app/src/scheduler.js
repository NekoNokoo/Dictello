// Отложенные действия внутри общего цикла анимации: время идёт только через advance(dt),
// поэтому скрытая вкладка не копит события, а сброс отменяет всё одним вызовом.
export class Scheduler {
  constructor() { this.now = 0; this.tasks = []; this.seq = 0; }

  after(ms, fn, group = 'default') {
    const id = ++this.seq;
    this.tasks.push({ id, at: this.now + Math.max(0, ms), fn, group });
    return id;
  }
  cancel(id) { this.tasks = this.tasks.filter((t) => t.id !== id); }
  cancelGroup(group) { this.tasks = this.tasks.filter((t) => t.group !== group); }
  clear() { this.tasks = []; }
  get size() { return this.tasks.length; }

  advance(dtMs) {
    this.now += dtMs;
    // Задачи, поставленные во время выполнения и уже наступившие, тоже выполняются в этом шаге.
    for (let guard = 0; guard < 1000; guard++) {
      let due = null;
      for (const t of this.tasks) if (t.at <= this.now && (!due || t.at < due.at || (t.at === due.at && t.id < due.id))) due = t;
      if (!due) break;
      this.tasks = this.tasks.filter((t) => t !== due);
      due.fn();
    }
  }
}
