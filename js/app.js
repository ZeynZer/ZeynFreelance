import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { searchPrompt, notesPrompt, auditPrompt, dayPrompt } from './prompts.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'zf-auth' },
});

/* ---------------- Constantes ---------------- */
const STATUS = {
  a_verifier: { label: 'À vérifier', color: '#f5a524' },
  a_visiter: { label: 'À visiter', color: '#22d3ee' },
  visite: { label: 'Visité', color: '#60a5fa' },
  rdv: { label: 'RDV fixé', color: '#a78bfa' },
  devis: { label: 'Devis envoyé', color: '#e879f9' },
  signe: { label: 'Signé', color: '#34d399' },
  livre: { label: 'Livré', color: '#10b981' },
  maintenance: { label: 'Maintenance', color: '#2dd4bf' },
  perdu: { label: 'Perdu', color: '#64748b' },
};
const PIPE = Object.keys(STATUS);
const CONTACTED = ['visite', 'rdv', 'devis', 'signe', 'livre', 'maintenance', 'perdu'];
const ACTIVE = ['a_verifier', 'a_visiter', 'visite', 'rdv', 'devis'];
const SITE = { none: 'Aucun site', social: 'Réseaux seulement', bad: 'Site mauvais', ok: 'Bon site' };
const OFFERS = { essentiel: 'Essentiel', pro: 'Pro', premium: 'Premium' };
const CLIENT_STATUS = { en_cours: 'En cours', livre: 'Livré', termine: 'Terminé' };
const TX_CATS = {
  entree: ['Acompte', 'Solde', 'Maintenance', 'Autre'],
  depense: ['Nom de domaine', 'Hébergement', 'Matériel', 'Impression', 'Transport', 'Logiciel', 'URSSAF', 'Autre'],
};

/* ---------------- État ---------------- */
const S = {
  view: 'home',
  bizTab: 'clients',
  prospects: [],
  clients: [],
  tx: [],
  settings: null,
  filter: { q: '', status: 'actifs', trade: '' },
  importPreview: null,
  map: null,
  mapLayer: null,
};

/* ---------------- Utilitaires ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const today = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Prompt copié ✓ Colle-le dans ChatGPT'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast('Prompt copié ✓');
  }
}

function km(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ---------------- Score de pertinence ---------------- */
const BOOKING_TRADES = /coiff|barb|esth|ongl|massage|beaut|garag|auto|kin[ée]|osteo|ostéo|tatou|spa|salon|coach|lavage/i;
function computeScore(p) {
  let s = { none: 30, social: 26, bad: 22, ok: 0 }[p.website_state] ?? 15;
  const r = p.google_reviews;
  s += r == null ? 6 : r >= 150 ? 22 : r >= 60 ? 18 : r >= 25 ? 12 : r >= 8 ? 6 : 2;
  const g = p.google_rating;
  s += g == null ? 4 : g >= 4.2 ? 10 : g >= 3.8 ? 7 : g >= 3.3 ? 4 : 1;
  if (BOOKING_TRADES.test(p.trade || '') && !p.online_booking) s += 10;
  const probs = String(p.problems || '').split('\n').filter((x) => x.trim()).length;
  s += Math.min(probs * 3, 12);
  const st = S.settings;
  if (p.lat && p.lng && st) {
    const d = km(st.home_lat, st.home_lng, p.lat, p.lng);
    s += d < 1.5 ? 12 : d < 3 ? 9 : d < 6 ? 5 : 1;
  } else s += 4;
  if (p.reliability === 'faible') s -= 8;
  return Math.max(0, Math.min(100, Math.round(s)));
}
const scoreColor = (s) => (s >= 70 ? '#34d399' : s >= 50 ? '#22d3ee' : s >= 35 ? '#f5a524' : '#64748b');

/* ---------------- Données ---------------- */
async function loadAll() {
  const [p, c, t, s] = await Promise.all([
    sb.from('zf_prospects').select('*').order('score', { ascending: false }),
    sb.from('zf_clients').select('*').order('created_at', { ascending: false }),
    sb.from('zf_transactions').select('*').order('date', { ascending: false }),
    sb.from('zf_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  const err = p.error || c.error || t.error || s.error;
  if (err) throw err;
  if (!s.data) throw new Error('no-access');
  S.prospects = p.data; S.clients = c.data; S.tx = t.data; S.settings = s.data;
}

async function saveProspect(row, id) {
  row.score = computeScore({ ...(S.prospects.find((x) => x.id === id) || {}), ...row });
  const q = id ? sb.from('zf_prospects').update(row).eq('id', id).select().single() : sb.from('zf_prospects').insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  const i = S.prospects.findIndex((x) => x.id === data.id);
  if (i >= 0) S.prospects[i] = data; else S.prospects.push(data);
  S.prospects.sort((a, b) => b.score - a.score);
  return data;
}

async function geocode(p) {
  if (!p.address) return null;
  const q = /b[ée]ziers/i.test(p.address) ? p.address : `${p.address}, Béziers`;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'fr' } });
    const j = await r.json();
    if (j[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
  } catch {}
  return null;
}

/* ---------------- Lecture des réponses ChatGPT ---------------- */
function parseAI(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  const a2 = t.indexOf('['), b2 = t.lastIndexOf(']');
  let obj;
  try {
    if (a >= 0 && (a2 < 0 || a < a2)) obj = JSON.parse(t.slice(a, b + 1));
    else if (a2 >= 0) obj = { commerces: JSON.parse(t.slice(a2, b2 + 1)) };
  } catch (e) {
    throw new Error('Réponse illisible : vérifie que tu as collé tout le bloc JSON de ChatGPT.');
  }
  if (!obj) throw new Error('Aucun JSON trouvé dans la réponse.');
  const list = obj.commerces || obj.businesses || obj.results || (Array.isArray(obj) ? obj : []);
  if (!list.length) throw new Error('Aucun commerce dans la réponse.');
  return { advice: obj.conseil_global || '', items: list };
}

const list2text = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => `• ${x}`).join('\n') : v || null);
function mapItem(it, source) {
  const state = ['none', 'bad', 'social', 'ok'].includes(it.etat_site) ? it.etat_site : 'none';
  const offer = ['essentiel', 'pro', 'premium'].includes(it.formule) ? it.formule : null;
  const sources = Array.isArray(it.sources) && it.sources.length ? `Sources :\n${it.sources.join('\n')}` : '';
  return {
    name: String(it.nom || '').trim(),
    trade: it.metier || null,
    zone: it.quartier || null,
    address: it.adresse || null,
    phone: it.telephone || null,
    email: it.email || null,
    contact_name: it.gerant || null,
    website: it.site_web || null,
    website_state: state,
    online_booking: !!it.reservation_en_ligne,
    google_rating: num(it.note_google),
    google_reviews: num(it.nb_avis_google) != null ? Math.round(num(it.nb_avis_google)) : null,
    maps_url: it.lien_google_maps || null,
    problems: list2text(it.problemes),
    improvements: list2text(it.ameliorations),
    recommended_offer: offer,
    estimated_price: num(it.prix_estime),
    pitch: it.accroche || null,
    next_action: it.prochaine_action || 'Vérifier les infos sur Google Maps',
    next_action_date: today(),
    reliability: ['haute', 'moyenne', 'faible'].includes(it.fiabilite) ? it.fiabilite : null,
    notes: sources || null,
    source,
    status: 'a_verifier',
    _prio: num(it.priorite),
  };
}

/* ---------------- Auth ---------------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  try {
    await loadAll();
    showApp();
  } catch (e) {
    if (e.message === 'no-access') { await sb.auth.signOut(); showLogin('Ce compte n\'a pas accès à ZeynFreelance.'); }
    else showLogin('Erreur de connexion : ' + e.message);
  }
}

function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-msg').textContent = msg;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-form button');
  btn.disabled = true; btn.textContent = 'Connexion…';
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  btn.disabled = false; btn.textContent = 'Se connecter';
  if (error) return ($('#login-msg').textContent = 'Email ou mot de passe incorrect.');
  boot();
});

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

/* ---------------- Navigation ---------------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { S.view = nav.dataset.nav; render(); window.scrollTo(0, 0); return; }
  const act = e.target.closest('[data-act]');
  if (act) handleAction(act.dataset.act, act.dataset, act, e);
});

function render() {
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === S.view));
  const v = $('#view');
  const views = { home: viewHome, ai: viewAI, prospects: viewProspects, map: viewMap, biz: viewBiz };
  v.innerHTML = views[S.view]();
  if (S.view === 'map') initMap();
  if (S.view === 'ai' && S.importPreview) renderPreview();
}

/* ---------------- Vue : Aujourd'hui ---------------- */
function stats() {
  const income = S.tx.filter((t) => t.kind === 'entree').reduce((a, t) => a + Number(t.amount), 0);
  const spent = S.tx.filter((t) => t.kind === 'depense' && t.category !== 'URSSAF').reduce((a, t) => a + Number(t.amount), 0);
  const urssafPaid = S.tx.filter((t) => t.kind === 'depense' && t.category === 'URSSAF').reduce((a, t) => a + Number(t.amount), 0);
  const month = today().slice(0, 7);
  const monthIncome = S.tx.filter((t) => t.kind === 'entree' && t.date.startsWith(month)).reduce((a, t) => a + Number(t.amount), 0);
  const recurring = S.clients.filter((c) => c.maintenance_active).reduce((a, c) => a + Number(c.maintenance_monthly || 0), 0);
  const contacted = S.prospects.filter((p) => CONTACTED.includes(p.status)).length;
  const signed = S.clients.length;
  const rate = Number(S.settings.urssaf_rate || 0) / 100;
  const urssafDue = Math.max(0, income * rate - urssafPaid);
  return { income, spent, urssafPaid, monthIncome, recurring, contacted, signed, urssafDue, profit: income - spent - urssafPaid, cash: Number(S.settings.capital || 0) + income - spent - urssafPaid };
}

function bar(label, value, goal, fmt = (x) => x) {
  const pct = Math.min(100, Math.round((value / (goal || 1)) * 100));
  return `<div class="goal"><div class="goal-top"><span>${label}</span><b>${fmt(value)} <small>/ ${fmt(goal)}</small></b></div>
  <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}

function viewHome() {
  const st = stats();
  const g = S.settings.goals || {};
  const t = today();
  const due = S.prospects.filter((p) => p.next_action_date && p.next_action_date <= t && !['perdu', 'livre', 'maintenance'].includes(p.status))
    .sort((a, b) => a.next_action_date.localeCompare(b.next_action_date) || b.score - a.score);
  const toCheck = S.prospects.filter((p) => p.status === 'a_verifier').length;
  const top = S.prospects.filter((p) => p.status === 'a_visiter').slice(0, 5);
  const late = due.filter((p) => p.next_action_date < t).length;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  return `
  <header class="hero">
    <p class="eyebrow">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>${hello} Zeyn</h1>
    <p class="muted">${due.length ? `${due.length} action${due.length > 1 ? 's' : ''} à faire aujourd'hui${late ? ` dont ${late} en retard` : ''}.` : 'Aucune action prévue : va chercher de nouveaux commerces.'}</p>
  </header>

  <section class="kpis">
    <div class="kpi"><span>Encaissé</span><b>${eur(st.income)}</b></div>
    <div class="kpi"><span>Ce mois</span><b>${eur(st.monthIncome)}</b></div>
    <div class="kpi"><span>Récurrent</span><b>${eur(st.recurring)}<small>/mois</small></b></div>
    <div class="kpi"><span>Bénéfice</span><b class="${st.profit < 0 ? 'neg' : ''}">${eur(st.profit)}</b></div>
  </section>

  <section class="card">
    <h2>Objectifs</h2>
    ${bar('Commerces contactés (fin décembre)', st.contacted, g.contacts_dec || 30)}
    ${bar('Clients signés (3 mois)', st.signed, g.clients_3m || 3)}
    ${bar('Encaissé (3 mois)', st.income, g.cash_3m || 1500, eur)}
    ${bar('Ce mois-ci (objectif 12 mois)', st.monthIncome, g.monthly_12m || 1000, eur)}
  </section>

  <section class="card">
    <div class="card-head"><h2>À faire aujourd'hui</h2>${toCheck ? `<button class="chip warn" data-act="filter" data-status="a_verifier">${toCheck} à vérifier</button>` : ''}</div>
    ${due.length ? due.map(row).join('') : '<p class="empty">Rien de prévu. Lance une recherche IA ou planifie tes prochaines visites.</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>Priorités à visiter</h2><button class="link" data-nav="map">Voir la carte →</button></div>
    ${top.length ? top.map(row).join('') : '<p class="empty">Vérifie les fiches « À vérifier » pour les passer en « À visiter ».</p>'}
  </section>

  <section class="card coach">
    <h2>Coach IA du jour</h2>
    <p class="muted">Copie ce prompt dans ChatGPT : il connaît tout ton suivi et te dit quoi faire aujourd'hui.</p>
    <button class="btn" data-act="copy-day">Copier le prompt du jour</button>
  </section>`;
}

function row(p) {
  const s = STATUS[p.status];
  const late = p.next_action_date && p.next_action_date < today();
  return `<button class="row" data-act="open" data-id="${p.id}">
    <span class="score" style="--c:${scoreColor(p.score)}">${p.score}</span>
    <span class="row-main">
      <b>${esc(p.name)}</b>
      <small>${esc([p.trade, p.zone].filter(Boolean).join(' · '))}${p.next_action ? ` — ${esc(p.next_action)}` : ''}</small>
    </span>
    <span class="row-side">
      <span class="pill" style="--c:${s.color}">${s.label}</span>
      ${p.next_action_date ? `<small class="${late ? 'late' : ''}">${fmtDate(p.next_action_date)}</small>` : ''}
    </span>
  </button>`;
}

function daySummary() {
  const st = stats();
  const act = S.prospects.filter((p) => ACTIVE.includes(p.status)).slice(0, 15);
  return [
    `Date : ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    `Commerces contactés : ${st.contacted} (objectif fin décembre : ${S.settings.goals?.contacts_dec || 30})`,
    `Clients signés : ${st.signed} — Encaissé : ${eur(st.income)} — Récurrent : ${eur(st.recurring)}/mois`,
    '',
    'Prospects actifs (score de pertinence /100) :',
    ...act.map((p) => `- ${p.name} (${p.trade || '?'}, ${p.zone || 'Béziers'}) — statut : ${STATUS[p.status].label} — score ${p.score} — site : ${SITE[p.website_state] || '?'}${p.next_action ? ` — prochaine action : ${p.next_action}${p.next_action_date ? ` (${fmtDate(p.next_action_date)})` : ''}` : ''}`),
  ].join('\n');
}

/* ---------------- Vue : Recherche IA ---------------- */
function viewAI() {
  const trades = [...new Set(S.prospects.map((p) => p.trade).filter(Boolean))];
  return `
  <header class="hero"><p class="eyebrow">Recherche IA · ChatGPT</p><h1>Trouver des clients</h1>
  <p class="muted">1. Copie le prompt → 2. Colle-le dans ChatGPT (avec la recherche web) → 3. Colle sa réponse ici.</p></header>

  <div class="seg">
    <button class="${S.aiTab !== 'notes' ? 'on' : ''}" data-act="ai-tab" data-tab="search">Chercher des commerces</button>
    <button class="${S.aiTab === 'notes' ? 'on' : ''}" data-act="ai-tab" data-tab="notes">Analyser mes notes</button>
  </div>

  ${S.aiTab === 'notes' ? `
  <section class="card">
    <h2>1 · Lâche tes notes en vrac</h2>
    <p class="muted">Tout ce que tu as vu ou entendu, sur autant de commerces que tu veux. L'IA trie, complète et te dit qui prioriser.</p>
    <textarea id="ai-notes" rows="8" placeholder="Ex : le barbier rue de la République, plein à 17h, rdv par téléphone uniquement, pas de site. Le snack près des Allées, Facebook pas à jour depuis 2022…">${esc(S.notesDraft || '')}</textarea>
    <button class="btn" data-act="copy-notes">Copier le prompt</button>
  </section>` : `
  <section class="card">
    <h2>1 · Ta recherche</h2>
    <label>Métiers<input id="ai-trades" list="trade-list" value="${esc(S.aiTrades || 'barbier, coiffeur, snack')}" placeholder="barbier, snack, boulangerie…"></label>
    <datalist id="trade-list">${['barbier', 'coiffeur', 'snack', 'restaurant', 'boulangerie', 'esthéticienne', 'garage', 'pressing', 'fleuriste', 'auto-école', 'kebab', 'pizzeria', ...trades].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="grid2">
      <label>Secteur (optionnel)<input id="ai-zone" value="${esc(S.aiZone || '')}" placeholder="centre-ville, La Devèze…"></label>
      <label>Nombre<select id="ai-count">${[3, 4, 5, 6, 8].map((n) => `<option ${n === (S.aiCount || 4) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <button class="btn" data-act="copy-search">Copier le prompt</button>
    <p class="hint">Les ${S.prospects.length} commerces déjà dans ton suivi sont exclus automatiquement.</p>
  </section>`}

  <section class="card">
    <h2>2 · Colle la réponse de ChatGPT</h2>
    <textarea id="ai-answer" rows="6" placeholder="Colle ici tout le bloc JSON renvoyé par ChatGPT"></textarea>
    <button class="btn" data-act="parse">Analyser la réponse</button>
  </section>
  <div id="preview"></div>`;
}

function renderPreview() {
  const P = S.importPreview;
  const el = $('#preview');
  if (!el || !P) return;
  el.innerHTML = `
  <section class="card">
    <h2>3 · ${P.items.length} commerce${P.items.length > 1 ? 's' : ''} trouvé${P.items.length > 1 ? 's' : ''}</h2>
    ${P.advice ? `<div class="advice">💡 ${esc(P.advice)}</div>` : ''}
    ${P.items.map((it, i) => `
      <label class="pick">
        <input type="checkbox" data-i="${i}" ${it._checked ? 'checked' : ''}>
        <span class="score" style="--c:${scoreColor(it._score)}">${it._score}</span>
        <span class="row-main">
          <b>${esc(it.name)} ${it._dup ? '<em class="tag">déjà suivi → mise à jour</em>' : ''} ${it.reliability === 'faible' ? '<em class="tag warn">infos peu fiables</em>' : ''}</b>
          <small>${esc([it.trade, it.zone, SITE[it.website_state]].filter(Boolean).join(' · '))}</small>
          <small>${esc(it.address || 'adresse inconnue')}${it.phone ? ' · ' + esc(it.phone) : ''}</small>
          ${it.improvements ? `<small class="imp">${esc(it.improvements.split('\n')[0])}</small>` : ''}
        </span>
      </label>`).join('')}
    <button class="btn" data-act="import">Importer la sélection</button>
    <p class="hint">Les fiches arrivent en « À vérifier » : contrôle-les sur Google Maps avant de te déplacer.</p>
  </section>`;
}

/* ---------------- Vue : Prospects ---------------- */
function filtered() {
  const f = S.filter;
  const q = norm(f.q);
  return S.prospects.filter((p) =>
    (f.status === 'tous' || (f.status === 'actifs' ? ACTIVE.includes(p.status) : p.status === f.status)) &&
    (!f.trade || norm(p.trade) === norm(f.trade)) &&
    (!q || norm([p.name, p.trade, p.zone, p.address].join(' ')).includes(q)));
}

function viewProspects() {
  const f = S.filter;
  const list = filtered();
  const trades = [...new Set(S.prospects.map((p) => p.trade).filter(Boolean))].sort();
  const counts = Object.fromEntries(PIPE.map((k) => [k, S.prospects.filter((p) => p.status === k).length]));
  return `
  <header class="hero row-head"><div><p class="eyebrow">${S.prospects.length} commerces suivis</p><h1>Prospects</h1></div>
  <button class="btn sm" data-act="new">+ Ajouter</button></header>
  <input class="search" id="q" placeholder="Rechercher un commerce, un quartier…" value="${esc(f.q)}">
  <div class="chips">
    ${[['actifs', 'Actifs'], ['tous', 'Tous']].map(([k, l]) => `<button class="chip ${f.status === k ? 'on' : ''}" data-act="filter" data-status="${k}">${l}</button>`).join('')}
    ${PIPE.map((k) => `<button class="chip ${f.status === k ? 'on' : ''}" style="--c:${STATUS[k].color}" data-act="filter" data-status="${k}">${STATUS[k].label} <i>${counts[k]}</i></button>`).join('')}
  </div>
  ${trades.length ? `<div class="chips">${['', ...trades].map((t) => `<button class="chip ${f.trade === t ? 'on' : ''}" data-act="filter-trade" data-trade="${esc(t)}">${t ? esc(t) : 'Tous métiers'}</button>`).join('')}</div>` : ''}
  <section class="list">${list.length ? list.map(row).join('') : '<p class="empty">Aucun commerce ici. Va dans l\'onglet IA pour en trouver.</p>'}</section>`;
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') {
    S.filter.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'ai-notes') S.notesDraft = e.target.value;
  if (e.target.matches('#preview input[type=checkbox]')) S.importPreview.items[e.target.dataset.i]._checked = e.target.checked;
});

/* ---------------- Fiche prospect ---------------- */
function openSheet(html) {
  const sh = $('#sheet');
  $('#sheet-body').innerHTML = html;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
  $('#sheet-body').scrollTop = 0;
}
function closeSheet() {
  const sh = $('#sheet');
  sh.classList.remove('open');
  setTimeout(() => (sh.hidden = true), 250);
}
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });

const field = (label, name, val, type = 'text', extra = '') =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(val ?? '')}" ${extra}></label>`;
const area = (label, name, val, rows = 3) => `<label>${label}<textarea name="${name}" rows="${rows}">${esc(val ?? '')}</textarea></label>`;
const select = (label, name, opts, val, empty = '') =>
  `<label>${label}<select name="${name}">${empty ? `<option value="">${empty}</option>` : ''}${Object.entries(opts).map(([k, l]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;

function openProspect(id) {
  const p = id ? S.prospects.find((x) => x.id === id) : { status: 'a_visiter', website_state: 'none', city: 'Béziers', next_action_date: today() };
  const maps = p.maps_url || (p.name ? `https://www.google.com/maps/search/${encodeURIComponent(`${p.name} ${p.address || 'Béziers'}`)}` : '');
  const client = id && S.clients.find((c) => c.prospect_id === id);
  openSheet(`
  <div class="sheet-head">
    <div>${id ? `<span class="score big" style="--c:${scoreColor(p.score)}">${p.score}</span>` : ''}<h2>${id ? esc(p.name) : 'Nouveau commerce'}</h2>
    ${id ? `<small class="muted">${esc([p.trade, p.zone].filter(Boolean).join(' · '))}${p.reliability ? ` · fiabilité IA : ${esc(p.reliability)}` : ''}</small>` : ''}</div>
    <button class="x" data-close>✕</button>
  </div>
  ${id ? `
  <div class="quick">
    ${p.phone ? `<a class="qbtn" href="tel:${esc(p.phone.replace(/\s/g, ''))}">📞 Appeler</a>` : ''}
    ${maps ? `<a class="qbtn" href="${esc(maps)}" target="_blank" rel="noopener">📍 Google Maps</a>` : ''}
    <button class="qbtn" data-act="copy-audit" data-id="${id}">🧠 Prompt mini-audit</button>
    ${client ? `<button class="qbtn" data-act="open-client" data-id="${client.id}">💼 Voir le client</button>` : ['signe', 'devis', 'rdv'].includes(p.status) ? `<button class="qbtn ok" data-act="convert" data-id="${id}">✅ Signé → créer le client</button>` : ''}
  </div>
  <div class="pipe">${PIPE.map((k) => `<button class="${p.status === k ? 'on' : ''}" style="--c:${STATUS[k].color}" data-act="set-status" data-id="${id}" data-status="${k}">${STATUS[k].label}</button>`).join('')}</div>
  ${p.pitch ? `<div class="advice">🎯 Accroche : ${esc(p.pitch)}</div>` : ''}` : ''}
  <form id="pform" data-id="${id || ''}">
    <h3>Prochaine action</h3>
    <div class="grid2">${field('Quoi', 'next_action', p.next_action)}${field('Quand', 'next_action_date', p.next_action_date, 'date')}</div>
    <h3>Commerce</h3>
    ${field('Nom *', 'name', p.name, 'text', 'required')}
    <div class="grid2">${field('Métier', 'trade', p.trade)}${field('Quartier', 'zone', p.zone)}</div>
    ${field('Adresse', 'address', p.address)}
    <div class="grid2">${field('Téléphone', 'phone', p.phone, 'tel')}${field('Email', 'email', p.email, 'email')}</div>
    ${field('Gérant', 'contact_name', p.contact_name)}
    ${!id ? select('Statut', 'status', Object.fromEntries(PIPE.map((k) => [k, STATUS[k].label])), p.status) : ''}
    <h3>Présence en ligne</h3>
    <div class="grid2">${select('Site actuel', 'website_state', SITE, p.website_state)}${field('Lien actuel', 'website', p.website)}</div>
    <div class="grid2">${field('Note Google', 'google_rating', p.google_rating, 'number', 'step="0.1" min="0" max="5"')}${field("Nombre d'avis", 'google_reviews', p.google_reviews, 'number', 'min="0"')}</div>
    <label class="check"><input type="checkbox" name="online_booking" ${p.online_booking ? 'checked' : ''}> Réservation en ligne déjà en place</label>
    ${field('Lien Google Maps', 'maps_url', p.maps_url)}
    <h3>Analyse et offre</h3>
    ${area('Problèmes repérés (un par ligne)', 'problems', p.problems)}
    ${area('Améliorations à proposer', 'improvements', p.improvements)}
    <div class="grid2">${select('Formule', 'recommended_offer', OFFERS, p.recommended_offer, '—')}${field('Prix estimé (€)', 'estimated_price', p.estimated_price, 'number')}</div>
    <div class="grid2">${field('Montant du devis (€)', 'quote_amount', p.quote_amount, 'number')}${field('Raison si perdu', 'lost_reason', p.lost_reason)}</div>
    ${field('Accroche', 'pitch', p.pitch)}
    ${area('Mini-audit (colle la réponse de ChatGPT)', 'audit', p.audit, 4)}
    ${area('Notes', 'notes', p.notes, 4)}
    <div class="actions">
      ${id ? `<button type="button" class="btn ghost danger" data-act="delete" data-id="${id}">Supprimer</button>` : ''}
      <button class="btn" type="submit">Enregistrer</button>
    </div>
  </form>`);
}

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'pform') {
    e.preventDefault();
    const f = e.target, id = f.dataset.id || null;
    const fd = new FormData(f);
    const row = {};
    for (const [k, v] of fd.entries()) row[k] = typeof v === 'string' ? v.trim() || null : v;
    ['google_rating', 'google_reviews', 'estimated_price', 'quote_amount'].forEach((k) => (row[k] = num(row[k])));
    if (row.google_reviews != null) row.google_reviews = Math.round(row.google_reviews);
    row.online_booking = !!f.online_booking.checked;
    if (!row.recommended_offer) row.recommended_offer = null;
    const old = id && S.prospects.find((x) => x.id === id);
    if (!old || old.address !== row.address) {
      const g = await geocode(row);
      if (g) Object.assign(row, g); else if (old && old.address !== row.address) Object.assign(row, { lat: null, lng: null });
    }
    try { await saveProspect(row, id); toast('Enregistré ✓'); closeSheet(); render(); }
    catch (err) { toast('Erreur : ' + err.message, 'err'); }
  }
  if (e.target.id === 'cform') saveClient(e);
  if (e.target.id === 'txform') saveTx(e);
  if (e.target.id === 'sform') saveSettings(e);
});

/* ---------------- Actions ---------------- */
async function handleAction(act, d, el) {
  try {
    switch (act) {
      case 'open': return openProspect(d.id);
      case 'new': return openProspect(null);
      case 'filter': S.filter.status = d.status; S.view = 'prospects'; return render();
      case 'filter-trade': S.filter.trade = d.trade; return render();
      case 'ai-tab': S.aiTab = d.tab; return render();
      case 'copy-search': {
        S.aiTrades = $('#ai-trades').value; S.aiZone = $('#ai-zone').value; S.aiCount = Number($('#ai-count').value);
        return copy(searchPrompt({ trades: S.aiTrades || 'commerces de proximité', zone: S.aiZone, count: S.aiCount, exclude: S.prospects.map((p) => p.name) }));
      }
      case 'copy-notes': {
        const n = $('#ai-notes').value.trim();
        if (!n) return toast('Écris d\'abord tes notes', 'err');
        return copy(notesPrompt(n));
      }
      case 'copy-day': return copy(dayPrompt(daySummary()));
      case 'copy-audit': return copy(auditPrompt(S.prospects.find((p) => p.id === d.id)));
      case 'parse': {
        const { advice, items } = parseAI($('#ai-answer').value);
        const src = S.aiTab === 'notes' ? 'ia_notes' : 'ia_recherche';
        const mapped = items.map((it) => mapItem(it, src)).filter((it) => it.name)
          .map((it) => {
            const dup = S.prospects.find((p) => norm(p.name) === norm(it.name));
            return { ...it, _dup: dup?.id || null, _checked: true, _score: computeScore(it) };
          })
          .sort((a, b) => (a._prio ?? 9) - (b._prio ?? 9) || b._score - a._score);
        S.importPreview = { advice, items: mapped };
        renderPreview();
        $('#preview').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      case 'import': return importSelection(el);
      case 'set-status': {
        const p = S.prospects.find((x) => x.id === d.id);
        const patch = { status: d.status };
        if (d.status === 'perdu') { patch.next_action = null; patch.next_action_date = null; }
        await saveProspect(patch, d.id);
        toast(`${p.name} → ${STATUS[d.status].label}`);
        render();
        if (d.status === 'signe' && !S.clients.find((c) => c.prospect_id === d.id)) return convert(d.id);
        return openProspect(d.id);
      }
      case 'delete': {
        if (!confirm('Supprimer définitivement ce commerce ?')) return;
        const { error } = await sb.from('zf_prospects').delete().eq('id', d.id);
        if (error) throw error;
        S.prospects = S.prospects.filter((p) => p.id !== d.id);
        closeSheet(); render(); return toast('Supprimé');
      }
      case 'convert': return convert(d.id);
      case 'open-client': return openClient(d.id);
      case 'new-client': return openClient(null);
      case 'biz-tab': S.bizTab = d.tab; return render();
      case 'pay': return pay(d.id, d.kind);
      case 'del-tx': {
        if (!confirm('Supprimer cette opération ?')) return;
        const { error } = await sb.from('zf_transactions').delete().eq('id', d.id);
        if (error) throw error;
        S.tx = S.tx.filter((t) => t.id !== d.id); render(); return toast('Supprimé');
      }
      case 'del-client': {
        if (!confirm('Supprimer ce client ? (les encaissements restent dans les finances)')) return;
        const { error } = await sb.from('zf_clients').delete().eq('id', d.id);
        if (error) throw error;
        S.clients = S.clients.filter((c) => c.id !== d.id); closeSheet(); render(); return toast('Supprimé');
      }
      case 'settings': return openSettings();
      case 'export': return exportData();
      case 'logout': await sb.auth.signOut(); closeSheet(); return showLogin();
      case 'refresh': await loadAll(); render(); return toast('Données à jour ✓');
      case 'relocate': return relocateAll(el);
      case 'map-open': return openProspect(d.id);
    }
  } catch (err) { toast(err.message || 'Erreur', 'err'); }
}

async function importSelection(btn) {
  const items = S.importPreview.items.filter((it) => it._checked);
  if (!items.length) return toast('Rien de sélectionné', 'err');
  btn.disabled = true;
  let n = 0;
  for (const it of items) {
    btn.textContent = `Import… ${++n}/${items.length}`;
    const { _dup, _checked, _score, _prio, ...row } = it;
    if (_dup) {
      const old = S.prospects.find((p) => p.id === _dup);
      const patch = {};
      for (const [k, v] of Object.entries(row)) if (v != null && v !== '' && (old[k] == null || old[k] === '')) patch[k] = v;
      ['next_action', 'next_action_date'].forEach((k) => row[k] && (patch[k] = row[k]));
      if (row.notes && old.notes) patch.notes = `${old.notes}\n\n${row.notes}`;
      delete patch.status;
      if (patch.address) Object.assign(patch, (await geocode(patch)) || {});
      await saveProspect(patch, _dup);
    } else {
      const g = await geocode(row);
      if (g) Object.assign(row, g);
      await saveProspect(row, null);
    }
    await sleep(1100); // limite du service de géolocalisation gratuit
  }
  S.importPreview = null;
  toast(`${items.length} commerce${items.length > 1 ? 's' : ''} importé${items.length > 1 ? 's' : ''} ✓`);
  S.filter.status = 'a_verifier';
  S.view = 'prospects';
  render();
}

async function relocateAll(btn) {
  const todo = S.prospects.filter((p) => p.address && !p.lat);
  if (!todo.length) return toast('Tout est déjà localisé');
  btn.disabled = true;
  let n = 0;
  for (const p of todo) {
    btn.textContent = `${++n}/${todo.length}…`;
    const g = await geocode(p);
    if (g) await saveProspect(g, p.id);
    await sleep(1100);
  }
  toast('Localisation terminée ✓'); render();
}

/* ---------------- Vue : Carte ---------------- */
function viewMap() {
  const noLoc = S.prospects.filter((p) => p.address && !p.lat).length;
  return `
  <header class="hero row-head"><div><p class="eyebrow">Couleur = statut · taille = score</p><h1>Carte</h1></div>
  ${noLoc ? `<button class="btn sm" data-act="relocate">Localiser ${noLoc}</button>` : ''}</header>
  <div class="legend">${PIPE.filter((k) => S.prospects.some((p) => p.status === k)).map((k) => `<span><i style="background:${STATUS[k].color}"></i>${STATUS[k].label}</span>`).join('')}</div>
  <div id="map"></div>`;
}

function initMap() {
  if (!window.L) return;
  const st = S.settings;
  if (S.map) { S.map.remove(); S.map = null; }
  S.map = L.map('map', { zoomControl: false }).setView([st.home_lat, st.home_lng], 14);
  L.control.zoom({ position: 'bottomright' }).addTo(S.map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
  }).addTo(S.map);
  L.circleMarker([st.home_lat, st.home_lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#fff', fillOpacity: 0.9 })
    .addTo(S.map).bindTooltip(st.home_label || 'Point de départ');
  const pts = [];
  S.prospects.filter((p) => p.lat && p.lng).forEach((p) => {
    const c = STATUS[p.status].color;
    const m = L.circleMarker([p.lat, p.lng], { radius: 7 + p.score / 12, color: c, weight: 2, fillColor: c, fillOpacity: 0.35 }).addTo(S.map);
    m.bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.trade || '')} · score ${p.score}<br><span style="color:${c}">${STATUS[p.status].label}</span><br><button class="btn sm" data-act="map-open" data-id="${p.id}">Ouvrir la fiche</button>`);
    pts.push([p.lat, p.lng]);
  });
  if (pts.length) S.map.fitBounds([...pts, [st.home_lat, st.home_lng]], { padding: [40, 40], maxZoom: 15 });
  setTimeout(() => S.map && S.map.invalidateSize(), 200);
}

/* ---------------- Vue : Business (clients + finances) ---------------- */
function viewBiz() {
  return `
  <header class="hero row-head"><div><p class="eyebrow">Business</p><h1>${S.bizTab === 'money' ? 'Finances' : 'Clients'}</h1></div>
  ${S.bizTab === 'money' ? '' : '<button class="btn sm" data-act="new-client">+ Client</button>'}</header>
  <div class="seg">
    <button class="${S.bizTab !== 'money' ? 'on' : ''}" data-act="biz-tab" data-tab="clients">Clients</button>
    <button class="${S.bizTab === 'money' ? 'on' : ''}" data-act="biz-tab" data-tab="money">Finances</button>
  </div>
  ${S.bizTab === 'money' ? viewMoney() : viewClients()}`;
}

function clientPaid(c) {
  return S.tx.filter((t) => t.client_id === c.id && t.kind === 'entree').reduce((a, t) => a + Number(t.amount), 0);
}

function viewClients() {
  if (!S.clients.length) return '<p class="empty">Pas encore de client. Quand un commerce signe, passe-le en « Signé » : le client se crée automatiquement.</p>';
  return S.clients.map((c) => {
    const paid = clientPaid(c);
    const pct = c.price ? Math.min(100, Math.round((paid / c.price) * 100)) : 0;
    return `<button class="ccard" data-act="open-client" data-id="${c.id}">
      <div class="card-head"><b>${esc(c.name)}</b><span class="pill" style="--c:${c.status === 'en_cours' ? '#22d3ee' : '#34d399'}">${CLIENT_STATUS[c.status]}</span></div>
      <small class="muted">${esc(OFFERS[c.offer] || 'Formule ?')} · ${eur(c.price)}${c.due_date ? ` · livraison ${fmtDate(c.due_date)}` : ''}${c.maintenance_active ? ` · ${eur(c.maintenance_monthly)}/mois` : ''}</small>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <small>${eur(paid)} encaissés sur ${eur(c.price)}${!c.deposit_paid ? ' · <span class="late">acompte non reçu</span>' : ''}</small>
    </button>`;
  }).join('');
}

function viewMoney() {
  const st = stats();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const k = d.toLocaleDateString('sv-SE').slice(0, 7);
    months.push({ k, label: d.toLocaleDateString('fr-FR', { month: 'short' }), v: S.tx.filter((t) => t.kind === 'entree' && t.date.startsWith(k)).reduce((a, t) => a + Number(t.amount), 0) });
  }
  const max = Math.max(1, ...months.map((m) => m.v));
  return `
  <section class="kpis">
    <div class="kpi"><span>Capital de départ</span><b>${eur(S.settings.capital)}</b></div>
    <div class="kpi"><span>Trésorerie</span><b>${eur(st.cash)}</b></div>
    <div class="kpi"><span>Encaissé</span><b>${eur(st.income)}</b></div>
    <div class="kpi"><span>Dépensé</span><b>${eur(st.spent)}</b></div>
    <div class="kpi"><span>Bénéfice net</span><b class="${st.profit < 0 ? 'neg' : ''}">${eur(st.profit)}</b></div>
    <div class="kpi warn"><span>URSSAF à mettre de côté</span><b>${eur(st.urssafDue)}</b></div>
  </section>
  <section class="card">
    <h2>Encaissements · 6 derniers mois</h2>
    <div class="bars">${months.map((m) => `<div class="b"><div class="bv" style="height:${Math.max(3, (m.v / max) * 100)}%"><span>${m.v ? eur(m.v) : ''}</span></div><small>${m.label}</small></div>`).join('')}</div>
    <p class="hint">Récurrent : ${eur(st.recurring)}/mois · Taux URSSAF utilisé : ${S.settings.urssaf_rate} % (modifiable dans les réglages)</p>
  </section>
  <section class="card">
    <h2>Ajouter une opération</h2>
    <form id="txform">
      <div class="seg mini">
        <label><input type="radio" name="kind" value="depense" checked> Dépense</label>
        <label><input type="radio" name="kind" value="entree"> Entrée</label>
      </div>
      <div class="grid2">${field('Montant (€) *', 'amount', '', 'number', 'step="0.01" min="0" required')}${field('Date', 'date', today(), 'date')}</div>
      <div class="grid2"><label>Catégorie<select name="category">${[...new Set([...TX_CATS.depense, ...TX_CATS.entree])].map((c) => `<option>${c}</option>`).join('')}</select></label>
      ${field('Libellé', 'label', '', 'text', 'placeholder="ex : domaine zeynfreelance.fr"')}</div>
      <label>Client (optionnel)<select name="client_id"><option value="">—</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <button class="btn" type="submit">Ajouter</button>
    </form>
  </section>
  <section class="card">
    <h2>Historique</h2>
    ${S.tx.length ? S.tx.map((t) => `<div class="tx">
      <span class="${t.kind}">${t.kind === 'entree' ? '+' : '−'}${eur(t.amount)}</span>
      <span class="row-main"><b>${esc(t.label || t.category)}</b><small>${fmtDate(t.date)} · ${esc(t.category || '')}${t.client_id ? ' · ' + esc(S.clients.find((c) => c.id === t.client_id)?.name || '') : ''}</small></span>
      <button class="x" data-act="del-tx" data-id="${t.id}">✕</button></div>`).join('') : '<p class="empty">Aucune opération.</p>'}
  </section>`;
}

async function saveTx(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const row = { kind: fd.get('kind'), amount: num(fd.get('amount')), date: fd.get('date') || today(), category: fd.get('category'), label: fd.get('label').trim() || null, client_id: fd.get('client_id') || null };
  if (!row.amount) return toast('Montant manquant', 'err');
  const { data, error } = await sb.from('zf_transactions').insert(row).select().single();
  if (error) return toast(error.message, 'err');
  S.tx.unshift(data); S.tx.sort((a, b) => b.date.localeCompare(a.date));
  toast('Opération ajoutée ✓'); render();
}

/* ---------------- Clients ---------------- */
async function convert(prospectId) {
  const p = S.prospects.find((x) => x.id === prospectId);
  const price = p.quote_amount || p.estimated_price || 0;
  const { data, error } = await sb.from('zf_clients').insert({
    prospect_id: p.id, name: p.name, offer: p.recommended_offer, price, deposit_amount: Math.round(price * 0.4), start_date: today(),
  }).select().single();
  if (error) throw error;
  S.clients.unshift(data);
  if (p.status !== 'signe') await saveProspect({ status: 'signe' }, p.id);
  await saveProspect({ next_action: 'Encaisser l\'acompte puis commencer le site', next_action_date: today() }, p.id);
  toast('🎉 Client créé ! Félicitations');
  S.view = 'biz'; S.bizTab = 'clients'; render();
  openClient(data.id);
}

function openClient(id) {
  const c = id ? S.clients.find((x) => x.id === id) : { status: 'en_cours', start_date: today(), price: 0, deposit_amount: 0 };
  const paid = id ? clientPaid(c) : 0;
  const balance = Math.max(0, Number(c.price || 0) - paid);
  openSheet(`
  <div class="sheet-head"><div><h2>${id ? esc(c.name) : 'Nouveau client'}</h2>${id ? `<small class="muted">${eur(paid)} encaissés · reste ${eur(balance)}</small>` : ''}</div><button class="x" data-close>✕</button></div>
  ${id ? `<div class="quick">
    ${!c.deposit_paid ? `<button class="qbtn ok" data-act="pay" data-id="${id}" data-kind="deposit">💶 Acompte reçu (${eur(c.deposit_amount)})</button>` : ''}
    ${!c.balance_paid && balance > 0 ? `<button class="qbtn ok" data-act="pay" data-id="${id}" data-kind="balance">💶 Solde reçu (${eur(balance)})</button>` : ''}
    ${c.maintenance_active ? `<button class="qbtn" data-act="pay" data-id="${id}" data-kind="maintenance">🔁 Maintenance du mois (${eur(c.maintenance_monthly)})</button>` : ''}
    ${c.prospect_id ? `<button class="qbtn" data-act="open" data-id="${c.prospect_id}">📇 Fiche commerce</button>` : ''}
  </div>` : ''}
  <form id="cform" data-id="${id || ''}">
    ${field('Nom *', 'name', c.name, 'text', 'required')}
    <div class="grid2">${select('Formule', 'offer', OFFERS, c.offer, '—')}${select('Statut', 'status', CLIENT_STATUS, c.status)}</div>
    <div class="grid2">${field('Prix total (€)', 'price', c.price, 'number', 'step="0.01"')}${field('Acompte (€)', 'deposit_amount', c.deposit_amount, 'number', 'step="0.01"')}</div>
    <div class="grid2">${field('Début', 'start_date', c.start_date, 'date')}${field('Livraison prévue', 'due_date', c.due_date, 'date')}</div>
    ${field('Livré le', 'delivered_date', c.delivered_date, 'date')}
    <div class="grid2">${field('Maintenance (€/mois)', 'maintenance_monthly', c.maintenance_monthly, 'number', 'step="0.01"')}
    <label class="check"><input type="checkbox" name="maintenance_active" ${c.maintenance_active ? 'checked' : ''}> Maintenance active</label></div>
    ${area('Notes', 'notes', c.notes, 4)}
    <div class="actions">
      ${id ? `<button type="button" class="btn ghost danger" data-act="del-client" data-id="${id}">Supprimer</button>` : ''}
      <button class="btn" type="submit">Enregistrer</button>
    </div>
  </form>`);
}

async function saveClient(e) {
  e.preventDefault();
  const f = e.target, id = f.dataset.id || null, fd = new FormData(f);
  const row = {};
  for (const [k, v] of fd.entries()) row[k] = String(v).trim() || null;
  ['price', 'deposit_amount', 'maintenance_monthly'].forEach((k) => (row[k] = num(row[k]) ?? 0));
  row.maintenance_active = f.maintenance_active.checked;
  const q = id ? sb.from('zf_clients').update(row).eq('id', id).select().single() : sb.from('zf_clients').insert(row).select().single();
  const { data, error } = await q;
  if (error) return toast(error.message, 'err');
  const i = S.clients.findIndex((c) => c.id === data.id);
  if (i >= 0) S.clients[i] = data; else S.clients.unshift(data);
  if (data.prospect_id && data.delivered_date) {
    const p = S.prospects.find((x) => x.id === data.prospect_id);
    if (p && !['livre', 'maintenance'].includes(p.status)) await saveProspect({ status: data.maintenance_active ? 'maintenance' : 'livre', next_action: null, next_action_date: null }, p.id);
  }
  toast('Enregistré ✓'); closeSheet(); render();
}

async function pay(id, kind) {
  const c = S.clients.find((x) => x.id === id);
  const balance = Math.max(0, Number(c.price) - clientPaid(c));
  const amount = kind === 'deposit' ? Number(c.deposit_amount) : kind === 'balance' ? balance : Number(c.maintenance_monthly);
  const cat = { deposit: 'Acompte', balance: 'Solde', maintenance: 'Maintenance' }[kind];
  const val = prompt(`${cat} reçu de ${c.name} — montant (€) :`, amount);
  if (val == null) return;
  const amt = num(String(val).replace(',', '.'));
  if (!amt) return toast('Montant invalide', 'err');
  const { data, error } = await sb.from('zf_transactions').insert({ kind: 'entree', amount: amt, category: cat, label: `${cat} ${c.name}`, client_id: c.id, date: today() }).select().single();
  if (error) return toast(error.message, 'err');
  S.tx.unshift(data);
  const patch = kind === 'deposit' ? { deposit_paid: true } : kind === 'balance' ? { balance_paid: true } : null;
  if (patch) {
    const r = await sb.from('zf_clients').update(patch).eq('id', id).select().single();
    if (!r.error) Object.assign(c, r.data);
  }
  toast(`+${eur(amt)} encaissés 💰`);
  render(); openClient(id);
}

/* ---------------- Réglages ---------------- */
function openSettings() {
  const s = S.settings, g = s.goals || {};
  openSheet(`
  <div class="sheet-head"><div><h2>Réglages</h2></div><button class="x" data-close>✕</button></div>
  <form id="sform">
    <h3>Argent</h3>
    <div class="grid2">${field('Capital de départ (€)', 'capital', s.capital, 'number')}${field('Taux URSSAF à provisionner (%)', 'urssaf_rate', s.urssaf_rate, 'number', 'step="0.1"')}</div>
    <p class="hint">Mets le taux de ton activité (il baisse la 1re année avec l'ACRE). Dans le doute, garde un taux un peu haut : mieux vaut trop mettre de côté.</p>
    <h3>Point de départ des tournées</h3>
    ${field('Adresse ou lieu', 'home_label', s.home_label)}
    <h3>Objectifs</h3>
    <div class="grid2">${field('Commerces contactés (fin déc.)', 'contacts_dec', g.contacts_dec, 'number')}${field('Clients signés (3 mois)', 'clients_3m', g.clients_3m, 'number')}</div>
    <div class="grid2">${field('Encaissé (3 mois, €)', 'cash_3m', g.cash_3m, 'number')}${field('Revenu mensuel visé (12 mois, €)', 'monthly_12m', g.monthly_12m, 'number')}</div>
    <button class="btn" type="submit">Enregistrer</button>
  </form>
  <div class="actions col">
    <button class="btn ghost" data-act="refresh">Recharger les données</button>
    <button class="btn ghost" data-act="export">Exporter une sauvegarde (JSON)</button>
    <button class="btn ghost danger" data-act="logout">Se déconnecter</button>
  </div>`);
}

async function saveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const row = {
    capital: num(fd.get('capital')) ?? 0,
    urssaf_rate: num(fd.get('urssaf_rate')) ?? 0,
    home_label: fd.get('home_label').trim() || 'Béziers centre',
    goals: { contacts_dec: num(fd.get('contacts_dec')) || 30, clients_3m: num(fd.get('clients_3m')) || 3, cash_3m: num(fd.get('cash_3m')) || 1500, monthly_12m: num(fd.get('monthly_12m')) || 1000 },
  };
  if (row.home_label !== S.settings.home_label) {
    const g = await geocode({ address: row.home_label });
    if (g) { row.home_lat = g.lat; row.home_lng = g.lng; } else toast('Lieu introuvable, point inchangé', 'err');
  }
  const { data, error } = await sb.from('zf_settings').update(row).eq('id', 1).select().single();
  if (error) return toast(error.message, 'err');
  S.settings = data;
  // Recalcule les scores (la distance a pu changer)
  for (const p of S.prospects) {
    const s = computeScore(p);
    if (s !== p.score) { p.score = s; await sb.from('zf_prospects').update({ score: s }).eq('id', p.id); }
  }
  S.prospects.sort((a, b) => b.score - a.score);
  toast('Réglages enregistrés ✓'); closeSheet(); render();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ date: new Date().toISOString(), prospects: S.prospects, clients: S.clients, transactions: S.tx, settings: S.settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zeynfreelance-${today()}.json`;
  a.click();
}

/* ---------------- Démarrage ---------------- */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !$('#app').hidden && $('#sheet').hidden) {
    try { await loadAll(); render(); } catch {}
  }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
boot();
