// Most między interfejsem a rdzeniem (Rust).
//
// Windows i Android: Tauri – rdzeń w procesie aplikacji, jedno polecenie `wykonaj`.
// Web: ten sam rdzeń w WebAssembly w przeglądarce + serwer synchronizacji (web.js).
// Interfejs widzi identyczny kontrakt na każdej platformie.

import { pelneTresci } from './stan.js';

const T = window.__TAURI__;

export const naTauri = Boolean(T && T.core);
export const platforma = naTauri ? (/Android/i.test(navigator.userAgent) ? 'android' : 'windows') : 'web';

/** Błąd z rdzenia: komunikat dla człowieka + szczegóły techniczne (do rozwinięcia). */
export class BladApki extends Error {
  constructor(komunikat, szczegoly = null) {
    super(komunikat);
    this.komunikat = komunikat;
    this.szczegoly = szczegoly;
  }
}

function jakoBlad(e) {
  if (e instanceof BladApki) return e;
  if (e && typeof e === 'object' && typeof e.komunikat === 'string') return new BladApki(e.komunikat, e.szczegoly || null);
  // Wyjątek JavaScriptu, a nie błąd z rdzenia: do logu idzie cały stos, żeby następny raz
  // dało się od razu wskazać plik i linię (komunikat na ekranie zostaje krótki).
  const t = String((e && e.message) || e || 'Nieznany błąd');
  sygnal('blad_ui', { tekst: `wyjatek: ${String((e && e.stack) || t).replace(/\s+/g, ' ')}` });
  return new BladApki('Coś poszło nie tak', t);
}

let web = null;
/** Wersja web podpina tu swój silnik (WebAssembly + serwer). */
export function podlaczWeb(silnik) {
  web = silnik;
}

export async function wywolaj(komenda, dane = {}) {
  try {
    const w = naTauri ? await T.core.invoke('wykonaj', { komenda, dane }) : await silnikWeb().wykonaj(komenda, dane);
    // Rdzeń pomija puste pola treści – tu każda treść dostaje z powrotem pełny zestaw.
    return pelneTresci(w);
  } catch (e) {
    throw jakoBlad(e);
  }
}

function silnikWeb() {
  if (!web) throw new BladApki('Silnik notatek jeszcze się nie uruchomił');
  return web;
}

/**
 * Polecenie tylko do odczytu (szukanie przy każdym klawiszu) najkrótszą drogą: na Windows
 * i Androidzie wprost w wątku okna, gdy silnik jest wolny – bez przeskoku na wątek w tle, co
 * daje połowę czasu wywołania. Zajęty silnik (synchronizacja, OCR) – zwykła droga.
 */
export async function wywolajSzybko(komenda, dane = {}) {
  if (!naTauri) return wywolaj(komenda, dane);
  let w;
  try {
    w = await T.core.invoke('szybko', { komenda, dane });
  } catch (e) {
    throw jakoBlad(e);
  }
  if (w === null) {
    drogi.zajety += 1;
    return wywolaj(komenda, dane);
  }
  drogi.szybka += 1;
  return pelneTresci(w);
}

/** Do pomiarów: ile poleceń poszło szybką drogą, a ile zwykłą, bo silnik był akurat zajęty. */
export const drogi = { szybka: 0, zajety: 0 };

/** Wysyła plik (obraz, nagranie) jako surowe bajty – bez base64. */
export async function wyslijPlik(bajty, typ, nazwa) {
  try {
    if (naTauri) {
      return await T.core.invoke('dodaj_plik', bajty, { headers: { 'x-typ': typ || 'application/octet-stream', 'x-nazwa': encodeURIComponent(nazwa || '') } });
    }
    return await web.dodajPlik(bajty, typ, nazwa);
  } catch (e) {
    throw jakoBlad(e);
  }
}

/** Adres pliku do <img>/<audio>. */
export function urlPliku(hash) {
  if (naTauri) return T.core.convertFileSrc(hash, 'pliki');
  return web ? web.urlPliku(hash) : '';
}

/** Zdarzenia z rdzenia (np. zmiany z MCP, synchronizacji, pokazanie okna). */
export function nasluchuj(nazwa, f) {
  // Treści ze zdarzeń przechodzą przez to samo dopełnianie pól co odpowiedzi poleceń.
  const g = (p) => f(pelneTresci(p));
  if (naTauri) return T.event.listen(nazwa, (e) => g(e.payload));
  if (web) return web.nasluchuj(nazwa, g);
  return Promise.resolve(() => {});
}

/** Sterowanie oknem (tylko Windows). `dane` – na przykład `{ skala }` przy powiększeniu. */
export async function okno(akcja, dane = {}) {
  if (platforma === 'windows') return T.core.invoke('okno', { akcja, ...dane });
  return null;
}

/** Sygnał do warstwy platformy (gotowość, pomiary, błędy UI). Nie przerywa pracy przy błędzie. */
export async function sygnal(nazwa, dane = {}) {
  try {
    if (naTauri) return await T.core.invoke(nazwa, dane);
    if (web && web.sygnal) return await web.sygnal(nazwa, dane);
  } catch {
    /* sygnał nie jest krytyczny */
  }
  return null;
}
