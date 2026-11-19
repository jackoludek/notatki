// Wersja web: ten sam interfejs i ten sam rdzeń (Rust → WebAssembly) co w aplikacjach.
//
// - Dane są w przeglądarce (IndexedDB): strona otwiera się z nich od razu, bez czekania na sieć.
// - Każda zmiana najpierw trafia do IndexedDB (dziennik rdzenia), dopiero potem interfejs
//   dostaje odpowiedź – zamknięcie karty nic nie gubi. Zaraz potem zmiana idzie dalej.
// - Synchronizacja bez serwera: prywatne repozytorium GitHuba, ten sam przebieg z rdzenia co na
//   Windows i telefonie (chmura.rs). Rdzeń mówi, jakie zapytanie wysłać, tu idzie ono przez fetch.
//   Strona leży więc na GitHub Pages i nie potrzebuje żadnego serwera (od 21.10.2026 znowu).
// - Synchronizacja przez serwer Notatek (gdy strona jest z niego otwarta, bez repozytorium):
//   protokół /api/sync, odbiór przez długie odpytywanie (/api/czekaj), ponowienia po powrocie sieci.
// - Porządki AI przez serwer (/api/ai) – klucz Claude nie trafia do strony.
// - Silnik działa w jednej karcie naraz (Web Locks); druga karta czeka.

import { podlaczWeb } from './most.js';
import * as baza from './baza.js';
import { baner, bezBaneru } from './ui.js';

const TYLKO_ODCZYT = new Set(['start', 'lista', 'notatka', 'historia', 'roznice', 'tagi', 'ustawienia', 'statystyka', 'kosz_rozmiar', 'paczki_ai', 'eksport', 'plik', 'robocza', 'sync_kursor', 'zalaczniki', 'przypomnienia']);

const sluchacze = new Map();
let wasm = null;
let kolejka = Promise.resolve();
let token = null;
let urzadzenie = '';
let stanSync = { polaczona: false, stan: 'wylaczona' };
let trybPomiaru = false;
const czasyStartu = {};
let koniecPierwszejSync = () => {};
const pierwszaSynchronizacja = new Promise((ok) => {
  koniecPierwszejSync = ok;
});

// Tryb pomiarów (serwer z --pomiary, adres z #pomiar): błędy strony trafiają do bledy-web.log serwera.
const raportujBledy = /(^|[#&])pomiar/.test(location.hash);
function raportuj(tekst) {
  if (!raportujBledy) return;
  fetch('/api/blad-web', { method: 'POST', body: String(tekst).slice(0, 4000), keepalive: true }).catch(() => {});
}
window.addEventListener('error', (e) => raportuj(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  raportuj(`Promise: ${(r && (r.komunikat || r.message)) || r}${r && r.szczegoly ? ` (${r.szczegoly})` : ''}${r && r.stack ? ` ${r.stack}` : ''}`);
});

function emituj(nazwa, dane) {
  for (const f of sluchacze.get(nazwa) || []) {
    try {
      f(dane);
    } catch (e) {
      console.error(e);
    }
  }
}

function czekaj(ms) {
  return new Promise((ok) => setTimeout(ok, ms));
}

// --- rdzeń w WebAssembly ---

const koder = new TextEncoder();
const dekoder = new TextDecoder();

function wolaj(eksport, obiekt) {
  const wej = koder.encode(JSON.stringify(obiekt));
  const p = wasm.alokuj(wej.length);
  new Uint8Array(wasm.memory.buffer, p, wej.length).set(wej);
  const n = wasm[eksport](p, wej.length);
  // Pamięć mogła urosnąć – nowy widok po wywołaniu.
  const wyj = new Uint8Array(wasm.memory.buffer, wasm.wynik_wskaznik(), n);
  return JSON.parse(dekoder.decode(wyj));
}

/** Polecenie rdzenia: po kolei, zapis w IndexedDB przed odpowiedzią. */
function rdzen(komenda, dane = {}) {
  const p = kolejka.then(async () => {
    const r = wolaj('wykonaj_polecenie', { komenda, dane, teraz: Date.now() });
    await baza.dopiszZapisy(r.zapisy);
    if (r.blad) throw r.blad;
    return r.ok;
  });
  kolejka = p.catch(() => {});
  return p;
}

async function zaladujWasm() {
  const t0 = performance.now();
  let wynik;
  try {
    wynik = await WebAssembly.instantiateStreaming(fetch('notatki.wasm'), {});
  } catch {
    const b = await (await fetch('notatki.wasm')).arrayBuffer();
    wynik = await WebAssembly.instantiate(b, {});
  }
  czasyStartu.wasm_ms = performance.now() - t0;
  return wynik.instance.exports;
}

// --- jedna karta z silnikiem ---

function jednaKarta() {
  if (!navigator.locks) return Promise.resolve();
  return new Promise((ok) => {
    navigator.locks.request('notatki-silnik', { ifAvailable: true }, (blokada) => {
      if (blokada) {
        ok();
        return new Promise(() => {});
      }
      baner('druga-karta', 'Ta strona jest otwarta w innej karcie i zacznie tu działać, gdy tamtą zamkniesz');
      navigator.locks.request('notatki-silnik', () => {
        bezBaneru('druga-karta');
        ok();
        return new Promise(() => {});
      });
      return undefined;
    });
  });
}

function nazwaUrzadzenia() {
  const ua = navigator.userAgent;
  const przegladarka = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Przeglądarka';
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${przegladarka} – ${system}` : przegladarka;
}

// --- serwer ---

async function api(metoda, sciezka, cialo, typ) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (cialo instanceof Blob || cialo instanceof ArrayBuffer || ArrayBuffer.isView(cialo)) {
    body = cialo;
    h['Content-Type'] = typ || 'application/octet-stream';
  } else if (cialo !== undefined) {
    body = JSON.stringify(cialo);
    h['Content-Type'] = 'application/json';
  }
  let r;
  try {
    r = await fetch(sciezka, { method: metoda, headers: h, body, cache: 'no-store' });
  } catch (e) {
    throw { komunikat: 'Brak połączenia z serwerem – zmiany poczekają i wyślą się same', szczegoly: String(e), offline: true };
  }
  if (r.status === 204) return {};
  const t = await r.text();
  let v = {};
  try {
    v = t ? JSON.parse(t) : {};
  } catch {
    v = {};
  }
  if (!r.ok) {
    if (r.status === 401 && sciezka !== '/api/logowanie') await zapomnijToken('Serwer nie rozpoznał tego urządzenia – połącz się ponownie w Ustawieniach → Synchronizacja');
    throw { komunikat: v.komunikat || `Serwer odpowiedział błędem ${r.status}`, szczegoly: `HTTP ${r.status}` };
  }
  return v;
}

async function zapomnijToken(komunikat) {
  token = null;
  await baza.usun('meta', 'token');
  stanSync = { polaczona: false, stan: 'blad', komunikat };
  emituj('sync', stanSync);
}

// --- synchronizacja ---

let syncTrwa = false;
let syncPonownie = false;
let przerwa = 2000;
let timerSync = null;
let nasluchDziala = false;

function zaplanujSync(ms) {
  if (!token) return;
  clearTimeout(timerSync);
  timerSync = setTimeout(synchronizujWTle, ms);
}

async function ustawStan(stan, komunikat = null) {
  let oczekujace = 0;
  try {
    oczekujace = (await rdzen('sync_kursor')).niewyslane;
  } catch {
    /* bez licznika */
  }
  const od = stan === 'offline' ? (stanSync.stan === 'offline' && stanSync.od ? stanSync.od : Date.now()) : 0;
  stanSync = { polaczona: Boolean(token), stan, rodzaj: 'serwer', adres: location.origin, oczekujace, od, komunikat };
  emituj('sync', stanSync);
}

async function przebieg() {
  for (let i = 0; i < 1000 && token; i++) {
    const z = await rdzen('sync_przygotuj');
    const o = await api('POST', '/api/sync', z);
    const brakujace = o.brakujace_pliki || [];
    for (const h of brakujace) {
      const p = await baza.pobierz('pliki', h);
      if (p) await api('PUT', `/api/pliki/${h}`, p.blob, p.typ);
    }
    const r = await rdzen('sync_przyjmij', { zadanie: z, odpowiedz: o, wyslane_pliki: brakujace });
    if (r.opis.zmienione.length || r.opis.usuniete.length) emituj('zmiany', r.opis);
    if (!o.wiecej && r.niewyslane === 0) break;
  }
}

async function synchronizujWTle() {
  if (!token) return;
  if (syncTrwa) {
    syncPonownie = true;
    return;
  }
  syncTrwa = true;
  const t0 = performance.now();
  try {
    await ustawStan('wysylanie');
    do {
      syncPonownie = false;
      await przebieg();
    } while (syncPonownie && token);
    przerwa = 2000;
    await ustawStan('polaczono');
    if (czasyStartu.pierwsza_sync_ms === undefined) czasyStartu.pierwsza_sync_ms = performance.now() - t0;
    koniecPierwszejSync();
    pobierzBrakujacePliki();
  } catch (e) {
    if (token) {
      await ustawStan(e && e.offline ? 'offline' : 'blad', (e && e.komunikat) || String(e));
      zaplanujSync(przerwa);
      przerwa = Math.min(przerwa * 2, 60000);
    }
  } finally {
    syncTrwa = false;
  }
}

/** Długie odpytywanie: serwer odpowiada, gdy ma nowe wersje (albo po ~25 s). */
async function nasluchSerwera() {
  if (nasluchDziala) return;
  nasluchDziala = true;
  while (token) {
    try {
      const { kursor } = await rdzen('sync_kursor');
      const r = await api('GET', `/api/czekaj?od=${kursor}`);
      if (r.kursor > kursor) zaplanujSync(0);
    } catch {
      await czekaj(10000);
    }
  }
  nasluchDziala = false;
}

let pobieranieTrwa = false;
/** Obrazy i nagrania z innych urządzeń – w tle, żeby były też offline. */
async function pobierzBrakujacePliki() {
  if (pobieranieTrwa || !token) return;
  pobieranieTrwa = true;
  try {
    const { hashe } = await rdzen('zalaczniki');
    let ile = 0;
    for (const h of hashe) {
      if (!token || ile >= 200) break;
      if (await baza.ma('pliki', h)) continue;
      const r = await fetch(`/api/pliki/${h}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
      if (!r || !r.ok) continue;
      const typ = r.headers.get('Content-Type') || 'application/octet-stream';
      const bufor = await r.arrayBuffer();
      if (hex(await crypto.subtle.digest('SHA-256', bufor)) !== h) continue;
      await baza.wstaw('pliki', { hash: h, typ, blob: new Blob([bufor], { type: typ }) });
      ile++;
    }
  } catch {
    /* następnym razem */
  } finally {
    pobieranieTrwa = false;
  }
}

async function zaloguj({ adres, haslo }) {
  const cel = String(adres || location.origin).trim().replace(/\/+$/, '');
  if (cel !== location.origin) {
    throw { komunikat: `W przeglądarce Notatki łączą się z serwerem, z którego otwarto stronę: ${location.origin}` };
  }
  const r = await api('POST', '/api/logowanie', { haslo, nazwa: urzadzenie });
  token = r.token;
  await baza.wstaw('meta', token, 'token');
  await rdzen('ustaw', { klucz: 'serwer_adres', wartosc: location.origin });
  await rdzen('ustaw', { klucz: 'synchronizacja', wartosc: true });
  stanSync = { polaczona: true, stan: 'wysylanie', adres: location.origin };
  emituj('sync', stanSync);
  zaplanujSync(0);
  nasluchSerwera();
  return {};
}

async function odlacz() {
  try {
    await api('POST', '/api/wyloguj');
  } catch {
    /* serwer i tak zapomni urządzenie przy zmianie hasła */
  }
  token = null;
  await baza.usun('meta', 'token');
  await rdzen('ustaw', { klucz: 'synchronizacja', wartosc: false });
  stanSync = { polaczona: false, stan: 'wylaczona' };
  emituj('sync', stanSync);
  return {};
}

// --- synchronizacja przez GitHuba (bez serwera) ---

const API_GITHUB = 'https://api.github.com';
/** { repo, token } – gdy to urządzenie jest połączone z repozytorium. Token jest tylko tutaj
 *  i w IndexedDB (meta „github_token”), nie w rdzeniu i nie w kopiach. */
let github = null;
let chmuraTrwa = false;
let chmuraPonownie = false;
let timerChmury = null;
let przerwaChmury = 2000;
/** Przerwa, której zażądał GitHub (limit zapytań): do tej chwili żadnych zapytań. */
let wstrzymaneDo = 0;
/** Token odrzucony przez GitHuba – bez ponawiania przez 10 minut albo do zmiany tokenu. */
let zleKonto = null;
let przebiegi = Promise.resolve();

function lokalnaStrona() {
  return /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
}

/** Adres API. Inny tylko w teście automatycznym na tym komputerze (udawany GitHub): na prawdziwej
 *  stronie podmiana adresu wysłałaby token obcemu serwerowi, więc działa wyłącznie pod localhost. */
function adresApi() {
  if (lokalnaStrona()) {
    const a = sessionStorage.getItem('ikeeper_api_github');
    if (a) return a;
  }
  return API_GITHUB;
}

/** Jedno zapytanie do API GitHuba. Błąd HTTP to zwykła odpowiedź (o dalszym kroku decyduje rdzeń);
 *  błąd sieci – „Brak połączenia…”, po którym pętla rozpoznaje stan offline. */
async function zapytanieGithub(k, tok) {
  const z = k.http;
  const h = { Authorization: `Bearer ${tok}`, Accept: k.accept, 'X-GitHub-Api-Version': k.wersja_api };
  if (z.etag) h['If-None-Match'] = z.etag;
  let body;
  if (z.cialo !== null && z.cialo !== undefined) {
    body = JSON.stringify(z.cialo);
    h['Content-Type'] = 'application/json';
  }
  const brakSieci = (e) => ({ komunikat: 'Brak połączenia z GitHubem – zmiany poczekają i wyślą się same', szczegoly: String(e), offline: true });
  let r;
  let cialo;
  try {
    // no-store: pytanie z ETagiem ma dostać od GitHuba 304, a nie kopię z pamięci przeglądarki.
    r = await fetch(adresApi() + z.sciezka, { method: z.metoda, headers: h, body, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    cialo = z.metoda === 'HEAD' || r.status === 304 ? new Uint8Array(0) : new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    throw brakSieci(e);
  }
  const liczba = (v) => (v !== null && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const limit = (r.headers.get('x-ratelimit-remaining') || '').trim() === '0';
  // Ile czekać po limicie (zasady GitHuba): Retry-After, a przy wyczerpanym limicie – do x-ratelimit-reset.
  let ponow = liczba(r.headers.get('retry-after'));
  if (ponow === null && limit) {
    const reset = liczba(r.headers.get('x-ratelimit-reset'));
    if (reset !== null) ponow = Math.max(1, Math.round(reset - Date.now() / 1000));
  }
  return { meta: { status: r.status, etag: r.headers.get('etag'), ponow_po: ponow, limit_wyczerpany: limit }, cialo };
}

function wolajKrok(meta, bajty) {
  const m = koder.encode(JSON.stringify(meta));
  const pm = wasm.alokuj(m.length);
  new Uint8Array(wasm.memory.buffer, pm, m.length).set(m);
  let pc = 0;
  let nc = 0;
  if (bajty && bajty.length) {
    nc = bajty.length;
    pc = wasm.alokuj(nc);
    new Uint8Array(wasm.memory.buffer, pc, nc).set(bajty);
  }
  const n = wasm.krok_chmury(pm, m.length, pc, nc);
  return JSON.parse(dekoder.decode(new Uint8Array(wasm.memory.buffer, wasm.wynik_wskaznik(), n)));
}

/** Krok przebiegu w rdzeniu: po kolei z poleceniami okna, dziennik do IndexedDB przed dalszą pracą. */
function krokChmury(odpowiedz, bajty) {
  const p = kolejka.then(async () => {
    const r = wolajKrok({ teraz: Date.now(), odpowiedz }, bajty);
    // Bajty pliku z kroku „zapisz” – kopia od razu, zanim rdzeń dostanie następne polecenie.
    const dane = r.ok && r.ok.zapisz ? new Uint8Array(wasm.memory.buffer, wasm.dane_wskaznik(), r.ok.dlugosc).slice() : null;
    await baza.dopiszZapisy(r.zapisy);
    if (r.blad) throw r.blad;
    if (dane) r.ok.bajty = dane;
    return r.ok;
  });
  kolejka = p.catch(() => {});
  return p;
}

/** Cały przebieg (zwykły, porządki albo łączenie) – jeden naraz, bo rdzeń prowadzi jeden. */
function przebiegChmury(start, tok) {
  const p = przebiegi.then(async () => {
    let k = await rdzen('chmura_start', start);
    for (let i = 0; i < 1000000; i++) {
      if (k.http) {
        const o = await zapytanieGithub(k, tok);
        k = await krokChmury(o.meta, o.cialo);
      } else if (k.czekaj !== undefined) {
        await czekaj(k.czekaj);
        k = await krokChmury(null);
      } else if (k.czytaj) {
        const plik = await baza.pobierz('pliki', k.czytaj);
        const bajty = plik ? new Uint8Array(await plik.blob.arrayBuffer()) : null;
        k = await krokChmury({ status: bajty ? 200 : 404 }, bajty);
      } else if (k.zapisz) {
        await baza.wstaw('pliki', { hash: k.zapisz, typ: k.typ, blob: new Blob([k.bajty], { type: k.typ }) });
        k = await krokChmury(null);
      } else if (k.koniec) {
        return k;
      } else {
        throw { komunikat: 'Nieznany krok synchronizacji', szczegoly: JSON.stringify(k).slice(0, 300) };
      }
    }
    throw { komunikat: 'Synchronizacja z GitHubem się nie kończy – spróbuję za chwilę' };
  });
  przebiegi = p.catch(() => {});
  return p;
}

function pokazZmiany(opis) {
  if (opis && ((opis.zmienione || []).length || (opis.usuniete || []).length || (opis.pliki || []).length)) emituj('zmiany', opis);
}

function zaplanujChmure(ms) {
  if (!github) return;
  clearTimeout(timerChmury);
  timerChmury = setTimeout(synchronizujChmure, Math.max(0, ms));
}

/** Stan dla okna – tylko gdy się zmienił (sprawdzanie co 5 s niczego nie miga). */
async function ustawStanChmury(stan, komunikat = null) {
  let oczekujace = 0;
  try {
    oczekujace = (await rdzen('sync_kursor')).niewyslane;
  } catch {
    /* bez licznika */
  }
  const od = stan === 'offline' ? (stanSync.stan === 'offline' && stanSync.od ? stanSync.od : Date.now()) : 0;
  const nowy = { polaczona: Boolean(github), stan, rodzaj: 'github', adres: github ? github.repo : '', oczekujace, od, komunikat };
  if (JSON.stringify(nowy) === JSON.stringify(stanSync)) return;
  stanSync = nowy;
  emituj('sync', stanSync);
}

/** Jeden przebieg i zaplanowanie następnego: co 5 s, gdy karta jest widoczna, co 30 s w tle,
 *  od razu po zmianie; po limicie GitHuba i złym tokenie – przerwa bez zapytań. */
async function synchronizujChmure() {
  if (!github) return;
  if (chmuraTrwa) {
    chmuraPonownie = true;
    return;
  }
  const doKiedy = Math.max(wstrzymaneDo, zleKonto && zleKonto.token === github.token ? zleKonto.do : 0);
  if (Date.now() < doKiedy) {
    zaplanujChmure(doKiedy - Date.now());
    return;
  }
  zleKonto = null;
  chmuraTrwa = true;
  chmuraPonownie = false;
  const { repo, token: tok } = github;
  const widoczna = document.visibilityState === 'visible';
  let nastepny = widoczna ? 5000 : 30000;
  let udany = false;
  try {
    if ((await rdzen('sync_kursor')).niewyslane > 0) await ustawStanChmury('wysylanie');
    // Karta na wierzchu: szybkie kolejne zapisy (pisanie) idą razem, a nie każdy osobną paczką.
    const k = await przebiegChmury({ rodzaj: 'zwykly', repo, zbieraj: widoczna }, tok);
    pokazZmiany(k.opis);
    const w = k.koniec;
    if (w.kompaktowanie && !w.limit) {
      try {
        const k2 = await przebiegChmury({ rodzaj: 'kompaktowanie', repo }, tok);
        pokazZmiany(k2.opis);
        if (k2.koniec.limit) Object.assign(w, { limit: true, pozostalo: true, zaczekaj_s: k2.koniec.zaczekaj_s });
        w.ostrzezenie = w.ostrzezenie || k2.koniec.ostrzezenie || null;
      } catch (e) {
        w.ostrzezenie = `Porządkowanie repozytorium się nie udało: ${(e && e.komunikat) || e}`;
      }
    }
    if (w.limit) wstrzymaneDo = Date.now() + (w.zaczekaj_s || 60) * 1000;
    if (w.pozostalo) nastepny = Math.min(Math.max(1, w.zaczekaj_s || 1) * 1000, nastepny);
    przerwaChmury = 2000;
    udany = true;
    await ustawStanChmury('polaczono', w.ostrzezenie || null);
    if (czasyStartu.pierwsza_sync_ms === undefined) czasyStartu.pierwsza_sync_ms = performance.now();
    koniecPierwszejSync();
  } catch (e) {
    const offline = Boolean(e && e.offline);
    // Zły token albo brak dostępu: ponawianie nic nie da, a GitHub nie lubi serii zapytań ze złym tokenem.
    if (e && e.konto) zleKonto = { token: tok, do: Date.now() + 10 * 60000 };
    await ustawStanChmury(offline ? 'offline' : 'blad', (e && e.komunikat) || String(e));
    nastepny = przerwaChmury;
    przerwaChmury = Math.min(przerwaChmury * 2, 60000);
  } finally {
    chmuraTrwa = false;
  }
  // Zmiana w trakcie przebiegu – następny zaraz (zbieranie w rdzeniu i tak łączy szybkie zapisy).
  if (udany && chmuraPonownie) nastepny = Math.min(nastepny, 300);
  chmuraPonownie = false;
  zaplanujChmure(nastepny);
}

/** Po zmianie w oknie: wysłać ją tam, gdzie synchronizuje się to urządzenie (repozytorium albo serwer). */
function poZmianie() {
  if (github) zaplanujChmure(0);
  else zaplanujSync(0);
}

async function polaczGithub({ repo, token: t, haslo }) {
  const tok = String(t || '').trim();
  if (!tok) throw { komunikat: 'Brakuje tokenu GitHuba – wklej go w oknie łączenia' };
  const k = await przebiegChmury({ rodzaj: 'polaczenie', repo, haslo: haslo || null }, tok);
  await rdzen('ustaw', { klucz: 'chmura_repo', wartosc: repo });
  await rdzen('ustaw', { klucz: 'synchronizacja', wartosc: true });
  const { ustawienia } = await rdzen('ustawienia');
  await baza.wstaw('meta', tok, 'github_token');
  // Repozytorium zamiast serwera: urządzenie synchronizuje się jedną drogą.
  if (token) {
    token = null;
    await baza.usun('meta', 'token');
  }
  github = { repo: ustawienia.chmura_repo, token: tok };
  zleKonto = null;
  wstrzymaneDo = 0;
  przerwaChmury = 2000;
  stanSync = { polaczona: true, stan: 'wysylanie', rodzaj: 'github', adres: github.repo };
  emituj('sync', stanSync);
  zaplanujChmure(0);
  return k.koniec.polaczenie;
}

async function odlaczGithub() {
  github = null;
  clearTimeout(timerChmury);
  // Przebieg w toku kończy się sam; dopiero potem zapominamy klucz i stan.
  await przebiegi;
  await baza.usun('meta', 'github_token');
  await rdzen('chmura_odlacz');
  await rdzen('ustaw', { klucz: 'synchronizacja', wartosc: false });
  stanSync = { polaczona: false, stan: 'wylaczona' };
  emituj('sync', stanSync);
  return {};
}

/** Dla testu automatycznego: przebieg teraz i stan po nim. */
export async function synchronizujTeraz() {
  while (chmuraTrwa) await czekaj(50);
  clearTimeout(timerChmury);
  await synchronizujChmure();
  return stanSync;
}

// --- pliki ---

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function dodajPlik(bajty, typ, nazwa) {
  const u8 = bajty instanceof Uint8Array ? bajty : new Uint8Array(bajty);
  if (u8.byteLength > 100 * 1024 * 1024) throw { komunikat: 'Plik jest większy niż 100 MB' };
  const kopia = u8.slice();
  const hash = hex(await crypto.subtle.digest('SHA-256', kopia));
  const t = typ || 'application/octet-stream';
  await baza.wstaw('pliki', { hash, typ: t, blob: new Blob([kopia], { type: t }) });
  const z = await rdzen('plik_zarejestruj', { hash, typ: t, nazwa, rozmiar: kopia.byteLength });
  poZmianie();
  return z;
}

const adresyObiektow = new Map();

/** Adres obrazu/nagrania: przez service workera (z IndexedDB albo z serwera). */
function urlPliku(hash) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) return `pliki/${hash}`;
  // Bez service workera (pierwsze otwarcie): obiekt z IndexedDB podmieniany po wczytaniu.
  if (adresyObiektow.has(hash)) return adresyObiektow.get(hash);
  baza
    .pobierz('pliki', hash)
    .then((p) => {
      if (!p) return;
      const u = URL.createObjectURL(p.blob);
      adresyObiektow.set(hash, u);
      for (const el of document.querySelectorAll('img, audio')) if (el.getAttribute('src') === `pliki/${hash}`) el.src = u;
    })
    .catch(() => {});
  return `pliki/${hash}`;
}

// --- import z Google Keep (folder z Takeout) ---

function wybierzFolder() {
  return new Promise((ok) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.webkitdirectory = true;
    i.multiple = true;
    i.addEventListener('change', () => ok(i.files && i.files.length ? [...i.files] : null), { once: true });
    i.addEventListener('cancel', () => ok(null), { once: true });
    i.click();
  });
}

function typZNazwy(n) {
  const r = n.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', '3gp': 'audio/3gpp', m4a: 'audio/mp4', mp3: 'audio/mpeg', awb: 'audio/amr-wb', webm: 'audio/webm' }[r] || 'application/octet-stream';
}

function znajdzPlik(mapa, nazwa) {
  const n = nazwa.toLowerCase();
  if (mapa.has(n)) return mapa.get(n);
  const rdzenNazwy = n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n;
  for (const r of ['jpg', 'jpeg', 'png', 'gif', 'webp', '3gp', 'm4a', 'mp3', 'awb']) if (mapa.has(`${rdzenNazwy}.${r}`)) return mapa.get(`${rdzenNazwy}.${r}`);
  return null;
}

async function importujKeep() {
  const pliki = await wybierzFolder();
  if (!pliki) return { anulowano: true };
  const mapa = new Map(pliki.map((f) => [f.name.toLowerCase(), f]));
  const jsony = pliki.filter((f) => /\.json$/i.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (!jsony.length) throw { komunikat: 'W tym folderze nie ma plików .json z Google Keep – wybierz folder „Keep” z eksportu Takeout' };
  const raport = { notatek: 0, w_archiwum: 0, przypietych: 0, list: 0, obrazow: 0, nowych: 0, zaktualizowanych: 0, bez_zmian: 0, bledy: [], brakujace_pliki: [] };
  for (const f of jsony) {
    let tekst;
    let info;
    try {
      tekst = await f.text();
      info = await rdzen('keep_przetworz', { nazwa: f.name, json: tekst });
    } catch (e) {
      raport.bledy.push(`${f.name}: ${(e && e.komunikat) || e}`);
      continue;
    }
    raport.notatek++;
    raport.w_archiwum += info.archiwum ? 1 : 0;
    raport.przypietych += info.przypieta ? 1 : 0;
    raport.list += info.lista ? 1 : 0;
    const zalaczniki = [];
    for (const [nazwa, typ] of info.pliki) {
      const p = znajdzPlik(mapa, nazwa);
      if (!p) {
        raport.brakujace_pliki.push(`${f.name}: ${nazwa}`);
        continue;
      }
      const t = typ || p.type || typZNazwy(nazwa);
      if (t.startsWith('image/')) raport.obrazow++;
      zalaczniki.push(await dodajPlik(new Uint8Array(await p.arrayBuffer()), t, nazwa));
    }
    const r = await rdzen('keep_dodaj', { nazwa: f.name, json: tekst, zalaczniki });
    if (r.wynik === 'nowa') raport.nowych++;
    else if (r.wynik === 'zaktualizowana') raport.zaktualizowanych++;
    else raport.bez_zmian++;
  }
  poZmianie();
  return { raport };
}

// --- polecenia interfejsu ---

async function wykonaj(komenda, dane = {}) {
  switch (komenda) {
    case 'start': {
      const d = await rdzen('start', dane);
      d.platforma = { system: 'web', ai_przez_serwer: Boolean(token) };
      d.sync = stanSync;
      return d;
    }
    case 'sync_zaloguj':
      if (github) await odlaczGithub();
      return zaloguj(dane);
    case 'sync_odlacz':
      return github ? odlaczGithub() : odlacz();
    case 'chmura_polacz':
      return polaczGithub(dane);
    case 'chmura_odlacz':
      return odlaczGithub();
    case 'sync_teraz':
      poZmianie();
      return {};
    case 'ai_zaproponuj':
      if (!token) throw { komunikat: 'Porządki AI w przeglądarce działają przez własny serwer. Bez serwera zrób je w aplikacji na Windows' };
      return api('POST', '/api/ai', dane);
    case 'otworz_link':
      window.open(dane.url, '_blank', 'noopener,noreferrer');
      return {};
    case 'import_keep':
      return importujKeep();
    default: {
      const w = await rdzen(komenda, dane);
      if (!TYLKO_ODCZYT.has(komenda)) poZmianie();
      return w;
    }
  }
}

function nasluchuj(nazwa, f) {
  if (!sluchacze.has(nazwa)) sluchacze.set(nazwa, new Set());
  sluchacze.get(nazwa).add(f);
  return Promise.resolve(() => sluchacze.get(nazwa).delete(f));
}

async function sygnal(nazwa, dane) {
  if (nazwa === 'gotowe') {
    // Od otwarcia strony (nawigacji) do listy gotowej do pracy.
    czasyStartu.do_gotowosci_ms = performance.now();
    // Pomiar na pustej przeglądarce: najpierw całe notatki z serwera, potem pomiary interfejsu.
    if (trybPomiaru && !czasyStartu.notatek && token) await pierwszaSynchronizacja;
    return { pomiar: trybPomiaru };
  }
  if (nazwa === 'blad_ui') {
    console.error('iKeeper:', dane && dane.tekst);
    raportuj(dane && dane.tekst);
  }
  if (nazwa === 'zapisz_pomiar') {
    const sw = Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
    const cialo = JSON.stringify({ ...dane, start: czasyStartu, urzadzenie, service_worker: sw, przegladarka: navigator.userAgent });
    await fetch('/api/pomiar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cialo }).catch(() => {});
  }
  return null;
}

// --- start ---

export async function uruchomWeb() {
  await jednaKarta();
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
  }
  wasm = await zaladujWasm();
  // Token urządzenia w adresie po #: link z Pulpitu (narzedzia\postaw-serwer-aws.ps1, Jacek, 21.10.2026: przeglądarka bez
  // hasła) i pomiar automatyczny (serwer w trybie --pomiary). Token wydaje tylko ten serwer, więc obcy link nic nie da.
  // Tryb pomiarów serwer potwierdza raz; kolejne wizyty nie pytają sieci (sprawdzamy start bez niej).
  const frag = new URLSearchParams(location.hash.slice(1));
  let tokenZLinku = false;
  // Link z Pulpitu do wersji na GitHub Pages (narzedzia\opublikuj-strone.ps1): repozytorium z notatkami i token GitHuba po #.
  // Fragmentu po # przeglądarka nie wysyła do serwera strony; token trafia tylko do IndexedDB tej przeglądarki.
  let githubZLinku = null;
  if (frag.get('github') && frag.get('gh_token')) {
    githubZLinku = { repo: frag.get('github'), token: frag.get('gh_token') };
    history.replaceState(null, '', location.pathname);
  }
  if (frag.has('pomiar') || frag.has('token')) {
    if (frag.has('pomiar')) {
      let znany = Boolean(await baza.pobierz('meta', 'tryb_pomiarow'));
      if (!znany) {
        const st = await fetch('/api/stan', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
        znany = Boolean(st.pomiary);
        if (znany) await baza.wstaw('meta', true, 'tryb_pomiarow');
      }
      trybPomiaru = znany;
    }
    if (frag.get('token')) {
      await baza.wstaw('meta', frag.get('token'), 'token');
      tokenZLinku = true;
    }
    history.replaceState(null, '', location.pathname);
  }
  token = (await baza.pobierz('meta', 'token')) || null;
  urzadzenie = (await baza.pobierz('meta', 'urzadzenie')) || '';
  if (!urzadzenie) {
    urzadzenie = nazwaUrzadzenia();
    await baza.wstaw('meta', urzadzenie, 'urzadzenie');
  }
  const t0 = performance.now();
  const zapisy = await baza.caloscDoOdtworzenia();
  czasyStartu.odczyt_bazy_ms = performance.now() - t0;
  const t1 = performance.now();
  const ziarno = Array.from(crypto.getRandomValues(new Uint8Array(32)));
  // Zawartość plików jest w IndexedDB – rdzeń dostaje tylko skróty tych, które tu są.
  const pliki = await baza.klucze('pliki');
  const r = wolaj('start_silnika', { ziarno, teraz: Date.now(), urzadzenie, zapisy, pliki });
  czasyStartu.odtworzenie_ms = performance.now() - t1;
  czasyStartu.zapisow = zapisy.length;
  if (r.blad) throw r.blad;
  await baza.dopiszZapisy(r.zapisy);
  czasyStartu.notatek = r.ok.notatek;
  if (r.ok.skrocic) {
    const { zapisy: zrzut } = await rdzen('zrzut');
    await baza.zastapZapisy(zrzut);
  }
  // Repozytorium GitHuba (bez serwera) ma pierwszeństwo – tak jak na Windows i telefonie. Droga synchronizacji jest
  // wybrana, zanim okno zapyta o stan (podlaczWeb niżej): okno z linku nie pokazuje wtedy logowania do serwera.
  const { ustawienia } = await rdzen('ustawienia');
  const tokenGithub = await baza.pobierz('meta', 'github_token');
  if (githubZLinku && !(tokenGithub === githubZLinku.token && (ustawienia.chmura_repo || '') === githubZLinku.repo && ustawienia.synchronizacja)) {
    // Pierwsze otwarcie z linku (albo nowy token): łączenie w tle, okno już działa.
    stanSync = { polaczona: true, stan: 'wysylanie', rodzaj: 'github', adres: githubZLinku.repo };
    polaczGithub(githubZLinku).catch((e) => {
      stanSync = { polaczona: false, stan: 'blad', rodzaj: 'github', komunikat: (e && e.komunikat) || String(e) };
      emituj('sync', stanSync);
    });
  } else if (ustawienia.synchronizacja && (ustawienia.chmura_repo || '').trim() && tokenGithub) {
    github = { repo: ustawienia.chmura_repo, token: tokenGithub };
    stanSync = { polaczona: true, stan: 'polaczono', rodzaj: 'github', adres: github.repo };
    zaplanujChmure(0);
  } else if (token) {
    if (tokenZLinku) {
      await rdzen('ustaw', { klucz: 'serwer_adres', wartosc: location.origin });
      await rdzen('ustaw', { klucz: 'synchronizacja', wartosc: true });
    }
    stanSync = { polaczona: true, stan: 'wysylanie', rodzaj: 'serwer', adres: location.origin };
    zaplanujSync(0);
    nasluchSerwera();
  }
  podlaczWeb({ wykonaj, dodajPlik, urlPliku, nasluchuj, sygnal });
  window.addEventListener('online', () => poZmianie());
  document.addEventListener('visibilitychange', () => {
    // GitHub: widoczna – od razu sprawdzić; schowana – wysłać, co czeka (już bez zbierania).
    if (github) zaplanujChmure(0);
    else if (document.visibilityState === 'visible') zaplanujSync(0);
  });
}
