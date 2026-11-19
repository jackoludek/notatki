// Wspólny stan interfejsu. Jedno źródło prawdy po stronie widoku;
// trwałe dane żyją w rdzeniu (Rust), tu jest tylko ich kopia do rysowania.

export const S = {
  notatki: new Map(), // id → { id, glowa, tresc }
  tagi: [], // [[nazwa, liczba]]
  ustawienia: {},
  statystyka: {},
  kolory: [],
  modele: [],
  podpowiedziAi: [],
  urzadzenie: '',
  wersja: '',
  platforma: {},
  sync: { stan: 'wylaczona' },

  widok: 'notatki', // notatki | przypomnienia | archiwum | kosz
  tag: null,
  zapytanie: '',
  terminy: [],
  rozmyty: true,

  ekran: 'lista', // lista (nic nie jest otwarte) | edytor (notatka obok listy) | ai
  wynik: null,
  wynikPelny: true, // czy rdzeń oddał całą listę, czy tylko pierwszą porcję
  narysowano: 0, // wierszy na liście
  grupy: [], // sekcje listy: { wpisy, ids, gotowe }
  zaznaczone: new Set(),

  // Przypomnienia: najbliższe wystąpienie każdego (id → ms) – liczy je rdzeń, interfejs tylko pokazuje.
  nastepne: new Map(),
  strefa: '', // strefa urządzenia znana rdzeniowi; pusta – powtarzania nie da się ustawić

  e: null, // stan edytora
  h: null, // stan okna historii
  // Cofanie i ponawianie (reguła Jacka z 16.10.2026): paczki rdzenia { paczka, opis } albo działania okna
  // { opis, cofnij, ponow, wlasciciel } (przestawiony przycisk, usunięty obraz). Nowe działanie kasuje listę do ponowienia.
  cofnij: [], // do cofnięcia (Ctrl+Z), najnowsze na końcu
  ponow: [], // do ponowienia (Ctrl+Y, Ctrl+Shift+Z), najnowsze na końcu
  ai: { plan: null, polecenie: '', token: 0 },
};

/**
 * Treść notatki z wszystkimi polami. Rdzeń nie wysyła pól, które są puste (oszczędza miejsce
 * w bazie i w pliku synchronizacji), więc bez tego `tresc.lista` czy `tresc.tagi` bywa
 * nieobecne – a interfejs wołał na nich `.filter` i się wywracał. Druga rzecz: porównanie
 * treści „naszej” z „tą z rdzenia” wypadało różnie tylko z powodu brakujących pustych pól,
 * co edytor brał za scalenie z innego urządzenia i przerysowywał się w trakcie pisania.
 */
export const TRESC_PUSTA = {
  tytul: '',
  tekst: '',
  jest_lista: false,
  lista: [],
  tagi: [],
  kolor: 'DEFAULT',
  przypieta: false,
  archiwum: false,
  karteczka: false,
  kosz: null,
  zalaczniki: [],
  linki: [],
  przypomnienie: null,
  utworzona: 0,
  edytowana: 0,
  konflikt: false,
};

/** Dopełnia treść brakującymi polami (nie zmienia przekazanego obiektu). */
export function pelnaTresc(t) {
  const w = { ...TRESC_PUSTA, ...(t || {}) };
  for (const k of ['lista', 'tagi', 'zalaczniki', 'linki']) if (!Array.isArray(w[k])) w[k] = [];
  for (const k of ['tytul', 'tekst']) if (typeof w[k] !== 'string') w[k] = '';
  if (!w.kolor) w.kolor = 'DEFAULT';
  return w;
}

/**
 * Dopełnia treści w dowolnej odpowiedzi rdzenia (notatka, lista notatek, wersje historii,
 * propozycje AI). Jedno miejsce dla wszystkich platform – Windows, przeglądarka i telefon
 * dostają ten sam JSON.
 */
export function pelneTresci(v) {
  if (Array.isArray(v)) {
    for (const x of v) pelneTresci(x);
    return v;
  }
  if (!v || typeof v !== 'object') return v;
  for (const [k, x] of Object.entries(v)) {
    if (k === 'tresc' && x && typeof x === 'object' && !Array.isArray(x)) v[k] = pelnaTresc(x);
    else if (x && typeof x === 'object') pelneTresci(x);
  }
  return v;
}


export const NAZWY_WIDOKOW = {
  notatki: 'Notatki',
  przypomnienia: 'Przypomnienia',
  archiwum: 'Archiwum',
  kosz: 'Kosz',
  oproznione: 'Odzyskaj usunięte',
};

/** Wkłada zmienione notatki do kopii w interfejsie. */
export function aktualizujNotatki(lista) {
  for (const n of lista || []) S.notatki.set(n.id, n);
}

/**
 * Zapamiętuje paczkę rdzenia do cofnięcia skrótem Ctrl+Z. Nowe działanie kasuje to, co było do ponowienia. `ids` to notatki
 * działania: działanie na jednej, otwartej notatce cofa też Ctrl+Z w jej polu (edytor.js).
 */
export function zapamietajCofniecie(paczka, opis, ids = null) {
  if (!paczka) return;
  zapamietajDzialanie({ paczka, opis, ids });
}

/** Wpis do cofnięcia dotyczy otwartej notatki `e`: jej krok albo działanie rdzenia tylko na niej. */
export function wpisNotatki(c, e) {
  return Boolean(c && e && (c.wlasciciel === e || (c.ids && c.ids.length === 1 && c.ids[0] === e.id)));
}

/**
 * Działanie do cofnięcia: paczka rdzenia albo działanie okna z funkcjami `cofnij` i `ponow`. `wlasciciel` to stan
 * edytora, gdy działanie dotyczy tylko otwartej notatki: po jej zamknięciu wpis znika (edytor.js, zamknijEdytor).
 */
export function zapamietajDzialanie(wpis) {
  S.cofnij.push(wpis);
  // Najwyżej 50 kroków i około 40 mln znaków treści w migawkach (`znakow`, edytor.js): przy bardzo długiej notatce zostaje
  // kilka ostatnich kroków, a nie gigabajty pamięci. Najnowszy krok zostaje zawsze.
  let znakow = 0;
  for (let i = S.cofnij.length - 1; i >= 0; i--) {
    znakow += S.cofnij[i].znakow || 0;
    if (i < S.cofnij.length - 1 && (S.cofnij.length - i > 50 || znakow > 40_000_000)) {
      S.cofnij.splice(0, i + 1);
      break;
    }
  }
  S.ponow.length = 0;
  return wpis;
}

/** Treść notatki jako czysty tekst (lista jako ☐/☑). */
export function tekstNotatki(t) {
  const czesci = [];
  if (t.tekst) czesci.push(t.tekst);
  for (const p of t.lista || []) czesci.push(`${p.zrobione ? '☑' : '☐'} ${p.tekst}`);
  return czesci.join('\n');
}

// --- miejsce pracy (Jacek, 22.10.2026: „żeby pozostawały na ostatnim tabie, który był otwarty … a nie że otwiera mi się
// pusta strona. We come back to where we left off the work”) ---
// Widok, przewinięcie listy, ostatnia notatka, czy była otwarta przy wyjściu, jej przewinięcie i miejsce kursora. Pamięć
// tego urządzenia (`localStorage`, jak układ okna), więc telefon i komputer wracają każdy do swojej pracy. Kursor
// i przewinięcie zmieniają się przy każdym klawiszu, więc zapis zbiera zmiany przez 300 ms, a schowanie strony zapisuje od razu.
const KLUCZ_MIEJSCA = 'ikeeper.miejsce';
let miejsce = null;
let timerMiejsca = null;

/** Zapamiętane miejsce pracy (kopia): { widok, tag, lista, notatka, otwarta, przewin, kursor }. */
export function wczytajMiejsce() {
  if (!miejsce) {
    try {
      const m = JSON.parse(localStorage.getItem(KLUCZ_MIEJSCA) || '{}');
      miejsce = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    } catch {
      miejsce = {};
    }
  }
  return { ...miejsce };
}

function zapiszMiejsce() {
  clearTimeout(timerMiejsca);
  timerMiejsca = null;
  try {
    localStorage.setItem(KLUCZ_MIEJSCA, JSON.stringify(miejsce));
  } catch {
    /* bez pamięci przeglądarki miejsce zostaje do zamknięcia okna */
  }
}

/** Dopisuje zmiany do miejsca pracy; zapis za 300 ms, z `odRazu` (strona idzie w tło) od razu. */
export function zapamietajMiejsce(zmiany, odRazu = false) {
  wczytajMiejsce();
  Object.assign(miejsce, zmiany);
  if (odRazu) zapiszMiejsce();
  else if (!timerMiejsca) timerMiejsca = setTimeout(zapiszMiejsce, 300);
}

for (const [cel, zdarzenie] of [[window, 'pagehide'], [document, 'visibilitychange']]) {
  cel.addEventListener(zdarzenie, () => {
    if (timerMiejsca) zapiszMiejsce();
  });
}
