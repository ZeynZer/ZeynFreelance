import { SALON, SERVICES, WALK_IN_PRICE, BARBERS, OPEN, SLOT, fmtTime, dayKey, dayLabel, nextDays, fakeBookings, isFree, connect, on, send } from './demo.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tel = `tel:${SALON.phone.replace(/\s/g, '')}`;

/* ---------- Contenu du site ---------- */
$('#call').href = tel; $('#call2').href = tel;
$('#maps').href = SALON.maps; $('#rating').href = SALON.maps;
$('#addr').textContent = SALON.address;

$('#menu').innerHTML = `
  <div class="item"><h3>Coupe homme <span class="tag">sans rendez-vous</span></h3><span class="price">${WALK_IN_PRICE} €</span><p>Passez quand vous voulez, selon l'attente.</p></div>
  ${SERVICES.map((s) => `<div class="item"><h3>${s.name} <span class="tag">sur rendez-vous</span></h3><span class="price">${s.price} €</span><p>${s.desc} · ${s.duration} min</p></div>`).join('')}`;

$('#team').innerHTML = BARBERS.map((b) => `<div class="member"><div class="avatar" style="--h:${b.hue}">${b.initials}</div><b>${b.name}</b><small>${b.role}</small></div>`).join('');

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const now = new Date().getDay();
$('#hours').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) =>
  `<div class="${d === now ? 'today' : ''}"><span>${DAYS[d]}</span><span>${OPEN.closed.includes(d) ? 'Fermé' : `${fmtTime(OPEN.start)} – ${fmtTime(OPEN.end)}`}</span></div>`).join('');

/* ---------- Réservation ---------- */
connect();
const days = nextDays(7);
const extra = []; // réservations faites depuis cet appareil
let st;
const reset = () => (st = { step: 0, service: null, barber: null, day: dayKey(days[0]), time: null, name: '', phone: '', id: null, status: null });
reset();

const bookingsFor = (key) => [...fakeBookings(key), ...extra.filter((b) => b.day === key)];
const service = () => SERVICES.find((s) => s.id === st.service);
const barberName = (id) => BARBERS.find((b) => b.id === id)?.name || 'Peu importe';

function freeBarber(key, time) {
  const list = bookingsFor(key);
  const ids = st.barber && st.barber !== 'any' ? [st.barber] : BARBERS.map((b) => b.id);
  return ids.find((id) => isFree(list, id, time, service().duration)) || null;
}

function open() {
  reset();
  $('#sheet').classList.add('open');
  document.body.style.overflow = 'hidden';
  render();
}
function close() {
  $('#sheet').classList.remove('open');
  document.body.style.overflow = '';
}
document.querySelectorAll('[data-book]').forEach((b) => b.addEventListener('click', open));
$('#close').addEventListener('click', close);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') close(); });

function render() {
  const titles = ['Choisissez une prestation', 'Avec qui ?', 'Quand ?', 'Vos coordonnées', ''];
  $('#p-title').textContent = st.step === 4 ? 'Réservation' : titles[st.step];
  document.querySelectorAll('#steps i').forEach((i, n) => i.classList.toggle('on', n <= Math.min(st.step, 3)));
  const body = $('#p-body'), foot = $('#p-foot');
  const back = st.step > 0 && st.step < 4 ? '<button class="btn line" data-back>Retour</button>' : '';

  if (st.step === 0) {
    body.innerHTML = SERVICES.map((s) => `<button class="opt ${st.service === s.id ? 'on' : ''}" data-service="${s.id}">
      <div><b>${s.name}</b><small>${s.desc} · ${s.duration} min</small></div><span class="price">${s.price} €</span></button>`).join('');
    foot.innerHTML = `<button class="btn gold" data-next ${st.service ? '' : 'disabled'}>Continuer</button>`;
  }
  if (st.step === 1) {
    body.innerHTML = `<button class="opt ${st.barber === 'any' ? 'on' : ''}" data-barber="any"><span class="any">✦</span><div><b>Peu importe</b><small>Le premier coiffeur disponible</small></div></button>` +
      BARBERS.map((b) => `<button class="opt ${st.barber === b.id ? 'on' : ''}" data-barber="${b.id}"><span class="avatar" style="--h:${b.hue}">${b.initials}</span><div><b>${b.name}</b><small>${b.role}</small></div></button>`).join('');
    foot.innerHTML = `${back}<button class="btn gold" data-next ${st.barber ? '' : 'disabled'}>Continuer</button>`;
  }
  if (st.step === 2) {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const isToday = st.day === dayKey(new Date());
    let slots = '';
    for (let m = OPEN.start; m + service().duration <= OPEN.end; m += SLOT) {
      const ok = !(isToday && m <= nowMin + 30) && freeBarber(st.day, m);
      slots += `<button class="slot ${st.time === m ? 'on' : ''}" data-time="${m}" ${ok ? '' : 'disabled'}>${fmtTime(m)}</button>`;
    }
    body.innerHTML = `<div class="label">Jour</div>
      <div class="days">${days.map((d) => `<button class="day ${st.day === dayKey(d) ? 'on' : ''}" data-day="${dayKey(d)}"><small>${d.toLocaleDateString('fr-FR', { weekday: 'short' })}</small><b>${d.getDate()}</b></button>`).join('')}</div>
      <div class="label">Créneaux disponibles${st.barber !== 'any' ? ` avec ${barberName(st.barber)}` : ''}</div>
      <div class="slots">${slots}</div>`;
    foot.innerHTML = `${back}<button class="btn gold" data-next ${st.time != null ? '' : 'disabled'}>Continuer</button>`;
  }
  if (st.step === 3) {
    const d = days.find((x) => dayKey(x) === st.day);
    body.innerHTML = `<div class="recap">
        <div><span>Prestation</span><b>${service().name}</b></div>
        <div><span>Coiffeur</span><b>${barberName(st.barber)}</b></div>
        <div><span>Date</span><b style="text-transform:capitalize">${dayLabel(d, true)} · ${fmtTime(st.time)}</b></div>
        <div><span>Prix</span><b>${service().price} € (à régler au salon)</b></div>
      </div>
      <label class="field">Prénom<input id="f-name" autocomplete="given-name" value="${esc(st.name)}" placeholder="Votre prénom"></label>
      <label class="field">Téléphone<input id="f-phone" type="tel" autocomplete="tel" value="${esc(st.phone)}" placeholder="06 12 34 56 78"></label>`;
    foot.innerHTML = `${back}<button class="btn gold" data-confirm>Confirmer le rendez-vous</button>`;
    setTimeout(() => $('#f-name')?.focus(), 350);
  }
  if (st.step === 4) {
    const d = days.find((x) => dayKey(x) === st.day);
    const when = `${dayLabel(d, true)} à ${fmtTime(st.time)}`;
    const states = {
      wait: ['wait', '⏳', 'Demande envoyée', `Le salon reçoit votre demande pour <b>${when}</b> et la confirme dans un instant.`],
      ok: ['ok', '✓', 'Rendez-vous confirmé', `À <b>${when}</b> avec ${barberName(st.assigned)}. On vous attend !`],
      no: ['no', '✕', 'Créneau indisponible', 'Le salon n\'a pas pu accepter ce créneau. Choisissez-en un autre.'],
    }[st.status];
    body.innerHTML = `<div class="done">
      <div class="seal ${states[0]}">${states[1]}</div>
      <h3>${states[2]}</h3><p>${states[3]}</p>
      ${st.status !== 'no' ? `<div class="sms"><small>La veille, vous recevrez ce rappel :</small>
      <div class="bubble">Vintage Coiffure : rappel de votre rendez-vous demain à ${fmtTime(st.time)} (${service().name}). Un empêchement ? Répondez ANNULER.</div></div>` : ''}
    </div>`;
    foot.innerHTML = st.status === 'no'
      ? '<button class="btn gold" data-retry>Choisir un autre créneau</button>'
      : '<button class="btn line" data-close-done>Fermer</button>';
  }
}

$('#sheet').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.service) { st.service = t.dataset.service; st.time = null; render(); }
  if (t.dataset.barber) { st.barber = t.dataset.barber; st.time = null; render(); }
  if (t.dataset.day) { st.day = t.dataset.day; st.time = null; render(); }
  if (t.dataset.time) { st.time = Number(t.dataset.time); render(); }
  if ('next' in t.dataset) { st.step++; render(); $('#p-body').scrollTop = 0; }
  if ('back' in t.dataset) { st.step--; render(); }
  if ('retry' in t.dataset) { st.step = 2; st.time = null; st.status = null; render(); }
  if ('closeDone' in t.dataset) close();
  if ('confirm' in t.dataset) confirm();
});

function confirm() {
  st.name = $('#f-name').value.trim();
  st.phone = $('#f-phone').value.trim();
  if (!st.name) { $('#f-name').focus(); return; }
  const barber = freeBarber(st.day, st.time);
  if (!barber) { st.step = 2; st.time = null; return render(); }
  st.assigned = barber;
  st.id = Math.random().toString(36).slice(2, 10);
  st.status = 'wait';
  const booking = { id: st.id, day: st.day, start: st.time, barber, service: st.service, client: st.name, phone: st.phone, chosen: st.barber !== 'any', at: Date.now() };
  extra.push(booking);
  send('booking', booking);
  st.step = 4;
  render();
}

on('status', (p) => {
  if (!st || p.id !== st.id || st.step !== 4) return;
  st.status = p.status === 'accepted' ? 'ok' : 'no';
  if (st.status === 'no') {
    const i = extra.findIndex((b) => b.id === p.id);
    if (i >= 0) extra.splice(i, 1);
  }
  if (navigator.vibrate) navigator.vibrate(st.status === 'ok' ? [30, 60, 30] : 200);
  render();
});
