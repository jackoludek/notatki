// Układ okna: szerokość paska bocznego i listy notatek, położenie tekstu notatki i napis na przycisku paska.
//
// Jacek, 15.10.2026: kolumnę tekstu „połowę w lewo”, z ustawieniem i „super light, niewidocznym” uchwytem, oraz
// widoczna informacja, że lewy pasek da się zwinąć. Każdy uchwyt jest niewidoczny, póki kursor nie stanie na
// krawędzi (wtedy cienka kreska). Przeciąganie zmienia, dwuklik wraca do wartości domyślnej, a z klawiatury działają
// strzałki, Home, End i Enter (wzorzec „window splitter” z WAI-ARIA). Pasek przeciągnięty prawie do zera chowa się,
// jak w macOS. Wartości zostają na tym urządzeniu (pamięć przeglądarki), jak powiększenie i kolejność przycisków.

import { ogloszenie } from './ui.js';
import { ustawDymek, liczba } from './pomoc.js';

const KLUCZ = 'ikeeper.uklad';
/**
 * Domyślnie: pasek 216 px (13,5 rem), lista 320 px (20 rem), tekst blisko lewego brzegu, jak na kartce papieru (Jacek,
 * 21.10.2026: „bliżej brzegu … jak kartka papieru”; wzrok zaczyna od lewej, NNg: „uwaga w poziomie idzie w lewo”).
 * Do 21.10.2026 było 0,25, w połowie drogi od środka w lewo (Jacek, 15.10.2026).
 */
export const DOMYSLNE = Object.freeze({ pasek: 216, lista: 320, tekst: 0.1, kafle: 1 });
/** Zapis z dawną wartością domyślną przechodzi na nową raz, przy pierwszym starcie tej wersji. */
const DAWNE_POLOZENIE = 0.25;
const GRANICE = { pasek: [168, 360], lista: [260, 560], kafle: [1, 5] };
/** Tyle pikseli ruchu znacznika pod listą to jedna linia podglądu w kafelku więcej albo mniej. */
const KROK_KAFLI = 24;
/** Pasek przeciągnięty węziej niż tyle pikseli chowa się (wraca przyciskiem albo F9). */
const SCHOWAJ_PONIZEJ = 120;
/** Tyle co najmniej zostaje na notatkę obok listy, gdy okno jest wąskie. */
const MIN_NOTATKA = 360;
const SZEROKO = window.matchMedia('(min-width: 1101px)');
const TELEFON = window.matchMedia('(max-width: 760px)');

let uklad = wczytaj();

function wczytaj() {
  const w = { ...DOMYSLNE };
  try {
    const v = JSON.parse(localStorage.getItem(KLUCZ) || '{}') || {};
    if (Number.isFinite(v.pasek)) w.pasek = ogranicz(v.pasek, GRANICE.pasek);
    if (Number.isFinite(v.lista)) w.lista = ogranicz(v.lista, GRANICE.lista);
    if (Number.isFinite(v.tekst)) w.tekst = Math.min(1, Math.max(0, v.tekst));
    if (Number.isFinite(v.kafle)) w.kafle = ogranicz(v.kafle, GRANICE.kafle);
    if (!v.wersja && w.tekst === DAWNE_POLOZENIE) w.tekst = DOMYSLNE.tekst;
  } catch {
    /* uszkodzony zapis: zostają wartości domyślne */
  }
  return w;
}

function zapisz() {
  try {
    localStorage.setItem(KLUCZ, JSON.stringify({ ...uklad, wersja: 2 }));
  } catch {
    /* bez pamięci przeglądarki układ zostaje do zamknięcia okna */
  }
}

function ogranicz(v, [a, b]) {
  return Math.round(Math.min(b, Math.max(a, v)));
}

function pasekWidac() {
  return SZEROKO.matches && !document.body.classList.contains('bez-paska');
}

/** Lista nie zabiera notatce miejsca, gdy okno jest wąskie (zapisana szerokość zostaje). */
function szerokoscListy() {
  const reszta = window.innerWidth - (pasekWidac() ? uklad.pasek : 0) - MIN_NOTATKA;
  return Math.max(GRANICE.lista[0], Math.min(uklad.lista, reszta));
}

function opisTekstu(f) {
  const p = Math.round(f * 100);
  if (p === 50) return '50%, na środku';
  if (p === 0) return '0%, przy lewej krawędzi';
  if (p === 100) return '100%, przy prawej krawędzi';
  return `${p}%, ${p < 50 ? 'między lewą krawędzią a środkiem' : 'między środkiem a prawą krawędzią'}`;
}

/** „2 linie podglądu” */
function opisKafli(n) {
  return `${liczba(n, 'linia', 'linie', 'linii')} podglądu`;
}

function zastosuj() {
  const s = document.documentElement.style;
  s.setProperty('--szer-paska', `${uklad.pasek}px`);
  s.setProperty('--szer-listy', `${szerokoscListy()}px`);
  s.setProperty('--polozenie-tekstu', String(uklad.tekst));
  s.setProperty('--linie-podgladu', String(uklad.kafle));
  document.documentElement.classList.toggle('wysokie-kafle', uklad.kafle > 1);
  const uk = document.getElementById('uchwyt-kafli');
  if (uk) {
    uk.setAttribute('aria-valuenow', String(uklad.kafle));
    uk.setAttribute('aria-valuetext', opisKafli(uklad.kafle));
    // Ręcznie ustawiona wysokość: znacznik w akcencie, jak w panelu Sesji Kiro (widać, że to nie domyślna).
    uk.classList.toggle('reczna', uklad.kafle !== DOMYSLNE.kafle);
  }
  const up = document.getElementById('uchwyt-paska');
  if (up) {
    up.setAttribute('aria-valuenow', String(uklad.pasek));
    up.setAttribute('aria-valuetext', `${uklad.pasek} pikseli`);
  }
  const ul = document.getElementById('uchwyt-listy');
  if (ul) {
    ul.setAttribute('aria-valuenow', String(szerokoscListy()));
    ul.setAttribute('aria-valuetext', `${szerokoscListy()} pikseli`);
    ul.setAttribute('aria-valuemax', String(GRANICE.lista[1]));
  }
  const ut = document.getElementById('e-polozenie');
  if (ut) {
    ut.setAttribute('aria-valuenow', String(Math.round(uklad.tekst * 100)));
    ut.setAttribute('aria-valuetext', opisTekstu(uklad.tekst));
  }
}

/** Położenie tekstu notatki: 0 przy lewej krawędzi, 0,5 na środku, 1 przy prawej. */
export function polozenieTekstu() {
  return uklad.tekst;
}

export function ustawPolozenieTekstu(f) {
  uklad.tekst = Math.round(Math.min(1, Math.max(0, f)) * 100) / 100;
  zastosuj();
  zapisz();
}

export function opisPolozenia(f = uklad.tekst) {
  return opisTekstu(f);
}

/** Linie podglądu w kafelku: 1 (domyślnie) do 5. Wyższy kafelek pokazuje więcej tekstu notatki. */
export function liniePodgladu() {
  return uklad.kafle;
}

export function ustawLiniePodgladu(n) {
  const bylo = uklad.kafle;
  uklad.kafle = ogranicz(n, GRANICE.kafle);
  zastosuj();
  zapisz();
  if (uklad.kafle !== bylo) zmienionoKafle();
}

/** Lista rysuje się od nowa (js/lista.js): pozycje list w kafelku po przecinku albo w osobnych liniach. */
function zmienionoKafle() {
  window.dispatchEvent(new Event('notatki:kafle'));
}

export function opisLiniiPodgladu(n = uklad.kafle) {
  return opisKafli(n);
}

/** Napis na przycisku paska bocznego mówi, co się stanie: „Schowaj” albo „Pokaż”. */
function opiszPrzelacznik() {
  const b = document.getElementById('pasek-przelacz');
  if (!b) return;
  const widac = SZEROKO.matches ? !document.body.classList.contains('bez-paska') : document.body.classList.contains('pasek-otwarty');
  const nazwa = widac ? 'Schowaj pasek boczny' : 'Pokaż pasek boczny';
  if (b.getAttribute('aria-label') === nazwa) return;
  b.setAttribute('aria-label', nazwa);
  ustawDymek(b, `${nazwa} (F9)`);
  b.setAttribute('aria-expanded', widac ? 'true' : 'false');
}

/**
 * Przeciąganie uchwytu: `start` zapamiętuje stan na początku, `ruch` liczy nową wartość, `koniec` zapisuje.
 * Wskaźnik zostaje przy uchwycie (setPointerCapture), więc ruch poza kreską też działa.
 */
function ciagnij(uchwyt, { start, ruch, koniec, klasa = 'ciagniecie-uchwytu' }) {
  uchwyt.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const s = start(ev);
    if (!s) return;
    uchwyt.setPointerCapture(ev.pointerId);
    uchwyt.classList.add('ciagniety');
    document.body.classList.add(klasa);
    const przesun = (e) => ruch(e, s);
    const pusc = (e) => {
      uchwyt.removeEventListener('pointermove', przesun);
      uchwyt.removeEventListener('pointerup', pusc);
      uchwyt.removeEventListener('pointercancel', pusc);
      uchwyt.classList.remove('ciagniety');
      document.body.classList.remove(klasa);
      koniec(e, s);
    };
    uchwyt.addEventListener('pointermove', przesun);
    uchwyt.addEventListener('pointerup', pusc);
    uchwyt.addEventListener('pointercancel', pusc);
  });
}

/** Klawisze uchwytu: strzałki o krok (z Shift o trzy), Home i End do granic, Enter do wartości domyślnej. */
function klawisze(uchwyt, { krok, zmien, domyslna }) {
  uchwyt.addEventListener('keydown', (ev) => {
    const o = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[ev.key];
    if (o) zmien((v) => v + o * krok * (ev.shiftKey ? 3 : 1));
    else if (ev.key === 'Home') zmien(() => -Infinity);
    else if (ev.key === 'End') zmien(() => Infinity);
    else if (ev.key === 'Enter') domyslna();
    else return;
    ev.preventDefault();
  });
  uchwyt.addEventListener('dblclick', domyslna);
}

function podepnijPasek() {
  const u = document.getElementById('uchwyt-paska');
  if (!u) return;
  ciagnij(u, {
    start: (ev) => ({ x: ev.clientX, w: uklad.pasek, surowa: uklad.pasek }),
    ruch: (e, s) => {
      s.surowa = s.w + e.clientX - s.x;
      uklad.pasek = ogranicz(s.surowa, GRANICE.pasek);
      zastosuj();
    },
    koniec: (e, s) => {
      if (s.surowa < SCHOWAJ_PONIZEJ) {
        // Jak w macOS: pasek ściśnięty do zera chowa się, a po pokazaniu ma dawną szerokość.
        uklad.pasek = s.w;
        zastosuj();
        document.getElementById('pasek-przelacz')?.click();
      }
      zapisz();
    },
  });
  klawisze(u, {
    krok: 16,
    zmien: (f) => {
      uklad.pasek = ogranicz(f(uklad.pasek), GRANICE.pasek);
      zastosuj();
      zapisz();
    },
    domyslna: () => {
      uklad.pasek = DOMYSLNE.pasek;
      zastosuj();
      zapisz();
      ogloszenie('Pasek boczny: domyślna szerokość');
    },
  });
}

function podepnijListe() {
  const u = document.getElementById('uchwyt-listy');
  if (!u) return;
  ciagnij(u, {
    start: (ev) => ({ x: ev.clientX, w: szerokoscListy() }),
    ruch: (e, s) => {
      uklad.lista = ogranicz(s.w + e.clientX - s.x, GRANICE.lista);
      // Przy wąskim oknie granica z prawej to miejsce na notatkę.
      uklad.lista = Math.min(uklad.lista, Math.max(GRANICE.lista[0], window.innerWidth - (pasekWidac() ? uklad.pasek : 0) - MIN_NOTATKA));
      zastosuj();
    },
    koniec: zapisz,
  });
  klawisze(u, {
    krok: 16,
    zmien: (f) => {
      uklad.lista = ogranicz(f(szerokoscListy()), GRANICE.lista);
      zastosuj();
      zapisz();
    },
    domyslna: () => {
      uklad.lista = DOMYSLNE.lista;
      zastosuj();
      zapisz();
      ogloszenie('Lista notatek: domyślna szerokość');
    },
  });
}

/** Wolne miejsce obok kartki notatki (px) i lewy brzeg miejsca na nią. */
function miejsceTekstu() {
  const ed = document.querySelector('#widok-edytor .edytor');
  const karta = document.getElementById('e-karta');
  if (!ed || !karta || !ed.offsetParent) return null;
  const st = getComputedStyle(ed);
  const r = ed.getBoundingClientRect();
  const lewo = r.left + parseFloat(st.paddingLeft);
  const szer = r.width - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
  return { lewo, wolne: Math.max(0, szer - karta.offsetWidth), karta };
}

function podepnijTekst() {
  const u = document.getElementById('e-polozenie');
  if (!u) return;
  ciagnij(u, {
    start: (ev) => {
      const m = miejsceTekstu();
      if (!m || m.wolne < 8) return null;
      return { ...m, chwyt: ev.clientX - m.karta.getBoundingClientRect().left };
    },
    ruch: (e, s) => {
      uklad.tekst = Math.round(Math.min(1, Math.max(0, (e.clientX - s.chwyt - s.lewo) / s.wolne)) * 100) / 100;
      zastosuj();
    },
    koniec: zapisz,
  });
  klawisze(u, {
    krok: 0.05,
    zmien: (f) => ustawPolozenieTekstu(f(uklad.tekst)),
    domyslna: () => {
      ustawPolozenieTekstu(DOMYSLNE.tekst);
      ogloszenie(`Położenie tekstu: ${opisTekstu(DOMYSLNE.tekst)}`);
    },
  });
  // Uchwyt tekstu jest tylko wtedy, gdy obok kartki jest wolne miejsce (szerokie okno).
  const ed = document.querySelector('#widok-edytor .edytor');
  if (ed && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      const m = miejsceTekstu();
      u.hidden = !m || m.wolne < 8 || TELEFON.matches;
    }).observe(ed);
  }
}

/**
 * Znacznik pod listą (zadanie 20, Jacek, 21.10.2026: „na dole taki znacznik i jego można rozciągać albo dwuklik na niego i ona
 * się ściągają do default”, jak w panelu Sesji Kiro): ruch w dół o 24 px to jedna linia podglądu więcej, w górę mniej.
 * Kafelki rosną od razu, w trakcie przeciągania. Strzałka w dół i w górę, Home, End, a Enter i dwuklik wracają do domyślnej.
 */
function podepnijKafle() {
  const u = document.getElementById('uchwyt-kafli');
  if (!u) return;
  ciagnij(u, {
    klasa: 'ciagniecie-kafli',
    start: (ev) => ({ y: ev.clientY, n: uklad.kafle }),
    ruch: (e, s) => {
      const n = ogranicz(s.n + Math.round((e.clientY - s.y) / KROK_KAFLI), GRANICE.kafle);
      if (n === uklad.kafle) return;
      const przed = u.getBoundingClientRect().top;
      uklad.kafle = n;
      zastosuj();
      // Kafelki rosną nad znacznikiem: lista przewija się o tyle samo, więc znacznik zostaje pod kursorem.
      const kol = document.getElementById('kolumna-listy');
      if (kol) kol.scrollTop += u.getBoundingClientRect().top - przed;
    },
    koniec: (e, s) => {
      zapisz();
      if (uklad.kafle !== s.n) zmienionoKafle();
    },
  });
  u.addEventListener('keydown', (ev) => {
    const o = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
    let n = uklad.kafle;
    if (o) n += o;
    else if (ev.key === 'Home') n = GRANICE.kafle[0];
    else if (ev.key === 'End') n = GRANICE.kafle[1];
    else if (ev.key === 'Enter') n = DOMYSLNE.kafle;
    else return;
    ev.preventDefault();
    ustawLiniePodgladu(n);
    ogloszenie(`Kafelki: ${opisKafli(uklad.kafle)}`);
  });
  u.addEventListener('dblclick', () => {
    ustawLiniePodgladu(DOMYSLNE.kafle);
    ogloszenie('Kafelki: domyślna wysokość');
  });
}

/** Wołane raz przy starcie (js/app.js). */
export function podepnijUklad() {
  zastosuj();
  opiszPrzelacznik();
  podepnijPasek();
  podepnijListe();
  podepnijTekst();
  podepnijKafle();
  let klatka = 0;
  const odswiez = () => {
    cancelAnimationFrame(klatka);
    klatka = requestAnimationFrame(() => {
      zastosuj();
      opiszPrzelacznik();
    });
  };
  // Pasek schowany, wysunięty albo okno zwężone: inne miejsce na listę i inny napis na przycisku.
  new MutationObserver(odswiez).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', odswiez);
  SZEROKO.addEventListener('change', odswiez);
}