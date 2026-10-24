// Karteczka na pulpicie (Windows): brzoskwiniowa kartka ze sprawami, które mają przypomnienie (Jacek, 20.10.2026: „sticky
// note … w kolorze brzoskwiniowym … godziny i dni … nagi, upierdliwe, przypominające”). Osobne okno tej samej aplikacji
// (04 --- Windows - Rust i Tauri\src\karteczka.rs) na tym samym rdzeniu: polecenia „karteczka”, „akcja”, „zapisz”, „cofnij”.
//
// Wiersz to sprawa: kółko „Zrobione”, tytuł notatki, pierwszy krok (następna linia notatki) i pora jako przycisk z menu
// (Zrobione, Otwórz w Notatkach, inna pora). Sprawa, której pora nadeszła, czeka na pomarańczowo, a karteczka stoi wtedy
// nad innymi oknami, aż sprawa będzie załatwiona albo przełożona. Pora w dniach i godzinach, bo termin liczony w dniach
// wydaje się bliższy i łatwiej wtedy zacząć (Lewis i Oyserman, 2015). Bez czerwieni i liczników zaległości: „czeka” mówi,
// co jest, a nie wytyka.

import { wywolaj, nasluchuj, okno, sygnal } from './most.js';
import { el, ikona, $, motywSystemu, czasPrzypomnienia, opisPowtarzania, tekstPrzypomnienia, liczba, czekaj, ustawDymek } from './pomoc.js';
import { toast, bladToast, ogloszenie, popoverOtwarty } from './ui.js';
import { menuPrzypomnienia } from './wybory.js';
import { podepnijDymki } from './dymki.js';

document.documentElement.dataset.motyw = motywSystemu();
addEventListener('error', (e) => sygnal('blad_ui', { tekst: `karteczka: ${e.message} (${e.filename}:${e.lineno})` }));
addEventListener('unhandledrejection', (e) => sygnal('blad_ui', { tekst: `karteczka: ${String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)}` }));

const MINUTA = 60000;
const GODZINA = 60 * MINUTA;

const K = {
  sprawy: [],
  // Pinezka: karteczka nad innymi oknami także wtedy, gdy nic nie czeka (ustawienie „karteczka_wierzch”).
  wierzch: true,
  naWierzchu: null,
  rysowano: '',
  // Ctrl+Z i Ctrl+Y w tym oknie: { opis, paczka } (paczka rdzenia) albo { opis, nowa } (dopisana sprawa).
  cofnij: [],
  ponow: [],
};

/** Dni kalendarzowe od dziś: 0 – dziś, 1 – jutro, -1 – wczoraj (zmiana czasu nie psuje liczby). */
function dniOdDzis(ms) {
  const d = new Date(ms);
  const t = new Date();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
}

/** „Czeka od 2 godzin”, „Za 15 minut”, „Jutro, 09:00”, „Za 3 dni · 24 paź, 09:00” – z rytmem, gdy sprawa się powtarza. */
export function opisPory(s, teraz = Date.now()) {
  let t;
  if (s.czeka) {
    const m = Math.max(1, Math.floor((teraz - s.czas) / MINUTA));
    const dni = -dniOdDzis(s.czas);
    if (m < 60) t = m === 1 ? 'Czeka od minuty' : `Czeka od ${m} minut`;
    else if (dni < 1) {
      const g = Math.floor(m / 60);
      t = g === 1 ? 'Czeka od godziny' : `Czeka od ${g} godzin`;
    } else t = dni === 1 ? 'Czeka od wczoraj' : `Czeka od ${dni} dni`;
  } else {
    const m = Math.max(1, Math.ceil((s.czas - teraz) / MINUTA));
    const dni = dniOdDzis(s.czas);
    if (m < 60) t = `Za ${liczba(m, 'minutę', 'minuty', 'minut')}`;
    else if (dni <= 1) t = czasPrzypomnienia(s.czas);
    else t = `Za ${dni} dni · ${czasPrzypomnienia(s.czas)}`;
  }
  const rytm = opisPowtarzania(s.przypomnienie);
  return rytm ? `${t}, ${rytm}` : t;
}

function wierszSprawy(id) {
  return $(`.k-sprawa[data-id="${CSS.escape(id)}"]`);
}

function wiersz(s, teraz) {
  const pora = opisPory(s, teraz);
  const kolko = el('button.k-kolko', { type: 'button', 'aria-label': `Zrobione: ${s.tytul}`, title: 'Zrobione', dataset: { rola: 'kolko' }, onclick: () => zalatw(s) }, ikona('ptaszek'));
  const zmien = el(
    `button.k-pora${s.czeka ? '.czeka' : ''}`,
    {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-label': `${pora}. Zmień porę`,
      title: 'Zmień porę albo otwórz w Notatkach',
      dataset: { rola: 'pora' },
      onclick: (ev) => menuSprawy(s, ev.currentTarget),
    },
    el('span', { tekst: pora }),
    ikona('dol'),
  );
  const li = el('li.k-sprawa', { dataset: { id: s.id } }, kolko, el('div.k-tresc', null, el('span.k-tytul', { tekst: s.tytul }), s.krok ? el('span.k-krok', { tekst: s.krok }) : null, zmien));
  // Prawy klik na sprawie: to samo menu co pora.
  li.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    menuSprawy(s, zmien);
  });
  return li;
}

function pusto() {
  return el('li.k-pusto', null, el('span.k-tytul', { tekst: 'Nic nie czeka' }), el('span.k-krok', { tekst: 'Wpisz sprawę poniżej i wybierz porę' }));
}

/** Rysuje sprawy, gdy coś się zmieniło (także sam napis pory). Fokus zostaje na tym samym przycisku tej samej sprawy. */
function rysuj(teraz = Date.now()) {
  const klucz = JSON.stringify(K.sprawy.map((s) => [s.id, s.tytul, s.krok, s.czas, s.czeka, opisPory(s, teraz)]));
  // Otwarte menu stoi przy swoim wierszu – wiersze rysujemy po jego zamknięciu, przy następnym odświeżeniu.
  if (klucz === K.rysowano || popoverOtwarty()) return;
  K.rysowano = klucz;
  const a = document.activeElement;
  const byl = a && a.closest && a.closest('.k-sprawa') ? [a.closest('.k-sprawa').dataset.id, a.dataset.rola] : null;
  $('#k-sprawy').replaceChildren(...(K.sprawy.length ? K.sprawy.map((s) => wiersz(s, teraz)) : [pusto()]));
  if (byl) {
    const w = wierszSprawy(byl[0]);
    const b = w && w.querySelector(`[data-rola="${byl[1]}"]`);
    if (b) b.focus();
  }
}

/** Nad innymi oknami: pinezka albo sprawa, która czeka. Zmiana idzie do okna tylko wtedy, gdy naprawdę jest. */
function ustawWierzch() {
  const tak = K.wierzch || K.sprawy.some((s) => s.czeka);
  if (tak === K.naWierzchu) return;
  K.naWierzchu = tak;
  okno('wierzch', { wl: tak });
}

let wDrodze = null;
let znowu = false;
/** Sprawy z rdzenia. Prośby w trakcie łączą się w jedno następne odświeżenie, więc żadna zmiana nie ginie. */
function odswiez() {
  if (wDrodze) {
    znowu = true;
    return wDrodze;
  }
  wDrodze = (async () => {
    do {
      znowu = false;
      try {
        const r = await wywolaj('karteczka');
        K.sprawy = r.sprawy || [];
        rysuj();
        ustawWierzch();
      } catch (e) {
        console.error('karteczka', e);
      }
    } while (znowu);
    wDrodze = null;
  })();
  return wDrodze;
}

/** Przypomnienie nadeszło albo wraca: te sprawy mrugają trzy razy. */
function mrugnij(ids) {
  for (const id of ids) {
    const w = wierszSprawy(id);
    if (!w) continue;
    w.classList.remove('mruga');
    void w.offsetWidth;
    w.classList.add('mruga');
    setTimeout(() => w.classList.remove('mruga'), 3200);
  }
}

function menuSprawy(s, kotwica) {
  menuPrzypomnienia(kotwica, s.przypomnienie, (p) => ustawPore(s, p), s.czas, {
    zalatw: () => zalatw(s),
    zaGodzine: s.czeka,
    otworz: () => sygnal('pokaz_notatke', { id: s.id }),
  });
}

function zapamietaj(wpis) {
  K.cofnij.push(wpis);
  if (K.cofnij.length > 50) K.cofnij.shift();
  K.ponow = [];
  return wpis;
}

/** „Zrobione”: jednorazowa sprawa schodzi z karteczki, powtarzana przechodzi na następną porę. Przypomnienie przestaje wracać. */
async function zalatw(s) {
  const w = wierszSprawy(s.id);
  if (w) w.classList.add('zrobiona');
  try {
    const r = await wywolaj('akcja', { ids: [s.id], akcja: { typ: 'zalatwione' }, opis: 'Zrobione' });
    const wpis = zapamietaj({ opis: `zrobione „${s.tytul}”`, paczka: r.paczka });
    ogloszenie('Zrobione');
    toast('Zrobione', { przycisk: 'Cofnij', akcja: () => cofnijWpis(wpis), czas: 8000 });
    // Ptaszek widać chwilę, potem sprawa znika albo przechodzi na następny termin.
    await czekaj(700);
  } catch (e) {
    bladToast(e);
  }
  K.rysowano = '';
  await odswiez();
}

/** Inna pora z menu (albo usunięcie przypomnienia – sprawa schodzi z karteczki). */
async function ustawPore(s, p) {
  try {
    const r = await wywolaj('akcja', { ids: [s.id], akcja: { typ: 'przypomnienie', wartosc: p } });
    const wpis = zapamietaj({ opis: p ? `zmiana pory „${s.tytul}”` : `zdjęcie „${s.tytul}” z karteczki`, paczka: r.paczka });
    toast(p ? tekstPrzypomnienia(p, p.czas) : 'Zdjęto z karteczki', { przycisk: 'Cofnij', akcja: () => cofnijWpis(wpis), czas: 8000 });
  } catch (e) {
    bladToast(e);
  }
  K.rysowano = '';
  await odswiez();
}

/**
 * Nowa sprawa z pola: „Bank: zadzwonić do doradcy” – przed dwukropkiem sprawa, po nim pierwszy krok (zostaje w treści notatki).
 * Pora od razu za godzinę, a okienko pory otwiera się zaraz potem, żeby wybrać inną.
 */
async function nowaSprawa(pole) {
  const tekst = pole.value.trim();
  if (!tekst) return;
  const i = tekst.indexOf(':');
  const tytul = (i > 0 ? tekst.slice(0, i) : tekst).trim();
  const krok = i > 0 ? tekst.slice(i + 1).trim() : '';
  const czas = Math.ceil((Date.now() + GODZINA) / MINUTA) * MINUTA;
  try {
    const r = await wywolaj('zapisz', { tresc: { tytul, tekst: krok, przypomnienie: { czas } } });
    pole.value = '';
    if (!r.notatka) return;
    const id = r.notatka.id;
    zapamietaj({ opis: `nowa sprawa „${tytul}”`, nowa: id });
    K.rysowano = '';
    await odswiez();
    const s = K.sprawy.find((x) => x.id === id);
    const b = $(`.k-sprawa[data-id="${CSS.escape(id)}"] .k-pora`);
    if (s && b) {
      b.scrollIntoView({ block: 'nearest' });
      menuSprawy(s, b);
    }
  } catch (e) {
    bladToast(e);
  }
}

/** Ctrl+Z (albo „Cofnij” w komunikacie): ostatni wpis albo ten z komunikatu. Cofnięcie da się ponowić (Ctrl+Y). */
async function cofnijWpis(wpis = K.cofnij[K.cofnij.length - 1]) {
  if (!wpis) return;
  K.cofnij = K.cofnij.filter((w) => w !== wpis);
  try {
    if (wpis.nowa) {
      const r = await wywolaj('akcja', { ids: [wpis.nowa], akcja: { typ: 'do_kosza', wartosc: true } });
      K.ponow.push({ opis: wpis.opis, paczka: r.paczka });
    } else {
      const r = await wywolaj('cofnij', { paczka: wpis.paczka });
      if (r.paczka) K.ponow.push({ opis: wpis.opis, paczka: r.paczka });
    }
    ogloszenie(`Cofnięto: ${wpis.opis}`);
  } catch (e) {
    bladToast(e);
  }
  K.rysowano = '';
  await odswiez();
}

async function ponowWpis() {
  const wpis = K.ponow.pop();
  if (!wpis) return;
  try {
    const r = await wywolaj('cofnij', { paczka: wpis.paczka });
    if (r.paczka) K.cofnij.push({ opis: wpis.opis, paczka: r.paczka });
    ogloszenie(`Ponowiono: ${wpis.opis}`);
  } catch (e) {
    bladToast(e);
  }
  K.rysowano = '';
  await odswiez();
}

function rysujPinezke() {
  const b = $('#k-wierzch');
  b.classList.toggle('wlaczony', K.wierzch);
  b.setAttribute('aria-pressed', String(K.wierzch));
  ustawDymek(b, K.wierzch ? 'Nie trzymaj nad innymi oknami' : 'Trzymaj nad innymi oknami');
}

async function przelaczWierzch() {
  K.wierzch = !K.wierzch;
  rysujPinezke();
  ustawWierzch();
  ogloszenie(K.wierzch ? 'Karteczka zostaje nad innymi oknami' : 'Karteczka jak zwykłe okno');
  try {
    await wywolaj('ustaw', { klucz: 'karteczka_wierzch', wartosc: K.wierzch });
  } catch (e) {
    bladToast(e);
  }
}

function podepnij() {
  podepnijDymki();
  $('#k-wierzch').addEventListener('click', przelaczWierzch);
  $('#k-zamknij').addEventListener('click', () => okno('ukryj'));
  const pole = $('#k-pole');
  $('#k-nowa').addEventListener('submit', (ev) => {
    ev.preventDefault();
    nowaSprawa(pole);
  });
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'n') {
      ev.preventDefault();
      pole.focus();
    } else if (k === 'w') {
      ev.preventDefault();
      okno('ukryj');
    } else if ((k === 'z' || k === 'y') && !(ev.target instanceof HTMLInputElement)) {
      // W polu Ctrl+Z cofa pisanie, jak w Windows. Poza polem cofa i ponawia działania karteczki.
      ev.preventDefault();
      if (k === 'z' && !ev.shiftKey) cofnijWpis();
      else ponowWpis();
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    document.documentElement.dataset.motyw = motywSystemu();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) odswiez();
  });
}

async function start() {
  podepnij();
  try {
    const u = await wywolaj('ustawienia');
    K.wierzch = u.ustawienia.karteczka_wierzch !== false;
  } catch {
    /* zostaje domyślne: na wierzchu */
  }
  rysujPinezke();
  await odswiez();
  await nasluchuj('zmiany', () => odswiez());
  // Zmiana z głównego okna Notatek (polecenia.rs); własne zmiany karteczka już ma.
  await nasluchuj('zmiany-okna', (z) => {
    if (z.zrodlo !== 'karteczka') odswiez();
  });
  await nasluchuj('karteczka', (k) => odswiez().then(() => mrugnij((k && k.ids) || [])));
  // Co 30 s: napisy pory („Za 14 minut”) i sprawy, których pora właśnie nadeszła.
  setInterval(() => odswiez(), 30000);
}

if (!window.__karteczkaTest) start();