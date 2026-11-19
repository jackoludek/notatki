// Android: udostępnianie do iKeepera z innych aplikacji, blokada aplikacji, zgoda na powiadomienia.
//
// Blokada (Ustawienia → Blokada, domyślnie wyłączona) włącza się przy starcie i po powrocie
// do aplikacji, która była w tle co najmniej minutę. Odblokowanie:
// - odcisk palca (albo PIN/wzór telefonu) – systemowe okno przez wtyczkę biometric,
// - własny gest: trzy szybkie stuknięcia i przytrzymanie palca przy czwartym. Przypadkiem się
//   go nie wykona: liczą się tylko krótkie stuknięcia w tym samym miejscu, szybko po sobie,
//   a na końcu przytrzymanie bez przesuwania.

import { wywolaj } from './most.js';
import { el, ikona } from './pomoc.js';
import { S, aktualizujNotatki } from './stan.js';
import { toast, bladToast } from './ui.js';

const T = window.__TAURI__;
const BLOKADA_PO_MS = 60000;
const STUKNIECIE_MS = 300;
const PRZERWA_MS = 600;
const PRZYTRZYMANIE_MS = 700;
const TOLERANCJA_PX = 24;

let schowano = 0;
let ekran = null;
let wymagaOdblokowania = false;
let cb = null;

function blokadaWlaczona() {
  return S.ustawienia.blokada && S.ustawienia.blokada !== 'brak';
}

function odblokuj() {
  wymagaOdblokowania = false;
  if (ekran) ekran.remove();
  ekran = null;
}

async function odciskiem() {
  try {
    await T.core.invoke('plugin:biometric|authenticate', {
      reason: 'Odblokuj Notatki',
      allowDeviceCredential: true,
      title: 'Notatki',
      cancelTitle: 'Anuluj',
    });
    odblokuj();
    return true;
  } catch {
    // Anulowano albo nie rozpoznano – ekran blokady zostaje, przycisk ponawia.
    return false;
  }
}

function podepnijGest(e) {
  let stukniecia = [];
  let wcisniecie = null;
  const zeruj = () => {
    if (wcisniecie) clearTimeout(wcisniecie.timer);
    wcisniecie = null;
    stukniecia = [];
  };
  e.addEventListener('pointerdown', (ev) => {
    const t = performance.now();
    const ostatnie = stukniecia[stukniecia.length - 1];
    if (ostatnie && (t - ostatnie.t > PRZERWA_MS || Math.hypot(ev.clientX - ostatnie.x, ev.clientY - ostatnie.y) > TOLERANCJA_PX * 2)) stukniecia = [];
    wcisniecie = { t, x: ev.clientX, y: ev.clientY, timer: null };
    if (stukniecia.length === 3) wcisniecie.timer = setTimeout(odblokuj, PRZYTRZYMANIE_MS);
  });
  e.addEventListener('pointermove', (ev) => {
    if (wcisniecie && Math.hypot(ev.clientX - wcisniecie.x, ev.clientY - wcisniecie.y) > TOLERANCJA_PX) zeruj();
  });
  e.addEventListener('pointerup', () => {
    if (!wcisniecie) return;
    clearTimeout(wcisniecie.timer);
    const t = performance.now();
    if (t - wcisniecie.t < STUKNIECIE_MS && stukniecia.length < 3) stukniecia.push({ t, x: wcisniecie.x, y: wcisniecie.y });
    else stukniecia = [];
    wcisniecie = null;
  });
  e.addEventListener('pointercancel', zeruj);
}

/** Zasłania treść, zanim aplikacja zejdzie z ekranu (i do chwili odblokowania). */
function zaslon() {
  if (ekran || !blokadaWlaczona()) return;
  const odcisk = S.ustawienia.blokada === 'odcisk';
  ekran = el(
    'div.blokada',
    // Bez nazwy programu (reguła Jacka z 24.10.2026): kłódka i jedno słowo mówią, co się stało.
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Zablokowane' },
    ikona('klodka', 'duza'),
    el('p.title-2', { tekst: 'Zablokowane' }),
    odcisk
      ? el('button.sugerowany.pigulka', { type: 'button', onclick: odciskiem }, 'Odblokuj')
      : el('p.przygaszony', { tekst: 'Trzy szybkie stuknięcia i przytrzymanie palca' }),
  );
  if (!odcisk) podepnijGest(ekran);
  document.body.append(ekran);
}

async function pokazBlokade() {
  if (!blokadaWlaczona()) return;
  wymagaOdblokowania = true;
  zaslon();
  if (S.ustawienia.blokada === 'odcisk') await odciskiem();
}

/**
 * Przed włączeniem blokady odciskiem: czy telefon ma odcisk (albo PIN) i czy go rozpoznaje.
 * Zwraca `false`, gdy blokady nie da się bezpiecznie włączyć – ustawienie zostaje bez zmian.
 */
export async function sprawdzBlokade(wartosc) {
  if (wartosc !== 'odcisk') {
    if (wartosc === 'gest') toast('Odblokowanie: trzy szybkie stuknięcia w jednym miejscu i przytrzymanie palca przy czwartym', { czas: 9000 });
    return true;
  }
  try {
    const s = await T.core.invoke('plugin:biometric|status');
    if (!s.isAvailable) {
      toast(s.error ? `Odcisk palca jest niedostępny: ${s.error}` : 'Ten telefon nie ma dodanego odcisku palca ani blokady ekranu', { czas: 9000 });
      return false;
    }
  } catch (e) {
    bladToast(e);
    return false;
  }
  // Próba teraz – blokada nie włączy się, jeśli odcisk nie działa.
  try {
    await T.core.invoke('plugin:biometric|authenticate', { reason: 'Potwierdź, że odcisk działa', allowDeviceCredential: true, title: 'Notatki', cancelTitle: 'Anuluj' });
    return true;
  } catch {
    toast('Nie potwierdzono odcisku – blokada została wyłączona');
    return false;
  }
}

/** Android 13+: zgoda na powiadomienia (przypomnienia). Pytamy raz, gdy jest potrzebna. */
export async function zezwolNaPowiadomienia() {
  try {
    const jest = await T.core.invoke('plugin:notification|is_permission_granted');
    if (jest === true) return true;
    const r = await T.core.invoke('plugin:notification|request_permission');
    if (r === 'granted') return true;
    toast('Bez zgody na powiadomienia przypomnienia widać tylko w aplikacji (widok Przypomnienia)', { czas: 9000 });
  } catch {
    /* starszy Android – zgoda nie jest potrzebna */
  }
  return false;
}

/** To, co udostępniono z innych aplikacji, trafia do nowych notatek. */
async function pobierzUdostepnione() {
  try {
    const r = await wywolaj('udostepnione');
    if (!r.notatki.length) return;
    aktualizujNotatki(r.notatki);
    await cb.poZmianach();
    if (r.notatki.length === 1) await cb.otworz(r.notatki[0].id);
    toast(r.notatki.length === 1 ? 'Dodano notatkę z udostępnienia' : `Dodano ${r.notatki.length} notatki z udostępnienia`);
  } catch (e) {
    bladToast(e);
  }
}

/**
 * Dotknięte przypomnienie: id notatki czeka w aktywności (MainActivity.kt), aż interfejs je odbierze.
 * Przy zimnym starcie pytamy po wczytaniu notatek, a działający interfejs woła aktywność sama.
 */
function zPowiadomienia() {
  const m = window.NotatkiAndroid;
  // „Zrobione” w przypomnieniu: sprawa załatwiona bez otwierania notatki.
  const z = m && m.doZalatwienia ? m.doZalatwienia() : '';
  if (z && cb.zalatw) cb.zalatw(z);
  const id = m && m.doOtwarcia ? m.doOtwarcia() : '';
  if (id) cb.zPowiadomienia(id);
}

/** Przypomnienia przyszły z innego urządzenia, a zgody jeszcze nie było – zapytaj raz. */
async function zgodaDlaPrzypomnien() {
  let pytano = false;
  try {
    pytano = localStorage.getItem('zgoda_powiadomien') === 'tak';
  } catch {
    /* bez pamięci przeglądarki */
  }
  if (pytano || S.ustawienia.przypomnienia === false) return;
  const teraz = Date.now();
  // Powtarzane: pierwsza chwila bywa w przeszłości – liczy się najbliższy termin z rdzenia.
  const sa = [...S.notatki.values()].some((n) => n.tresc.przypomnienie && !n.tresc.przypomnienie.zrobione && !n.tresc.kosz && (S.nastepne.get(n.id) ?? n.tresc.przypomnienie.czas) > teraz);
  if (!sa) return;
  try {
    localStorage.setItem('zgoda_powiadomien', 'tak');
  } catch {
    /* bez pamięci przeglądarki */
  }
  await zezwolNaPowiadomienia();
}

/**
 * Pełny ekran (MainActivity.kt, reguła pelny-ekran-telefon): pasek stanu jest schowany, a przy otworze aparatu stoi pas,
 * który jest marginesem widoku, a nie częścią strony. Dostaje kolor tego, co widać w pierwszym wierszu strony, więc nagłówek
 * przechodzi w niego bez szwu: ekran blokady albo okno na całej górze (Ustawienia), inaczej nagłówek ekranu (lista, notatka,
 * Porządki AI), a pod zasłoną okna nagłówek przyciemniony. Do aktywności idzie tylko zmiana. Oddaje funkcję, która liczy
 * kolor od razu (testy), albo null bez mostu.
 */
export function sledzKolorGory() {
  const m = window.NotatkiAndroid;
  if (!m || !m.gora) return null;
  // Kolor ze stylu jako [r, g, b, a] w 0–255: rgb() i rgba() (z przecinkami albo ze spacjami i ukośnikiem), color(srgb …)
  // i #rrggbb. Wprost z napisu, bez płótna: odczyt płótna bywa zaszumiony (Brave dodaje szum przeciw odciskom przeglądarki).
  const rgba = (c) => {
    const t = String(c || '').trim();
    const alfa = (a) => (a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));
    let m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3], alfa(m[4]) * 255].map(Math.round);
    m = t.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, alfa(m[4]) * 255].map(Math.round);
    m = t.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255];
    return [0, 0, 0, 0];
  };
  const naGorze = (e) => {
    if (!e || !e.getClientRects().length) return false;
    const r = e.getBoundingClientRect();
    const x = innerWidth / 2;
    return r.top <= 1 && r.bottom > 1 && r.left <= x && r.right > x;
  };
  // Najgłębszy element `w` w pierwszym wierszu strony, a od niego w górę drzewa pierwsze pełne tło.
  const tlo = (w) => {
    let e = w;
    for (const d of w.querySelectorAll('*')) if (naGorze(d)) e = d;
    for (; e && e.nodeType === 1; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] === 255) return c;
    }
    return rgba(getComputedStyle(document.body).backgroundColor);
  };
  const przyciemnij = (k, z) => [0, 1, 2].map((i) => Math.round(z[i] * (z[3] / 255) + k[i] * (1 - z[3] / 255)));
  const kolor = () => {
    if (ekran && naGorze(ekran)) return tlo(ekran);
    let zaslona = null;
    const okna = [...document.querySelectorAll('dialog[open]')];
    for (let i = okna.length - 1; i >= 0; i--) {
      if (naGorze(okna[i])) return zaslona ? przyciemnij(tlo(okna[i]), zaslona) : tlo(okna[i]);
      if (!zaslona && okna[i].matches(':modal')) zaslona = rgba(getComputedStyle(document.documentElement).getPropertyValue('--zaslona').trim());
    }
    const k = tlo(document.querySelector('.naglowek') || document.body);
    return zaslona ? przyciemnij(k, zaslona) : k;
  };
  let ostatni = '';
  let klatka = 0;
  const zglos = () => {
    klatka = 0;
    const hex = `#${kolor().slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (hex === ostatni) return;
    ostatni = hex;
    m.gora(hex);
  };
  const pozniej = () => {
    if (!klatka) klatka = requestAnimationFrame(zglos);
  };
  // Co zmienia górę: ekran (data-ekran), motyw (data-motyw), ekran blokady (dziecko body) i okna (open w całym drzewie).
  // Bez śledzenia całego drzewa: lista rysuje się przy każdym klawiszu w szukaniu.
  const zmiany = new MutationObserver(pozniej);
  zmiany.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motyw', 'class'] });
  zmiany.observe(document.body, { attributes: true, attributeFilter: ['data-ekran', 'class'], childList: true });
  new MutationObserver(pozniej).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('resize', pozniej);
  zglos();
  return zglos;
}

/** `zwrotne`: { poZmianach(), otworz(id), zPowiadomienia(id) } z app.js. */
export async function uruchomTelefon(zwrotne) {
  cb = zwrotne;
  sledzKolorGory();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      schowano = Date.now();
      zaslon();
    } else {
      if (wymagaOdblokowania || (blokadaWlaczona() && Date.now() - schowano >= BLOKADA_PO_MS)) pokazBlokade();
      else odblokuj();
      pobierzUdostepnione();
    }
  });
  if (blokadaWlaczona()) await pokazBlokade();
  await pobierzUdostepnione();
  window.__notatkiPowiadomienie = zPowiadomienia;
  zPowiadomienia();
  zgodaDlaPrzypomnien();
}
