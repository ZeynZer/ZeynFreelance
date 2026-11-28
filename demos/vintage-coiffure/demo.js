// Démo Vintage Coiffure — données et temps réel partagés entre la vue client et la vue salon.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const SALON = {
  name: 'Vintage Coiffure',
  address: '110 Bd de la Liberté, 34500 Béziers',
  phone: '09 81 17 64 84',
  maps: 'https://www.google.com/maps/place/Vintage+Coiffure/@43.3370144,3.2251687,17z',
  rating: 4.5,
  reviews: 26,
};

// Prix donnés par Mohamed (coupe + barbe à confirmer)
export const SERVICES = [
  { id: 'coupe', name: 'Coupe homme', desc: 'Shampoing, coupe, coiffage', price: 13, duration: 30 },
  { id: 'coupe-barbe', name: 'Coupe + barbe', desc: 'Coupe complète et taille de barbe soignée', price: 18, duration: 45 },
];
export const WALK_IN_PRICE = 10;

// Prénoms fictifs, à remplacer par ceux de l'équipe
export const BARBERS = [
  { id: 'karim', name: 'Karim', role: 'Gérant', initials: 'K', hue: 32 },
  { id: 'yanis', name: 'Yanis', role: 'Coiffeur', initials: 'Y', hue: 150 },
  { id: 'mehdi', name: 'Mehdi', role: 'Coiffeur', initials: 'M', hue: 205 },
  { id: 'lucas', name: 'Lucas', role: 'Coiffeur', initials: 'L', hue: 350 },
];

export const OPEN = { start: 9 * 60, end: 20 * 60, closed: [0] }; // fermé le dimanche
export const SLOT = 30;

export const fmtTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
export const dayKey = (d) => d.toLocaleDateString('sv-SE');
export const dayLabel = (d, long = false) =>
  d.toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric' });

export function nextDays(n = 7) {
  const out = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  while (out.length < n) {
    if (!OPEN.closed.includes(d.getDay())) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Rendez-vous fictifs déjà pris, identiques sur les deux vues (générés à partir de la date)
const FIRST = ['Sofiane', 'Thomas', 'Bilal', 'Hugo', 'Nassim', 'Enzo', 'Rayan', 'Julien', 'Ilyes', 'Maxime', 'Adam', 'Théo', 'Samir', 'Nathan', 'Walid', 'Kylian'];
function rng(seed) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export function fakeBookings(key) {
  const r = rng(key);
  const list = [];
  for (const b of BARBERS) {
    for (let m = OPEN.start; m < OPEN.end; m += SLOT) {
      const busy = r() < (m >= 12 * 60 && m < 17 * 60 ? 0.55 : 0.32);
      if (busy) {
        const sv = r() < 0.6 ? SERVICES[0] : SERVICES[1];
        list.push({ barber: b.id, start: m, service: sv.id, client: FIRST[Math.floor(r() * FIRST.length)], fake: true });
        if (sv.duration > SLOT) m += SLOT;
      }
    }
  }
  return list;
}

export function isFree(bookings, barber, start, duration) {
  const end = start + duration;
  if (end > OPEN.end) return false;
  return !bookings.some((b) => {
    if (b.barber !== barber) return false;
    const bd = SERVICES.find((s) => s.id === b.service)?.duration || SLOT;
    return start < b.start + bd && b.start < end;
  });
}

/* ---------- Temps réel : Supabase Broadcast (+ secours sur le même appareil) ---------- */
const sb = createClient('https://umqztmjhvkelviddnjcm.supabase.co', 'sb_publishable_g2Lz5vdW6iZxvk4ecnpp_g_Jh7y-AoV', {
  auth: { persistSession: false },
});
const local = 'BroadcastChannel' in window ? new BroadcastChannel('vintage-demo') : null;
let channel = null;
const handlers = {};

export function connect() {
  if (channel) return channel;
  channel = sb.channel('vintage-coiffure-demo', { config: { broadcast: { self: false } } });
  ['booking', 'status'].forEach((ev) =>
    channel.on('broadcast', { event: ev }, ({ payload }) => handlers[ev]?.(payload)));
  channel.subscribe();
  if (local) local.onmessage = (e) => handlers[e.data.event]?.(e.data.payload);
  return channel;
}
export function on(event, fn) { handlers[event] = fn; }
export function send(event, payload) {
  connect();
  channel.send({ type: 'broadcast', event, payload }).catch(() => {});
  local?.postMessage({ event, payload });
}
