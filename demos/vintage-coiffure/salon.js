import { SERVICES, BARBERS, OPEN, SLOT, fmtTime, dayKey, dayLabel, nextDays, fakeBookings, connect, on, send } from './demo.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROW = 44; // px par créneau de 30 min
const days = nextDays(7);
let sel = dayKey(days[0]);
const live = []; // réservations reçues en direct
let audio = null;

$('#today-label').textContent = dayLabel(new Date(), true);

/* ---------- Démarrage (débloque le son sur iPhone) ---------- */
$('#start').addEventListener('click', () => {
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  $('#intro').classList.add('gone');
  connect();
});

function ding() {
  if (!audio) return;
  const t = audio.currentTime;
  [[1318.5, 0], [1760, 0.13]].forEach(([f, d]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.65);
  });
}

/* ---------- Rendu ---------- */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const svc = (id) => SERVICES.find((s) => s.id === id);
const barber = (id) => BARBERS.find((b) => b.id === id);

function render() {
  $('#days').innerHTML = days.map((d) => {
    const k = dayKey(d);
    const hasPending = live.some((b) => b.day === k && b.status === 'wait');
    return `<button class="day ${sel === k ? 'on' : ''}" data-day="${k}">${hasPending ? '<span class="dot"></span>' : ''}<small>${d.toLocaleDateString('fr-FR', { weekday: 'short' })}</small><b>${d.getDate()}</b></button>`;
  }).join('');

  // Demandes en attente
  const pend = live.filter((b) => b.status === 'wait');
  $('#pending').innerHTML = pend.map((b) => {
    const d = days.find((x) => dayKey(x) === b.day) || new Date(b.day + 'T12:00');
    return `<div class="pending">
      <span class="eyebrow">Nouvelle réservation en ligne</span>
      <h3>${esc(b.client)} · ${svc(b.service).name}</h3>
      <p>${cap(dayLabel(d, true))} à ${fmtTime(b.start)} · avec ${barber(b.barber).name}${b.chosen ? '' : ' (premier disponible)'}${b.phone ? ` · ${esc(b.phone)}` : ''}</p>
      <div class="acts"><button class="btn no sm" data-reject="${b.id}">Refuser</button><button class="btn gold sm" data-accept="${b.id}">Accepter</button></div>
    </div>`;
  }).join('');

  // Planning
  const list = [...fakeBookings(sel), ...live.filter((b) => b.day === sel && b.status !== 'rejected')];
  const rows = (OPEN.end - OPEN.start) / SLOT;
  let html = '<div class="gh"></div>' + BARBERS.map((b) => `<div class="gh"><div class="avatar" style="--h:${b.hue}">${b.initials}</div><b>${b.name}</b></div>`).join('');
  html += `<div class="tcol">${Array.from({ length: rows }, (_, i) => `<div class="tl">${i % 2 === 0 ? fmtTime(OPEN.start + i * SLOT) : ''}</div>`).join('')}</div>`;
  html += BARBERS.map((br) => `<div class="col" style="height:${rows * ROW}px">${list.filter((b) => b.barber === br.id).map((b) => {
    const s = svc(b.service);
    const top = ((b.start - OPEN.start) / SLOT) * ROW + 2;
    const h = (s.duration / SLOT) * ROW - 4;
    const cls = b.fake ? '' : b.status === 'wait' ? 'new wait' : 'new';
    return `<div class="bk ${cls}" id="bk-${b.id || ''}" style="top:${top}px;height:${h}px"><b>${esc(b.client)}</b><small>${fmtTime(b.start)} · ${s.name}${!b.fake ? ' · en ligne' : ''}</small></div>`;
  }).join('')}</div>`).join('');
  if (sel === dayKey(new Date())) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m > OPEN.start && m < OPEN.end) html += `<div class="now" data-min="${m}"></div>`;
  }
  $('#grid').innerHTML = html;
  const now = $('#grid .now');
  if (now) now.style.top = `${$('#grid .gh').offsetHeight + ((Number(now.dataset.min) - OPEN.start) / SLOT) * ROW}px`;

  // Statistiques du jour
  const valid = list.filter((b) => b.fake || b.status === 'accepted');
  const ca = valid.reduce((a, b) => a + svc(b.service).price, 0);
  const online = live.filter((b) => b.day === sel && b.status === 'accepted').length;
  $('#stats').innerHTML = `
    <div class="stat"><small>Rendez-vous</small><b>${valid.length}</b></div>
    <div class="stat"><small>CA prévu</small><b>${ca} €</b></div>
    <div class="stat"><small>Réservés en ligne</small><b>${online}</b></div>`;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.day) { sel = t.dataset.day; render(); }
  if (t.dataset.accept || t.dataset.reject) {
    const b = live.find((x) => x.id === (t.dataset.accept || t.dataset.reject));
    b.status = t.dataset.accept ? 'accepted' : 'rejected';
    send('status', { id: b.id, status: b.status });
    render();
    if (b.status === 'accepted') setTimeout(() => document.getElementById(`bk-${b.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 80);
  }
  if (t.id === 'qr-btn') $('#qr').classList.add('open');
  if (t.id === 'qr-close') $('#qr').classList.remove('open');
});
$('#qr').addEventListener('click', (e) => { if (e.target.id === 'qr') $('#qr').classList.remove('open'); });

/* ---------- Réception en direct ---------- */
let toastTimer;
on('booking', (b) => {
  if (live.some((x) => x.id === b.id)) return;
  live.push({ ...b, status: 'wait' });
  sel = b.day;
  $('#qr').classList.remove('open');
  ding();
  if (navigator.vibrate) navigator.vibrate([60, 80, 60]);
  const toast = $('#toast');
  toast.innerHTML = `<span class="ic">✂</span><div><b>Nouveau rendez-vous : ${esc(b.client)}</b><small>${svc(b.service).name} · ${fmtTime(b.start)} avec ${barber(b.barber).name}</small></div>`;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

render();
setInterval(render, 60000);
