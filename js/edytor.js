// Edytor notatki – kartka jak w Notatkach Apple: nad nią data ostatniej zmiany i przypomnienie,
// potem tytuł, tekst albo lista z polami wyboru, obrazy, nagrania i linki. Etykiet i koloru nie
// widać (zostają w danych). Rzadkie działania są w menu Więcej.
//
// Zapis: kopia robocza przy każdej zmianie (natychmiast, bez fsync w rdzeniu),
// pełna wersja po 1,5 s przerwy, przy wyjściu z edytora i przy dodaniu pliku.
// Edycja zaczyna się od wersji `baza`: jeśli w międzyczasie przyszła zmiana
// z innego urządzenia albo od AI, rdzeń scala obie (nic nie ginie).

import { wywolaj, wyslijPlik, urlPliku, naTauri } from './most.js';
import { pozycjePulpitu } from './lista.js';
import {
  el, ikona, $, $$, linkiWTekscie, domena, noweId, liczba, pozycjaTrafienia, dataKartki,
  kiedyPrzypomnienie, tekstPrzypomnienia, terminPrzypomnienia, ustawDymek,
} from './pomoc.js';
import { S, zapamietajDzialanie, wczytajMiejsce, zapamietajMiejsce } from './stan.js';
import { toast, bladToast, ogloszenie, menu, ustawEkran, zamknijPopover, waski, popoverOtwarty } from './ui.js';
import {
  odswiezListe, dzialanie, zastosujZmiany, rysujPasek, kopiujNotatke, oznaczOtwarta, odswiezPrzypomnienia, KOLORY_NOTATEK, zmienKolor, cofnijWpis,
  cofnijOstatnie, ponowOstatnie,
} from './lista.js';
import { menuPrzypomnienia } from './wybory.js';
import { otworzHistorie } from './historia.js';
import {
  czysc,
  enterWTabeli,
  formatuj,
  klasaZaznaczenia,
  klawiszWTabeli,
  komorkaKursora,
  naprawTabele,
  trescPola,
  wklejDuzo,
  tabelaSzeroka,
  wstawTabele,
  zmienTabele,
  htmlZTekstu,

  skrotFormatu,
  tekstZHtml,
  tekstZPola,
  ustawHtmlPola,
  ustawZaznaczenie,
  wlaczone,
  zaznaczenie,
  zakresPola,
  zmienRozmiar,
  ROZMIARY,
  INTERLINIE,
  paletaFormatu,
  klasaKoloru,
  kluczKoloru,
} from './tekstowe.js';

const OPOZNIENIE_WERSJI = 1500;
const MAKS_PLIK = 100 * 1024 * 1024;

function nowaTresc({ tytul = '', lista = false } = {}) {
  return {
    tytul,
    tekst: '',
    tekst_html: null,
    jest_lista: lista,
    lista: lista ? [{ id: noweId(), tekst: '', zrobione: false }] : [],
    tagi: S.tag ? [S.tag] : [],
    kolor: 'DEFAULT',
    przypieta: false,
    archiwum: false,
    karteczka: false,
    zalaczniki: [],
    linki: [],
    przypomnienie: null,
    utworzona: 0,
    edytowana: 0,
  };
}

export function edytorOtwarty() {
  return Boolean(S.e);
}

/**
 * Otwiera notatkę (id) albo nową (id = null) obok listy. `bezFokusu` – fokus zostaje tam, gdzie
 * był (kliknięcie albo strzałka na liście); bez tego kursor idzie do tekstu albo do trafienia.
 */
export async function otworzEdytor(id, { lista = false, tytul = '', bezFokusu = false } = {}) {
  if (id && S.e && S.e.id === id) {
    // Wynik szukania z notatką, która już jest otwarta, też pokazuje trafienie.
    if (!skokDoTrafienia(!bezFokusu) && !bezFokusu) ustawKursor(S.e.tresc, true);
    return;
  }
  zamknijPopover(false);
  if (S.e) await zamknijEdytor({ bezOdswiezania: true, bezFokusu: true });
  const n = id ? S.notatki.get(id) : null;
  if (id && !n) {
    toast('Tej notatki już nie ma');
    return;
  }
  S.e = {
    id: n ? n.id : `n${noweId()}${noweId()}`,
    istnieje: Boolean(n),
    baza: n ? n.glowa : null,
    tresc: n ? structuredClone(n.tresc) : nowaTresc({ tytul, lista }),
    zmieniona: false,
    zmian: 0,
    timer: null,
    zapis: null,
    pokazZrobione: true,
    // Na wąskim ekranie lista znika na czas notatki i gubi przewinięcie – wraca z tym miejscem.
    przewin: $('#kolumna-listy').scrollTop,
  };
  if (!S.e.tresc.zalaczniki) S.e.tresc.zalaczniki = [];
  if (!S.e.tresc.lista) S.e.tresc.lista = [];
  if (!S.e.tresc.tagi) S.e.tresc.tagi = [];
  if (!S.e.tresc.linki) S.e.tresc.linki = [];
  // Kopia tekstu sprzed listy ma sens tylko przy liście (przelaczTyp).
  if (n && !S.e.tresc.jest_lista) zapiszKopieTekstu(S.e.id, null);
  ustawEkran('edytor');
  rysujEdytor();
  oznaczOtwarta(S.e.id);
  $('#tresc').scrollTop = 0;
  zapamietajMiejsce({ notatka: S.e.id, otwarta: true, przewin: 0, kursor: null });
  const t = S.e.tresc;
  if (!n && tytul) $('#e-tekst').focus();
  else if (!n && lista) $('#e-lista input[type="text"]')?.focus();
  else if (!n) $('#e-tytul').focus();
  // Wejście z wyniku szukania: notatka przewinięta do trafienia, a z klawiatury kursor na nim.
  else if (skokDoTrafienia(!bezFokusu)) {
    /* kursor albo widok stoi na trafieniu */
  } else if (!bezFokusu) ustawKursor(t, false);
}

/** Kursor w notatce: na końcu tekstu albo w tytule listy. `doTekstu` – tytuł listy pomija. */
function ustawKursor(t, doTekstu) {
  if (t.jest_lista) {
    const p = doTekstu ? $('#e-lista input[type="text"]') : null;
    (p || $('#e-tytul')).focus();
    return;
  }
  const pole = $('#e-tekst');
  pole.focus();
  const dl = tekstZPola(pole).length;
  ustawZaznaczenie(pole, dl, dl);
}

// --- powrót do pracy (Jacek, 22.10.2026: „We come back to where we left off the work”; js/app.js, wrocDoPracy) ---

/** Gdzie stoi kursor w otwartej notatce: { pole, od, do, id }; null przy bardzo długiej notatce, undefined poza polami. */
function miejsceKursora() {
  const a = document.activeElement;
  if (!S.e || !a) return undefined;
  if (a.id === 'e-tytul') return { pole: 'tytul', od: a.selectionStart, do: a.selectionEnd };
  if (a.id === 'e-tekst') {
    // Przy milionie znaków liczenie miejsca kursora trwa (jak w kursorPola), więc taka notatka wraca na koniec.
    if (dlugaNotatka()) return null;
    const z = zaznaczenie(a);
    return z ? { pole: 'tekst', od: z[0], do: z[1] } : undefined;
  }
  const p = a.closest && a.closest('#e-lista .e-pozycja');
  if (p && a.matches('input[type="text"]')) return { pole: 'lista', id: p.dataset.id, od: a.selectionStart, do: a.selectionEnd };
  return undefined;
}

/** Zapisuje przewinięcie otwartej notatki i miejsce kursora; kursor poza polami (przycisk, lista) zostawia ostatnie miejsce. */
function zapamietajMiejsceNotatki(odRazu = false) {
  if (!S.e) return;
  const k = miejsceKursora();
  zapamietajMiejsce({ notatka: S.e.id, otwarta: true, przewin: Math.round($('#tresc').scrollTop), ...(k === undefined ? {} : { kursor: k }) }, odRazu);
}

/** Kursor albo zaznaczenie w zapisanym miejscu, bez przewijania; bez miejsca jak przy otwarciu z listy. */
function przywrocKursor(k) {
  const t = S.e.tresc;
  const tresc = $('#tresc');
  const przewin = tresc.scrollTop;
  const wPolu = (p, od, do_) => {
    p.focus({ preventScroll: true });
    p.setSelectionRange(od, do_);
  };
  const pozycja = k && k.pole === 'lista' && t.jest_lista ? $(`#e-lista .e-pozycja[data-id="${CSS.escape(String(k.id || ''))}"] input[type="text"]`) : null;
  if (k && k.pole === 'tytul') wPolu($('#e-tytul'), k.od, k.do);
  else if (pozycja) wPolu(pozycja, k.od, k.do);
  else if (k && k.pole === 'tekst' && !t.jest_lista) {
    const pole = $('#e-tekst');
    pole.focus({ preventScroll: true });
    // Tekst mógł się zmienić na innym urządzeniu: miejsce za końcem staje na końcu (ustawZaznaczenie).
    ustawZaznaczenie(pole, k.od, k.do);
  } else ustawKursor(t, false);
  tresc.scrollTop = przewin;
}

/**
 * Otwiera notatkę tam, gdzie była praca: to samo przewinięcie, a z `fokus` kursor albo zaznaczenie w tym samym polu
 * (na telefonie bez fokusu, żeby klawiatura nie zasłoniła połowy notatki).
 */
export async function otworzWMiejscu(id, { przewin = 0, kursor = null } = {}, { fokus = true } = {}) {
  await otworzEdytor(id, { bezFokusu: true });
  if (!S.e || S.e.id !== id) return false;
  if (fokus) przywrocKursor(kursor);
  $('#tresc').scrollTop = Number(przewin) || 0;
  zapamietajMiejsce({ przewin: Math.round($('#tresc').scrollTop), kursor });
  return true;
}

/**
 * Okno pokazane z otwartą notatką (ikona, zasobnik, dwuklik kółkiem): fokus zostaje w notatce, na liście albo
 * w wyszukiwarce, a z innego miejsca (krzyżyk, którym okno się schowało) wraca do notatki, w zapisane miejsce kursora.
 */
export function wrocFokusDoNotatki() {
  if (!S.e) return;
  const a = document.activeElement;
  if (a && a !== document.body && a.closest('#e-karta, #kolumna-listy, #szukaj')) return;
  const m = wczytajMiejsce();
  przywrocKursor(m.notatka === S.e.id ? m.kursor : null);
}

/** Miejsce w notatce zapisuje się samo: kursor, pisanie i przewinięcie, raz na 400 ms spokoju; strona w tle od razu. */
function podepnijMiejsce() {
  let timer = null;
  const pozniej = () => {
    if (!S.e) return;
    clearTimeout(timer);
    timer = setTimeout(() => zapamietajMiejsceNotatki(), 400);
  };
  document.addEventListener('selectionchange', pozniej);
  $('#tresc').addEventListener('scroll', pozniej, { passive: true });
  for (const z of ['keyup', 'pointerup', 'focusin']) $('#e-karta').addEventListener(z, pozniej, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.e) {
      clearTimeout(timer);
      zapamietajMiejsceNotatki(true);
    }
  });
}

/**
 * Wejście z wyniku szukania (Jacek, 17.10.2026: „find the item in the text when I click on showing it”). To główny powód
 * tego programu: Google Keep otwiera notatkę, ale trafienia głęboko w tekście nie widać. Notatka staje na pierwszym
 * trafieniu w treści albo w pozycji listy, w górnej trzeciej części ekranu, a trafienie dostaje fioletową kapsułkę
 * (pokazTrafienie). Z `fokus` (z klawiatury) kursor staje za trafieniem, bez zaznaczenia, żeby pisanie niczego nie
 * zastąpiło. Bez szukania (pusta wyszukiwarka) nic nie robi.
 */
function skokDoTrafienia(fokus) {
  if (!S.terminy || !S.terminy.length) return false;
  const pole = $('#e-tekst');
  if (pole && !pole.hidden) {
    const z = pozycjaTrafienia(tekstZPola(pole), S.terminy, S.rozmyty);
    const zakres = z && zakresPola(pole, z[0], z[1]);
    if (!zakres) return false;
    if (fokus) {
      pole.focus({ preventScroll: true });
      ustawZaznaczenie(pole, z[1], z[1]);
    }
    przewinDo(zakres.getBoundingClientRect());
    pokazTrafienie(() => [...zakres.getClientRects()]);
    return true;
  }
  for (const p of $$('#e-lista input[type="text"]')) {
    const z = pozycjaTrafienia(p.value, S.terminy, S.rozmyty);
    if (!z) continue;
    const id = p.closest('.e-pozycja').dataset.id;
    if (fokus) {
      p.focus({ preventScroll: true });
      p.setSelectionRange(z[1], z[1]);
    }
    przewinDo(p.getBoundingClientRect());
    pokazTrafienie(() => prostokatWPozycji(id, z[0], z[1]));
    return true;
  }
  return false;
}

/** Przewija treść tak, żeby prostokąt (trafienie) stanął w górnej trzeciej części ekranu. */
function przewinDo(r) {
  const tresc = $('#tresc');
  const y = r.top - tresc.getBoundingClientRect().top + tresc.scrollTop;
  tresc.scrollTop = Math.max(0, y - tresc.clientHeight / 3);
}

// Kapsułka trafienia: fiolet, bo w programach Jacka fiolet znaczy szukanie (wzorzec THIS IS THE WAY). Cztery razy wolno
// pulsuje, potem zostaje spokojna. Gaśnie, gdy kursor myszy przejdzie nad nią („już widziałem”), przy pisaniu i przy
// kliknięciu w notatce. Kapsułki leżą w warstwie nad kartką (#e-trafienie, styl.css) i idą za tekstem, gdy zmienia się
// szerokość okna albo powiększenie (podepnijTrafienie).
let trafienie = null; // { prostokaty: () => DOMRect[], od }
const OKOLICA_TRAFIENIA = 16;
let miarka = null;

function pokazTrafienie(prostokaty) {
  zgasTrafienie(true);
  trafienie = { prostokaty, od: performance.now() };
  ustawTrafienie();
}

/** Kapsułki na miejscu trafienia, jedna na linię (słowo pogrubione w połowie to wciąż jedna kapsułka). */
function ustawTrafienie() {
  if (!trafienie) return;
  const w = $('#e-trafienie');
  const linie = [];
  for (const r of trafienie.prostokaty()) {
    if (r.width < 1 || r.height < 1) continue;
    const l = linie.find((x) => Math.abs(x.top - r.top) < 3 && r.left <= x.right + 2);
    if (l) {
      l.left = Math.min(l.left, r.left);
      l.right = Math.max(l.right, r.right);
      l.bottom = Math.max(l.bottom, r.bottom);
    } else linie.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  if (!linie.length) {
    zgasTrafienie(true);
    return;
  }
  const b = w.parentElement.getBoundingClientRect();
  // Kapsułka dorysowana później (słowo przeszło do dwóch linii) pulsuje w tym samym takcie co reszta.
  const takt = `${-Math.round(performance.now() - trafienie.od)}ms`;
  while (w.children.length > linie.length) w.lastChild.remove();
  linie.forEach((l, i) => {
    let k = w.children[i];
    if (!k) {
      k = el('span.trafienie');
      k.style.animationDelay = takt;
      w.append(k);
    }
    Object.assign(k.style, { left: `${l.left - b.left - 3}px`, top: `${l.top - b.top - 1}px`, width: `${l.right - l.left + 6}px`, height: `${l.bottom - l.top + 2}px` });
  });
  w.hidden = false;
}

function zgasTrafienie(odRazu = false) {
  const w = $('#e-trafienie');
  if (!trafienie && w.hidden) return;
  trafienie = null;
  const sprzataj = () => {
    if (trafienie) return;
    w.hidden = true;
    w.replaceChildren();
    w.classList.remove('zgaszone');
  };
  if (odRazu) sprzataj();
  else {
    w.classList.add('zgaszone');
    setTimeout(sprzataj, 320);
  }
}

function bliskoTrafienia(x, y) {
  return [...$('#e-trafienie').children].some((k) => {
    const r = k.getBoundingClientRect();
    return x >= r.left - OKOLICA_TRAFIENIA && x <= r.right + OKOLICA_TRAFIENIA && y >= r.top - OKOLICA_TRAFIENIA && y <= r.bottom + OKOLICA_TRAFIENIA;
  });
}

/** Trafienie w pozycji listy: pole ma jedną linię, więc miejsce słowa mierzy się krojem pola. */
function prostokatWPozycji(id, od, do_) {
  const pole = $(`#e-lista .e-pozycja[data-id="${CSS.escape(id)}"] input[type="text"]`);
  if (!pole) return [];
  const st = getComputedStyle(pole);
  if (!miarka) miarka = document.createElement('canvas').getContext('2d');
  miarka.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
  const r = pole.getBoundingClientRect();
  const x0 = r.left + parseFloat(st.borderLeftWidth) + parseFloat(st.paddingLeft) - pole.scrollLeft;
  const a = Math.max(r.left, x0 + miarka.measureText(pole.value.slice(0, od)).width);
  const b = Math.min(r.right, x0 + miarka.measureText(pole.value.slice(0, do_)).width);
  const wys = parseFloat(st.fontSize) * 1.3;
  return b > a ? [new DOMRect(a, r.top + (r.height - wys) / 2, b - a, wys)] : [];
}

function podepnijTrafienie() {
  const tresc = $('#tresc');
  // „Już widziałem”: kursor myszy przy kapsułce. Pierwsze 300 ms się nie liczą, bo wtedy treść się przewija.
  tresc.addEventListener('pointermove', (ev) => {
    if (trafienie && ev.pointerType === 'mouse' && performance.now() - trafienie.od > 300 && bliskoTrafienia(ev.clientX, ev.clientY)) zgasTrafienie();
  });
  tresc.addEventListener('pointerdown', () => zgasTrafienie());
  $('#e-karta').addEventListener('input', () => zgasTrafienie(true), true);
  new ResizeObserver(() => ustawTrafienie()).observe($('#e-karta'));
}

/** Zamyka edytor (zapisuje wersję) i wraca do listy. */
export async function zamknijEdytor({ bezOdswiezania = false, bezFokusu = false } = {}) {
  const e = S.e;
  if (!e) return;
  // Miejsce w notatce zostaje: na szerokim ekranie ta notatka wraca przy następnym pokazaniu okna (js/app.js, wrocDoPracy).
  zapamietajMiejsceNotatki();
  zatrzymajNagrywanie();
  if (e.tresc.jest_lista) {
    const przed = e.tresc.lista.length;
    e.tresc.lista = e.tresc.lista.filter((p) => p.tekst.trim() !== '');
    if (e.tresc.lista.length !== przed && e.istnieje) zmiana(e, false);
  }
  await zapiszWersje(e);
  zgasTrafienie(true);
  S.e = null;
  zapamietajMiejsce({ otwarta: false });
  // Działania okna na tej notatce (usunięty obraz, usunięte pozycje) cofa się, póki jest otwarta. Potem zostaje historia wersji.
  S.cofnij = S.cofnij.filter((c) => c.wlasciciel !== e);
  S.ponow = S.ponow.filter((c) => c.wlasciciel !== e);
  ustawEkran('lista');
  oznaczOtwarta(null);
  if (!bezOdswiezania) await odswiezListe({ przewin: e.przewin });
  if (!bezFokusu) {
    const k = document.querySelector(`#sekcje .wpis[data-id="${CSS.escape(e.id)}"]`);
    if (k) {
      k.tabIndex = 0;
      k.focus({ preventScroll: true });
    } else $('#szukaj').focus();
  }
}

// Lista stoi obok notatki: po zapisanej wersji pokazuje nowy tytuł, początek tekstu i kolejność.
// Na wąskim ekranie listy nie widać – odświeży się przy powrocie.
let timerListy = null;
function odswiezListeObok() {
  if (waski()) return;
  clearTimeout(timerListy);
  timerListy = setTimeout(() => odswiezListe({ przewin: $('#kolumna-listy').scrollTop }), 100);
}

// --- zapis ---

function zmiana(e = S.e, robocza = true) {
  if (!e) return;
  e.zmieniona = true;
  e.zmian += 1;
  if (robocza) zapiszRobocza(e);
  clearTimeout(e.timer);
  // Jak w Notatkach Apple zapis jest niewidoczny: nad kartką stoi data, a nie „Zapisywanie…”.
  // Błąd zapisu i tak mówi komunikat (bladToast), a czytnik ekranu nie słyszy niczego przy każdym znaku.
  e.timer = setTimeout(() => zapiszWersje(e), OPOZNIENIE_WERSJI);
}

let roboczaWDrodze = false;
let roboczaCzeka = null;

/**
 * Treść do zapisu bez miejsca na liście: miejsce zmienia tylko przeciąganie (lista.js), a edytor trzyma kopię z chwili
 * otwarcia. Rdzeń bez tego pola zostawia notatkę tam, gdzie stoi (silnik.rs, zapisz).
 */
function doZapisu(t) {
  const { pozycja, ...reszta } = t;
  return reszta;
}

/** Kopia robocza – co najwyżej jedna w drodze, ostatnia wygrywa. */
async function zapiszRobocza(e) {
  if (roboczaWDrodze) {
    roboczaCzeka = e;
    return;
  }
  roboczaWDrodze = true;
  try {
    let biezaca = e;
    while (biezaca) {
      roboczaCzeka = null;
      await wywolaj('robocza', { id: biezaca.id, baza: biezaca.baza, tresc: doZapisu(biezaca.tresc) });
      biezaca = roboczaCzeka;
    }
  } catch (err) {
    bladToast(err);
  } finally {
    roboczaWDrodze = false;
  }
}

function porownanie(t) {
  return JSON.stringify([
    t.tytul,
    t.tekst,
    t.tekst_html || null,
    t.jest_lista,
    t.lista,
    [...(t.tagi || [])].sort(),
    t.kolor,
    t.przypieta,
    t.archiwum,
    Boolean(t.karteczka),
    t.kosz || null,
    t.zalaczniki,
    t.linki,
    t.przypomnienie || null,
  ]);
}

/** Pełna wersja notatki (kolejkowana – nigdy dwie naraz dla jednej notatki). */
export function zapiszWersje(e = S.e) {
  if (!e) return Promise.resolve();
  if (e === S.e && timerPola) {
    wypchnijPole();
    e.zmieniona = true;
  }
  clearTimeout(e.timer);
  if (!e.zmieniona) return e.zapis || Promise.resolve();
  e.zmieniona = false;
  const nr = e.zmian;
  const tresc = doZapisu(structuredClone(e.tresc));
  const poprzedni = e.zapis || Promise.resolve();
  const ten = poprzedni.then(async () => {
    try {
      const r = await wywolaj('zapisz', { id: e.id, baza: e.baza, tresc });
      if (r.notatka) {
        S.notatki.set(r.notatka.id, r.notatka);
        e.istnieje = true;
        if (e.zmian === nr) {
          e.baza = r.notatka.glowa;
          // Rdzeń połączył naszą zmianę ze zmianą z innego urządzenia – pokaż wynik.
          if (porownanie(r.notatka.tresc) !== porownanie(e.tresc)) {
            e.tresc = structuredClone(r.notatka.tresc);
            if (S.e === e) rysujEdytor({ zachowajFokus: true });
          }
        } else {
          // W trakcie zapisu doszły nowe znaki: następna wersja wyjdzie od naszej,
          // a rdzeń sam połączy ją z ewentualnym scaleniem.
          e.baza = r.wersja || r.notatka.glowa;
        }
      }
      if (r.tagi) {
        S.tagi = r.tagi;
        rysujPasek();
      }
      if (S.e === e) stanZapisu();
      // Przypomnienie powtarzane: najbliższy termin liczy rdzeń, a plakietki i widok Przypomnienia idą za nim.
      if (tresc.przypomnienie || S.nastepne.has(e.id)) odswiezPrzypomnienia();
      odswiezListeObok();
    } catch (err) {
      e.zmieniona = true;
      bladToast(err);
    } finally {
      if (e.zapis === ten) e.zapis = null;
    }
  });
  e.zapis = ten;
  return ten;
}

let timerStanu = null;
/**
 * Wynik polecenia w wierszu stanu notatki, na kilka sekund (np. „Zapisano wersję” po Ctrl+S),
 * zamiast komunikatu w rogu okna. Wiersz ma role="status", więc czytnik ekranu też to przeczyta.
 */
export function chwilowyStan(tekst) {
  if (!S.e) return;
  clearTimeout(timerStanu);
  $('#e-stan').textContent = tekst;
  timerStanu = setTimeout(stanZapisu, 4000);
}
function stanZapisu() {
  const e = S.e;
  if (!e) return;
  const t = e.tresc;
  const n = S.notatki.get(e.id);
  const edyt = n ? n.tresc.edytowana : 0;
  const stan = $('#e-stan');
  // Jak w Notatkach Apple: nad kartką sama data ostatniej zmiany (nowa notatka – dzisiejsza),
  // a kiedy notatka powstała, mówi podpowiedź.
  let opis = dataKartki(e.istnieje && edyt ? edyt : Date.now());
  ustawDymek(stan, t.utworzona ? `Utworzono ${dataKartki(t.utworzona)}` : '');
  // W koszu notatki nie da się zmienić – mówimy wprost, jak ją wyjąć. Kosz nie wygasa (Jacek, 21.10.2026).
  if (t.kosz) opis = `${t.oprozniona ? 'W opróżnionym koszu' : 'W koszu'}. Przywrócisz ją w menu Więcej`;
  stan.textContent = opis;
}

/**
 * Najbliższy termin przypomnienia przyszedł z rdzenia (minęła godzina powtarzanego, synchronizacja):
 * plakietka i opis przycisku otwartej notatki idą za nim. Gdy fokus stoi na plakietce, zostaje –
 * nowy termin pokaże się przy następnym rysowaniu.
 */
export function odswiezTerminOtwartej() {
  if (!S.e || !S.e.tresc.przypomnienie) return;
  rysujPrzyciski();
  rysujTermin();
}
/** Zmiana z zewnątrz (MCP, synchronizacja, cofnięcie) dla otwartej notatki. */
export function odswiezOtwarty(zmienione) {
  const e = S.e;
  if (!e || !zmienione) return;
  const n = zmienione.find((x) => x.id === e.id);
  if (!n) return;
  if (e.zmieniona || e.zapis) {
    // Użytkownik pisze: jego wersja wyjdzie od starej bazy i rdzeń scali obie.
    return;
  }
  e.baza = n.glowa;
  if (porownanie(n.tresc) !== porownanie(e.tresc)) {
    e.tresc = structuredClone(n.tresc);
    rysujEdytor({ zachowajFokus: true });
  }
}

// --- cofanie w otwartej notatce (reguła Jacka z 16.10.2026: Ctrl+Z cofa ostatnią operację, Ctrl+Y ją ponawia) ---
//
// Każda zmiana otwartej notatki idzie na wspólną listę działań (S.cofnij) w kolejności, w jakiej ją zrobiłeś: pisanie,
// ptaszek, nowa, połączona, przesunięta i usunięta pozycja, przypomnienie, obraz, zmiana typu. Wpis pamięta część treści
// sprzed zmiany i po niej, więc cofnięcie i ponowienie wraca dokładnie do tego stanu, także po przerysowaniu pól. Pisanie
// w jednym polu to jeden krok, aż do innego działania, innego pola albo sekundy przerwy. Formatowanie, tabela i wklejenie
// to zawsze osobny krok. W polu Ctrl+Z cofa najnowszy krok tej notatki (podepnijCofanie), a poza polem najnowsze działanie, także na
// liście (app.js). Wpisy znikają po zamknięciu notatki (zamknijEdytor), potem zostaje historia wersji.

const CZESCI = {
  tytul: ['tytul'],
  tekst: ['tekst', 'tekst_html'],
  lista: ['lista'],
  przypomnienie: ['przypomnienie'],
  zalaczniki: ['zalaczniki'],
  typ: ['tekst', 'tekst_html', 'lista', 'jest_lista'],
};
// Lista, przypomnienie i załączniki zmieniają się w miejscu, więc migawka to ich kopia. Napisy zostają jako odwołania.
const KOPIOWANE = new Set(['lista', 'przypomnienie', 'zalaczniki']);
const PRZERWA_PISANIA = 1000;
// Miejsce kursora tuż przed zmianą (beforeinput): tam staje kursor po cofnięciu pisania.
let kursorPrzed = null; // { pole, k }
// Następna zmiana pola treści zaczyna nowy krok (formatowanie, tabela, wklejenie).
let nastepnyOsobno = false;

function dlugaNotatka() {
  return Boolean(S.e && (S.e.tresc.tekst || '').length > DLUGA_NOTATKA);
}

function migawka(t, czesc) {
  const m = {};
  for (const k of CZESCI[czesc]) m[k] = KOPIOWANE.has(k) ? structuredClone(t[k] ?? null) : (t[k] ?? null);
  return m;
}

/** Ile znaków treści trzyma migawka (limit pamięci kroków, stan.js). */
function znakiMigawki(m) {
  return (m.tekst ? m.tekst.length : 0) + (m.tekst_html ? m.tekst_html.length : 0);
}

function jakMigawka(t, m) {
  return Object.keys(m).every((k) => (KOPIOWANE.has(k) ? JSON.stringify(t[k] ?? null) === JSON.stringify(m[k]) : (t[k] ?? null) === m[k]));
}

/** Miejsce kursora w polu kroku pisania: 'tytul', 'tekst' albo 'lista:<id pozycji>'. */
function kursorPola(pole) {
  if (pole === 'tytul') {
    const p = $('#e-tytul');
    return [p.selectionStart, p.selectionEnd];
  }
  if (pole === 'tekst') return dlugaNotatka() ? null : zaznaczenie($('#e-tekst'));
  const id = pole.slice('lista:'.length);
  const p = $(`#e-lista .e-pozycja[data-id="${CSS.escape(id)}"] input[type="text"]`);
  return { id, poz: p ? p.selectionStart : null };
}

/** Przywraca część treści z migawki i rysuje ją. `false`, gdy nie było czego zmieniać: Ctrl+Z idzie wtedy dalej. */
function przywroc(e, czesc, m, kursor) {
  if (S.e !== e || jakMigawka(e.tresc, m)) return false;
  const t = e.tresc;
  for (const [k, v] of Object.entries(m)) t[k] = KOPIOWANE.has(k) ? structuredClone(v) : v;
  if (!t.lista) t.lista = [];
  if (!t.zalaczniki) t.zalaczniki = [];
  // Kursor wraca na miejsce tylko wtedy, gdy stoi w notatce: Ctrl+Z na liście notatek nie zabiera fokusu.
  const wNotatce = $('#e-karta').contains(document.activeElement);
  zmiana(e);
  if (czesc === 'typ') rysujEdytor({ zachowajFokus: true });
  else if (czesc === 'tytul') {
    const pole = $('#e-tytul');
    pole.value = t.tytul || '';
    dopasujTytul(pole);
    if (kursor && document.activeElement === pole) pole.setSelectionRange(kursor[0], kursor[1]);
  } else if (czesc === 'tekst') {
    const pole = $('#e-tekst');
    ustawHtmlPola(pole, t.tekst_html || htmlZTekstu(t.tekst || ''));
    if (kursor && document.activeElement === pole) ustawZaznaczenie(pole, kursor[0], kursor[1]);
    odswiezPasekFormatu();
  } else if (czesc === 'lista') {
    const id = wNotatce && kursor ? kursor.id : null;
    rysujListe(id, id && kursor.poz != null ? kursor.poz : null, { naZnaczniku: Boolean(kursor && kursor.znacznik) });
  } else if (czesc === 'przypomnienie') {
    rysujTermin();
    rysujPrzyciski();
  } else if (czesc === 'zalaczniki') {
    rysujObrazy();
    rysujNagrania();
  }
  if (czesc !== 'typ') rysujLinki();
  return true;
}

/** Zmiana otwartej notatki jako krok cofania: migawka części treści przed `zrob()` i po nim. */
function zmienZCofaniem(e, opis, czesc, zrob, kursor = null) {
  if (!e || S.e !== e) return zrob();
  const przed = migawka(e.tresc, czesc);
  const wynik = zrob();
  if (!jakMigawka(e.tresc, przed)) {
    const po = migawka(e.tresc, czesc);
    zapamietajDzialanie({
      opis,
      wlasciciel: e,
      znakow: znakiMigawki(przed) + znakiMigawki(po),
      cofnij: () => przywroc(e, czesc, przed, kursor),
      ponow: () => przywroc(e, czesc, po, kursor),
    });
  }
  return wynik;
}

function nowyKrok(pole, e = S.e) {
  const ost = S.cofnij[S.cofnij.length - 1];
  return nastepnyOsobno || !ost || ost.pisanie !== pole || ost.wlasciciel !== e || Date.now() - ost.kiedy >= PRZERWA_PISANIA;
}

/**
 * Pisanie w polu (`pole`: 'tytul', 'tekst' albo 'lista:<id>'): pierwsza zmiana po innym działaniu, w innym polu albo po
 * przerwie zaczyna nowy krok cofania, następne go przedłużają. Wołane przed zapisaniem zmiany w stanie, bo migawka
 * „przed” to stan sprzed pierwszej zmiany kroku.
 */
function pisanie(e, pole, czesc) {
  const k = kursorPrzed && kursorPrzed.pole === pole ? kursorPrzed.k : undefined;
  kursorPrzed = null;
  if (!nowyKrok(pole, e)) {
    S.cofnij[S.cofnij.length - 1].kiedy = Date.now();
    S.ponow.length = 0;
    return;
  }
  // Wklejenia, formatowania i zmiany tabeli nie przedłuża pisanie, które idzie po nich.
  const osobno = nastepnyOsobno;
  nastepnyOsobno = false;
  const przed = migawka(e.tresc, czesc);
  const kursor = k !== undefined ? k : kursorPola(pole);
  const wpis = { opis: 'Pisanie', wlasciciel: e, pisanie: osobno ? null : pole, kiedy: Date.now(), znakow: znakiMigawki(przed) };
  wpis.cofnij = () => {
    wpis.po = migawka(e.tresc, czesc);
    wpis.kursorPo = kursorPola(pole);
    return przywroc(e, czesc, przed, kursor);
  };
  wpis.ponow = () => przywroc(e, czesc, wpis.po, wpis.kursorPo);
  zapamietajDzialanie(wpis);
}

/** Zmiana pola treści poleceniem (formatowanie, tabela, wklejenie) to osobny krok cofania, także w środku pisania. */
function osobnyKrok(pole, zrob) {
  if (!S.e) return false;
  wypchnijPole();
  nastepnyOsobno = true;
  // Kursor sprzed zmiany, bo tam staje po cofnięciu. Liczony teraz, zanim wklejenie wydłuży pole.
  kursorPrzed = { pole: 'tekst', k: dlugaNotatka() ? null : zaznaczenie(pole) };
  try {
    const wynik = zrob();
    zapiszZPola(pole);
    return wynik;
  } finally {
    nastepnyOsobno = false;
    kursorPrzed = null;
  }
}

function poleNotatki(t) {
  return Boolean(t && (t.id === 'e-tytul' || (t.closest && t.closest('#e-tekst')) || (t.matches && t.matches('#e-lista input[type="text"]'))));
}

/**
 * Ctrl+Z, Ctrl+Y i Ctrl+Shift+Z w polach notatki cofają i ponawiają kroki tej notatki. Cofanie z menu przeglądarki
 * (historyUndo) idzie tą samą drogą, więc przeglądarka nigdy nie cofa po swojemu pól, które program przerysował.
 */
function podepnijCofanie() {
  const karta = $('#e-karta');
  const tekst = $('#e-tekst');
  tekst.addEventListener('beforeinput', (ev) => {
    if (S.e && !ev.inputType.startsWith('history') && !dlugaNotatka() && nowyKrok('tekst')) kursorPrzed = { pole: 'tekst', k: zaznaczenie(tekst) };
  });
  const cofanieWPolu = (wstecz) => (wstecz ? cofnijOstatnie({ notatka: S.e }) : ponowOstatnie({ notatka: S.e }));
  karta.addEventListener(
    'keydown',
    (ev) => {
      if (!S.e || !(ev.ctrlKey || ev.metaKey) || ev.altKey || !poleNotatki(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      ev.preventDefault();
      ev.stopPropagation();
      cofanieWPolu(k === 'z' && !ev.shiftKey);
    },
    true,
  );
  karta.addEventListener(
    'beforeinput',
    (ev) => {
      if (ev.inputType !== 'historyUndo' && ev.inputType !== 'historyRedo') return;
      ev.preventDefault();
      if (S.e) cofanieWPolu(ev.inputType === 'historyUndo');
    },
    true,
  );
}

// --- rysowanie ---

function ustawWartosc(pole, wartosc) {
  if (pole.value === wartosc) return;
  const aktywne = document.activeElement === pole;
  const [a, b] = [pole.selectionStart, pole.selectionEnd];
  pole.value = wartosc;
  if (aktywne) pole.setSelectionRange(Math.min(a, wartosc.length), Math.min(b, wartosc.length));
}

/** Tytuł zawija się w kolejne wiersze: niewidoczna kopia tekstu obok pola nadaje mu wysokość (styl.css, .e-tytul-ramka). */
function dopasujTytul(tytul) {
  tytul.parentElement.dataset.kopia = tytul.value;
}

function rysujEdytor({ zachowajFokus = false } = {}) {
  zgasTrafienie(true);
  const e = S.e;
  const t = e.tresc;
  const tylkoOdczyt = Boolean(t.kosz);
  const tytul = $('#e-tytul');
  const tekst = $('#e-tekst');
  if (zachowajFokus) ustawWartosc(tytul, t.tytul || '');
  else tytul.value = t.tytul || '';
  dopasujTytul(tytul);
  // Sformatowana treść, a gdy notatka jej nie ma – czysty tekst zamieniony na wiersze.
  ustawHtmlPola(tekst, t.tekst_html || htmlZTekstu(t.tekst || ''));
  tytul.readOnly = tylkoOdczyt;
  tekst.contentEditable = tylkoOdczyt ? 'false' : 'true';
  tekst.hidden = Boolean(t.jest_lista);
  $('#e-lista').hidden = !t.jest_lista;
  // Formatowanie (Aa) tylko przy zwykłym tekście, który da się zmieniać.
  const aa = $('#e-aa');
  aa.hidden = Boolean(t.jest_lista) || tylkoOdczyt;
  // Inna notatka: pływający pasek znika, bo stał nad tekstem poprzedniej.
  if (aa.hidden || (!zachowajFokus && $('#panel-formatu').classList.contains('plywajacy'))) przelaczFormatowanie(false);
  if (t.jest_lista) rysujListe();
  rysujObrazy();
  rysujNagrania();
  rysujLinki();
  rysujTermin();
  rysujPrzyciski();
  $('#e-konflikt').hidden = !t.konflikt;
  stanZapisu();
}

// --- formatowanie treści ---

/**
 * Przepisuje treść z pola do stanu: sformatowany HTML i czysty tekst wyliczony z niego. Zmiana idzie do cofania jako
 * pisanie, a z `osobno` jako osobny krok (tabela).
 */
function zapiszZPola(pole, { osobno = false } = {}) {
  if (!S.e) return;
  clearTimeout(timerPola);
  timerPola = null;
  const { html, tekst, formatowanie } = trescPola(pole);
  const t = S.e.tresc;
  // Notatka bez pogrubień i kolorów nie trzyma drugiej postaci treści.
  const noweHtml = formatowanie ? html : null;
  if (t.tekst !== tekst || (t.tekst_html ?? null) !== noweHtml) {
    if (osobno) nastepnyOsobno = true;
    pisanie(S.e, 'tekst', 'tekst');
  }
  t.tekst = tekst;
  t.tekst_html = noweHtml;
}

// Notatka dłuższa niż milion znaków: treść z pola co najwyżej 4 razy na sekundę, a nie po każdym klawiszu (całość
// liczy się wtedy kilkaset milisekund). Zapis wersji i zamknięcie notatki najpierw ją dopisują (wypchnijPole).
const DLUGA_NOTATKA = 1_000_000;
let timerPola = null;

/** Zaległa treść z pola długiej notatki trafia do stanu, zanim cokolwiek ją zapisze. */
function wypchnijPole() {
  if (!timerPola) return;
  zapiszZPola($('#e-tekst'));
}

const STANY_FORMATU = ['pogrubienie', 'kursywa', 'podkreslenie', 'przekreslenie'];

function odswiezPasekFormatu() {
  if (!S.e || S.e.tresc.jest_lista) return;
  for (const b of $$('#pasek-formatu .fmt[data-fmt]')) {
    if (STANY_FORMATU.includes(b.dataset.fmt)) b.setAttribute('aria-pressed', wlaczone(b.dataset.fmt) ? 'true' : 'false');
  }
  // Przycisk tabeli: poza tabelą wstawia nową, w tabeli otwiera jej menu.
  const t = $('#fmt-tabela');
  const wTabeli = Boolean(komorkaKursora($('#e-tekst')));
  const nazwa = wTabeli ? 'Edytuj tabelę: wiersze, kolumny, linie' : 'Wstaw tabelę';
  if (t.dataset.dymek !== nazwa) {
    t.setAttribute('aria-label', nazwa);
    ustawDymek(t, nazwa);
    if (wTabeli) t.setAttribute('aria-haspopup', 'menu');
    else t.removeAttribute('aria-haspopup');
  }
}

/** Menu tabeli z kursorem: wiersze i kolumny, rodzaj linii, usunięcie (js/tekstowe.js, zmienTabele). */
function menuTabeli(kotwica, pole, zapisz) {
  const zrob = (co) => () => {
    pole.focus();
    if (zmienTabele(pole, co)) zapisz();
  };
  menu(
    [
      { tekst: 'Dodaj wiersz', akcja: zrob('wiersz') },
      { tekst: 'Dodaj kolumnę', akcja: zrob('kolumna') },
      '-',
      { tekst: 'Usuń wiersz', akcja: zrob('usun-wiersz') },
      { tekst: 'Usuń kolumnę', akcja: zrob('usun-kolumne') },
      '-',
      { tekst: 'Szerokie, przezroczyste linie', przelacznik: tabelaSzeroka(pole), akcja: zrob('linie') },
      '-',
      { tekst: 'Usuń tabelę', niszczacy: true, akcja: zrob('usun') },
    ],
    kotwica,
    'Tabela',
  );
}

function podepnijPasekFormatu() {
  const pole = $('#e-tekst');
  const zastosuj = (co, wartosc = '') => {
    if (!S.e) return;
    const zaznaczone = zaznaczenie(pole);
    const trzebaZaznaczyc = ['kolor', 'tlo', 'rozmiar', 'kod', 'wyczysc'].includes(co);
    if (trzebaZaznaczyc && (!zaznaczone || zaznaczone[0] === zaznaczone[1])) {
      toast('Zaznacz najpierw fragment tekstu');
      return;
    }
    if (!osobnyKrok(pole, () => formatuj(pole, co, wartosc))) return;
    zmiana();
    odswiezPasekFormatu();
  };
  for (const b of $$('#pasek-formatu .fmt[data-fmt]')) {
    // `mousedown` bez domyślnej akcji – inaczej klik w przycisk gubi zaznaczenie w treści.
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => zastosuj(b.dataset.fmt));
  }
  // Kolor tekstu i wyróżnienie: paleta kółek Apple (ui.js, paleta). Rozmiar: lista, każda pozycja swoim rozmiarem.
  const menuKoloru = (kotwica, co, grupa, etykieta) =>
    menu(
      [{ tekst: etykieta, paleta: { kolory: paletaFormatu(grupa), wartosc: kluczKoloru(grupa, klasaZaznaczenia(pole, grupa)), akcja: (k) => zastosuj(co, klasaKoloru(grupa, k)) } }],
      kotwica,
      etykieta,
    );
  const menuRozmiaru = (kotwica) => {
    const teraz = klasaZaznaczenia(pole, 2);
    return menu(
      ROZMIARY.map(([nazwa, wartosc]) => ({ tekst: nazwa, styl: wartosc || undefined, zaznaczone: wartosc === teraz, akcja: () => zastosuj('rozmiar', wartosc) })),
      kotwica,
      'Rozmiar pisma',
    );
  };
  $('#fmt-kolor').addEventListener('mousedown', (ev) => ev.preventDefault());
  $('#fmt-kolor').addEventListener('click', (ev) => menuKoloru(ev.currentTarget, 'kolor', 0, 'Kolor tekstu'));
  $('#fmt-tlo').addEventListener('mousedown', (ev) => ev.preventDefault());
  $('#fmt-tlo').addEventListener('click', (ev) => menuKoloru(ev.currentTarget, 'tlo', 1, 'Wyróżnienie'));
  const tabela = $('#fmt-tabela');
  // Zmiana tabeli to zawsze osobny krok cofania.
  const poTabeli = () => {
    zapiszZPola(pole, { osobno: true });
    zmiana();
    odswiezPasekFormatu();
  };
  tabela.addEventListener('mousedown', (ev) => ev.preventDefault());
  tabela.addEventListener('click', (ev) => {
    if (!S.e) return;
    if (komorkaKursora(pole)) {
      menuTabeli(ev.currentTarget, pole, poTabeli);
      return;
    }
    // Kursor poza treścią: tabela idzie na koniec notatki.
    if (!zaznaczenie(pole)) {
      pole.focus();
      const dl = tekstZPola(pole).length;
      ustawZaznaczenie(pole, dl, dl);
    }
    if (osobnyKrok(pole, () => wstawTabele(pole))) {
      zmiana();
      odswiezPasekFormatu();
    }
  });
  $('#fmt-rozmiar').addEventListener('mousedown', (ev) => ev.preventDefault());
  $('#fmt-rozmiar').addEventListener('click', (ev) => menuRozmiaru(ev.currentTarget));
  // Prawy klik w treści (zadanie 8): Wytnij, Kopiuj i Wklej, a pod nimi formatowanie, jak w Wordzie. Na dotyku zostaje
  // menu systemu (przytrzymanie palcem zaznacza słowo).
  pole.addEventListener('contextmenu', (ev) => {
    if (!S.e || pole.contentEditable === 'false' || (ev.pointerType && ev.pointerType !== 'mouse') || !window.matchMedia('(any-pointer: fine)').matches) return;
    ev.preventDefault();
    const zakres = zaznaczenie(pole);
    const jest = Boolean(zakres && zakres[0] !== zakres[1]);
    const wroc = () => {
      pole.focus();
      if (zakres) ustawZaznaczenie(pole, zakres[0], zakres[1]);
    };
    const zrob = (fn) => () => {
      wroc();
      fn();
    };
    let gdzie = { x: ev.clientX, y: ev.clientY };
    if (!ev.clientX && !ev.clientY) {
      // Klawisz menu albo Shift+F10: menu przy kursorze.
      const z = zakresWTresci();
      const r = z ? prostokatZakresu(z) : pole.getBoundingClientRect();
      gdzie = { x: r.left, y: r.bottom };
    }
    // Kolor tekstu i wyróżnienie to osobne pozycje z nazwą: dwie takie same palety jedna pod drugą nie mówiły, która jest która.
    const wartoscKoloru = (grupa) => kluczKoloru(grupa, klasaZaznaczenia(pole, grupa));
    const kolory = (grupa, co, etykieta) =>
      jest
        ? {
            tekst: `${etykieta}…`,
            akcja: () =>
              menu(
                [{ tekst: etykieta, paleta: { kolory: paletaFormatu(grupa), wartosc: wartoscKoloru(grupa), akcja: (k) => { wroc(); zastosuj(co, klasaKoloru(grupa, k)); } } }],
                gdzie,
                etykieta,
              ),
          }
        : null;
    // Jedno formatowanie naraz: pasek nad zaznaczeniem chowa się, gdy otwiera się menu.
    schowajPasekFormatu();
    menu(
      [
        { tekst: 'Wytnij', skrot: 'Ctrl+X', wylaczone: !jest, akcja: zrob(() => osobnyKrok(pole, () => document.execCommand('cut')) && zmiana()) },
        { tekst: 'Kopiuj', skrot: 'Ctrl+C', wylaczone: !jest, akcja: zrob(() => document.execCommand('copy')) },
        { tekst: 'Wklej', skrot: 'Ctrl+V', akcja: () => { wroc(); wklejZSchowka(pole); } },
        '-',
        { tekst: 'Pogrub', skrot: 'Ctrl+B', akcja: zrob(() => zastosuj('pogrubienie')) },
        { tekst: 'Pochyl', skrot: 'Ctrl+I', akcja: zrob(() => zastosuj('kursywa')) },
        { tekst: 'Podkreśl', skrot: 'Ctrl+U', akcja: zrob(() => zastosuj('podkreslenie')) },
        { tekst: 'Przekreśl', skrot: 'Ctrl+Shift+S', akcja: zrob(() => zastosuj('przekreslenie')) },
        '-',
        kolory(0, 'kolor', 'Kolor tekstu'),
        kolory(1, 'tlo', 'Wyróżnienie'),
        // Interlinia całych akapitów, także bez zaznaczenia: wtedy akapitu z kursorem (Jacek, 25.10.2026: „Interlinię, żebym
        // mógł wybierać”). Ptaszek stoi przy obecnej.
        {
          tekst: 'Interlinia…',
          akcja: () => {
            wroc();
            const teraz = klasaZaznaczenia(pole, 3);
            menu(
              INTERLINIE.map(([nazwa, k]) => ({ tekst: nazwa, zaznaczone: k === teraz, akcja: () => { wroc(); zastosuj('interlinia', k); } })),
              gdzie,
              'Interlinia',
            );
          },
        },
        { tekst: 'Usuń formatowanie', skrot: 'Ctrl+\\', wylaczone: !jest, akcja: zrob(() => zastosuj('wyczysc')) },
      ],
      gdzie,
      'Tekst',
    );
  });
}

function rysujPrzyciski() {
  const t = S.e.tresc;
  // Pinezka nad notatką jest przełącznikiem: wciśnięta, póki notatka jest przypięta, a dymek mówi, co zrobi klik.
  const pin = $('#e-przypnij');
  pin.classList.toggle('wlaczony', Boolean(t.przypieta));
  pin.setAttribute('aria-pressed', String(Boolean(t.przypieta)));
  ustawDymek(pin, t.przypieta ? 'Odepnij notatkę' : 'Przypnij notatkę');
  ustawDymek($('#e-kolor'), 'Zmień kolor notatki');
  const przyp = $('#e-przypomnienie');
  const p = t.przypomnienie && !t.przypomnienie.zrobione ? t.przypomnienie : null;
  przyp.classList.toggle('wlaczony', Boolean(p));
  const napisPrzypomnienia = p ? tekstPrzypomnienia(p, kiedyPrzypomnienie(S.e.id, p) ?? p.czas) : 'Przypomnienie';
  przyp.setAttribute('aria-label', napisPrzypomnienia);
  // Dymek mówi, co się stanie, od czasownika (reguła `ikonki-z-dymkami.md`).
  ustawDymek(przyp, p ? `Zmień przypomnienie: ${terminPrzypomnienia(p, kiedyPrzypomnienie(S.e.id, p) ?? p.czas)}` : 'Ustaw przypomnienie');
  const typ = $('#e-typ');
  const napisTypu = t.jest_lista ? 'Zamień na zwykły tekst' : 'Zamień na listę z polami';
  typ.setAttribute('aria-label', napisTypu);
  ustawDymek(typ, napisTypu);
  typ.querySelector('use').setAttribute('href', t.jest_lista ? '#i-tekst' : '#i-pola');
  // Notatka w koszu jest tylko do czytania: znikają przyciski, które by ją zmieniały.
  const kosz = Boolean(t.kosz);
  for (const b of [pin, $('#e-kolor'), przyp, typ, $('#e-obraz')]) b.hidden = kosz;
  $('#e-glos').hidden = kosz || S.ustawienia.notatki_glosowe === false;
}

function rysujObrazy() {
  const e = S.e;
  const box = $('#e-obrazy');
  box.replaceChildren();
  for (const z of e.tresc.zalaczniki.filter((x) => x.typ.startsWith('image/'))) {
    const img = el('img', { src: urlPliku(z.hash), alt: z.nazwa || 'Obraz', loading: 'lazy', decoding: 'async' });
    img.addEventListener('click', () => pokazObraz(z));
    box.append(
      el('div.e-obraz', { dataset: { hash: z.hash } }, img, el('button.usun', { type: 'button', title: 'Usuń obraz', 'aria-label': 'Usuń obraz', onclick: () => usunZalacznik(z.hash) }, ikona('zamknij'))),
    );
  }
}

function rysujNagrania() {
  const e = S.e;
  const box = $('#e-nagrania');
  box.replaceChildren();
  for (const z of e.tresc.zalaczniki.filter((x) => x.typ.startsWith('audio/'))) {
    const opis = el('p.caption.przygaszony', { tekst: 'Wczytywanie transkrypcji…' });
    wywolaj('plik', { hash: z.hash })
      .then((r) => {
        const tekst = r && r.plik && r.plik.ocr;
        if (tekst) {
          opis.textContent = tekst;
          opis.classList.remove('przygaszony');
        } else if (S.ustawienia.klucz_soniox_ustawiony) opis.textContent = 'Transkrypcja w przygotowaniu';
        else opis.textContent = 'Bez transkrypcji – dodaj klucz Soniox w Ustawieniach';
      })
      .catch(() => {
        opis.textContent = '';
      });
    box.append(
      el(
        'div.e-nagranie',
        null,
        el('audio', { controls: true, preload: 'none', src: urlPliku(z.hash), 'aria-label': z.nazwa || 'Notatka głosowa' }),
        opis,
        el('button.usun', { type: 'button', title: 'Usuń nagranie', 'aria-label': 'Usuń nagranie', onclick: () => usunZalacznik(z.hash) }, ikona('zamknij')),
      ),
    );
  }
}

let timerLinkow = null;

function rysujLinki() {
  const e = S.e;
  // Odnośniki rysuje też minutnik po pisaniu, a notatka mogła się już zamknąć.
  if (!e) return;
  const box = $('#e-linki');
  const adresy = new Map();
  for (const l of e.tresc.linki || []) adresy.set(l.url, l.tytul || domena(l.url));
  if (S.ustawienia.wykrywanie_linkow !== false) {
    const zrodlo = [e.tresc.tekst || '', ...(e.tresc.lista || []).map((p) => p.tekst)].join('\n');
    for (const u of linkiWTekscie(zrodlo)) if (!adresy.has(u)) adresy.set(u, domena(u));
  }
  box.replaceChildren(
    ...[...adresy].map(([url, tytul]) =>
      el(
        'a.e-link',
        { href: url, title: `Otwórz ${url}`, onclick: (ev) => { ev.preventDefault(); otworzLink(url); } },
        ikona('link'),
        el('span', { tekst: tytul }),
        el('span.caption.przygaszony', { tekst: domena(url) }),
      ),
    ),
  );
}

export async function otworzLink(url) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (naTauri) {
    try {
      await wywolaj('otworz_link', { url });
    } catch (e) {
      bladToast(e);
    }
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Pod datą: przypomnienie z najbliższym terminem i rytmem słowami („Jutro, 9:00, codziennie”,
 * u powtarzanego termin liczy rdzeń). Kliknięcie otwiera jego okienko – tam też je usuniesz.
 * Zamiast plakietek: kartka zostaje kartką.
 */
function rysujTermin() {
  const e = S.e;
  const b = $('#e-termin');
  const p = e.tresc.przypomnienie && !e.tresc.przypomnienie.zrobione ? e.tresc.przypomnienie : null;
  b.hidden = !p;
  if (!p) return;
  const tekst = terminPrzypomnienia(p, kiedyPrzypomnienie(e.id, p));
  b.replaceChildren(ikona('dzwonek'), tekst);
  b.disabled = Boolean(e.tresc.kosz);
  b.setAttribute('aria-label', b.disabled ? `Przypomnienie: ${tekst}` : `Przypomnienie: ${tekst}. Zmień`);
  ustawDymek(b, b.disabled ? '' : 'Zmień przypomnienie');
}

// --- lista z polami wyboru ---

function widocznaKolejnosc() {
  const l = S.e.tresc.lista;
  return [...l.filter((p) => !p.zrobione), ...l.filter((p) => p.zrobione)];
}

function rysujListe(fokusId = null, pozycja = null, { naZnaczniku = false } = {}) {
  zgasTrafienie(true);
  const e = S.e;
  const box = $('#e-lista');
  const a = document.activeElement;
  const akt = a && a.closest ? a.closest('.e-pozycja') : null;
  const wLiscie = Boolean(akt && box.contains(akt));
  const fid = fokusId || (wLiscie ? akt.dataset.id : null);
  // Fokus na ptaszku zostaje na ptaszku (klik, spacja, cofnięcie), a nie przeskakuje do tekstu pozycji.
  const znacznik = naZnaczniku || (!fokusId && wLiscie && a.type === 'checkbox');
  const fpoz = pozycja !== null ? pozycja : wLiscie && a.type === 'text' ? a.selectionStart : null;
  box.replaceChildren();
  const nie = e.tresc.lista.filter((p) => !p.zrobione);
  const tak = e.tresc.lista.filter((p) => p.zrobione);
  for (const p of nie) box.append(wierszPozycji(p));
  const dodaj = () => zmienZCofaniem(S.e, 'Nowa pozycja', 'lista', () => dodajPozycje(null, ''));
  // Wiersz „Dodaj pozycję” równo z pozycjami: plus w kolumnie pól wyboru, napis w kolumnie tekstu (styl.css).
  if (!e.tresc.kosz) box.append(el('button.e-dodaj-pozycje', { type: 'button', onclick: dodaj }, el('span.e-dodaj-znak', null, ikona('plus')), el('span', { tekst: 'Dodaj pozycję' })));
  if (tak.length) {
    box.append(
      el(
        'button.e-zrobione-naglowek',
        { type: 'button', 'aria-expanded': e.pokazZrobione ? 'true' : 'false', onclick: () => { e.pokazZrobione = !e.pokazZrobione; rysujListe(); } },
        ikona(e.pokazZrobione ? 'dol' : 'gora'),
        liczba(tak.length, 'zrobiona pozycja', 'zrobione pozycje', 'zrobionych pozycji'),
      ),
    );
    if (e.pokazZrobione) for (const p of tak) box.append(wierszPozycji(p));
  }
  if (fid) {
    const w = box.querySelector(`.e-pozycja[data-id="${CSS.escape(fid)}"]`);
    const pole = w && w.querySelector('input[type="text"]');
    if (w && znacznik) w.querySelector('input[type="checkbox"]').focus();
    else if (pole) {
      pole.focus();
      const x = Math.min(fpoz ?? pole.value.length, pole.value.length);
      pole.setSelectionRange(x, x);
    }
  }
}

function wierszPozycji(p) {
  const tylkoOdczyt = Boolean(S.e.tresc.kosz);
  const w = el('div.e-pozycja', { role: 'listitem', dataset: { id: p.id } });
  if (p.zrobione) w.classList.add('zrobione');
  // Kropki przy pozycji (zadanie 14): widać je pod kursorem, a dymek mówi, co robią.
  const uchwyt = el('button.uchwyt', { type: 'button', tabindex: '-1', title: 'Przeciągnij, żeby przestawić pozycję (Alt+↑↓)', 'aria-hidden': 'true' }, ikona('uchwyt'));
  uchwyt.addEventListener('pointerdown', () => {
    w.draggable = true;
  });
  const cb = el('input', { type: 'checkbox', 'aria-label': p.zrobione ? 'Oznacz jako niezrobione' : 'Oznacz jako zrobione' });
  cb.checked = Boolean(p.zrobione);
  cb.disabled = tylkoOdczyt;
  cb.addEventListener('change', () => {
    const zrobione = cb.checked;
    zmienZCofaniem(S.e, zrobione ? 'Zrobione' : 'Do zrobienia', 'lista', () => {
      p.zrobione = zrobione;
    }, { id: p.id, znacznik: true });
    zmiana();
    rysujListe(p.id, null, { naZnaczniku: true });
  });
  const pole = el('input', { type: 'text', 'aria-label': 'Pozycja listy', placeholder: 'Pozycja', autocomplete: 'off' });
  pole.value = p.tekst;
  pole.readOnly = tylkoOdczyt;
  pole.addEventListener('beforeinput', () => {
    kursorPrzed = { pole: `lista:${p.id}`, k: { id: p.id, poz: pole.selectionStart } };
  });
  pole.addEventListener('input', () => {
    if (S.e && p.tekst !== pole.value) pisanie(S.e, `lista:${p.id}`, 'lista');
    p.tekst = pole.value;
    zmiana();
    clearTimeout(timerLinkow);
    timerLinkow = setTimeout(rysujLinki, 400);
  });
  pole.addEventListener('keydown', (ev) => klawiszPozycji(ev, p, pole));
  pole.addEventListener('paste', (ev) => wklejWiersze(ev, p, pole));
  // Bez menu „⋯” (Jacek, 21.10.2026): pozycję przestawia się przeciąganiem albo Alt+↑ ↓, a usuwa małym X na końcu wiersza.
  const m = el('button.pozycja-menu.pozycja-usun', { type: 'button', title: 'Usuń pozycję', 'aria-label': 'Usuń pozycję', hidden: tylkoOdczyt || null }, ikona('zamknij'));
  m.addEventListener('click', () => usunPozycje(p));
  // Wiersz da się chwycić także w pustym miejscu, nie tylko za uchwyt.
  w.addEventListener('pointerdown', (ev) => {
    if (ev.target === w && !tylkoOdczyt) w.draggable = true;
  });
  w.addEventListener('dragstart', (ev) => {
    S.e.przeciagana = p.id;
    w.classList.add('przeciagana');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', p.tekst);
  });
  w.addEventListener('dragend', () => {
    for (const x of document.querySelectorAll('#e-lista .upusc-nad, #e-lista .upusc-pod')) x.classList.remove('upusc-nad', 'upusc-pod');
    w.classList.remove('przeciagana');
    w.draggable = false;
    if (S.e) S.e.przeciagana = null;
  });
  // Kreska w akcencie pokazuje, gdzie stanie pozycja: nad wierszem albo pod nim.
  const pod = (ev) => {
    const r = w.getBoundingClientRect();
    return ev.clientY > r.top + r.height / 2;
  };
  const zgas = () => w.classList.remove('upusc-nad', 'upusc-pod');
  w.addEventListener('dragover', (ev) => {
    if (!S.e || !S.e.przeciagana || S.e.przeciagana === p.id) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    const nizej = pod(ev);
    w.classList.toggle('upusc-pod', nizej);
    w.classList.toggle('upusc-nad', !nizej);
  });
  w.addEventListener('dragleave', zgas);
  w.addEventListener('drop', (ev) => {
    zgas();
    if (!S.e || !S.e.przeciagana) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (S.e.przeciagana !== p.id) przeniesObok(S.e.przeciagana, p.id, pod(ev));
  });
  // Kółko ma 20 px, a celem jest kwadrat wokół niego (etykieta przełącza pole): 32 px myszą, 48 px palcem.
  w.append(uchwyt, el('label.e-znacznik', null, cb), pole, m);
  return w;
}

function klawiszPozycji(ev, p, pole) {
  const kol = widocznaKolejnosc();
  const i = kol.indexOf(p);
  if (ev.key === 'Enter' && ev.ctrlKey) {
    ev.preventDefault();
    zmienZCofaniem(S.e, p.zrobione ? 'Do zrobienia' : 'Zrobione', 'lista', () => {
      p.zrobione = !p.zrobione;
    }, { id: p.id, poz: pole.selectionStart });
    zmiana();
    rysujListe(p.id);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    const poz = pole.selectionStart;
    const reszta = pole.value.slice(pole.selectionEnd);
    zmienZCofaniem(S.e, 'Nowa pozycja', 'lista', () => {
      p.tekst = pole.value.slice(0, poz);
      dodajPozycje(p, reszta);
    }, { id: p.id, poz });
  } else if (ev.key === 'Backspace' && pole.selectionStart === 0 && pole.selectionEnd === 0 && i > 0) {
    ev.preventDefault();
    const poprz = kol[i - 1];
    const dl = poprz.tekst.length;
    zmienZCofaniem(S.e, 'Połączono pozycje', 'lista', () => {
      poprz.tekst += p.tekst;
      S.e.tresc.lista = S.e.tresc.lista.filter((x) => x !== p);
    }, { id: p.id, poz: 0 });
    zmiana();
    rysujListe(poprz.id, dl);
  } else if (ev.key === 'ArrowUp' && ev.altKey) {
    ev.preventDefault();
    przesun(p, -1);
  } else if (ev.key === 'ArrowDown' && ev.altKey) {
    ev.preventDefault();
    przesun(p, 1);
  } else if (ev.key === 'ArrowUp' && i > 0) {
    ev.preventDefault();
    rysujListe(kol[i - 1].id, pole.selectionStart);
  } else if (ev.key === 'ArrowDown' && i < kol.length - 1) {
    ev.preventDefault();
    rysujListe(kol[i + 1].id, pole.selectionStart);
  }
}

function dodajPozycje(po, tekst) {
  const l = S.e.tresc.lista;
  const nowa = { id: noweId(), tekst: tekst || '', zrobione: false };
  if (po) l.splice(l.indexOf(po) + 1, 0, nowa);
  else {
    const ostatniaNie = l.map((x) => !x.zrobione).lastIndexOf(true);
    l.splice(ostatniaNie + 1, 0, nowa);
  }
  zmiana();
  rysujListe(nowa.id, 0);
}

function wklejWiersze(ev, p, pole) {
  const tekst = ev.clipboardData && ev.clipboardData.getData('text/plain');
  if (!tekst || !tekst.includes('\n')) return;
  ev.preventDefault();
  const linie = tekst.split(/\r?\n/).map((x) => x.replace(/^\s*([-*•☐☑]|\[[ x]\])\s*/i, '')).filter((x) => x.trim());
  if (!linie.length) return;
  const przed = pole.value.slice(0, pole.selectionStart);
  const po = pole.value.slice(pole.selectionEnd);
  let ostatnia = p;
  zmienZCofaniem(S.e, 'Wklejono pozycje', 'lista', () => {
    p.tekst = przed + linie[0];
    const l = S.e.tresc.lista;
    let i = l.indexOf(p);
    for (const linia of linie.slice(1)) {
      ostatnia = { id: noweId(), tekst: linia, zrobione: false };
      l.splice(++i, 0, ostatnia);
    }
    ostatnia.tekst += po;
  }, { id: p.id, poz: przed.length });
  zmiana();
  rysujListe(ostatnia.id, ostatnia.tekst.length - po.length);
}

function przesun(p, kierunek) {
  const l = S.e.tresc.lista;
  const i = l.indexOf(p);
  let j = i + kierunek;
  while (j >= 0 && j < l.length && l[j].zrobione !== p.zrobione) j += kierunek;
  if (j < 0 || j >= l.length) return;
  zmienZCofaniem(S.e, 'Przeniesiono pozycję', 'lista', () => {
    [l[i], l[j]] = [l[j], l[i]];
  }, { id: p.id });
  zmiana();
  rysujListe(p.id);
}

function przeniesObok(idPrzenoszonej, idCelu, za) {
  const l = S.e.tresc.lista;
  const p = l.find((x) => x.id === idPrzenoszonej);
  const cel = l.find((x) => x.id === idCelu);
  if (!p || !cel) return;
  zmienZCofaniem(S.e, 'Przeniesiono pozycję', 'lista', () => {
    l.splice(l.indexOf(p), 1);
    l.splice(l.indexOf(cel) + (za ? 1 : 0), 0, p);
    p.zrobione = cel.zrobione;
  }, { id: p.id });
  zmiana();
  rysujListe(p.id);
}

function usunPozycje(p) {
  const kol = widocznaKolejnosc();
  const i = kol.indexOf(p);
  zmienZCofaniem(S.e, 'Usunięto pozycję', 'lista', () => {
    S.e.tresc.lista = S.e.tresc.lista.filter((x) => x !== p);
  }, { id: p.id });
  zmiana();
  const nast = kol[i + 1] || kol[i - 1];
  rysujListe(nast ? nast.id : null);
}

// Kopia tekstu sprzed zamiany na listę (Jacek, 21.10.2026: „zachowaj kopię tej poprzedniej wersji i przywróć tak jak było”).
// Powrót z listy, której pozycje się nie zmieniły (ptaszki się nie liczą), oddaje tekst co do znaku, z formatowaniem
// i tabelami. Kopia stoi w otwartej notatce i w localStorage, więc przeżywa zamknięcie notatki i nowe uruchomienie.
const KOPIA_TEKSTU = 'notatki-tekst-przed-lista:';

function kopiaTekstu(id) {
  try {
    return JSON.parse(localStorage.getItem(KOPIA_TEKSTU + id) || 'null');
  } catch {
    return null;
  }
}

function zapiszKopieTekstu(id, kopia) {
  try {
    if (kopia) localStorage.setItem(KOPIA_TEKSTU + id, JSON.stringify(kopia));
    else localStorage.removeItem(KOPIA_TEKSTU + id);
  } catch {
    // Pełny magazyn (bardzo długa notatka): kopia zostaje tylko w otwartej notatce.
  }
}

function przelaczTyp() {
  wypchnijPole();
  const e = S.e;
  const t = e.tresc;
  zmienZCofaniem(e, t.jest_lista ? 'Zwykły tekst' : 'Lista z polami wyboru', 'typ', () => {
    if (t.jest_lista) {
      const pozycje = t.lista.map((p) => p.tekst);
      const kopia = e.tekstPrzedLista || kopiaTekstu(e.id);
      if (kopia && JSON.stringify(kopia.pozycje) === JSON.stringify(pozycje)) {
        t.tekst = kopia.tekst;
        t.tekst_html = kopia.tekst_html;
      } else {
        // Lista się zmieniła: każda pozycja to osobna linia, puste wypadają.
        t.tekst = [t.tekst, ...pozycje.filter((x) => x.trim())].filter(Boolean).join('\n');
        t.tekst_html = null;
      }
      e.tekstPrzedLista = null;
      zapiszKopieTekstu(e.id, null);
      t.lista = [];
      t.jest_lista = false;
    } else {
      // Pozycja listy to czysty tekst, więc formatowanie czeka w kopii na powrót do tekstu.
      const kopia = { tekst: t.tekst || '', tekst_html: t.tekst_html || null };
      const linie = (t.tekst || '').split('\n').filter((x) => x.trim());
      t.lista = (linie.length ? linie : ['']).map((x) => ({
        id: noweId(),
        tekst: x.replace(/^\s*([-*•☐☑]|\[[ x]\])\s*/i, ''),
        zrobione: /^\s*(☑|\[x\])/i.test(x),
      }));
      kopia.pozycje = t.lista.map((p) => p.tekst);
      e.tekstPrzedLista = kopia;
      zapiszKopieTekstu(e.id, kopia);
      t.tekst_html = null;
      t.tekst = '';
      t.jest_lista = true;
    }
  });
  zmiana();
  rysujEdytor();
  if (t.jest_lista) $('#e-lista input[type="text"]')?.focus();
  else $('#e-tekst').focus();
}

// --- przypomnienie i miejsce notatki ---

/** `p` z okienka przypomnienia: `{ czas }` albo `{ czas, powtarzanie: { co, strefa } }`, null – usuń. */
function ustawPrzypomnienie(p) {
  zmienZCofaniem(S.e, p ? 'Przypomnienie' : 'Usunięto przypomnienie', 'przypomnienie', () => {
    S.e.tresc.przypomnienie = p ? { ...p, zrobione: false } : null;
  });
  rysujTermin();
  rysujPrzyciski();
  zmiana();
  // Termin stoi od razu nad kartką, więc bez komunikatu w rogu – tylko dla czytnika ekranu.
  ogloszenie(p ? tekstPrzypomnienia(p, p.czas) : 'Usunięto przypomnienie');
}

/**
 * „Zrobione” w okienku przypomnienia: sprawa załatwiona w rdzeniu (jednorazowe – wykonane, powtarzane – to wystąpienie),
 * więc przypomnienie przestaje wracać. Najpierw zapis tego, co wpisane, potem działanie z „Cofnij”, jak z listy.
 */
async function zalatwOtwarta() {
  const e = S.e;
  if (!e) return;
  await zapiszWersje(e);
  if (!e.istnieje) return;
  await dzialanie([e.id], { typ: 'zalatwione' }, 'Zrobione');
  odswiezPrzypomnienia();
}

/**
 * Przypięta notatka stoi na górze listy. Przypięcie wyjmuje ją z archiwum. Zapisana notatka idzie przez rdzeń, jak przypięcie
 * z listy, więc działają „Cofnij”, Ctrl+Z i Ctrl+Y. Nowa, jeszcze niezapisana, dostaje przypięcie z pierwszym zapisem.
 */
async function przelaczPrzypiecie() {
  const e = S.e;
  const t = e.tresc;
  if (!e.istnieje) {
    t.przypieta = !t.przypieta;
    if (t.przypieta) t.archiwum = false;
    zmiana();
    rysujPrzyciski();
    ogloszenie(t.przypieta ? 'Przypięto notatkę' : 'Odpięto notatkę');
    return;
  }
  const wartosc = !t.przypieta;
  await zapiszWersje(e);
  await dzialanie([e.id], { typ: 'przypnij', wartosc }, wartosc ? 'Przypięto notatkę' : 'Odpięto notatkę');
}

/**
 * Pasek formatowania (zadanie 7). Na szerokim ekranie z myszą staje nad zaznaczonym fragmentem, a otwarty przez Aa przy
 * kursorze, a nie pod Aa u góry okna. Przesuwa go chwyt w wolnym miejscu paska. Chowa się po Escape, Aa, kliknięciu obok
 * i gdy zaznaczenie zniknie. Na telefonie i w wąskim oknie zostaje nad dolnym paskiem.
 */
const PLYWAJACY = window.matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)');
const plyw = { zrodlo: '', recznie: false, mysz: false, czas: 0 };
function przelaczFormatowanie(otworz = $('#panel-formatu').hidden) {
  if (!otworz) {
    schowajPasekFormatu();
    return;
  }
  if (!PLYWAJACY.matches) {
    $('#panel-formatu').hidden = false;
    $('#e-aa').setAttribute('aria-expanded', 'true');
  } else {
    const z = zakresWTresci();
    plyw.zrodlo = z && !z.collapsed ? 'zaznaczenie' : 'aa';
    if (z) polozPasekFormatu(prostokatZakresu(z));
    else {
      const a = $('#e-aa').getBoundingClientRect();
      polozPasekFormatu({ left: a.left, width: a.width, top: a.bottom, bottom: a.bottom });
    }
  }
  odswiezPasekFormatu();
}
function schowajPasekFormatu() {
  const p = $('#panel-formatu');
  p.hidden = true;
  p.classList.remove('plywajacy', 'ciagniety');
  p.style.left = '';
  p.style.top = '';
  plyw.zrodlo = '';
  plyw.recznie = false;
  $('#e-aa').setAttribute('aria-expanded', 'false');
}
/** Zaznaczenie albo kursor w treści notatki (`null`, gdy stoi gdzie indziej). */
function zakresWTresci() {
  const pole = $('#e-tekst');
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const z = s.getRangeAt(0);
  return pole.contains(z.startContainer) && pole.contains(z.endContainer) ? z : null;
}
function prostokatZakresu(z) {
  const r = z.getBoundingClientRect();
  if (r.width || r.height) return r;
  const rs = z.getClientRects();
  if (rs.length) return rs[0];
  const e = z.startContainer.nodeType === 1 ? z.startContainer : z.startContainer.parentElement;
  return e.getBoundingClientRect();
}
/** Na środku nad prostokątem `r` (zaznaczenie albo kursor), a gdy nad nim brak miejsca, pod nim. */
function polozPasekFormatu(r) {
  const p = $('#panel-formatu');
  p.classList.add('plywajacy');
  p.hidden = false;
  $('#e-aa').setAttribute('aria-expanded', 'true');
  if (plyw.recznie) return;
  const w = p.offsetWidth;
  const h = p.offsetHeight;
  const k = $('#e-tekst').getBoundingClientRect();
  const gora = $('#naglowek').getBoundingClientRect().bottom + 8;
  const lewo = Math.max(8, k.left - 16);
  const prawo = Math.min(window.innerWidth - 8, k.right + 16);
  const x = Math.max(lewo, Math.min(r.left + r.width / 2 - w / 2, prawo - w));
  let y = r.top - h - 10;
  if (y < gora) y = r.bottom + 10;
  y = Math.max(gora, Math.min(y, window.innerHeight - h - 8));
  p.style.left = `${Math.round(x)}px`;
  p.style.top = `${Math.round(y)}px`;
}
function sprawdzZaznaczenieFormatu() {
  if (!PLYWAJACY.matches || plyw.mysz) return;
  const p = $('#panel-formatu');
  const plywa = !p.hidden && p.classList.contains('plywajacy');
  if (!S.e || S.e.tresc.jest_lista || $('#e-aa').hidden) {
    if (plywa) schowajPasekFormatu();
    return;
  }
  const z = zakresWTresci();
  if (z && !z.collapsed) {
    // Otwarte menu (prawy klik, kolory): pasek nie wyskakuje spod niego.
    if (!plywa && popoverOtwarty()) return;
    if (!plyw.zrodlo) plyw.zrodlo = 'zaznaczenie';
    polozPasekFormatu(prostokatZakresu(z));
    odswiezPasekFormatu();
  } else if (plywa && plyw.zrodlo === 'zaznaczenie' && !popoverOtwarty()) schowajPasekFormatu();
}
function podepnijPlywajacy() {
  const p = $('#panel-formatu');
  const pole = $('#e-tekst');
  document.addEventListener('selectionchange', () => {
    clearTimeout(plyw.czas);
    plyw.czas = setTimeout(sprawdzZaznaczenieFormatu, 120);
  });
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const t = ev.target instanceof Element ? ev.target : null;
      if (ev.button === 0 && t && pole.contains(t)) plyw.mysz = true;
      if (p.hidden || !p.classList.contains('plywajacy') || !t) return;
      if (p.contains(t) || $('#e-aa').contains(t) || t.closest('.popover') || pole.contains(t)) return;
      schowajPasekFormatu();
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    () => {
      if (!plyw.mysz) return;
      plyw.mysz = false;
      setTimeout(sprawdzZaznaczenieFormatu, 0);
    },
    true,
  );
  // Przewijanie notatki: pasek idzie za zaznaczeniem, póki nikt go nie przesunął.
  document.addEventListener(
    'scroll',
    () => {
      if (p.hidden || !p.classList.contains('plywajacy') || plyw.recznie) return;
      const z = zakresWTresci();
      if (z) polozPasekFormatu(prostokatZakresu(z));
    },
    { capture: true, passive: true },
  );
  PLYWAJACY.addEventListener('change', () => {
    if (!p.hidden) schowajPasekFormatu();
  });
  // Chwyt w wolnym miejscu paska (przy brzegu i między przyciskami) go przesuwa, a zaznaczenie w treści zostaje.
  p.addEventListener('mousedown', (ev) => {
    if (p.classList.contains('plywajacy') && !ev.target.closest('button')) ev.preventDefault();
  });
  p.addEventListener('pointerdown', (ev) => {
    if (!p.classList.contains('plywajacy') || ev.button !== 0 || ev.target.closest('button')) return;
    const r = p.getBoundingClientRect();
    const dx = ev.clientX - r.left;
    const dy = ev.clientY - r.top;
    p.setPointerCapture(ev.pointerId);
    p.classList.add('ciagniety');
    const ruch = (e) => {
      plyw.recznie = true;
      p.style.left = `${Math.round(Math.max(8, Math.min(e.clientX - dx, window.innerWidth - r.width - 8)))}px`;
      p.style.top = `${Math.round(Math.max(8, Math.min(e.clientY - dy, window.innerHeight - r.height - 8)))}px`;
    };
    const koniec = () => {
      p.classList.remove('ciagniety');
      p.removeEventListener('pointermove', ruch);
      p.removeEventListener('pointerup', koniec);
      p.removeEventListener('pointercancel', koniec);
    };
    p.addEventListener('pointermove', ruch);
    p.addEventListener('pointerup', koniec);
    p.addEventListener('pointercancel', koniec);
  });
}
/**
 * „Wklej” z menu prawego kliku: schowek przez przeglądarkę, potem ta sama droga co Ctrl+V (zdarzenie `paste`), więc
 * formatowanie, tabele i obrazy wklejają się tak samo. Gdy program nie dostanie schowka, mówi, żeby wkleić Ctrl+V.
 */
async function wklejZSchowka(pole) {
  try {
    const dane = new DataTransfer();
    if (navigator.clipboard && navigator.clipboard.read) {
      for (const rzecz of await navigator.clipboard.read()) {
        for (const typ of rzecz.types) {
          const b = await rzecz.getType(typ);
          if (typ === 'text/plain' || typ === 'text/html') dane.setData(typ, await b.text());
          else if (typ.startsWith('image/')) dane.items.add(new File([b], `schowek.${typ.slice(6)}`, { type: typ }));
        }
      }
    } else dane.setData('text/plain', await navigator.clipboard.readText());
    pole.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dane, bubbles: true, cancelable: true }));
  } catch {
    toast('Wklej skrótem Ctrl+V');
  }
}

/** Historia wersji otwartej notatki (menu Więcej i Ctrl+H). */
export async function historiaNotatki() {
  if (!S.e) return;
  if (!S.e.istnieje) {
    toast('Historia pojawi się po pierwszym zapisie');
    return;
  }
  await zapiszWersje();
  otworzHistorie(S.e.id);
}

/** Paleta koloru otwartej notatki: pod kołem koloru nad notatką i w menu Więcej, gdy koła nie widać. */
function pozycjaKoloru(e) {
  const t = e.tresc;
  return {
    tekst: 'Kolor notatki',
    paleta: {
      kolory: KOLORY_NOTATEK,
      wartosc: t.kolor || 'DEFAULT',
      akcja: (k) => {
        // Jak z prawego kliku na liście: działanie rdzenia, więc działają „Cofnij”, Ctrl+Z i Ctrl+Y. Nowej, jeszcze
        // niezapisanej notatki nie ma w rdzeniu: tam kolor wchodzi z pierwszym zapisem.
        if (!e.istnieje) {
          t.kolor = k;
          zmiana();
          zapiszWersje();
          return;
        }
        zapiszWersje(e).then(() => zmienKolor([e.id], k));
      },
    },
  };
}

/** Koło koloru nad notatką (Jacek, 27.10.2026: „zrób to, co sugerujesz”): sama paleta, jak kolor w Google Keep. */
function menuKoloru(kotwica) {
  const e = S.e;
  if (!e || e.tresc.kosz) return;
  menu([pozycjaKoloru(e)], kotwica, 'Kolor notatki');
}

/**
 * Menu Więcej: rzadkie działania opisane słowami, żeby nad kartką zostały tylko codzienne. Archiwum jest tu, a nie na pasku,
 * tak robią Notatki Apple. Pinezka i kolor mają swoje koła na pasku i trafiają tu tylko wtedy, gdy kół nie widać.
 */
export function menuWiecej(kotwica = $('#e-menu')) {
  const e = S.e;
  if (!e) return;
  const t = e.tresc;
  const wKoszu = Boolean(t.kosz);
  // Przyciski paska, które w wąskiej kolumnie nie zmieściły się nad notatką (app.js, dopasujPasek), stoją na górze menu,
  // w kolejności z paska, i robią to samo co przycisk.
  // Pinezka i kolor mają swoje koła na pasku. W menu stoją tylko wtedy, gdy kół nie widać (wąska kolumna notatki).
  const naPasku = (id) => {
    const b = document.getElementById(id);
    return Boolean(b && !b.hidden && b.getClientRects().length);
  };
  const kolorWMenu = !naPasku('e-kolor');
  const pinezkaWMenu = !naPasku('e-przypnij');
  const zPaska = [...document.querySelectorAll('#naglowek .w-menu')]
    .filter((b) => b.matches('button') && !b.hidden && b.id !== 'e-kolor' && b.id !== 'e-przypnij')
    .map((b) => ({
      tekst: b.getAttribute('aria-label'),
      ikona: (b.querySelector('use')?.getAttribute('href') || '').replace('#i-', '') || null,
      skrot: b.id === 'sam-tekst' ? 'F11' : null,
      akcja: () => b.click(),
    }));
  menu(
    [
      ...zPaska,
      zPaska.length ? '-' : null,
      // Kolor kafelka na liście, jak z prawego kliku (HIG: pozycja menu kontekstowego jest też w głównym interfejsie).
      !wKoszu && kolorWMenu && pozycjaKoloru(e),
      !wKoszu && kolorWMenu && '-',
      !wKoszu && pinezkaWMenu && { tekst: t.przypieta ? 'Odepnij' : 'Przypnij', ikona: 'pinezka', akcja: () => przelaczPrzypiecie() },
      // Karteczka na pulpicie (Windows): zaległy tekst najpierw, żeby karteczka miała ostatnie słowa.
      ...(e.istnieje ? pozycjePulpitu(e.id, t).map((p) => ({ ...p, akcja: () => zapiszWersje(e).then(p.akcja) })) : []),
      !wKoszu &&
        (t.archiwum
          ? { tekst: 'Przywróć z archiwum', ikona: 'z-archiwum', akcja: () => przeniesNotatke({ typ: 'archiwizuj', wartosc: false }, 'Przywrócono z archiwum') }
          : { tekst: 'Archiwizuj', ikona: 'archiwum', akcja: () => przeniesNotatke({ typ: 'archiwizuj', wartosc: true }, 'Zarchiwizowano notatkę') }),
      !wKoszu && '-',
      { tekst: 'Historia wersji', ikona: 'historia', skrot: 'Ctrl+H', akcja: () => historiaNotatki() },
      { tekst: 'Kopiuj tekst', ikona: 'kopiuj', akcja: () => kopiujNotatke({ tresc: t }) },
      !wKoszu && { tekst: 'Duplikuj', ikona: 'plus', akcja: () => duplikuj() },
      t.jest_lista && !wKoszu ? '-' : null,
      t.jest_lista && !wKoszu ? { tekst: 'Odznacz wszystkie pozycje', ikona: 'pola', akcja: () => odznaczWszystkie() } : null,
      t.jest_lista && !wKoszu ? { tekst: 'Usuń zrobione pozycje', ikona: 'kosz', akcja: () => usunZrobione() } : null,
      '-',
      wKoszu
        ? { tekst: 'Przywróć z kosza', ikona: 'z-kosza', akcja: () => przeniesNotatke({ typ: 'do_kosza', wartosc: false }, 'Przywrócono z kosza') }
        : { tekst: 'Przenieś do kosza', ikona: 'kosz', akcja: () => przeniesNotatke({ typ: 'do_kosza', wartosc: true }, 'Przeniesiono do kosza') },
    ].filter(Boolean),
    kotwica,
    'Więcej działań',
  );
}

async function przeniesNotatke(akcja, opis) {
  const e = S.e;
  await zapiszWersje(e);
  if (!e.istnieje) {
    // Pusta nowa notatka: nie ma czego przenosić.
    await zamknijEdytor();
    return;
  }
  await zamknijEdytor({ bezOdswiezania: true });
  await dzialanie([e.id], akcja, opis);
}

// --- pliki ---

export async function dodajPliki(pliki, e = S.e) {
  for (const plik of pliki) {
    if (plik.size > MAKS_PLIK) {
      toast(`Plik ${plik.name} jest większy niż 100 MB`);
      continue;
    }
    await dodajZalacznik(e, plik, plik.name);
  }
}

async function dodajZalacznik(e, plik, nazwa) {
  if (!e) return;
  // Obraz od razu stoi tam, gdzie stanie (zadanie 17, Jacek: „Zdjęcie, jak się wkładają, to nie wiem, co to jest”): kafelek
  // „Dodaję obraz…” za ostatnim obrazem, przewinięty do widoku, a gotowy obraz cały, bez przycinania, z chwilowym pierścieniem.
  const czeka = (plik.type || '').startsWith('image/') && S.e === e ? kafelekDodawania() : null;
  try {
    const bajty = new Uint8Array(await plik.arrayBuffer());
    const z = await wyslijPlik(bajty, plik.type || 'application/octet-stream', nazwa || '');
    zmienZCofaniem(e, (z.typ || '').startsWith('audio/') ? 'Dodano nagranie' : 'Dodano obraz', 'zalaczniki', () => {
      if (!e.tresc.zalaczniki.some((x) => x.hash === z.hash)) e.tresc.zalaczniki.push(z);
    });
    if (S.e === e) {
      rysujObrazy();
      rysujNagrania();
      if ((z.typ || '').startsWith('image/')) pokazNowyObraz(z.hash);
    }
    zmiana(e, false);
    await zapiszWersje(e);
  } catch (err) {
    bladToast(err);
  } finally {
    if (czeka) czeka.remove();
  }
}

/** Kafelek „Dodaję obraz…” na miejscu nowego obrazu, przewinięty do widoku: od pierwszej chwili widać, gdzie obraz stanie. */
function kafelekDodawania() {
  const k = el('div.e-obraz.dodawany', { role: 'status' }, el('span.spinner', { 'aria-hidden': 'true' }), el('span.caption', { tekst: 'Dodaję obraz…' }));
  $('#e-obrazy').append(k);
  k.scrollIntoView({ block: 'nearest' });
  return k;
}

/** Nowy obraz w widoku, na chwilę z pierścieniem w akcencie (styl.css, „Obrazy w notatce”); czytnik ekranu słyszy „Dodano obraz”. */
function pokazNowyObraz(hash) {
  const k = $(`#e-obrazy .e-obraz[data-hash="${CSS.escape(hash)}"]`);
  if (!k) return;
  const img = k.querySelector('img');
  img.loading = 'eager';
  k.classList.add('nowy');
  k.addEventListener('animationend', () => k.classList.remove('nowy'), { once: true });
  // Wysokość obrazu znamy dopiero po wczytaniu, więc przewinięcie idzie po nim.
  const doWidoku = () => {
    if (k.isConnected) k.scrollIntoView({ block: 'nearest' });
  };
  (img.decode ? img.decode() : Promise.resolve()).then(doWidoku, doWidoku);
  ogloszenie('Dodano obraz');
}

/** Usuwa obraz albo nagranie. Ctrl+Z, Ctrl+Y i „Cofnij” w komunikacie działają, póki notatka jest otwarta. */
function usunZalacznik(hash) {
  const e = S.e;
  const z = e.tresc.zalaczniki.find((x) => x.hash === hash);
  if (!z) return;
  const pokaz = () => {
    rysujObrazy();
    rysujNagrania();
    zmiana(e, false);
    zapiszWersje(e);
  };
  const usun = () => {
    e.tresc.zalaczniki = e.tresc.zalaczniki.filter((x) => x.hash !== hash);
  };
  usun();
  pokaz();
  const wpis = zapamietajDzialanie({
    opis: z.typ.startsWith('audio/') ? 'Usunięto nagranie' : 'Usunięto obraz',
    wlasciciel: e,
    cofnij: () => {
      if (S.e !== e) return;
      if (!e.tresc.zalaczniki.some((x) => x.hash === hash)) e.tresc.zalaczniki.push(z);
      pokaz();
    },
    ponow: () => {
      if (S.e !== e) return;
      usun();
      pokaz();
    },
  });
  toast(wpis.opis, { przycisk: 'Cofnij', akcja: () => cofnijWpis(wpis) });
}

let podepnietyPodglad = false;

/** Wyjście z podglądu: przycisk w narożniku, Esc i kliknięcie obok obrazu. */
function podepnijPodglad(d) {
  if (podepnietyPodglad) return;
  podepnietyPodglad = true;
  d.addEventListener('click', (ev) => {
    // Kliknięcie w tekst z obrazu zostawiamy – z niego się kopiuje.
    if (ev.target.closest('#d-obraz-ocr')) return;
    d.close();
  });
}

async function pokazObraz(z) {
  const d = $('#d-obraz');
  podepnijPodglad(d);
  $('#d-obraz-img').src = urlPliku(z.hash);
  $('#d-obraz-img').alt = z.nazwa || 'Obraz';
  const ocr = $('#d-obraz-ocr');
  ocr.textContent = '';
  d.showModal();
  $('#d-obraz-zamknij').focus();
  try {
    const r = await wywolaj('plik', { hash: z.hash });
    const tekst = r && r.plik && r.plik.ocr;
    ocr.textContent = tekst ? `Tekst z obrazu: ${tekst}` : '';
  } catch {
    /* podgląd działa bez tekstu */
  }
}

// --- notatki głosowe ---

let nagrywanie = null;

async function nagrajGlos() {
  if (nagrywanie) {
    zatrzymajNagrywanie();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Nagrywanie nie jest dostępne na tym urządzeniu');
    return;
  }
  try {
    const strumien = await navigator.mediaDevices.getUserMedia({ audio: true });
    const typ = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const rec = new MediaRecorder(strumien, typ ? { mimeType: typ } : undefined);
    const kawalki = [];
    const e = S.e;
    const start = Date.now();
    const chip = $('#e-nagrywanie');
    const tik = setInterval(() => {
      const s = Math.round((Date.now() - start) / 1000);
      chip.textContent = `Nagrywanie ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} – mikrofon kończy`;
    }, 250);
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) kawalki.push(ev.data);
    };
    rec.onstop = async () => {
      clearInterval(tik);
      chip.hidden = true;
      strumien.getTracks().forEach((t) => t.stop());
      $('#e-glos').classList.remove('wlaczony');
      $('#e-glos').setAttribute('aria-label', 'Nagraj notatkę głosową');
      ustawDymek($('#e-glos'), 'Nagraj notatkę głosową');
      nagrywanie = null;
      const blob = new Blob(kawalki, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      if (blob.size < 2000) {
        toast('Nagranie jest puste');
        return;
      }
      const nazwa = `Nagranie ${new Date().toLocaleString('pl-PL').replace(/[/:]/g, '-')}.webm`;
      await dodajZalacznik(e, blob, nazwa);
      ogloszenie('Dodano notatkę głosową');
    };
    nagrywanie = { rec };
    rec.start(1000);
    chip.hidden = false;
    chip.textContent = 'Nagrywanie 0:00 – mikrofon kończy';
    $('#e-glos').classList.add('wlaczony');
    $('#e-glos').setAttribute('aria-label', 'Zatrzymaj nagrywanie');
    ustawDymek($('#e-glos'), 'Zatrzymaj nagrywanie');
  } catch (err) {
    toast(err && err.name === 'NotAllowedError' ? 'Brak dostępu do mikrofonu – zezwól w ustawieniach systemu' : 'Nie udało się rozpocząć nagrywania');
  }
}

function zatrzymajNagrywanie() {
  if (nagrywanie && nagrywanie.rec.state !== 'inactive') nagrywanie.rec.stop();
}

// --- podpięcie zdarzeń ---

export function podepnijEdytor() {
  const tytul = $('#e-tytul');
  const tekst = $('#e-tekst');
  // Enter w tytule przechodzi do treści albo do pierwszej pozycji listy, jak w Notatkach Apple.
  const doTresci = () => {
    if (!S.e) return;
    if (S.e.tresc.jest_lista) {
      const pierwsze = $('#e-lista input[type="text"]');
      if (pierwsze) pierwsze.focus();
      else zmienZCofaniem(S.e, 'Nowa pozycja', 'lista', () => dodajPozycje(null, ''));
    } else {
      tekst.focus();
      ustawZaznaczenie(tekst, 0, 0);
    }
  };
  tytul.addEventListener('input', () => {
    // Tytuł to jeden akapit: nowa linia z wklejonego tekstu staje się spacją, a kursor zostaje w miejscu.
    if (tytul.value.includes('\n')) {
      const [a, b] = [tytul.selectionStart, tytul.selectionEnd];
      tytul.value = tytul.value.replace(/\n/g, ' ');
      tytul.setSelectionRange(a, b);
    }
    dopasujTytul(tytul);
    if (!S.e) return;
    if ((S.e.tresc.tytul || '') !== tytul.value) pisanie(S.e, 'tytul', 'tytul');
    S.e.tresc.tytul = tytul.value;
    zmiana();
  });
  // Klawiatura telefonu potrafi wysłać nową linię bez zdarzenia Enter.
  tytul.addEventListener('beforeinput', (ev) => {
    kursorPrzed = { pole: 'tytul', k: [tytul.selectionStart, tytul.selectionEnd] };
    if (ev.inputType !== 'insertLineBreak' && ev.inputType !== 'insertParagraph') return;
    ev.preventDefault();
    doTresci();
  });
  tytul.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || (ev.key === 'ArrowDown' && tytul.selectionStart === tytul.value.length)) {
      ev.preventDefault();
      doTresci();
    }
  });
  tekst.addEventListener('input', () => {
    if (!S.e) return;
    if ((S.e.tresc.tekst || '').length > DLUGA_NOTATKA) {
      // Zmiana już jest, choć jeszcze nie w stanie: zmiana z innego urządzenia nie może teraz przerysować pola.
      S.e.zmieniona = true;
      clearTimeout(timerPola);
      timerPola = setTimeout(() => {
        if (!S.e) return;
        zapiszZPola(tekst);
        zmiana();
      }, 250);
      return;
    }
    zapiszZPola(tekst);
    zmiana();
    clearTimeout(timerLinkow);
    timerLinkow = setTimeout(rysujLinki, 400);
  });
  // Skróty formatowania działają tam, gdzie się pisze – w treści notatki. Ctrl+Z i Ctrl+Y obsługuje karta (podepnijCofanie).
  tekst.addEventListener('keydown', (ev) => {
    if (!S.e) return;
    // W tabeli: Tab, Enter i brzegi komórek (js/tekstowe.js, klawiszWTabeli).
    const wTabeli = klawiszWTabeli(tekst, ev);
    if (wTabeli) {
      if (wTabeli === 'zmiana') {
        zapiszZPola(tekst, { osobno: true });
        zmiana();
      }
      return;
    }

    const co = skrotFormatu(tekst, ev);
    if (!co) return;
    ev.preventDefault();
    const zmienione = osobnyKrok(tekst, () => (co === 'wieksze' ? zmienRozmiar(tekst, 1) : co === 'mniejsze' ? zmienRozmiar(tekst, -1) : formatuj(tekst, co)));
    if (!zmienione) return;
    zmiana();
    odswiezPasekFormatu();
  });
  // Wklejanie: zachowujemy pogrubienia i kolory, ale tylko znane znaczniki (bez skryptów,
  // obrazków z internetu i odnośników), a Ctrl+Shift+V wkleja czysty tekst.
  tekst.addEventListener('paste', (ev) => {
    if (!S.e || tekst.contentEditable === 'false') return;
    const dane = ev.clipboardData;
    if (!dane) return;
    const pliki = [...(dane.files || [])].filter((f) => f.type.startsWith('image/'));
    if (pliki.length) return; // obrazy obsługuje wspólny kod wklejania w app.js
    const html = dane.getData('text/html');
    const czysty = html ? czysc(html, { wklejka: true }) : '';
    ev.preventDefault();
    // W komórce tabeli tylko tekst (tabela w tabeli by się rozjechała), a zwykły tekst jako <br>, bez <div>.
    const wKomorce = Boolean(komorkaKursora(tekst));
    const zwykly = (wKomorce && czysty ? tekstZHtml(czysty).replace(/\t/g, ' ') : dane.getData('text/plain')).replace(/\r\n?/g, '\n');
    const wklej = czysty && !wKomorce ? czysty : htmlZTekstu(zwykly);
    // Wklejenie to osobny krok cofania, także w środku pisania.
    osobnyKrok(tekst, () => {
      if (wklej && !(wklej.length > 100_000 && wklejDuzo(tekst, wklej))) document.execCommand('insertHTML', false, wklej);
      naprawTabele(tekst);
    });
    zmiana();
  });
  // Klawiatura telefonu potrafi wysłać nową linię bez zdarzenia Enter: w tabeli działa jak Enter
  // (komórka niżej), poza nią zostaje zwykła nowa linia przeglądarki.
  tekst.addEventListener('beforeinput', (ev) => {
    if (ev.inputType !== 'insertParagraph' || !S.e || !komorkaKursora(tekst)) return;
    ev.preventDefault();
    if (enterWTabeli(tekst)) {
      zapiszZPola(tekst, { osobno: true });
      zmiana();
    }
  });
  for (const zdarzenie of ['keyup', 'mouseup', 'focus']) {
    tekst.addEventListener(zdarzenie, odswiezPasekFormatu);
  }
  podepnijPasekFormatu();
  podepnijPlywajacy();
  podepnijCofanie();
  podepnijTrafienie();
  podepnijMiejsce();
  $('#e-konflikt-gotowe').addEventListener('click', () => {
    S.e.tresc.konflikt = false;
    $('#e-konflikt').hidden = true;
    zmiana();
  });
  // Dzwonek na pasku i termin nad kartką otwierają to samo okienko, każde przy sobie.
  const okienkoPrzypomnienia = (ev) => {
    const p = S.e.tresc.przypomnienie;
    menuPrzypomnienia(ev.currentTarget, p, ustawPrzypomnienie, kiedyPrzypomnienie(S.e.id, p), { zalatw: zalatwOtwarta, zaGodzine: Boolean(p && !p.powtarzanie && p.czas <= Date.now()) });
  };
  $('#e-przypnij').addEventListener('click', () => przelaczPrzypiecie());
  $('#e-kolor').addEventListener('click', (ev) => menuKoloru(ev.currentTarget));
  $('#e-przypomnienie').addEventListener('click', okienkoPrzypomnienia);
  $('#e-termin').addEventListener('click', okienkoPrzypomnienia);
  // Aa nie zabiera fokusu z treści – zaznaczony fragment zostaje zaznaczony.
  $('#e-aa').addEventListener('mousedown', (ev) => ev.preventDefault());
  $('#e-aa').addEventListener('click', () => przelaczFormatowanie());
  $('#e-typ').addEventListener('click', przelaczTyp);
  $('#e-obraz').addEventListener('click', () => $('#plik-obrazu').click());
  $('#plik-obrazu').addEventListener('change', async (ev) => {
    const pliki = [...ev.target.files];
    ev.target.value = '';
    if (S.e) await dodajPliki(pliki);
  });
  $('#e-glos').addEventListener('click', nagrajGlos);
  $('#e-menu').addEventListener('click', (ev) => menuWiecej(ev.currentTarget));
  podepnijKursorNaWidoku();
  // Upuszczone pliki w edytorze trafiają do notatki.
  $('#widok-edytor').addEventListener('dragover', (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  $('#widok-edytor').addEventListener('drop', (ev) => {
    if (!ev.dataTransfer || !ev.dataTransfer.files.length || !S.e) return;
    ev.preventDefault();
    dodajPliki([...ev.dataTransfer.files]);
  });
}

// --- kursor na widoku (zasada 27 z dobry-interfejs; Jacek, 27.10.2026: dyktowany tekst drukował się „gdzieś poniżej
// telefonu, poza ekranem”) ---
//
// Przy pisaniu i dyktowaniu przeglądarka sama przewija do kursora, ale nie wtedy, gdy okno maleje: klawiatura na telefonie,
// mniejsze okno albo pasek na dole. Wtedy kursor wraca na widok, 24 px nad dolną krawędzią, czyli nad kciukiem. Tylko gdy
// kursor było widać przed zmianą: kto przewinął wyżej, żeby coś przeczytać, zostaje tam, gdzie był.

/**
 * Prostokąt kursora w polu do pisania z formatowaniem. Chromium daje go z `getBoundingClientRect()` zwiniętego zakresu,
 * a `getClientRects()` zwraca dla niego pustą listę. Pusta linia nie ma prostokąta: wtedy rzecz tuż przed kursorem.
 */
function prostokatKursora() {
  const s = getSelection();
  if (!s || !s.rangeCount) return null;
  const z = s.getRangeAt(0).cloneRange();
  z.collapse(false);
  const r = z.getBoundingClientRect();
  if (r.height) return r;
  const c = z.endContainer;
  const obok = c.nodeType === 1 ? c.childNodes[z.endOffset - 1] || c.childNodes[z.endOffset] : c;
  if (!obok) return null;
  const w = document.createRange();
  w.selectNode(obok);
  const b = w.getBoundingClientRect();
  return b.height ? b : null;
}

/** Kursor w notatce i jego prostokąt z widocznym pasem pola (bez pasa 24 px u góry i u dołu), albo `null`. */
function kursorWPolu() {
  const pole = document.activeElement;
  const karta = $('#e-karta');
  if (!pole || !karta || !karta.contains(pole) || !S.e) return null;
  const r = pole.isContentEditable ? prostokatKursora() : pole.getBoundingClientRect();
  if (!r) return null;
  const t = $('#tresc').getBoundingClientRect();
  const v = window.visualViewport;
  return { r, gora: t.top + 24, dol: Math.min(t.bottom, v ? v.offsetTop + v.height : innerHeight) - 24 };
}

let kursorBylWidac = false;
function podepnijKursorNaWidoku() {
  const tresc = $('#tresc');
  let klatka = 0;
  const zapamietaj = () => {
    cancelAnimationFrame(klatka);
    klatka = requestAnimationFrame(() => {
      const m = kursorWPolu();
      kursorBylWidac = Boolean(m && m.r.top >= m.gora - 24 && m.r.bottom <= m.dol + 24);
    });
  };
  document.addEventListener('selectionchange', zapamietaj);
  tresc.addEventListener('scroll', zapamietaj, { passive: true });
  const naWidok = () =>
    requestAnimationFrame(() => {
      const m = kursorWPolu();
      if (!m || !kursorBylWidac) return;
      if (m.r.bottom > m.dol) tresc.scrollTop += m.r.bottom - m.dol;
      else if (m.r.top < m.gora) tresc.scrollTop -= m.gora - m.r.top;
    });
  window.addEventListener('resize', naWidok);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', naWidok);
}

async function duplikuj() {
  wypchnijPole();
  const t = structuredClone(S.e.tresc);
  await zamknijEdytor({ bezOdswiezania: true, bezFokusu: true });
  t.tytul = t.tytul ? `${t.tytul} (kopia)` : '';
  t.lista = (t.lista || []).map((p) => ({ ...p, id: noweId() }));
  t.przypieta = false;
  // Kopia karteczki to zwykła notatka: drugie okienko na pulpicie byłoby niespodzianką.
  t.karteczka = false;
  t.utworzona = 0;
  t.edytowana = 0;
  delete t.pozycja;
  try {
    const r = await wywolaj('zapisz', { tresc: t });
    zastosujZmiany({ zmienione: r.notatka ? [r.notatka] : [], tagi: r.tagi });
    if (r.notatka) await otworzEdytor(r.notatka.id);
    ogloszenie('Otwarto kopię notatki');
  } catch (e) {
    bladToast(e);
  }
}

/** Usuwa odhaczone pozycje listy. Cofnięcie wstawia je z powrotem na ich miejsca, a to, co dopisano w międzyczasie, zostaje. */
function usunZrobione() {
  const e = S.e;
  const usuniete = e.tresc.lista.map((p, i) => [i, p]).filter(([, p]) => p.zrobione);
  if (!usuniete.length) return;
  const ids = new Set(usuniete.map(([, p]) => p.id));
  const pokaz = () => {
    zmiana(e);
    rysujListe();
  };
  const usun = () => {
    e.tresc.lista = e.tresc.lista.filter((p) => !ids.has(p.id));
  };
  usun();
  pokaz();
  const wpis = zapamietajDzialanie({
    opis: `Usunięto ${liczba(usuniete.length, 'pozycję', 'pozycje', 'pozycji')}`,
    wlasciciel: e,
    cofnij: () => {
      if (S.e !== e) return;
      const l = e.tresc.lista.slice();
      for (const [i, p] of usuniete) if (!l.some((x) => x.id === p.id)) l.splice(Math.min(i, l.length), 0, p);
      e.tresc.lista = l;
      pokaz();
    },
    ponow: () => {
      if (S.e !== e) return;
      usun();
      pokaz();
    },
  });
  toast(wpis.opis, { przycisk: 'Cofnij', akcja: () => cofnijWpis(wpis) });
}

/** Zdejmuje ptaszki ze wszystkich pozycji. Ctrl+Z i „Cofnij” stawiają je z powrotem, póki notatka jest otwarta. */
function odznaczWszystkie() {
  const e = S.e;
  const zrobione = new Set(e.tresc.lista.filter((p) => p.zrobione).map((p) => p.id));
  if (!zrobione.size) return;
  const ustaw = (wartosc) => {
    if (S.e !== e) return;
    for (const p of e.tresc.lista) if (zrobione.has(p.id)) p.zrobione = wartosc;
    zmiana(e);
    rysujListe();
  };
  ustaw(false);
  const wpis = zapamietajDzialanie({ opis: 'Odznaczono pozycje', wlasciciel: e, cofnij: () => ustaw(true), ponow: () => ustaw(false) });
  toast(wpis.opis, { przycisk: 'Cofnij', akcja: () => cofnijWpis(wpis) });
}
