import { LocalDB } from './db.js';
import { Trainer } from './timer.js';
import { guideHTML } from './guide.js';
import { iso, dayKey, dayStart, addDays, rest, summary, loadEqual, defaultLoad, nextLoad, easierLoad, progression, phases, makeArchive, validateArchive, importPreview } from './domain.js';

const $ = selector => document.querySelector(selector);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  sliders: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-10h6"/>',
  leaf: '<path d="M20 3c-9-1-15 3-15 9a7 7 0 0 0 7 7c6 0 9-6 8-16Z"/><path d="M3 22 16 9"/>',
  archive: '<path d="M4 8v13h16V8M3 3h18v5H3zM9 12h6"/>',
  drop: '<path d="M12 2C9 7 5 10 5 15a7 7 0 0 0 14 0c0-5-4-8-7-13Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const fmt = (date, withTime = false) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(date));
const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
const db = new LocalDB();
let state, tab = 'today', queue = Promise.resolve(), engine = null, interval = null, wakeLock = null;
let offlineReady = false, swRegistration = null, updating = false, pendingArchive = null, backupFile = null, errorText = '', trainerResultShown = false;
let importRestoresPlan = false, activeToastTimeout = null;
const main = $('#main'), modal = $('#modal'), trainer = $('#trainer');
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);

function announce(message) {
  const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
  clearTimeout(activeToastTimeout); activeToastTimeout = setTimeout(() => { toast.hidden = true; }, 6500);
}
function showError(error) {
  errorText = error?.message || String(error);
  announce(`Не удалось сохранить: ${errorText}`);
  const target = $('#session-error') || $('#modal-error');
  if (target) target.textContent = errorText;
}
async function mutate(change) {
  const job = queue.then(async () => {
    const perform = async () => {
      const fresh = await db.read();
      const changes = await change(fresh);
      if (changes) await db.commit(changes);
      state = await db.read(); applyAppearance();
    };
    if (navigator.locks) await navigator.locks.request(`ritm-write:${db.name}`, perform); else await perform();
  });
  queue = job.catch(() => {});
  return job;
}
function applyAppearance() {
  if (!state?.profile) return;
  const p = state.profile;
  document.documentElement.dataset.theme = p.appearance || 'system';
  document.documentElement.style.setProperty('--scale', String(p.textScale || 1));
}
function todayCount() { return state.sessions.filter(s => s.complete && dayKey(s.started) === dayKey()).length; }
function backupDue() { return !state.profile.lastBackup || new Date() >= addDays(state.profile.lastBackup, 14); }
function heading(eyebrow, title, subtitle = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle ? `<p class="intro-subtitle">${subtitle}</p>` : ''}</div><span class="chip">Личная практика</span></div>`;
}
function historyHTML(s) {
  const label = s.discomfort ? 'Дискомфорт' : s.complete ? (s.quality ? 'Техника подтверждена' : 'Без оценки техники') : 'Не завершено';
  return `<div class="history-item"><div class="history-dot">${icon(s.discomfort ? 'info' : s.complete ? 'check' : 'pause')}</div><div class="history-info"><strong class="small">${esc(fmt(s.started, true))}</strong><p class="muted small">${esc(summary(s.load))}</p><p class="muted small">${label} · ${s.slowDone} медленных, ${s.fastDone} быстрых</p>${s.note ? `<details><summary>Заметка</summary><p>${esc(s.note)}</p></details>` : ''}</div></div>`;
}
function renderToday() {
  const p = state.profile, count = todayCount(), completed = count >= p.load.daily;
  const minutes = (phases(p.load).reduce((a, x) => a + x.seconds, 0) / 60).toFixed(1).replace('.', ',');
  const ring = Math.min(count / p.load.daily, 1) * 301.6;
  return `${heading(new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), 'В своём ритме', 'Небольшая практика сегодня. Устойчивые изменения со временем.')}
    <div class="today-grid"><section class="card hero"><div class="hero-top"><p class="eyebrow">Ваш подход на сегодня</p><span class="pill">${p.paused ? 'Пауза' : completed ? 'Выполнено' : 'Спокойный темп'}</span></div>
    <div class="hero-middle"><div class="daily-ring"><svg viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="48" fill="none" stroke="#ffffff24" stroke-width="6"/><circle cx="56" cy="56" r="48" fill="none" stroke="#d9f0ab" stroke-width="6" stroke-linecap="round" stroke-dasharray="${ring} 301.6"/></svg><div class="daily-count">${count}<span> / ${p.load.daily}</span></div></div>
      <div><p class="hero-load">${p.load.slow} ${plural(p.load.slow, 'медленное', 'медленных', 'медленных')}<br>по ${p.load.hold} ${plural(p.load.hold, 'секунде', 'секунды', 'секунд')}</p><p class="hero-caption">${p.load.fast ? `+ ${p.load.fast} ${plural(p.load.fast, 'быстрое сокращение', 'быстрых сокращения', 'быстрых сокращений')}` : 'Без быстрых сокращений'}<br>Отдых между медленными: ${rest(p.load)} с</p></div></div>
      <div class="hero-bottom">${p.paused ? `<p>Нагрузка приостановлена. Сначала разберитесь с дискомфортом.</p><button class="button primary full section-space" data-go="plan">Открыть план ${icon('arrow')}</button>` : completed ? `<div class="balance">${icon('check')}<p>Дневной план выполнен.<br>До завтра — отдых.</p></div>` : `<button class="button primary full" data-action="start">Начать подход ${icon('arrow')}</button><p class="session-hint">Около ${minutes} мин · без спешки и задержки дыхания</p>`}</div></section>
      <div class="stack"><section class="card"><div class="card-header"><h2>После мочеиспускания</h2>${icon('drop')}</div><div class="step-list"><div class="step"><span class="step-number">1</span><div>Дождитесь полного окончания струи.</div></div><div class="step"><span class="step-number">2</span><div>Мягко проведите пальцами из области позади мошонки вперёд и вверх.</div></div><div class="step"><span class="step-number">3</span><div>При необходимости повторите. Без сильного давления и боли.</div></div></div><button class="text-link" data-go="guide">Подробнее о технике ↗</button></section>
      <section class="card"><div class="card-header"><h2>Как прошёл день?</h2>${icon('book')}</div><p class="muted small">Отметьте, после скольких мочеиспусканий были капли. Так будет видна динамика.</p><button class="text-link" data-action="diary-today">Записать сегодня →</button></section></div></div>
    <div class="today-note">${icon('leaf')}<span>Полное расслабление — часть каждого повтора. Если техника теряется, лучше закончить раньше.</span></div>
    ${backupDue() ? `<aside class="backup-banner"><div><strong>${state.profile.lastBackup ? 'Пора сохранить копию' : 'Сохраните первую копию'}</strong><p class="muted small">JSON вне приложения, затем каждые 14 дней.</p></div><button data-go="data">Сохранить →</button></aside>` : ''}
    <section class="card full-row"><div class="card-header"><h2>Последние тренировки</h2>${icon('clock')}</div>${state.sessions.length ? state.sessions.slice(0, 5).map(historyHTML).join('') : '<p class="empty">Здесь появится история вашей практики. Каждый подход сохраняется на этом устройстве.</p>'}</section>`;
}
function renderDiary() {
  const records = state.diary, points = records.filter(d => d.voids > 0).slice(0, 14).reverse();
  const total = records.slice(0, 7).reduce((a, d) => ({ voids: a.voids + d.voids, leaks: a.leaks + d.leaks }), { voids: 0, leaks: 0 });
  return `${heading('Наблюдение без догадок', 'Как меняются симптомы', 'Записывайте за полный день. Пропуск — это неизвестно, а не ноль.')}
    <div class="grid-two"><section class="card"><div class="card-header"><h2>С каплями после мочеиспускания</h2>${icon('drop')}</div><p class="metric">${total.voids ? Math.round(total.leaks / total.voids * 100) : '—'}<small>${total.voids ? '%' : ''}</small></p><p class="muted small">За последние ${Math.min(records.length, 7)} записанных дней · ${total.leaks} из ${total.voids} мочеиспусканий</p>
      ${points.length ? `<div class="dot-chart" role="img" aria-label="Доля мочеиспусканий с каплями. Точные значения доступны в списке записей ниже.">${points.map(d => `<div class="chart-col"><span class="chart-value">${Math.round(d.leaks / d.voids * 100)}%</span><div class="chart-bar" data-height="${Math.max(1, d.leaks / d.voids * 80)}"></div><span class="chart-day">${new Date(d.day).getDate()}</span></div>`).join('')}</div><p class="chart-caption">До 14 записанных дней. Даты с пропусками не соединяются.</p>` : '<p class="empty">Для графика нужна хотя бы одна запись с числом мочеиспусканий больше нуля.</p>'}</section>
      <section class="card"><div class="card-header"><h2>Одна запись в день</h2>${icon('book')}</div><p class="muted small">Сколько было мочеиспусканий и после скольких вы заметили капли? Несколько капель после одного мочеиспускания — одно событие.</p><div class="button-list section-space"><button class="button primary" data-action="diary-today">${icon('plus')} Записать сегодня</button><button class="button ghost" data-action="diary-other">Выбрать другой день</button></div><p class="safety-links">Личный дневник, а не диагностический опросник. Сначала соберите 3 обычных дня.</p></section></div>
      <section class="card full-row"><h2>Ваши записи</h2>${records.length ? records.map(d => `<button class="day-record" data-diary="${esc(dayKey(d.day))}"><div class="history-item"><div class="history-info"><strong>${esc(fmt(d.day))}</strong><p class="small">С каплями: ${d.leaks} из ${d.voids}${d.voids ? ` · ${Math.round(d.leaks / d.voids * 100)}%` : ' · доля не рассчитана'}</p><p class="muted small">Беспокоит: ${d.bother}/10${d.discomfort ? ' · дискомфорт' : ''}</p>${d.note ? `<p class="muted small">${esc(d.note)}</p>` : ''}</div>${icon('arrow')}</div></button>`).join('') : '<p class="empty">Дневник пока пуст. Можно начать с сегодняшнего дня.</p>'}</section>`;
}
function renderPlan() {
  const p = state.profile, check = progression(state), next = nextLoad(p.load), easier = easierLoad(p.load);
  return `${heading('Посильная нагрузка', 'Сначала качество.<br>Потом следующий шаг.', 'Повышение необязательно. Пропущенные подходы не нужно наверстывать.')}
    <div class="grid-two"><div class="stack"><section class="card"><div class="card-header"><h2>Текущий план</h2><span class="pill">${p.paused ? 'На паузе' : 'Активен'}</span></div><p class="hero-load">${esc(summary(p.load))}</p><div class="stat-row"><span>Отдых после медленных</span><strong>${rest(p.load)} с</strong></div><div class="stat-row"><span>Отдых после быстрых</span><strong>3 с</strong></div><div class="stat-row"><span>На этой нагрузке с</span><strong>${fmt(p.changed)}</strong></div><button class="button secondary full section-space" data-action="reduce" ${loadEqual(p.load, easier) ? 'disabled' : ''}>Снизить нагрузку</button></section>
    <section class="card"><h2>${p.paused ? 'Пауза для восстановления' : 'Можно остановиться'}</h2><p class="muted small section-space">${p.paused ? 'До продолжения выясните причину дискомфорта. При боли, затруднении мочеиспускания или постоянном напряжении укрепление может не подходить.' : 'Если появились боль, постоянное напряжение или ухудшение симптомов, остановите тренировки и обратитесь за оценкой причины.'}</p><button class="button ${p.paused ? 'ghost' : 'danger'} full section-space" data-action="${p.paused ? 'resume-plan' : 'pause-plan'}">${p.paused ? 'Вернуться после оценки симптомов' : 'Приостановить тренировки'}</button></section></div>
    <div class="stack"><section class="card"><div class="card-header"><h2>Готовность к шагу</h2>${icon('sliders')}</div><p class="metric">${check.goodDays}<small> / 5 дней</small></p><div class="progress-track"><div class="progress-fill" data-width="${Math.min(check.goodDays / 5, 1) * 100}"></div></div><p class="muted small section-space">${esc(check.reason)}</p>${next ? `<div class="notice section-space"><strong>Предлагаемый шаг</strong><p>${esc(summary(next))}</p></div><button class="button primary full section-space" data-action="advance" ${check.eligible ? '' : 'disabled'}>Рассмотреть повышение</button>` : ''}
    <details class="section-space"><summary>Как работает предложение</summary><p>Не ранее 7 календарных дней на текущей нагрузке. Дневной план с подтверждённой техникой в ≥5 из последних 7 дней. Без зарегистрированного дискомфорта за эти дни. Прерванный или некачественный подход исключает свой день из зачёта.</p><p>Один параметр за шаг: сначала частота до 3 раз/день, затем удержание до 10 с, медленные до 10, быстрые до 10. Это правило приложения, а не валидированный клинический алгоритм PMD.</p></details></section>
    <section class="card"><h2>Сверьтесь с результатом</h2><p class="muted small section-space">Сравнивайте симптомы с исходными 3 днями. К 12 неделям оцените пользу вместе со специалистом; при ухудшении обратитесь раньше. Верхний предел нагрузки — не цель лечения.</p></section></div></div>
    <section class="card full-row"><h2>Вся история</h2>${state.sessions.length ? state.sessions.map(historyHTML).join('') : '<p class="empty">Тренировок пока нет.</p>'}</section>`;
}
function renderData() {
  const p = state.profile;
  return `${heading('Ваш дневник — у вас', 'Сохранить.<br>И спокойно продолжить.', 'Резервная копия — маленькая привычка раз в две недели.')}
    <div class="grid-two"><div class="stack"><section class="card"><div class="card-header"><h2>Резервная копия</h2>${icon('archive')}</div><p class="muted small">${p.lastBackup ? `Последняя подтверждённая копия: ${fmt(p.lastBackup, true)}.` : 'Подтверждённой резервной копии пока нет.'}</p><div class="button-list section-space"><button class="button primary" data-action="export">${icon('upload')} Экспорт данных в JSON</button><button class="button secondary" data-action="import">${icon('download')} Импорт из JSON</button></div><input id="import-file" class="screen-reader-only" type="file" accept=".json,application/json" aria-label="Выберите JSON резервной копии"><p class="safety-links">Сохраните файл вне приложения. JSON содержит личные записи и не зашифрован отдельно.</p></section>
    <section class="card"><h2>Раз в 14 дней</h2><p class="muted small section-space">Напоминание появится здесь и на главном экране. Пока веб-приложение закрыто, без push-сервера оно не может надёжно напоминать само.</p><button class="button ghost full section-space" data-action="calendar">Добавить напоминание в Календарь</button><p class="safety-links">Будет создан файл .ics с повтором раз в 2 недели. Откройте его и подтвердите добавление в выбранный календарь. Дата события не сдвигается автоматически после экспорта.</p></section>
    <section class="card"><h2>Внешний вид</h2><div class="form-stack section-space"><label class="field"><span>Тема</span><select id="appearance"><option value="system" ${p.appearance === 'system' ? 'selected' : ''}>Как на устройстве</option><option value="light" ${p.appearance === 'light' ? 'selected' : ''}>Светлая</option><option value="dark" ${p.appearance === 'dark' ? 'selected' : ''}>Тёмная</option></select></label><label class="field"><span>Размер текста</span><select id="text-scale">${[[1, 'Обычный'], [1.15, 'Увеличенный'], [1.3, 'Крупный'], [1.5, 'Очень крупный']].map(([value, label]) => `<option value="${value}" ${(p.textScale || 1) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></section></div>
    <div class="stack"><section class="card"><div class="card-header"><h2>Автономность</h2>${icon('shield')}</div><div class="offline-row"><span class="status-dot"></span><strong id="offline-label">${offlineReady ? 'Файлы готовы для работы офлайн' : 'Подготавливаю офлайн-режим…'}</strong></div><p class="muted small section-space">В IndexedDB: ${state.sessions.length} тренировок, ${state.diary.length} дней дневника. Данные не отправляются на GitHub. Safari или iOS всё же могут удалить локальное хранилище — поэтому нужна копия.</p><button class="text-link" data-action="persist">Запросить постоянное хранение →</button><p id="persist-result" class="small muted"></p>${swRegistration?.waiting ? '<button class="button secondary full section-space" data-action="update">Установить обновление приложения</button>' : ''}</section>
    <section class="card"><h2>На экран «Домой»</h2><ol class="install-steps"><li>Откройте эту страницу в Safari на iPhone.</li><li>Нажмите «Поделиться» → «На экран “Домой”». Если появится переключатель «Открывать как веб-приложение», включите его.</li><li>Запустите «Ритм» с новой иконки при включённом интернете. Во вкладке «Данные» дождитесь готовности офлайн.</li><li>После этого проверьте запуск и сохранение в авиарежиме.</li></ol><p class="safety-links">Установленная версия может иметь отдельное хранилище от вкладки Safari. Если уже внесли записи в браузере, перенесите их через JSON.</p></section>
    <section class="card"><h2>Что остаётся локально</h2><p class="muted small section-space">Нагрузка, история, симптомы, заметки и настройки интерфейса. Нет аккаунта приложения, внешних библиотек и аналитики.</p><p class="muted small">GitHub Pages отдаёт код и может вести технические журналы посещения. Веб-адрес и исходный код публичны; ваши введённые записи в репозиторий не попадают. Не загружайте туда резервные копии.</p><p class="safety-links">Версия 1.0.0 · памятка проверена 10.11.2026.</p></section></div></div>`;
}
function render() {
  if (!state) return;
  const functions = { today: renderToday, diary: renderDiary, plan: renderPlan, guide: () => guideHTML(icon), data: renderData };
  main.innerHTML = functions[tab]();
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const bar of document.querySelectorAll('[data-height]')) bar.style.height = `${bar.dataset.height}%`;
  for (const bar of document.querySelectorAll('[data-width]')) bar.style.width = `${bar.dataset.width}%`;
}
function navigate(to, focus = true) {
  if (!['today', 'diary', 'plan', 'guide', 'data'].includes(to)) to = 'today';
  tab = to; history.replaceState(null, '', `#${to}`); render();
  window.scrollTo(0, 0); if (focus) main.focus({ preventScroll: true });
}
function showModal(title, content, actions = '', { blocking = false, className = '' } = {}) {
  if (modal.open) modal.close();
  modal.className = className;
  modal.innerHTML = `<div class="modal-top"><h2 id="modal-title">${title}</h2>${blocking ? '' : '<button type="button" class="close-button" data-action="close-modal" aria-label="Закрыть">×</button>'}</div>${content}<p id="modal-error" class="inline-error" role="alert"></p>${actions ? `<div class="modal-actions">${actions}</div>` : ''}`;
  modal.dataset.blocking = String(blocking); modal.showModal();
}
function ask(title, text, label, action, danger = false) {
  showModal(title, `<p class="muted">${text}</p>`, `<div class="button-list"><button class="button ${danger ? 'danger' : 'primary'}" id="confirm-action">${label}</button><button class="button ghost" data-action="close-modal">Отмена</button></div>`);
  $('#confirm-action').addEventListener('click', async event => {
    const confirmButton = event.currentTarget;
    confirmButton.disabled = true;
    try { await action(); modal.close(); render(); } catch (error) { showError(error); confirmButton.disabled = false; }
  });
}
function onboarding() {
  showModal('Начнём спокойно', `<form id="onboarding-form" class="form-stack"><p class="muted small">Сначала выберите объём, который получается чисто и без боли. Значения по умолчанию — осторожная настройка приложения, а не доказанная оптимальная схема PMD.</p>
    <div class="notice danger">Невозможность помочиться — срочно за помощью. Боль, кровь в моче, лихорадка, жжение или слабая струя требуют медицинской оценки. При постоянном напряжении укрепление может не подходить.</div>
    <p class="small">Вне мочеиспускания мягко сожмите и поднимите мышцы, как при удержании газов. Дышите свободно, не сжимайте ягодицы и не тужьтесь. Между повторами полностью расслабляйтесь. Технику лучше проверить со специалистом.</p>
    <div class="field-grid"><label class="field"><span>Удержание, секунды</span><input name="hold" type="number" min="1" max="10" value="3" required inputmode="numeric"></label><label class="field"><span>Медленные повторы</span><input name="slow" type="number" min="1" max="10" value="5" required inputmode="numeric"></label></div><label class="field"><span>Быстрые повторы</span><input name="fast" type="number" min="0" max="10" value="3" required inputmode="numeric"></label><p class="small muted">Начало: 1 подход в день. Для отдыха — не меньше времени удержания и не меньше 6 секунд; после быстрых — 3 секунды.</p>
    <label class="check"><input name="understood" type="checkbox" required><span>Прочитал технику и условия остановки. Выбираю посильную нагрузку.</span></label><button class="button primary full" type="submit">Сохранить стартовый план ${icon('arrow')}</button></form>`, '', { blocking: true, className: 'onboard-dialog' });
}
function diaryEditor(key = dayKey()) {
  showModal('Запись за день', `<form id="diary-form" class="form-stack"><label class="field"><span>Дата</span><input id="diary-day" name="day" type="date" min="2000-01-01" max="${dayKey()}" value="${esc(key)}" required></label><div class="field-grid"><label class="field"><span>Мочеиспусканий за день</span><input name="voids" id="diary-voids" type="number" min="0" max="100" required inputmode="numeric"></label><label class="field"><span>После скольких были капли</span><input name="leaks" id="diary-leaks" type="number" min="0" max="100" required inputmode="numeric"></label></div><label class="field"><span>Насколько беспокоит, 0–10</span><input name="bother" type="number" min="0" max="10" value="0" required inputmode="numeric"></label><p class="small muted">0 — не беспокоит; 10 — крайне беспокоит. Несколько капель после одного мочеиспускания считаются одним событием.</p><label class="check"><input name="discomfort" type="checkbox"><span>Боль, постоянное напряжение или усиление симптомов. Тренировки будут приостановлены.</span></label><label class="field"><span>Заметка, необязательно</span><textarea name="note" maxlength="2000" rows="3"></textarea></label><p class="small muted" id="diary-replace-note"></p><button class="button primary full" type="submit">Сохранить запись</button></form>`);
  fillDiary(key);
}
function fillDiary(key) {
  const record = state.diary.find(d => dayKey(d.day) === key), form = $('#diary-form'); if (!form) return;
  for (const name of ['voids', 'leaks', 'bother']) form.elements[name].value = record?.[name] ?? 0;
  form.elements.discomfort.checked = !!record?.discomfort; form.elements.note.value = record?.note || '';
  form.elements.leaks.max = String(record?.voids || 0);
  $('#diary-replace-note').textContent = record ? 'За эту дату уже есть запись. Сохранение заменит её текущими значениями.' : 'Новая запись. Ноль мочеиспусканий не участвует в расчёте доли подтеканий.';
}

async function checkpoint(record) {
  try {
    await mutate(fresh => ({ sessions: [record], ...(record.discomfort ? { profile: { ...fresh.profile, paused: true } } : {}) }));
    errorText = '';
  } catch (error) { engine?.pause(); await releaseWake(); showError(error); }
}
async function requestWake() {
  try { if (navigator.wakeLock && document.visibilityState === 'visible' && engine && !engine.paused && !engine.finished) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Timer still pauses safely if the screen locks. */ }
}
async function releaseWake() { try { await wakeLock?.release(); } catch {} wakeLock = null; }
async function startTrainer() {
  if (engine || state.profile.paused || todayCount() >= state.profile.load.daily) return;
  const current = new Trainer(state.profile.load);
  try { await mutate(() => ({ sessions: [current.record()] })); }
  catch (error) { showError(error); return; }
  engine = current; trainerResultShown = false; errorText = '';
  engine.oncheckpoint = checkpoint;
  engine.onchange = updateTrainer;
  trainer.innerHTML = `<div class="trainer-head"><span class="eyebrow">Время для себя</span><button type="button" data-action="stop-trainer">Закончить</button></div><div class="trainer-main"><p class="timer-label">${esc(summary(engine.load))}</p><h2 id="trainer-title">Приготовьтесь</h2><div class="timer-orbit" id="timer-orbit"><span class="timer-number" id="timer-number" role="timer" aria-live="off">5</span></div><p id="timer-repetition" class="timer-label"></p><p class="muted small">Дышите свободно.<br>Ягодицы и бёдра расслаблены.</p><p id="timer-completed" class="timer-label"></p><p id="timer-pause-note" class="notice small" hidden>После 5 секунд восстановления текущая фаза начнётся заново. Повторы в фоне не засчитываются.</p></div><div class="trainer-controls"><button class="button primary full" data-action="pause-trainer" id="pause-trainer">Пауза · расслабиться</button><button class="button danger full" data-action="pain-trainer">Дискомфорт · остановить</button></div><p id="session-error" class="inline-error" role="alert"></p><p class="timer-footnote">На отдыхе полностью отпустите мышцы. Не тужьтесь.</p>`;
  trainer.showModal(); engine.start(); await requestWake();
  interval = setInterval(() => engine?.tick(), 100);
}
function updateTrainer() {
  if (!engine) return;
  if (engine.finished) {
    clearInterval(interval); releaseWake();
    if (!trainerResultShown) { trainerResultShown = true; showTrainerResult(); }
    return;
  }
  const titles = { prepare: 'Приготовьтесь', hold: 'Сократите и поднимите', rest: 'Полностью расслабьте', quick: 'Коротко сократите', recover: 'Полностью расслабьте' };
  $('#trainer-title').textContent = engine.paused ? 'Пауза: расслабьте мышцы' : titles[engine.phase.kind];
  $('#timer-number').textContent = engine.paused ? 'Ⅱ' : engine.remaining;
  $('#timer-number').setAttribute('aria-label', engine.paused ? 'Пауза' : `Осталось ${engine.remaining} секунд`);
  $('#timer-repetition').textContent = engine.phase.total ? `Повтор ${engine.phase.repetition} из ${engine.phase.total}` : 'Спокойное дыхание';
  $('#timer-completed').textContent = `Выполнено: ${engine.slowDone} медленных, ${engine.fastDone} быстрых`;
  $('#timer-pause-note').hidden = !engine.paused;
  $('#pause-trainer').textContent = engine.paused ? (errorText ? 'Повторить сохранение и продолжить' : 'Продолжить после отдыха') : 'Пауза · расслабиться';
  $('#timer-orbit').style.setProperty('--angle', `${360 * Math.min(1, Math.max(0, 1 - engine.remaining / engine.phase.seconds))}deg`);
  if (engine.paused) releaseWake();
}
function showTrainerResult() {
  trainer.innerHTML = `<div class="result-mark">${icon(engine.aborted ? 'pause' : 'check')}</div><h2 id="trainer-title" class="result-title">${engine.aborted ? 'Вы остановились' : 'Подход выполнен'}</h2><p class="muted small">${engine.slowDone} медленных и ${engine.fastDone} быстрых повторов. Повторы засчитаны после отдыха.</p><form id="session-form" class="form-stack section-space">${engine.aborted ? '' : '<label class="check"><input type="checkbox" name="quality"><span>Все повторы с правильной техникой, свободным дыханием и полным расслаблением</span></label>'}<label class="check"><input type="checkbox" name="discomfort" ${engine.pain ? 'checked disabled' : ''}><span>Боль, напряжение или усиление симптомов</span></label><label class="field"><span>Заметка, необязательно</span><textarea name="note" rows="3" maxlength="2000"></textarea></label>${engine.pain ? '<p class="notice danger">Нагрузка будет на паузе. Выясните причину дискомфорта до продолжения.</p>' : ''}<button class="button primary full" type="submit">Сохранить и закончить</button></form><p id="session-error" class="inline-error" role="alert"></p><p class="timer-footnote">Следующий подход — позже, после восстановления. Пропущенное не нужно наверстывать.</p>`;
  $('#trainer-title').focus?.();
}
async function pauseOrResume() {
  if (!engine || engine.finished) return;
  if (!engine.paused) { engine.pause(); await releaseWake(); return; }
  try {
    await mutate(fresh => ({ sessions: [engine.record()], ...(engine.pain ? { profile: { ...fresh.profile, paused: true } } : {}) }));
    errorText = ''; $('#session-error').textContent = ''; engine.resume(); await requestWake();
  } catch (error) { showError(error); }
}

function backupDialog() {
  const archive = makeArchive(state);
  backupFile = new File([JSON.stringify(archive, null, 2)], `ritm-${dayKey()}.json`, { type: 'application/json' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [backupFile] });
  showModal('Сохранить резервную копию', `<p class="muted small">${state.sessions.length} тренировок · ${state.diary.length} дней. Сохраните JSON вне этого приложения: в «Файлы», на накопитель или через AirDrop на Mac.</p><div class="button-list section-space">${canShare ? `<button class="button primary" data-action="share-json">${icon('upload')} Поделиться JSON…</button>` : ''}<button class="button ${canShare ? 'secondary' : 'primary'}" data-action="download-json">${icon('download')} Скачать JSON</button></div><div class="notice section-space">Сначала проверьте, что файл действительно появился вне приложения. Затем подтвердите копию.</div>`, '<button class="button ghost full" data-action="confirm-backup">Файл сохранён — подтвердить копию</button>');
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function readImport(file) {
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('Файл больше 20 МБ.');
    pendingArchive = validateArchive(JSON.parse(await file.text()));
    importRestoresPlan = state.sessions.length === 0 && state.diary.length === 0;
    showImportPreview();
  } catch (error) { showModal('Импорт не выполнен', `<p class="notice danger">${esc(error.message)}</p><p class="small muted section-space">Ваши текущие данные не изменены.</p>`); }
}
function showImportPreview() {
  const preview = importPreview(state, pendingArchive);
  showModal('Проверка перед импортом', `<div class="stat-row"><span>Новых тренировок</span><strong>${preview.sessions.length}</strong></div><div class="stat-row"><span>Новых дней</span><strong>${preview.diary.length}</strong></div><div class="stat-row"><span>Совпадений, будут пропущены</span><strong>${preview.skipped}</strong></div><p class="muted small section-space">История объединяется без удаления. При совпадающем ID тренировки или дате дневника остаётся локальная версия.</p><label class="check section-space"><input id="restore-profile" type="checkbox" ${importRestoresPlan ? 'checked' : ''}><span>Восстановить также план: ${esc(summary(pendingArchive.profile.load))}</span></label><p class="small muted">Импорт не снимает действующую паузу из-за симптомов. После объединения сделайте новую копию.</p>`, '<button class="button primary full" data-action="confirm-import">Импортировать эти данные</button>');
}
function calendarFile() {
  const due = addDays(new Date(), 14); due.setHours(19, 0, 0, 0);
  const end = new Date(+due + 10 * 60000);
  const floating = d => `${dayKey(d).replaceAll('-', '')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const stamp = iso().replaceAll('-', '').replaceAll(':', '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ritm//Local Backup//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${crypto.randomUUID()}@ritm.local`, `DTSTAMP:${stamp}`, `DTSTART:${floating(due)}`, `DTEND:${floating(end)}`, 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Ритм: сохранить резервную копию', 'DESCRIPTION:Откройте Ритм → Данные → Экспорт данных в JSON.', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:Сохраните резервную копию Ритма.', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''];
  // RFC 5545: fold long UTF-8 lines at 75 octets without splitting a code point.
  const folded = lines.map(line => {
    const result = []; let row = '', size = 0;
    for (const c of line) { const bytes = new TextEncoder().encode(c).length; if (size + bytes > 74) { result.push(row); row = ' '; size = 1; } row += c; size += bytes; }
    result.push(row); return result.join('\r\n');
  }).join('\r\n');
  download(new Blob([folded], { type: 'text/calendar;charset=utf-8' }), 'ritm-backup-reminder.ics');
  announce('Откройте файл .ics и подтвердите добавление в Календарь.');
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.tab) { navigate(button.dataset.tab); return; }
  if (button.dataset.go) { navigate(button.dataset.go); return; }
  if (button.dataset.diary) { diaryEditor(button.dataset.diary); return; }
  const action = button.dataset.action;
  try {
    switch (action) {
      case 'close-modal': modal.close(); break;
      case 'start': button.disabled = true; await startTrainer(); button.disabled = false; break;
      case 'diary-today': case 'diary-other': diaryEditor(); break;
      case 'pause-trainer': await pauseOrResume(); break;
      case 'pain-trainer': engine?.stop(true); break;
      case 'stop-trainer':
        engine?.pause(); await releaseWake();
        ask('Закончить раньше?', 'Незавершённая тренировка сохранится и не будет считаться выполненной.', 'Закончить тренировку', async () => engine?.stop(false)); break;
      case 'pause-plan': await mutate(fresh => ({ profile: { ...fresh.profile, paused: true } })); render(); break;
      case 'resume-plan': ask('Возобновить после оценки?', 'Продолжайте после исчезновения дискомфорта и выяснения причины. Будет установлена более лёгкая нагрузка. Кнопка не заменяет медицинскую оценку.', 'Симптомы оценены — продолжить', () => mutate(fresh => ({ profile: { ...fresh.profile, paused: false, load: easierLoad(fresh.profile.load), changed: iso() } }))); break;
      case 'reduce': ask('Снизить нагрузку?', `Новая нагрузка: ${esc(summary(easierLoad(state.profile.load)))}. При боли сначала нужна пауза и оценка причины.`, 'Снизить', () => mutate(fresh => ({ profile: { ...fresh.profile, load: easierLoad(fresh.profile.load), changed: iso() } }))); break;
      case 'advance':
        if (!progression(state).eligible) break;
        ask('Один следующий шаг', `${esc(summary(nextLoad(state.profile.load)))}. Подходы распределяйте в течение дня. Если техника ухудшится, снизьте нагрузку.`, 'Принять следующий шаг', () => mutate(fresh => {
          if (!progression(fresh).eligible) throw new Error('Критерии изменились. Проверьте текущий план.');
          return { profile: { ...fresh.profile, load: nextLoad(fresh.profile.load), changed: iso() } };
        })); break;
      case 'export': backupDialog(); break;
      case 'download-json': download(backupFile, backupFile.name); announce('Проверьте файл в «Загрузках» / «Файлах», затем подтвердите копию.'); break;
      case 'share-json':
        try { await navigator.share({ files: [backupFile], title: 'Резервная копия Ритма' }); announce('После проверки сохранённого файла подтвердите копию.'); }
        catch (error) { if (error.name !== 'AbortError') announce('Не удалось поделиться. Используйте «Скачать JSON».'); }
        break;
      case 'confirm-backup': await mutate(fresh => ({ profile: { ...fresh.profile, lastBackup: iso() } })); modal.close(); render(); announce('Копия подтверждена. Следующее напоминание — через 14 дней.'); break;
      case 'import': $('#import-file').click(); break;
      case 'confirm-import': {
        button.disabled = true; const restore = $('#restore-profile').checked;
        await mutate(fresh => {
          const archive = validateArchive(pendingArchive), preview = importPreview(fresh, archive);
          let profile = { ...(restore ? archive.profile : fresh.profile), lastBackup: null, paused: fresh.profile.paused || (restore && archive.profile.paused) || preview.sessions.some(s => s.discomfort) || preview.diary.some(d => d.discomfort) };
          return { profile, sessions: preview.sessions, diary: preview.diary };
        });
        pendingArchive = null; modal.close(); render(); announce('Данные объединены. Сделайте новую резервную копию.'); break;
      }
      case 'calendar': calendarFile(); break;
      case 'persist':
        if (!navigator.storage?.persist) $('#persist-result').textContent = 'Запрос не поддерживается. Продолжайте делать JSON-копии.';
        else { const granted = await navigator.storage.persist(); $('#persist-result').textContent = granted ? 'Постоянное хранение разрешено. Резервные копии всё равно нужны.' : 'Браузер не предоставил постоянное хранение. Запускайте с экрана «Домой» и сохраняйте JSON.'; }
        break;
      case 'update':
        if (engine) { announce('Сначала завершите тренировку.'); break; }
        if (swRegistration?.waiting) { updating = true; swRegistration.waiting.postMessage('UPDATE_NOW'); }
        break;
    }
  } catch (error) { button.disabled = false; showError(error); }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['onboarding-form', 'diary-form', 'session-form'].includes(form.id)) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = new FormData(form), submit = form.querySelector('[type=submit]'); submit.disabled = true;
  try {
    if (form.id === 'onboarding-form') {
      const load = { hold: Number(values.get('hold')), slow: Number(values.get('slow')), fast: Number(values.get('fast')), daily: 1 };
      if (![load.hold, load.slow, load.fast].every(Number.isInteger) || load.hold < 1 || load.hold > 10 || load.slow < 1 || load.slow > 10 || load.fast < 0 || load.fast > 10) throw new Error('Проверьте стартовую нагрузку.');
      await mutate(fresh => ({ profile: { ...fresh.profile, load, onboarded: true, changed: iso() } })); modal.close(); render();
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    }
    if (form.id === 'diary-form') {
      const key = values.get('day'), voids = Number(values.get('voids')), leaks = Number(values.get('leaks')), bother = Number(values.get('bother'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key > dayKey() || !Number.isInteger(voids) || !Number.isInteger(leaks) || !Number.isInteger(bother) || voids < 0 || voids > 100 || leaks < 0 || leaks > voids || bother < 0 || bother > 10) throw new Error('Проверьте дату и числа. Подтеканий не может быть больше мочеиспусканий.');
      await mutate(fresh => {
        const old = fresh.diary.find(d => dayKey(d.day) === key);
        const diary = { id: old?.id || crypto.randomUUID(), day: iso(new Date(`${key}T00:00:00`)), voids, leaks, bother, discomfort: values.has('discomfort'), note: String(values.get('note')).slice(0, 2000) };
        return { diary: [diary], ...(diary.discomfort ? { profile: { ...fresh.profile, paused: true } } : {}) };
      }); modal.close(); render(); announce('Запись сохранена на устройстве.');
    }
    if (form.id === 'session-form') {
      const record = engine.record({ quality: values.has('quality'), discomfort: values.has('discomfort'), note: String(values.get('note')).slice(0, 2000) });
      await mutate(fresh => ({ sessions: [record], ...(record.discomfort ? { profile: { ...fresh.profile, paused: true } } : {}) }));
      clearInterval(interval); await releaseWake(); engine = null; trainer.close(); render(); announce('Тренировка сохранена.');
    }
  } catch (error) { showError(error); submit.disabled = false; }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'import-file') { const file = target.files[0]; target.value = ''; await readImport(file); }
  if (target.id === 'diary-day') fillDiary(target.value);
  if (target.id === 'appearance' || target.id === 'text-scale') {
    try { await mutate(fresh => ({ profile: { ...fresh.profile, ...(target.id === 'appearance' ? { appearance: target.value } : { textScale: Number(target.value) }) } })); }
    catch (error) { showError(error); }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'diary-voids') {
    const max = Math.max(0, Number(event.target.value) || 0), leaks = $('#diary-leaks'); leaks.max = String(max);
    if (Number(leaks.value) > max) leaks.value = String(max);
  }
});
modal.addEventListener('cancel', event => { if (modal.dataset.blocking === 'true') event.preventDefault(); });
trainer.addEventListener('cancel', event => { event.preventDefault(); engine?.pause(); releaseWake(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') { engine?.pause(); releaseWake(); }
  else if (!engine && state) { try { await queue; state = await db.read(); applyAppearance(); if (!modal.open) render(); } catch (error) { showError(error); } }
});
window.addEventListener('pagehide', () => { engine?.pause(); releaseWake(); });
window.addEventListener('beforeunload', event => { if (engine && !engine.finished) { engine.pause(); event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => { if (!trainer.open) navigate(location.hash.slice(1), false); });

async function setupOffline() {
  if (!('serviceWorker' in navigator) || !isSecureContext) { announce('Для офлайн-установки откройте HTTPS-адрес GitHub Pages.'); return; }
  try {
    const hadController = !!navigator.serviceWorker.controller;
    swRegistration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
    swRegistration.addEventListener('updatefound', () => {
      swRegistration.installing?.addEventListener('statechange', () => { if (hadController && swRegistration.waiting) { announce('Доступно обновление. Установить можно во вкладке «Данные».'); if (tab === 'data' && !modal.open) render(); } });
    });
    const registration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      offlineReady = !!event.data.ready;
      const label = $('#offline-label'); if (label) label.textContent = offlineReady ? 'Файлы готовы для работы офлайн' : 'Офлайн-кэш ещё не готов. Откройте при интернете повторно.';
      channel.port1.close();
    };
    registration.active?.postMessage('OFFLINE_STATUS', [channel.port2]);
  } catch (error) { offlineReady = false; const label = $('#offline-label'); if (label) label.textContent = 'Офлайн-режим не готов. Откройте страницу при интернете повторно.'; console.warn('Offline cache:', error.message); }
}
async function boot() {
  try {
    await db.open(); state = await db.read(); applyAppearance();
    db.onVersionChange = () => { engine?.pause(); announce('База обновлена другой вкладкой. Закройте вкладки и откройте приложение снова.'); };
    navigate(location.hash.slice(1) || 'today', false);
    if (!state.profile.onboarded) onboarding();
    setupOffline();
  } catch (error) {
    main.innerHTML = `${heading('Хранилище недоступно', 'Дневник не открыт')}<section class="card"><p class="notice danger">${esc(error.message)}</p><p class="muted section-space">Не удаляйте данные Safari без резервной копии. Освободите место и откройте обычный Safari, затем повторите. Приложение не подменяет постоянную базу временной памятью.</p><button class="button primary full section-space" id="retry-boot">Повторить открытие</button></section>`;
    $('#retry-boot').onclick = () => location.reload();
  }
}
boot();
