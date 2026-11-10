import { iso, phases } from './domain.js';

export class Trainer {
  constructor(load, { now = () => performance.now(), date = () => new Date(), id = crypto.randomUUID() } = {}) {
    this.load = { ...load }; this.now = now; this.date = date; this.id = id;
    this.started = iso(date()); this.phases = phases(load); this.index = 0;
    this.slowDone = 0; this.fastDone = 0; this.paused = true; this.finished = false; this.aborted = false; this.pain = false; this.recovery = false;
    this.remaining = 5; this.deadline = 0; this.lastTick = 0;
  }
  get phase() { return this.recovery ? { kind: 'recover', seconds: 5 } : this.phases[this.index]; }
  get contracted() { return !this.finished && !this.paused && ['hold', 'quick'].includes(this.phase.kind); }
  start() { this.paused = false; this.lastTick = this.now(); this.deadline = this.now() + 5000; this.onchange?.(); }
  pause() { if (this.finished) return; this.paused = true; this.onchange?.(); }
  resume() {
    if (this.finished) return;
    this.recovery = true; this.remaining = 5; this.paused = false;
    this.lastTick = this.now(); this.deadline = this.now() + 5000; this.onchange?.();
  }
  tick() {
    if (this.paused || this.finished) return;
    const now = this.now();
    if (now - this.lastTick > 1500) { this.pause(); return; }
    this.lastTick = now; this.remaining = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    if (now < this.deadline) { this.onchange?.(); return; }
    if (this.recovery) this.recovery = false;
    else {
      if (this.phase.slowEnd) this.slowDone++;
      if (this.phase.fastEnd) this.fastDone++;
      if (this.index === this.phases.length - 1) {
        this.finished = true; this.oncheckpoint?.(this.record()); this.onchange?.(); return;
      }
      this.index++;
    }
    this.remaining = this.phase.seconds; this.deadline = now + this.phase.seconds * 1000;
    this.oncheckpoint?.(this.record()); this.onchange?.();
  }
  stop(pain = false) {
    this.pain ||= pain; this.aborted = true; this.finished = true; this.paused = false;
    this.oncheckpoint?.(this.record()); this.onchange?.();
  }
  record({ quality = false, discomfort = false, note } = {}) {
    const complete = this.finished && !this.aborted;
    return { id: this.id, started: this.started, ended: iso(this.date()), load: { ...this.load }, slowDone: this.slowDone, fastDone: this.fastDone, complete, quality: complete && quality && !this.pain && !discomfort, discomfort: this.pain || discomfort, note: note ?? (complete ? 'Подход пройден; оценка техники ещё не сохранена.' : 'Не завершено. После перезапуска начните новый подход после отдыха.') };
  }
}
