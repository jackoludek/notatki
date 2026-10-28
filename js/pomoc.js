// Drobne narzędzia interfejsu: DOM, tekst, daty, podświetlanie trafień, linki, opisy przypomnień.

import { S } from './stan.js';

/** Motyw ustawiony w systemie (Windows, Android, przeglądarka). */
export function motywSystemu() {
  // Android: pytamy aktywność wprost (uiMode systemu) – WebView nie zawsze odświeża
  // prefers-color-scheme po zmianie motywu, gdy aplikacja jest otwarta.
  try {
    if (window.NotatkiAndroid && window.NotatkiAndroid.ciemny) return window.NotatkiAndroid.ciemny() ? 'ciemny' : 'jasny';
  } catch {
    /* starsza aktywność bez tej funkcji – niżej media query */
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ciemny' : 'jasny';
}

/**
 * Dymek (js/dymki.js) zamiast `title`: dymek systemu staje tam, gdzie akurat stoi kursor, a dymek iKeepera zawsze na środku
 * pod rzeczą (reguła Jacka z 16.10.2026). Czytnik ekranu dostaje napis jak z `title`: jako nazwę, gdy rzecz nie ma innej,
 * a jako opis, gdy różni się od nazwy. Pusty napis zdejmuje dymek.
 */
export function ustawDymek(e, tekst) {
  const t = String(tekst ?? '').trim();
  if (e.hasAttribute('title')) e.removeAttribute('title');
  if (!t) {
    delete e.dataset.dymek;
    e.removeAttribute('aria-description');
    return;
  }
  e.dataset.dymek = t;
  const nazwa = (e.getAttribute('aria-label') || '').trim() || (e.textContent || '').trim();
  if (!nazwa) e.setAttribute('aria-label', t);
  if (nazwa && t !== nazwa) e.setAttribute('aria-description', t);
  else e.removeAttribute('aria-description');
}

/** Tworzy element: el('div.klasa#id', {atrybuty}, dzieci…). `title` robi się dymkiem (ustawDymek). */
export function el(opis, atr = null, ...dzieci) {
  const m = /^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i.exec(opis) || [];
  const e = document.createElement(m[1] || 'div');
  for (const cz of (m[2] || '').match(/[.#][^.#]+/g) || []) {
    if (cz[0] === '.') e.classList.add(cz.slice(1));
    else e.id = cz.slice(1);
  }
  let dymek = null;
  if (atr) {
    for (const [k, v] of Object.entries(atr)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'tekst') e.textContent = v;
      else if (k === 'title') dymek = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const d of dzieci.flat()) {
    if (d === null || d === undefined || d === false) continue;
    e.append(d instanceof Node ? d : document.createTextNode(String(d)));
  }
  // Dymek na końcu: rzecz ma już swoje napisy, więc wiadomo, czy dymek jest jej nazwą, czy opisem.
  if (dymek !== null) ustawDymek(e, dymek);
  return e;
}

/** Ikona symboliczna ze spritu w index.html. */
export function ikona(nazwa, klasa = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('class', `i ${klasa}`.trim());
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(ns, 'use');
  u.setAttribute('href', `#i-${nazwa}`);
  s.append(u);
  return s;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Ta sama tabela co w rdzeniu (tekst.rs): małe litery bez znaków diakrytycznych.
const OGONKI = {
  ą: 'a', à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ā: 'a', ă: 'a',
  ć: 'c', ç: 'c', č: 'c', ĉ: 'c', ċ: 'c', ď: 'd', đ: 'd',
  ę: 'e', è: 'e', é: 'e', ê: 'e', ë: 'e', ě: 'e', ē: 'e', ė: 'e', ğ: 'g', ģ: 'g',
  ì: 'i', í: 'i', î: 'i', ï: 'i', ī: 'i', į: 'i', ı: 'i', ķ: 'k', ł: 'l', ľ: 'l', ĺ: 'l', ļ: 'l',
  ń: 'n', ñ: 'n', ň: 'n', ņ: 'n', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', ō: 'o', ő: 'o',
  ř: 'r', ŕ: 'r', ś: 's', š: 's', ş: 's', ș: 's', ť: 't', ţ: 't', ț: 't',
  ù: 'u', ú: 'u', û: 'u', ü: 'u', ů: 'u', ū: 'u', ű: 'u', ų: 'u', ý: 'y', ÿ: 'y', ź: 'z', ż: 'z', ž: 'z',
  // Końcowa sigma zależy od sąsiedniej litery – po złożeniu obie są równe, jak w rdzeniu.
  ς: 'σ', ß: 'ss', æ: 'ae', œ: 'oe',
};

const RE_OGONKI = new RegExp(`[${Object.keys(OGONKI).join('')}]`, 'g');

/**
 * Złożenie tekstu z mapą pozycji (złożony indeks → indeks w oryginale). Mapa `null` znaczy
 * „te same pozycje” – tak jest prawie zawsze, i wtedy złożenie to dwa szybkie przebiegi
 * przeglądarki zamiast pętli po znakach: przy szukaniu składa się tekst kilkunastu notatek
 * na każdy klawisz. Litera nigdy nie skraca się po złożeniu, więc ta sama długość znaczy te
 * same pozycje.
 */
function zlozZMapa(s, bezOgonkow) {
  const male = s.toLowerCase();
  if (male.length === s.length) {
    if (!bezOgonkow) return [male, null];
    const z = male.replace(RE_OGONKI, (c) => OGONKI[c]);
    if (z.length === s.length) return [z, null];
  }
  // Rzadko znak zmienia długość: „İ” (mała to dwa znaki), „ß” → „ss”, „æ” → „ae”. Pozycje idą
  // znak po znaku, a litery są z małych liter całego tekstu (końcowa sigma zależy od sąsiada).
  let w = '';
  const mapa = [];
  let i = 0;
  let j = 0;
  for (const ch of s) {
    const dl = ch.toLowerCase().length;
    const m = male.slice(j, j + dl);
    j += dl;
    const z = bezOgonkow ? m.replace(RE_OGONKI, (c) => OGONKI[c]) : m;
    for (let k = 0; k < z.length; k++) mapa.push(i);
    w += z;
    i += ch.length;
  }
  mapa.push(s.length);
  return [w, mapa];
}

/** Pozycja w oryginale dla pozycji w złożonym tekście. */
function wOryginale(mapa, i) {
  return mapa ? mapa[i] : i;
}

export function zloz(s) {
  return zlozZMapa(s, true)[0];
}

/** Terminy zapytania w postaci do porównań (jak w rdzeniu). */
export function terminy(zapytanie, rozmyty) {
  return zapytanie.split(/\s+/).map((t) => zlozZMapa(t, rozmyty)[0]).filter(Boolean);
}

/** Wstawia tekst do elementu z podświetleniem trafień (<mark>) – bez innerHTML. */
export function wstawZTrafieniami(cel, tekst, ter, rozmyty) {
  cel.textContent = '';
  if (!ter.length || !tekst) {
    cel.textContent = tekst;
    return;
  }
  // Pojedyncza litera pasuje prawie wszędzie – podświetlenie od dwóch znaków, najwyżej 40 miejsc.
  const dlugie = ter.filter((t) => t.length >= 2);
  if (!dlugie.length) {
    cel.textContent = tekst;
    return;
  }
  const [z, mapa] = zlozZMapa(tekst, rozmyty);
  const zakresy = [];
  for (const t of dlugie) {
    let od = 0;
    for (;;) {
      const i = z.indexOf(t, od);
      if (i < 0 || zakresy.length >= 40) break;
      zakresy.push([wOryginale(mapa, i), wOryginale(mapa, i + t.length)]);
      od = i + t.length;
    }
  }
  if (!zakresy.length) {
    cel.textContent = tekst;
    return;
  }
  zakresy.sort((a, b) => a[0] - b[0]);
  let poz = 0;
  for (const [a, b] of zakresy) {
    if (a < poz) continue;
    if (a > poz) cel.append(tekst.slice(poz, a));
    cel.append(el('mark', { tekst: tekst.slice(a, b) }));
    poz = b;
  }
  if (poz < tekst.length) cel.append(tekst.slice(poz));
}

/** Najwcześniejsze trafienie któregoś z terminów w złożonym tekście: `[pozycja, długość]` albo `null`. */
function pierwszeTrafienie(z, dlugie) {
  let wynik = null;
  for (const t of dlugie) {
    const i = z.indexOf(t);
    if (i >= 0 && (!wynik || i < wynik[0])) wynik = [i, t.length];
  }
  return wynik;
}

// Długi tekst jest składany kawałkami od początku, aż do pierwszego trafienia: w długiej notatce
// trafienie jest zwykle blisko początku, więc reszty nie trzeba składać. Kawałki kończą się na
// końcu linii – termin nie ma białych znaków, więc trafienie nigdy nie przechodzi przez granicę.
const KAWALEK = 1000;

/** Pierwsze trafienie w tekście jako `[od, do]` w oryginalnych znakach albo `null`. */
function pierwszeWTekscie(s, dlugie, rozmyty) {
  for (let od = 0; od < s.length; ) {
    let doK = od + KAWALEK >= s.length ? s.length : s.indexOf('\n', od + KAWALEK);
    if (doK < 0) doK = s.length;
    const [z, mapa] = zlozZMapa(s.slice(od, doK), rozmyty);
    const p = pierwszeTrafienie(z, dlugie);
    if (p) return [od + wOryginale(mapa, p[0]), od + wOryginale(mapa, p[0] + p[1])];
    od = doK + 1;
  }
  return null;
}

// Linia z tekstem (nie same spacje). `\S` to dokładnie to, co zostawia trim().
const NIEBIALY = /\S/;
// Druga połowa pary zastępczej UTF-16 (emoji i inne znaki spoza BMP).
const drugaPolowa = (c) => c >= 0xdc00 && c <= 0xdfff;

/** Okno `szerokosc` znaków w bardzo długiej linii (np. cała notatka w jednej), trafienie w pierwszej trzeciej. */
function oknoLinii(linia, srodek, szerokosc) {
  let od = Math.max(0, srodek - Math.floor(szerokosc / 3));
  let doKonca = Math.min(linia.length, od + szerokosc);
  // Emoji na brzegu okna zostaje w całości – bez połówki pary, która rysuje się jako „�”.
  if (od > 0 && drugaPolowa(linia.charCodeAt(od))) od -= 1;
  if (doKonca < linia.length && drugaPolowa(linia.charCodeAt(doKonca))) doKonca += 1;
  return `${od > 0 ? '…' : ''}${linia.slice(od, doKonca)}${doKonca < linia.length ? '…' : ''}`;
}

/**
 * Fragment tekstu wokół pierwszego trafienia: do `linii` niepustych linii.
 * `znaleziono` = false, gdy w tekście nie ma żadnego terminu (trafienie było w tytule, etykiecie
 * albo w tekście z obrazka) – wtedy fragmentem jest początek notatki.
 * `przed`/`po` mówią, czy przed albo po fragmencie jest jeszcze tekst (wielokropek).
 *
 * Trafienie jest szukane w tekście złożonym kawałkami, a linie wycinane dopiero wokół niego:
 * przy szukaniu to kilkanaście notatek na każdy klawisz, więc liczy się każda linia, której nie
 * trzeba dzielić ani składać.
 */
export function fragmentTrafienia(tekst, ter, rozmyty, linii = 3, szerokosc = 220) {
  const s = String(tekst || '');
  const dlugie = ter.filter((t) => t.length >= 2);
  const p = dlugie.length && s ? pierwszeWTekscie(s, dlugie, rozmyty) : null;
  const trafienie = p ? p[0] : -1;
  const znaleziono = trafienie >= 0;
  const pierwszy = znaleziono ? trafienie : s.search(NIEBIALY);
  if (pierwszy < 0) return { linie: [], znaleziono: false, przed: false, po: false };
  const start = s.lastIndexOf('\n', pierwszy - 1) + 1;
  const linie = [];
  let poz = start;
  while (poz <= s.length && linie.length < linii) {
    let koniec = s.indexOf('\n', poz);
    if (koniec < 0) koniec = s.length;
    const l = s.slice(poz, koniec);
    if (NIEBIALY.test(l)) {
      // Długa linia: okno wokół trafienia (tylko w pierwszej linii – dalsze od początku).
      const srodek = !linie.length && znaleziono ? trafienie - poz : 0;
      linie.push(l.length > szerokosc ? oknoLinii(l, srodek, szerokosc) : l);
    }
    poz = koniec + 1;
  }
  return {
    linie,
    znaleziono,
    przed: start > 0 && NIEBIALY.test(s.slice(0, start)),
    po: poz < s.length && NIEBIALY.test(s.slice(poz)),
  };
}

/** Pierwsze trafienie w tekście jako `[od, do]` w oryginalnych znakach (`null` – brak). */
export function pozycjaTrafienia(tekst, ter, rozmyty) {
  const dlugie = ter.filter((t) => t.length >= 2);
  if (!dlugie.length || !tekst) return null;
  return pierwszeWTekscie(tekst, dlugie, rozmyty);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/** Adresy WWW w tekście. */
export function linkiWTekscie(tekst) {
  return [...new Set((tekst.match(URL_RE) || []).slice(0, 50))];
}

export function domena(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const dzienFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
const dzienBezRokuFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });
const godzFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const pelnyFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** „12:30”, „wczoraj 18:04”, „3 wrz 2026”. */
export function kiedy(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const teraz = new Date();
  const dzis = new Date(teraz.getFullYear(), teraz.getMonth(), teraz.getDate()).getTime();
  if (ms >= dzis) return godzFmt.format(d);
  if (ms >= new Date(teraz.getFullYear(), teraz.getMonth(), teraz.getDate() - 1).getTime()) return `wczoraj ${godzFmt.format(d)}`;
  return dzienFmt.format(d);
}

export function pelnaData(ms) {
  return ms ? pelnyFmt.format(new Date(ms)) : '';
}
const dataKartkiFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const dzienTygodniaFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long' });
/** Nad kartką, jak w Notatkach Apple: „12 października 2026 o 17:07” (Intl daje to bez „o”). */
export function dataKartki(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${dataKartkiFmt.format(d)} o ${godzFmt.format(d)}`;
}
/**
 * Data w wierszu listy, krótko jak w Notatkach Apple: dziś godzina („17:07”), „wczoraj”, w ostatnim
 * tygodniu dzień („poniedziałek”), dawniej „21.07.26”. Granice liczone od północy (zmiana czasu
 * nie przesuwa „wczoraj”).
 */
export function krotkaData(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const t = new Date();
  const od = (dni) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - dni).getTime();
  if (ms >= od(0)) return godzFmt.format(d);
  if (ms >= od(1)) return 'wczoraj';
  if (ms >= od(6)) return dzienTygodniaFmt.format(d);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

export function czasPrzypomnienia(ms) {
  const d = new Date(ms);
  const teraz = new Date();
  const dzis = new Date(teraz.getFullYear(), teraz.getMonth(), teraz.getDate()).getTime();
  const dzien = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Jutrzejsza północ z kalendarza, a nie „dziś + 24 h”: w dniu zmiany czasu doba ma 23 albo 25 godzin.
  const jutro = new Date(teraz.getFullYear(), teraz.getMonth(), teraz.getDate() + 1).getTime();
  if (dzien === dzis) return `Dziś, ${godzFmt.format(d)}`;
  if (dzien === jutro) return `Jutro, ${godzFmt.format(d)}`;
  // W tym roku bez roku („15 paź, 08:30”), jak u Apple – krótszy termin zostawia miejsce na podgląd.
  const fmt = d.getFullYear() === teraz.getFullYear() ? dzienBezRokuFmt : dzienFmt;
  return `${fmt.format(d)}, ${godzFmt.format(d)}`;
}

/** Dni kalendarzowe od dziś: 0 – dziś, 1 – jutro, -1 – wczoraj (zmiana czasu nie psuje liczby). */
function dniOdDzis(ms) {
  const d = new Date(ms);
  const t = new Date();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
}

/**
 * Pora sprawy na karteczce i w panelu przy zegarze: „Czeka od 2 godzin”, „Za 15 minut”, „Jutro, 09:00”,
 * „Za 3 dni · 24 paź, 09:00”, z rytmem, gdy sprawa się powtarza. `s` = { czas, czeka, przypomnienie }. Pora w dniach
 * i godzinach, bo termin liczony w dniach wydaje się bliższy i łatwiej wtedy zacząć (Lewis i Oyserman, 2015). Bez czerwieni
 * i liczników zaległości: „czeka” mówi, co jest, a nie wytyka.
 */
export function opisPory(s, teraz = Date.now(), { bezRytmu = false } = {}) {
  let t;
  if (s.czeka) {
    const m = Math.max(1, Math.floor((teraz - s.czas) / 60000));
    const dni = -dniOdDzis(s.czas);
    if (m < 60) t = m === 1 ? 'Czeka od minuty' : `Czeka od ${m} minut`;
    else if (dni < 1) {
      const g = Math.floor(m / 60);
      t = g === 1 ? 'Czeka od godziny' : `Czeka od ${g} godzin`;
    } else t = dni === 1 ? 'Czeka od wczoraj' : `Czeka od ${dni} dni`;
  } else {
    const m = Math.max(1, Math.ceil((s.czas - teraz) / 60000));
    const dni = dniOdDzis(s.czas);
    if (m < 60) t = `Za ${liczba(m, 'minutę', 'minuty', 'minut')}`;
    else if (dni <= 1) t = czasPrzypomnienia(s.czas);
    else t = `Za ${dni} dni · ${czasPrzypomnienia(s.czas)}`;
  }
  const r = bezRytmu ? '' : opisPowtarzania(s.przypomnienie);
  return r ? `${t}, ${r}` : t;
}

/** Wartość dla <input type="datetime-local"> w strefie użytkownika. */
export function doPolaDaty(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

// --- przypomnienia ---

/** Ostatnia chwila przypomnienia, którą przyjmuje rdzeń: 9999-12-31 23:59:59,999 UTC. */
export const MAKS_PRZYPOMNIENIA = 253402300799999;

/** Rytmy w menu przypomnienia. Klucze jak w danych („dzien”…) – tak zapisuje je rdzeń. */
export const NAZWY_POWTARZANIA = { dzien: 'Codziennie', tydzien: 'Co tydzień', miesiac: 'Co miesiąc', rok: 'Co rok' };
const OPISY_POWTARZANIA = { dzien: 'codziennie', tydzien: 'co tydzień', miesiac: 'co miesiąc', rok: 'co rok' };

/**
 * Znany rytm przypomnienia („dzien”, „tydzien”, „miesiac”, „rok”) albo pusty napis: przypomnienie
 * jednorazowe albo rytm z nowszej wersji programu, który działa jak jednorazowy.
 */
export function rytm(p) {
  const co = p && p.powtarzanie ? p.powtarzanie.co : '';
  return Object.hasOwn(OPISY_POWTARZANIA, co) ? co : '';
}

/** „codziennie”, „co tydzień”… – pusty napis dla przypomnienia bez znanego rytmu. */
export function opisPowtarzania(p) {
  const co = rytm(p);
  return co ? OPISY_POWTARZANIA[co] : '';
}

/** Strefa czasowa urządzenia (nazwa IANA, np. „Europe/Warsaw”) – w niej liczona jest godzina powtarzanego przypomnienia. */
export function strefaUrzadzenia() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Najbliższe wystąpienie przypomnienia notatki. Liczy je tylko rdzeń (koniec miesiąca, zmiana
 * czasu) – interfejs nie ma drugiej implementacji, więc plakietka i powiadomienie się nie rozjadą.
 * Bez wartości z rdzenia (nowa, jeszcze niezapisana notatka) – chwila z samego przypomnienia.
 */
export function kiedyPrzypomnienie(id, p) {
  if (!p) return null;
  const n = id ? S.nastepne.get(id) : undefined;
  return n ?? p.czas;
}

/** „Jutro, 9:00, codziennie” – termin razem z rytmem (podpowiedzi, opis przycisku). */
export function terminPrzypomnienia(p, kiedy) {
  const opis = opisPowtarzania(p);
  return opis ? `${czasPrzypomnienia(kiedy)}, ${opis}` : czasPrzypomnienia(kiedy);
}

/**
 * Toast po ustawieniu: „Przypomnienie: Jutro, 9:00, codziennie”. Minioną chwilę powtarzanego
 * przypomnienia rdzeń przesuwa na najbliższy termin – dopóki go nie poda, toast nie zgaduje daty.
 */
export function tekstPrzypomnienia(p, kiedy) {
  const opis = opisPowtarzania(p);
  if (opis && kiedy < Date.now()) return `Przypomnienie: ${opis}, od najbliższego terminu`;
  return `Przypomnienie: ${terminPrzypomnienia(p, kiedy)}`;
}


export function liczba(n, jeden, kilka, wiele) {
  const d = n % 10;
  const s = n % 100;
  if (n === 1) return `${n} ${jeden}`;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return `${n} ${kilka}`;
  return `${n} ${wiele}`;
}

export function rozmiar(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Losowy identyfikator pozycji listy (16 znaków hex). */
export function noweId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function czekaj(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Klatka po narysowaniu (do pomiarów: zmiana jest już na ekranie). */
export function poKlatce() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
