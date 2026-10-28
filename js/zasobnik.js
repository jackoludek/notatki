// Panel przy zegarze (Windows): prawy klik w ikonę Notatek w zasobniku. Szklana karta jak w programie Dyktowanie (projekt 17;
// Jacek, 25.10.2026: „taki fajny glass … nie przełączniki, tylko liquid glass buttons sugerowane troszeczkę”). Na górze dwa
// przyciski, które robią dwie różne rzeczy: „Napisz notatkę” otwiera Notatki z nową notatką, „Przyklej karteczkę” stawia nową
// karteczkę na pulpicie. Pod nimi gotowe karteczki: klik pokazuje karteczkę (także schowaną X-em). Na dole Zakończ i Otwórz Notatki.
//
// Okno robi 04 --- Windows - Rust i Tauri\src\zasobnik.rs. Kolejno: zdarzenie „zasobnik”, lista karteczek, rozmiar karty („miejsce”:
// okno staje w prawym dolnym rogu ekranu i program robi zdjęcie ekranu spod niego), zdjęcie jako tło szkła („zasobnik_tlo”),
// pokazanie okna i pierwsza klatka szkła. Escape, klik obok karty i utrata fokusu chowają panel.
//
// Bez Tauri (zwykła przeglądarka) strona jest pokazem do zrzutów i pomiarów: ?tlo=<obraz> pod szkłem (bez niego kolorowe plamy),
// ?ciemny=1, ?bezszkla=1, ?ile=<liczba karteczek>, ?test=1 (pomiar jasności szkła i kontrastu w <pre id="wynik">).

import { el, ikona, $, $$, czasPrzypomnienia } from './pomoc.js';
import { podepnijDymki } from './dymki.js';
import { swiatloPrzyciskow } from './guziki.js';

const T = window.__TAURI__;
const naTauri = Boolean(T && T.core);
const par = new URLSearchParams(location.search);
const MARGINES = 24;
const MAKS_WIERSZY = 5;
const body = document.body;
const karta = $('#karta');
const canvas = $('#gl');
const ciemnyMQ = matchMedia('(prefers-color-scheme: dark)');

function ciemny() {
  return par.has('ciemny') ? par.get('ciemny') === '1' : ciemnyMQ.matches;
}
function ustawMotyw() {
  document.documentElement.dataset.motyw = ciemny() ? 'ciemny' : 'jasny';
}
ustawMotyw();

function blad(tekst) {
  if (naTauri) T.core.invoke('blad_ui', { tekst: `zasobnik: ${tekst}` }).catch(() => {});
}
addEventListener('error', (e) => blad(`${e.message} (${e.filename}:${e.lineno})`));
addEventListener('unhandledrejection', (e) => blad(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

/** Polecenie panelu (zasobnik.rs). W pokazie nic nie robi. */
function komenda(akcja, dane = {}) {
  return naTauri ? T.core.invoke('zasobnik', { akcja, ...dane }) : Promise.resolve(null);
}

// ---------- Szkło ----------
// Reduce Transparency, Increase Contrast i forced-colors z systemu (Apple HIG: szkło musi to znieść): pełna karta zamiast WebGL.
const mqSzkla = [matchMedia('(prefers-reduced-transparency: reduce)'), matchMedia('(prefers-contrast: more)'), matchMedia('(forced-colors: active)')];
const silnik = window.Szklo ? window.Szklo.utworz(canvas) : null;
let maTlo = false;
function bezSzkla() {
  return par.get('bezszkla') === '1' || mqSzkla.some((m) => m.matches);
}
function stanSzkla() {
  body.classList.toggle('bez-gl', !silnik || !maTlo || bezSzkla());
}
function rola(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

/**
 * Materiał szkła. Ciemny jak w Dyktowaniu (Jacek go lubi): przydymione, prawie czarne szkło z kolorowym, giętym brzegiem.
 * Jasny mniej mleczny niż tam: pas jasności od progu kontrastu napisów (co najmniej 0,52), mniej bieli w odcieniu i więcej
 * nasycenia, więc pod kartą widać kolory pulpitu, a mocniejszy cień i ciemniejsza obwódka odcinają kartę od jasnego tła.
 */
function opcje() {
  const c = ciemny();
  const kolory = [rola('--tekst'), rola('--z-drugi')];
  if (c) {
    const prog = window.Szklo.gornaGranica(kolory, 4.5);
    return { ciemny: 1, rozmycie: 12, odcien: 0.14, nasycenie: 1.55, lmin: 0, lmax: Math.max(0.03, Math.min(0.06, prog)), lminBrzeg: 0, lmaxBrzeg: 0.16, cien: 0.62, blask: 0.85, dysp: 0.07, fresnel: 0.5 };
  }
  const prog = window.Szklo.dolnaGranica(kolory, 4.5);
  return { ciemny: 0, rozmycie: 16, odcien: 0.14, nasycenie: 1.7, lmin: Math.min(0.86, Math.max(0.52, prog + 0.06)), lmax: 1, lminBrzeg: 0.4, lmaxBrzeg: 1, cien: 0.5, blask: 0.9, dysp: 0.07, fresnel: 0.8 };
}

function ksztalty() {
  const r = karta.getBoundingClientRect();
  return [{ x: r.left, y: r.top, w: r.width, h: r.height, r: 24, n: 4, typ: 1, faza: 16, grubosc: 66, cien: 1 }];
}

// Mysz: światło idzie za kursorem, poświata pod nim i kropla pod wciśniętym przyciskiem (iOS 26).
const mysz = { x: -9999, y: -9999, poswiata: 0, celPos: 0, kropla: 0, celKr: 0, kx: -9999, ky: -9999 };
function nadKarta(x, y, zapas = 0) {
  const r = karta.getBoundingClientRect();
  return x >= r.left - zapas && x <= r.right + zapas && y >= r.top - zapas && y <= r.bottom + zapas;
}

let raf = 0;
let ostatni = 0;
function zaplanuj() {
  if (!raf) raf = requestAnimationFrame(klatka);
}
function klatka(t) {
  raf = 0;
  const dt = ostatni ? Math.min(0.05, (t - ostatni) / 1000) : 1 / 60;
  ostatni = t;
  mysz.poswiata += (mysz.celPos - mysz.poswiata) * (1 - Math.exp(-dt / 0.18));
  mysz.kropla += (mysz.celKr - mysz.kropla) * (1 - Math.exp(-dt / (mysz.celKr ? 0.06 : 0.14)));
  rysuj();
  if (Math.abs(mysz.celPos - mysz.poswiata) > 0.01 || Math.abs(mysz.celKr - mysz.kropla) > 0.01) zaplanuj();
  else ostatni = 0;
}

function rysuj() {
  if (!silnik || !maTlo || body.classList.contains('bez-gl')) return;
  const r = karta.getBoundingClientRect();
  let sw = [-0.62, -0.78];
  if (mysz.poswiata > 0.02) {
    const dx = mysz.x - (r.left + r.width / 2);
    const dy = mysz.y - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy) || 1;
    sw = [dx / l, dy / l];
  }
  silnik.ustaw(opcje());
  silnik.ustaw({ swiatlo: sw });
  silnik.rysuj(ksztalty(), null, { x: mysz.x, y: mysz.y, poswiata: mysz.poswiata, kropla: mysz.kropla, kx: mysz.kx, ky: mysz.ky });
}

addEventListener('pointermove', (e) => {
  mysz.x = e.clientX;
  mysz.y = e.clientY;
  mysz.celPos = nadKarta(e.clientX, e.clientY, 20) ? 1 : 0;
  zaplanuj();
});
addEventListener('pointerleave', () => {
  mysz.celPos = 0;
  zaplanuj();
});
addEventListener('pointerdown', (e) => {
  body.classList.remove('klawiatura');
  // Klik w przezroczysty margines okna, obok karty: panel znika, jak przy kliknięciu w pulpit.
  if (!nadKarta(e.clientX, e.clientY)) {
    komenda('ukryj');
    return;
  }
  mysz.kx = e.clientX;
  mysz.ky = e.clientY;
  mysz.celKr = 1;
  zaplanuj();
});
addEventListener('pointerup', () => {
  mysz.celKr = 0;
  zaplanuj();
});
addEventListener('resize', () => rysuj());

// ---------- Karteczki ----------
let karteczki = [];

/** Pora w wierszu: „Za 15 min”, „Jutro, 09:00”; sprawa, która czeka, ma zamiast niej pomarańczowe „Czeka” z dzwonkiem. */
function krotkaPora(ms) {
  const m = Math.ceil((ms - Date.now()) / 60000);
  return m >= 1 && m < 60 ? `Za ${m} min` : czasPrzypomnienia(ms);
}

function wiersz(k) {
  const pora = k.czas != null && !k.czeka ? krotkaPora(k.czas) : '';
  const nazwa = k.tytul || 'Pusta karteczka';
  const opis = k.czeka ? ', czeka' : pora ? `, ${pora}` : '';
  return el(
    'li',
    null,
    el(
      'button.wiersz.szklany',
      { type: 'button', dataset: { id: k.id }, 'aria-label': `${nazwa}${opis}. Pokaż na pulpicie`, onclick: () => komenda('karteczka', { id: k.id }) },
      el('span.znak-karteczki', { dataset: { kolor: k.kolor || 'DEFAULT' }, 'aria-hidden': 'true' }, ikona('karteczka')),
      el(`span.nazwa${k.tytul ? '' : '.pusta'}`, { tekst: nazwa }),
      k.czeka ? el('span.czeka', null, ikona('dzwonek'), el('span', { tekst: 'Czeka' })) : pora ? el('span.pora', { tekst: pora }) : null,
    ),
  );
}

function rysujListe() {
  const ul = $('#karteczki');
  ul.replaceChildren(...karteczki.map(wiersz));
  ul.hidden = !karteczki.length;
  ul.classList.toggle('dlugie', karteczki.length > MAKS_WIERSZY);
}

async function pobierzKarteczki() {
  if (!naTauri) return pokazoweKarteczki();
  try {
    const r = await T.core.invoke('wykonaj', { komenda: 'karteczki', dane: {} });
    return (r && r.karteczki) || [];
  } catch (e) {
    blad(`karteczki: ${(e && e.komunikat) || e}`);
    return [];
  }
}

// ---------- Pokazanie i schowanie ----------
let wPokazie = null;

/** Prawy klik w ikonę: świeża lista, rozmiar, zdjęcie ekranu pod szkło, pokazanie okna i pierwsza klatka szkła. */
function pokaz() {
  if (!wPokazie) wPokazie = przygotujIPokaz().finally(() => (wPokazie = null));
  return wPokazie;
}

async function przygotujIPokaz() {
  body.classList.add('schowany');
  ustawMotyw();
  karteczki = await pobierzKarteczki();
  rysujListe();
  const r = karta.getBoundingClientRect();
  const m = await komenda('miejsce', { w: Math.ceil(r.width) + 2 * MARGINES, h: Math.ceil(r.height) + 2 * MARGINES });
  maTlo = false;
  if (silnik && m && m.zdjecie) {
    try {
      const dane = await T.core.invoke('zasobnik_tlo');
      const bajty = new Uint8Array(dane);
      if (bajty.length === m.w * m.h * 4) {
        silnik.tloPiksele(bajty, m.w, m.h);
        silnik.ustaw({ okno: [m.x, m.y], baza: 0 });
        maTlo = true;
      }
    } catch (e) {
      blad(`tlo: ${(e && e.message) || e}`);
    }
  }
  stanSzkla();
  await komenda('pokaz');
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  rysuj();
  body.classList.remove('schowany');
  karta.focus({ preventScroll: true });
}

function schowajTresc() {
  body.classList.add('schowany');
  body.classList.remove('klawiatura');
  mysz.celPos = 0;
  mysz.poswiata = 0;
  mysz.celKr = 0;
  mysz.kropla = 0;
  if (document.activeElement && document.activeElement !== body) document.activeElement.blur();
}

// ---------- Przyciski i klawiatura ----------
function podepnij() {
  podepnijDymki();
  swiatloPrzyciskow();
  $('#nowa-notatka').addEventListener('click', () => komenda('nowa_notatka'));
  $('#nowa-karteczka').addEventListener('click', () => komenda('nowa_karteczka'));
  $('#otworz').addEventListener('click', () => komenda('otworz'));
  $('#zakoncz').addEventListener('click', () => komenda('zakoncz'));
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      komenda('ukryj');
      return;
    }
    if (ev.key === 'Tab') body.classList.add('klawiatura');
    // Strzałki chodzą po przyciskach jak po menu, od góry do dołu.
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
      const b = $$('#karta button').filter((x) => !x.disabled && x.offsetParent);
      if (!b.length) return;
      ev.preventDefault();
      const i = b.indexOf(document.activeElement);
      let j = 0;
      if (ev.key === 'ArrowDown') j = i < 0 ? 0 : (i + 1) % b.length;
      else if (ev.key === 'ArrowUp') j = i < 0 ? b.length - 1 : (i - 1 + b.length) % b.length;
      else if (ev.key === 'End') j = b.length - 1;
      b[j].focus();
      b[j].scrollIntoView({ block: 'nearest' });
    }
  });
  for (const m of [...mqSzkla, ciemnyMQ]) {
    m.addEventListener('change', () => {
      ustawMotyw();
      stanSzkla();
      rysuj();
    });
  }
}

// ---------- Pokaz w zwykłej przeglądarce ----------
function pokazoweKarteczki() {
  const t = Date.now();
  const wszystkie = [
    { id: 'a', tytul: 'Zakupy na weekend', kolor: 'YELLOW', czas: t + 20 * 3600000, czeka: false },
    { id: 'b', tytul: 'Bank: zadzwonić do doradcy', kolor: 'ORANGE', czas: t - 2 * 3600000, czeka: true },
    { id: 'c', tytul: 'Leki dla Mai', kolor: 'GREEN', czas: t + 25 * 60000, czeka: false },
    { id: 'd', tytul: 'Pomysł na prezent', kolor: 'PURPLE' },
    { id: 'e', tytul: '', kolor: 'DEFAULT' },
    { id: 'f', tytul: 'Hasło do Wi-Fi gości', kolor: 'BLUE' },
    { id: 'g', tytul: 'Przegląd auta', kolor: 'CERULEAN', czas: t + 3 * 86400000, czeka: false },
  ];
  const ile = par.has('ile') ? Math.max(0, Number(par.get('ile')) || 0) : 4;
  return wszystkie.slice(0, ile);
}

async function tloPokazu() {
  const dpr = devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  const g = c.getContext('2d');
  const src = par.get('tlo');
  if (src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  } else {
    g.fillStyle = ciemny() ? '#101418' : '#e8eef6';
    g.fillRect(0, 0, c.width, c.height);
    for (const [x, y, r, kolor] of [[0.2, 0.3, 0.35, '#0a84ff'], [0.7, 0.2, 0.3, '#ff9f0a'], [0.55, 0.8, 0.4, '#30d158'], [0.9, 0.7, 0.25, '#bf5af2']]) {
      const gr = g.createRadialGradient(x * c.width, y * c.height, 0, x * c.width, y * c.height, r * c.width);
      gr.addColorStop(0, kolor);
      gr.addColorStop(1, 'transparent');
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
    }
  }
  return c;
}

/** Jasność po nałożeniu bieli z kryciem `a` (lico przycisku, guziki.css) na szkło o jasności `L`, jak składa to przeglądarka (sRGB). */
function nadBiela(L, a) {
  const s = L <= 0.0031308 ? 12.92 * L : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
  const c = s * (1 - a) + a;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Jasność szkła w karcie (bez marginesu 16 px) i kontrast napisów w najgorszym miejscu – do testu wyglądu. Każdy napis stoi
 * na przycisku, więc kontrast liczy się z licem przycisku (biel z kryciem z --g-lico) na najgorszym szkle: najciemniejszym
 * w jasnym motywie, najjaśniejszym w ciemnym.
 */
function wynikTestu() {
  const r = karta.getBoundingClientRect();
  const j = silnik && maTlo && !body.classList.contains('bez-gl') ? silnik.jasnosc(r.left + 16, r.top + 16, r.width - 32, r.height - 32) : null;
  const L = (k) => window.Szklo.jasnoscWzgledna(window.Szklo.kolor(rola(k)));
  const kontrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const lico = Number((/\/\s*([\d.]+)\s*\)/.exec(rola('--g-lico')) || [0, 0])[1]);
  const tlo = j ? nadBiela(ciemny() ? j.max : j.min, lico) : null;
  // Znak karteczki w wierszu (obrys w kolorze kartki) to grafika: co najmniej 3:1 na licu wiersza na najgorszym szkle, dla
  // każdego z 12 kolorów, nie tylko tych z pokazowej listy. Kolor obrysu czyta płótno 1 × 1, bo color-mix wychodzi jako color(srgb …).
  const plotno = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const jasnoscCss = (c) => {
    plotno.clearRect(0, 0, 1, 1);
    plotno.fillStyle = '#000';
    plotno.fillStyle = c;
    plotno.fillRect(0, 0, 1, 1);
    const d = plotno.getImageData(0, 0, 1, 1).data;
    return window.Szklo.jasnoscWzgledna([d[0] / 255, d[1] / 255, d[2] / 255]);
  };
  const proba = el('span.znak-karteczki', { 'aria-hidden': 'true' }, ikona('karteczka'));
  proba.hidden = true;
  karta.append(proba);
  const znaki = ['DEFAULT', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'BLUE', 'CERULEAN', 'PURPLE', 'PINK', 'BROWN', 'GRAY'].map((k) => {
    proba.dataset.kolor = k;
    return { k, L: jasnoscCss(getComputedStyle(proba.firstChild).color) };
  });
  proba.remove();
  const najslabszy = tlo == null ? null : znaki.map((z) => ({ k: z.k, c: kontrast(z.L, tlo) })).sort((a, b) => a.c - b.c)[0];
  const wynik = {
    motyw: ciemny() ? 'ciemny' : 'jasny',
    szklo: Boolean(j),
    jasnosc: j,
    lico,
    tekst: tlo == null ? null : Math.round(kontrast(L('--tekst'), tlo) * 100) / 100,
    drugi: tlo == null ? null : Math.round(kontrast(L('--z-drugi'), tlo) * 100) / 100,
    znak: najslabszy ? Math.round(najslabszy.c * 100) / 100 : null,
    znakKolor: najslabszy ? najslabszy.k : null,
    karta: { x: r.left, y: r.top, w: r.width, h: r.height },
    przyciski: $$('#karta button').map((b) => {
      const q = b.getBoundingClientRect();
      return { id: b.id || b.dataset.id, x: Math.round(q.left * 100) / 100, w: Math.round(q.width * 100) / 100, h: Math.round(q.height * 100) / 100 };
    }),
  };
  const pre = $('#wynik');
  pre.textContent = JSON.stringify(wynik);
  pre.hidden = false;
  pre.style.display = 'none';
}

async function pokazWPrzegladarce() {
  karteczki = pokazoweKarteczki();
  rysujListe();
  if (silnik && !bezSzkla()) {
    silnik.tlo(await tloPokazu());
    silnik.ustaw({ okno: [0, 0], baza: 1 });
    maTlo = true;
  }
  stanSzkla();
  body.classList.remove('schowany');
  rysuj();
  if (par.has('test')) wynikTestu();
}

podepnij();
window.__zasobnik = { pokaz, rysuj, wynikTestu, get karteczki() { return karteczki; } };
if (naTauri) {
  T.event.listen('zasobnik', () => pokaz());
  T.event.listen('zasobnik-schowaj', () => schowajTresc());
  // Pierwszy prawy klik mógł przyjść, zanim strona się wczytała.
  komenda('gotowy').then((r) => {
    if (r && r.pokaz) pokaz();
  });
} else {
  pokazWPrzegladarce();
}