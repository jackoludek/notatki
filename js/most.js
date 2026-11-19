// Most między interfejsem a rdzeniem (Rust).
//
// Windows i Android: Tauri – rdzeń w procesie aplikacji, jedno polecenie `wykonaj`.
// Web: ten sam rdzeń w WebAssembly w przeglądarce + serwer synchronizacji (web.js).
// Interfejs widzi identyczny kontrakt na każdej platformie.

import { pelneTresci } from './stan.js';

const T = window.__TAURI__;

export const naTauri = Boolean(T && T.core);
export const platforma = naTauri ? (/Android/i.test(navigator.userAgent) ? 'android' : 'windows') : 'web';
/** System komputera z Tauri: „windows” albo „linux” (CachyOS, 09 --- CachyOS - Rust i Tauri), gdzie platforma to też
 * „windows”, bo okno działa tak samo. Poza komputerem to samo co platforma. Różni się tylko tym, czego Linux nie ma. */
export const system = platforma === 'windows' && /Linux/.test(navigator.userAgent) ? 'linux' : platforma;

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

/**
 * Umowa z Zasobnikiem Okien (iJack OS, Jacek w Fiszkach 19.11.2026: kółko „Schowaj do zasobnika” w każdej wersji Notatek,
 * „zwłaszcza w tej … przypiętej do desktopu”). Pasek tytułu jest z HTML, więc z zewnątrz nie widać, gdzie stoi przycisk.
 * Prostokąt `przycisk` w px CSS idzie do Rusta (main.rs, „miejsce_min”), który stawia właściwość okna `iJackOS.Minimalizuj`
 * w px fizycznych; kółko staje 8 px na lewo od przycisku, w miejscu, które układ trzyma wolne. W oknie Notatek to Minimalizuj,
 * na karteczce (bez Minimalizuj) skrajnie lewy przycisk z prawej grupy. Odświeżane przy zmianie rozmiaru, powiększenia, skali
 * ekranu i układu; schowany przycisk (pełny ekran) zdejmuje umowę. Tylko Windows.
 */
export function umowaZasobnika(przycisk, miejsce = null) {
  sledzPrzycisk(przycisk, 'miejsce_min', miejsce);
}

/**
 * Snap Layouts z Windows 11 (Jacek, 19.11.2026: przyciąganie okien „Ta sama funkcjonalność, poproszę”): nad przyciskiem
 * Maksymalizuj stoi niewidoczne okno systemowe (win.rs, `maks`), więc Windows po najechaniu pokazuje układy okien. Ono łapie
 * mysz, więc podświetlenie przycisku przychodzi zdarzeniem „przycisk-maks”, a klik przełącza okno samo. Klawiatura bez zmian.
 */
export function nakladkaMaksymalizuj(przycisk) {
  if (platforma !== 'windows' || !przycisk) return;
  nasluchuj('przycisk-maks', (co) => przycisk.classList.toggle('pod-kursorem', co === 'nad'));
  sledzPrzycisk(przycisk, 'miejsce_maks');
}

/** Prostokąt przycisku w px CSS do Rusta (`akcja` polecenia „okno”), przy każdej zmianie rozmiaru, powiększenia, skali i układu. */
function sledzPrzycisk(przycisk, akcja, miejsce = null) {
  if (platforma !== 'windows' || !przycisk) return;
  let ostatnie = '';
  let klatka = 0;
  const wyslij = () => {
    const r = przycisk.getBoundingClientRect();
    // `miejsce`: wolne miejsce na kółko obok przycisku. Bez niego (wąskie okno) umowy nie ma.
    const jest = r.width > 0 && r.height > 0 && (!miejsce || miejsce.getBoundingClientRect().width > 0);
    const p = jest ? [r.left, r.top, r.right, r.bottom] : null;
    const klucz = JSON.stringify([p, innerWidth, devicePixelRatio]);
    if (klucz === ostatnie) return;
    ostatnie = klucz;
    okno(akcja, { prostokat: p, szer: innerWidth }).catch(() => {
      ostatnie = '';
    });
  };
  const pozniej = () => {
    cancelAnimationFrame(klatka);
    klatka = requestAnimationFrame(wyslij);
  };
  addEventListener('resize', pozniej);
  new ResizeObserver(pozniej).observe(przycisk);
  if (miejsce) new ResizeObserver(pozniej).observe(miejsce);
  new MutationObserver(pozniej).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ekran'] });
  // Inna skala ekranu (okno na drugim monitorze, zmiana skali w Windows): px CSS te same, fizyczne inne.
  const skala = () => {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        pozniej();
        skala();
      },
      { once: true },
    );
  };
  skala();
  wyslij();
}