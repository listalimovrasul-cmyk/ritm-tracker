export const FORMAT = 'ritm-local';
export const VERSION = 1;
export const iso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const dayKey = (date = new Date()) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function dayStart(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d;
}
export function addDays(date, count) { const d = new Date(date); d.setDate(d.getDate() + count); return d; }
export const rest = load => Math.max(6, load.hold);
export const loadEqual = (a, b) => ['hold', 'slow', 'fast', 'daily'].every(k => a[k] === b[k]);
export const summary = l => `${l.slow} × ${l.hold} с · ${l.fast} быстрых · ${l.daily} раз/день`;
export const defaultLoad = () => ({ hold: 3, slow: 5, fast: 3, daily: 1 });
export function defaultProfile(now = new Date()) {
  return { started: iso(now), changed: iso(now), load: defaultLoad(), paused: false, onboarded: false, lastBackup: null, reminders: false, appearance: 'system', textScale: 1 };
}
export function nextLoad(load) {
  const n = { ...load };
  if (n.daily < 3) n.daily++;
  else if (n.hold < 10) n.hold++;
  else if (n.slow < 10) n.slow++;
  else if (n.fast < 10) n.fast++;
  else return null;
  return n;
}
export function easierLoad(load) {
  const n = { ...load };
  if (n.hold > 1) n.hold--;
  else if (n.slow > 1) n.slow--;
  else if (n.fast > 0) n.fast--;
  else n.daily = Math.max(1, n.daily - 1);
  return n;
}
export function progression({ profile, sessions, diary }, now = new Date()) {
  const from = dayStart(addDays(now, -6));
  const current = sessions.filter(s => new Date(s.started) >= from && new Date(s.started) <= now);
  const pain = current.some(s => s.discomfort) || diary.some(d => new Date(d.day) >= from && new Date(d.day) <= now && d.discomfort);
  const days = new Map();
  for (const s of current.filter(s => new Date(s.started) >= new Date(profile.changed) && loadEqual(s.load, profile.load))) {
    const k = dayKey(s.started); if (!days.has(k)) days.set(k, []); days.get(k).push(s);
  }
  const goodDays = [...days.values()].filter(a => a.filter(s => s.complete && s.quality && !s.discomfort).length >= profile.load.daily && a.every(s => s.complete && s.quality && !s.discomfort)).length;
  // UTC day ordinals of LOCAL calendar dates avoid daylight-saving 23/25-hour days.
  const ordinal = d => { const a = new Date(d); return Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) / 86400000; };
  const elapsed = ordinal(now) - ordinal(profile.changed);
  let reason;
  if (profile.paused || pain) reason = 'Сначала разберитесь с дискомфортом. Повышение недоступно.';
  else if (!nextLoad(profile.load)) reason = 'Достигнут заданный предел. Повышать дальше не требуется.';
  else if (elapsed < 7) reason = `Не менее 7 дней на этой нагрузке. Сейчас: ${Math.max(0, elapsed)}.`;
  else if (goodDays < 5) reason = `Нужны 5 качественных дней из последних 7. Сейчас: ${goodDays}.`;
  else reason = 'Критерии выполнены. Можно повысить один параметр; это необязательно.';
  return { goodDays, elapsed, eligible: !profile.paused && !pain && elapsed >= 7 && goodDays >= 5 && !!nextLoad(profile.load), reason };
}
export function phases(load) {
  const p = [{ kind: 'prepare', seconds: 5 }];
  for (let i = 1; i <= load.slow; i++) {
    p.push({ kind: 'hold', seconds: load.hold, repetition: i, total: load.slow });
    p.push({ kind: 'rest', seconds: rest(load), repetition: i, total: load.slow, slowEnd: true });
  }
  for (let i = 1; i <= load.fast; i++) {
    p.push({ kind: 'quick', seconds: 1, repetition: i, total: load.fast });
    p.push({ kind: 'rest', seconds: 3, repetition: i, total: load.fast, fastEnd: true });
  }
  return p;
}
export function makeArchive(state, now = new Date()) {
  return { format: FORMAT, version: VERSION, exported: iso(now), profile: { ...state.profile, load: { ...state.profile.load } }, sessions: state.sessions.map(({ dayKey: _, ...s }) => s), diary: state.diary.map(({ dayKey: _, ...d }) => d) };
}
export function validateArchive(input, now = new Date()) {
  const fail = message => { throw new Error(message); };
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const integer = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
  const bool = x => typeof x === 'boolean';
  const date = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && iso(x).slice(0, 19) === x.slice(0, 19) && Date.parse(x) >= Date.UTC(2000, 0, 1) && Date.parse(x) <= +now + 86400000;
  const id = x => typeof x === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
  function load(x) {
    if (!object(x) || !integer(x.hold, 1, 10) || !integer(x.slow, 1, 10) || !integer(x.fast, 0, 10) || !integer(x.daily, 1, 3)) fail('Нагрузка за допустимыми пределами.');
    return { hold: x.hold, slow: x.slow, fast: x.fast, daily: x.daily };
  }
  function note(x) { if (typeof x !== 'string' || x.length > 2000) fail('Неверная или слишком длинная заметка.'); return x; }
  if (!object(input) || input.format !== FORMAT || input.version !== VERSION) fail('Неизвестный формат или версия JSON.');
  if (!date(input.exported)) fail('Неверная дата экспорта.');
  const p = input.profile;
  if (!object(p) || !date(p.started) || !date(p.changed) || Date.parse(p.changed) < Date.parse(p.started) || !(p.lastBackup == null || date(p.lastBackup)) || !bool(p.paused) || !bool(p.onboarded) || !bool(p.reminders)) fail('Некорректные настройки или даты.');
  const profile = { started: iso(p.started), changed: iso(p.changed), load: load(p.load), paused: p.paused, onboarded: p.onboarded, lastBackup: p.lastBackup ? iso(p.lastBackup) : null, reminders: false, appearance: ['system', 'light', 'dark'].includes(p.appearance) ? p.appearance : 'system', textScale: [1, 1.15, 1.3, 1.5].includes(p.textScale) ? p.textScale : 1 };
  if (!Array.isArray(input.sessions) || input.sessions.length > 30000 || !Array.isArray(input.diary) || input.diary.length > 15000) fail('Неверный список записей или превышен лимит.');
  const sessionIDs = new Set(), diaryIDs = new Set(), diaryDays = new Set();
  const sessions = input.sessions.map(s => {
    if (!object(s) || !id(s.id) || sessionIDs.has(s.id.toLowerCase())) fail('Неверные или повторяющиеся ID тренировок.');
    sessionIDs.add(s.id.toLowerCase()); const l = load(s.load);
    if (!date(s.started) || !date(s.ended) || Date.parse(s.ended) < Date.parse(s.started) || !integer(s.slowDone, 0, l.slow) || !integer(s.fastDone, 0, l.fast) || !bool(s.complete) || !bool(s.quality) || !bool(s.discomfort)) fail('Неверные данные тренировки.');
    if (s.complete && (s.slowDone !== l.slow || s.fastDone !== l.fast)) fail('Завершённая тренировка содержит не все повторы.');
    if (s.quality && (!s.complete || s.discomfort)) fail('Противоречивая оценка техники.');
    return { id: s.id.toLowerCase(), started: iso(s.started), ended: iso(s.ended), load: l, slowDone: s.slowDone, fastDone: s.fastDone, complete: s.complete, quality: s.quality, discomfort: s.discomfort, note: note(s.note) };
  });
  const diary = input.diary.map(d => {
    if (!object(d) || !id(d.id) || !date(d.day)) fail('Неверная запись дневника.');
    const key = dayKey(d.day);
    if (diaryIDs.has(d.id.toLowerCase()) || diaryDays.has(key)) fail('Повторяющиеся ID или даты дневника.');
    diaryIDs.add(d.id.toLowerCase()); diaryDays.add(key);
    if (!integer(d.voids, 0, 100) || !integer(d.leaks, 0, d.voids) || !integer(d.bother, 0, 10) || !bool(d.discomfort)) fail('Неверное число мочеиспусканий, подтеканий или оценка симптомов.');
    return { id: d.id.toLowerCase(), day: iso(d.day), voids: d.voids, leaks: d.leaks, bother: d.bother, discomfort: d.discomfort, note: note(d.note) };
  });
  return { format: FORMAT, version: VERSION, exported: iso(input.exported), profile, sessions, diary };
}
export function importPreview(current, incoming) {
  const ids = new Set(current.sessions.map(s => s.id));
  const diaryIDs = new Set(current.diary.map(d => d.id));
  const keys = new Set(current.diary.map(d => dayKey(d.day)));
  const sessions = incoming.sessions.filter(s => !ids.has(s.id));
  const diary = incoming.diary.filter(d => !diaryIDs.has(d.id) && !keys.has(dayKey(d.day)));
  return { sessions, diary, skipped: incoming.sessions.length - sessions.length + incoming.diary.length - diary.length };
}
