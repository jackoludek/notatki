// Lista notatek: widoki, etykiety, wyszukiwanie, wiersze listy, zaznaczanie, działania.
//
// Układ jak w Apple Notes i Marknote z KDE: obok paska bocznego kolumna z wierszami (tytuł,
// a pod nim data albo termin przypomnienia i początek tekstu), a obok niej cała otwarta notatka.
// Wiersz ma stałą wysokość, więc nic nie trzeba mierzyć ani pamiętać. Przy 10 000 notatek
// rdzeń oddaje po każdym klawiszu tylko pierwsze LIMIT identyfikatorów każdej sekcji, rysuje się
// tyle wierszy, ile mieści ekran (z zapasem), a resztę przy przewijaniu.

import { wywolaj, wywolajSzybko, urlPliku, platforma } from './most.js';
import { el, ikona, $, $$, terminy, wstawZTrafieniami, liczba, fragmentTrafienia, pozycjaTrafienia, krotkaData, kiedyPrzypomnienie, terminPrzypomnienia, tekstPrzypomnienia } from './pomoc.js';
import { S, NAZWY_WIDOKOW, aktualizujNotatki, zapamietajCofniecie, tekstNotatki, wpisNotatki, zapamietajMiejsce } from './stan.js';
import { toast, bladToast, ogloszenie, menu, ustawEkran, waski, alertMacOS } from './ui.js';
import { menuPrzypomnienia } from './wybory.js';
import { otworzEdytor, odswiezOtwarty, odswiezTerminOtwartej } from './edytor.js';
import { otworzHistorie } from './historia.js';
import { KOLORY_PALETY } from './tekstowe.js';
import { importujKeep, otworzLogowanie, stronaBezSerwera } from './ustawienia.js';
import { liniePodgladu } from './uchwyty.js';

const WYSOKOSC_WPISU = 64; // px – jak .wpis w styl.css (min-height 4rem)
const ZAPAS = 6; // wierszy ponad wysokość listy przy pierwszym rysowaniu
const PARTIA = 40; // wierszy dorysowywanych przy przewijaniu
const LIMIT = 240; // identyfikatorów w każdej sekcji pierwszej odpowiedzi rdzenia
const PODGLAD = 400; // znaków podglądu w kafelku (do 5 linii przy wyższych kafelkach, js/uchwyty.js)
let licznik = 0;
let obietnica = Promise.resolve();
let dociaganie = false;
let wysokoscListy = 0;

const kolumna = () => $('#kolumna-listy');

/** Ostatnie odświeżenie listy (pomiary czekają na nie). */
export function ostatnieOdswiezenie() {
  return obietnica;
}

export function ustawZapytanie(q) {
  S.zapytanie = q;
  S.terminy = terminy(q, S.rozmyty);
  $('#szukaj-wyczysc').hidden = !q;
  return odswiezListe();
}

export function odswiezListe(opcje = {}) {
  obietnica = odswiez(opcje);
  return obietnica;
}

function filtrListy() {
  return { widok: S.tag ? 'wszystko' : S.widok, tag: S.tag };
}

function policz(w) {
  return w.sekcje.reduce((a, s) => a + s.ids.length, 0);
}

async function odswiez({ przewin = null } = {}) {
  const nr = ++licznik;
  // Przy powrocie w głąb listy od razu cała lista (0 – bez limitu; trzeba narysować aż do tego miejsca).
  const limit = przewin ? 0 : LIMIT;
  let w;
  const t0 = performance.now();
  try {
    w = await wywolajSzybko('lista', { zapytanie: S.zapytanie, filtr: filtrListy(), limit });
  } catch (e) {
    bladToast(e);
    return;
  }
  if (nr !== licznik) return; // w drodze jest nowsze zapytanie
  const t1 = performance.now();
  S.wynik = w;
  S.wynikPelny = policz(w) >= w.razem;
  rysujListe(przewin ? S.narysowano || 0 : 0);
  if (przewin !== null) kolumna().scrollTop = przewin;
  // Do pomiarów: ile trwało szukanie w rdzeniu razem z IPC, a ile rysowanie wierszy.
  S.czasyListy = {
    rdzen: t1 - t0,
    rysowanie: performance.now() - t1,
    narysowano: S.narysowano,
    wyslane: performance.timeOrigin + t0,
    odebrane: performance.timeOrigin + t1,
  };
}

let timerDopelnienia = null;
/** Wiersze nie wypełniają listy – dorysuj więcej, gdy użytkownik przestanie pisać (250 ms spokoju). */
function dopelnij() {
  clearTimeout(timerDopelnienia);
  timerDopelnienia = setTimeout(() => {
    const f = () => {
      const k = kolumna();
      if (k.offsetParent && zostaloDoNarysowania() && k.scrollHeight - k.scrollTop - k.clientHeight < 900) {
        dorysuj(PARTIA);
        dopelnij();
      }
    };
    if (window.requestIdleCallback) requestIdleCallback(f, { timeout: 400 });
    else f();
  }, 250);
}

/** Reszta identyfikatorów (użytkownik przewinął za pierwszą porcję). */
async function dociagnijReszte() {
  if (S.wynikPelny || dociaganie) return;
  dociaganie = true;
  const nr = licznik;
  try {
    const w = await wywolaj('lista', { zapytanie: S.zapytanie, filtr: filtrListy(), limit: 0 });
    if (nr !== licznik) return;
    const przewin = kolumna().scrollTop;
    S.wynik = w;
    S.wynikPelny = policz(w) >= w.razem;
    rysujListe((S.narysowano || 0) + PARTIA);
    kolumna().scrollTop = przewin;
  } catch (e) {
    bladToast(e);
  } finally {
    dociaganie = false;
  }
}

function wierszyNaEkran() {
  const h = wysokoscListy || kolumna().clientHeight || window.innerHeight || 800;
  return Math.ceil(h / WYSOKOSC_WPISU) + ZAPAS;
}

/** Rysuje listę od nowa: `ile` – co najmniej tyle wierszy (powrót w głąb listy), inaczej ekran z zapasem. */
function rysujListe(ile = 0) {
  const kont = $('#sekcje');
  const razem = S.wynik.sekcje.reduce((a, s) => a + s.ids.length, 0);
  // Lista odświeża się też obok otwartej notatki (zapis, synchronizacja): fokus na wierszu zostaje.
  const akt = document.activeElement;
  const idFokusu = akt && akt.classList && akt.classList.contains('wpis') && kont.contains(akt) ? akt.dataset.id : null;
  S.grupy = [];
  if (!razem) {
    kont.replaceChildren();
    rysujZastepcza();
    rysujLicznik();
    if (S.zapytanie) ogloszenie('Brak wyników');
    return;
  }
  $('#zastepcza').hidden = true;
  const frag = document.createDocumentFragment();

  for (const s of S.wynik.sekcje) {
    if (!s.ids.length) continue;
    // Nagłówki jak w Notatkach Apple: „Przypięte”, pod nimi „Notatki”. Liczba tylko przy szukaniu –
    // wtedy od razu widać, że coś jest też w archiwum albo w koszu. Liczba jest pełna (rdzeń liczy
    // całą sekcję), także gdy narysowana jest dopiero pierwsza porcja.
    const nazwa = s.nazwa === 'Inne' ? 'Notatki' : s.nazwa;
    const sek = el('section.sekcja', { 'aria-label': nazwa || tytulWidoku() });
    if (nazwa) {
      const ile = (typeof s.razem === 'number' ? s.razem : s.ids.length).toLocaleString('pl-PL');
      sek.append(el('h2.sekcja-listy.caption-heading', null, el('span', { tekst: nazwa }), S.zapytanie ? el('span.numeric', { tekst: ile }) : null));
    } else if (!S.zapytanie && (S.widok === 'archiwum' || S.widok === 'kosz')) {
      // Archiwum i Kosz to jedna sekcja bez nazwy. Gdy paska bocznego nie widać (telefon, domyślne
      // okno 1040 px), nagłówek mówi, gdzie jesteś; przy widocznym pasku chowa go styl (.nazwa-widoku).
      sek.append(el('h2.sekcja-listy.caption-heading.nazwa-widoku', { tekst: tytulWidoku() }));
    } else if (S.widok === 'oproznione') {
      // Pasek boczny wskazuje wtedy Kosz, więc nagłówek mówi zawsze, gdzie jesteś.
      sek.append(el('h2.sekcja-listy.caption-heading', { tekst: tytulWidoku() }));
    }
    // Jak „Ostatnio usunięte” w Notatkach Apple: nad koszem zdanie, kiedy notatki znikną, a pod nim „Opróżnij kosz…”.
    if ((S.widok === 'kosz' || S.widok === 'oproznione') && !S.zapytanie) sek.append(gornaCzescKosza());
    const wpisy = el('div.wpisy', { role: 'list' });
    sek.append(wpisy);
    frag.append(sek);
    S.grupy.push({ wpisy, ids: s.ids, gotowe: 0 });
  }
  kont.replaceChildren(frag);
  S.narysowano = 0;
  dorysuj(Math.max(ile, wierszyNaEkran()));
  const fokus = idFokusu ? $(`#sekcje .wpis[data-id="${CSS.escape(idFokusu)}"]`) : null;
  ustawPrzystanek(fokus);
  if (fokus) fokus.focus({ preventScroll: true });
  dopelnij();
  rysujLicznik();
  if (S.zapytanie) ogloszenie(liczba(S.wynik.razem, 'wynik', 'wyniki', 'wyników'));
}

/** Dorysowuje kolejne wiersze (przy przewijaniu). */
function dorysuj(ile) {
  const dodaj = (g) => {
    const n = S.notatki.get(g.ids[g.gotowe]);
    g.gotowe += 1;
    if (!n) return false;
    g.wpisy.append(wpis(n));
    S.narysowano += 1;
    return true;
  };
  // Najpierw po jednym wierszu z każdej sekcji: nagłówek „Archiwum” czy „Kosz” nigdy nie stoi pusty.
  for (const g of S.grupy) {
    if (ile <= 0) break;
    if (g.gotowe === 0 && g.gotowe < g.ids.length && dodaj(g)) ile -= 1;
  }
  for (const g of S.grupy) {
    while (g.gotowe < g.ids.length && ile > 0) {
      if (dodaj(g)) ile -= 1;
    }
    if (ile <= 0) break;
  }
  if (ile > 0 && !S.wynikPelny) dociagnijReszte();
}

function zostaloDoNarysowania() {
  return !S.wynikPelny || S.grupy.some((g) => g.gotowe < g.ids.length);
}

/** Przewija listę do `y` po ponownym uruchomieniu (js/app.js, wrocDoPracy): najpierw dorysowuje wiersze aż do tego miejsca. */
export async function przewinListeDo(y) {
  const k = kolumna();
  if (!S.wynikPelny) await dociagnijReszte();
  for (let i = 0; i < 250 && k.scrollHeight - k.clientHeight < y && S.grupy.some((g) => g.gotowe < g.ids.length); i++) dorysuj(PARTIA);
  k.scrollTop = y;
}

/** Tytuł wiersza (albo pierwsza linia tekstu, gdy notatka nie ma tytułu) i początek reszty. */
function opisWpisu(t) {
  let tytul = (t.tytul || '').trim();
  let podglad;
  if (t.jest_lista) {
    const poz = t.lista || [];
    const zostalo = poz.filter((p) => !p.zrobione).map((p) => p.tekst.trim()).filter(Boolean);
    if (!tytul) tytul = zostalo.shift() || '';
    // W jednej linii pozycje po przecinku, w wyższym kafelku każda pozycja w swojej linii (white-space: pre-line).
    podglad = zostalo.length ? zostalo.join(liniePodgladu() > 1 ? '\n' : ', ') : poz.length ? `Wszystko zrobione (${poz.length})` : '';
  } else {
    const linie = (t.tekst || '').slice(0, PODGLAD * 4).split('\n').map((x) => x.trim()).filter(Boolean);
    if (!tytul) tytul = linie.shift() || '';
    // W jednej linii nowe linie zlewają się w spacje, w wyższym kafelku każda linia notatki stoi osobno.
    podglad = linie.join('\n');
  }
  return { tytul, podglad: podglad.slice(0, PODGLAD) };
}
/**
 * Przy szukaniu podgląd w kafelku zaczyna się tuż przed trafieniem (zadanie 33). Wiersz ma miejsce na około 30 znaków,
 * więc trafienie dalej w linii znikało za wielokropkiem. Przed trafieniem zostaje jedno albo dwa słowa.
 */
const PRZED_TRAFIENIEM = 18;
function przyTrafieniu(linia, ter, rozm) {
  const p = pozycjaTrafienia(linia, ter, rozm);
  if (!p || p[0] <= PRZED_TRAFIENIEM) return linia;
  let od = linia.lastIndexOf(' ', p[0] - 1) + 1;
  const wczesniej = linia.lastIndexOf(' ', od - 2) + 1;
  if (od > 0 && p[0] - wczesniej <= PRZED_TRAFIENIEM) od = wczesniej;
  return od <= 2 ? linia : `… ${linia.slice(od)}`;
}

/**
 * Wiersz notatki jak w Notatkach Apple: tytuł 16 px półgruby, pod nim 13 px data (albo termin
 * przypomnienia, albo kiedy zniknie z kosza) i w drugim planie początek tekstu, z prawej miniatura
 * pierwszego obrazu. Bez kropki koloru i etykiet. Przy szukaniu podświetlone trafienia, a w podglądzie
 * linia z trafieniem.
 */
function wpis(n) {
  const t = n.tresc;
  const ter = S.terminy;
  const rozm = S.rozmyty;
  const { tytul, podglad } = opisWpisu(t);
  const obrazy = (t.zalaczniki || []).filter((z) => z.typ && z.typ.startsWith('image/'));
  const k = el('article.wpis', { role: 'listitem', tabindex: '-1', dataset: { id: n.id } });
  // Kolor notatki barwi cały kafelek (styl.css, [data-kolor]); nazwa koloru jest w opisie dla czytnika ekranu.
  const kolor = t.kolor && t.kolor !== 'DEFAULT' ? t.kolor : null;
  if (kolor) k.dataset.kolor = kolor;
  // Kafelek da się przeciągnąć myszą w inne miejsce listy (ręczna kolejność, niżej: przeciąganie kafelków).
  if (MYSZ_KAFLI.matches && przestawialne()) k.draggable = true;
  if (S.zaznaczone.has(n.id)) k.classList.add('zaznaczona');
  if (S.e && S.e.id === n.id) k.setAttribute('aria-current', 'true');

  const tyt = el('span.wpis-tytul');
  if (tytul) wstawZTrafieniami(tyt, tytul, ter, rozm);
  else {
    tyt.textContent = obrazy.length ? 'Notatka z obrazem' : 'Pusta notatka';
    tyt.classList.add('przygaszony');
  }
  const w1 = el('span.wpis-w1', null, tyt);

  const meta = el('span.wpis-meta');
  const p = t.przypomnienie && !t.przypomnienie.zrobione ? t.przypomnienie : null;
  // Kosz nie wygasa (Jacek, 21.10.2026), więc w koszu stoi, kiedy notatka do niego trafiła.
  if (t.kosz) meta.textContent = `Usunięta ${krotkaData(t.kosz)}`;
  else if (p) meta.append(ikona('dzwonek'), terminPrzypomnienia(p, kiedyPrzypomnienie(n.id, p)));
  else meta.textContent = krotkaData(t.edytowana);

  let linia = podglad;
  if (ter.length) {
    // Do 5 linii od trafienia: wyższy kafelek pokazuje też to, co stoi pod nim.
    const f = fragmentTrafienia(tekstNotatki(t), ter, rozm, 5);
    if (f.znaleziono && f.linie.length) {
      const [pierwsza, ...dalej] = f.linie;
      linia = [przyTrafieniu(`${f.przed && !pierwsza.startsWith('…') ? '… ' : ''}${pierwsza}`, ter, rozm), ...dalej].join('\n');
    }
    // Ani w tytule, ani w tekście, a notatka ma obrazy: znalazło się w tekście rozpoznanym na obrazie.
    else if (obrazy.length && !pozycjaTrafienia(tytul, ter, rozm)) linia = 'Znalezione w tekście z obrazu';
  }
  const w2 = el('span.wpis-w2', null, meta);
  if (t.konflikt) w2.append(el('span.wpis-uwaga', { tekst: 'Do przejrzenia' }));
  if (linia) {
    const pg = el('span.wpis-podglad');
    wstawZTrafieniami(pg, linia.slice(0, PODGLAD), ter, rozm);
    w2.append(pg);
  }
  k.append(el('span.wpis-znacznik', { 'aria-hidden': 'true' }, ikona('ptaszek')), el('span.wpis-tekst', null, w1, w2));
  if (obrazy.length) k.append(el('img.wpis-miniatura', { src: urlPliku(obrazy[0].hash), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
  // Czytnik ekranu dostaje to samo co oko: tytuł, datę albo termin i początek tekstu.
  k.setAttribute('aria-label', `${tytul || tyt.textContent}, ${meta.textContent}${kolor ? `, ${nazwaKoloru(kolor).toLowerCase()}` : ''}${linia ? `: ${linia.slice(0, 120)}` : ''}`);
  return k;
}

/**
 * Kolory notatek z palety systemowej Apple. Klucze jak w Google Keep (tak zapisuje je rdzeń i import z Keep),
 * nazwy po polsku. Odcienie są w styl.css, osobno dla jasnego i ciemnego motywu.
 */
export const KOLORY_NOTATEK = KOLORY_PALETY.map(([k, n]) => [k, n]);

export function nazwaKoloru(k) {
  return (KOLORY_NOTATEK.find(([x]) => x === k) || KOLORY_NOTATEK[0])[1];
}

/** Kolor dla jednej albo kilku notatek naraz, z „Cofnij” jak przy innych działaniach. */
export function zmienKolor(ids, k) {
  const ile = ids.length > 1 ? `, ${liczba(ids.length, 'notatka', 'notatki', 'notatek')}` : '';
  return dzialanie(ids, { typ: 'kolor', wartosc: k }, `${k === 'DEFAULT' ? 'Bez koloru' : `Kolor: ${nazwaKoloru(k)}`}${ile}`, { odswiezPasekAkcji: true });
}

// --- ręczna kolejność: przeciąganie kafelków myszą i Alt+↑ ↓ (rdzeń: przestaw, kolejnosc.rs) ---
//
// Jak w Google Keep: notatkę przeciąga się w inne miejsce jej sekcji (Przypięte, Notatki, Archiwum), a kolejność
// zostaje i idzie przez synchronizację na inne urządzenia. Zmiana treści notatki jej nie przesuwa, a nowa staje
// na górze. Klucz miejsca liczy rdzeń, okno podaje tylko sąsiadów. Ctrl+Z poza tekstem cofa przesunięcie.
const MYSZ_KAFLI = window.matchMedia('(hover: hover) and (pointer: fine)');
const TYP_KAFLA = 'application/x-ikeeper-notatka';
let ciagniety = null; // { id, wpisy, el }
let celUpuszczenia = null; // { el, za }
let kolejkaPrzesuniec = Promise.resolve();

/** W tym widoku notatki stoją w ręcznej kolejności. Szukanie (trafność), Kosz i Przypomnienia mają własną. */
function przestawialne() {
  return !S.zapytanie && (S.widok === 'notatki' || S.widok === 'archiwum');
}

function grupaKafla(k) {
  return S.grupy.find((g) => g.wpisy === k.parentElement) || null;
}

function tytulKafla(k) {
  const t = k.querySelector('.wpis-tytul');
  return (t && t.textContent) || 'Notatka';
}

/**
 * Miejsce upuszczenia pod kursorem: kafelek i strona (`za` – pod nim), tylko w sekcji przeciąganej notatki.
 * Kilka pikseli nad pierwszym i pod ostatnim kafelkiem też się liczy, dalej (inna sekcja) już nie.
 */
function celPod(y) {
  const kafle = [...ciagniety.wpisy.children];
  if (!kafle.length) return null;
  const gora = kafle[0].getBoundingClientRect().top;
  const dol = kafle[kafle.length - 1].getBoundingClientRect().bottom;
  if (y < gora - 24 || y > dol + 48) return null;
  for (const k of kafle) {
    const r = k.getBoundingClientRect();
    if (y < r.top + r.height / 2) return { el: k, za: false };
  }
  return { el: kafle[kafle.length - 1], za: true };
}

/** Kreska w kolorze akcentu między kafelkami. Bez kreski, gdy notatka stanęłaby tam, gdzie stoi. */
function pokazCel(cel) {
  const c = ciagniety && ciagniety.el;
  const bezRuchu = !cel || !c || cel.el === c || (!cel.za && cel.el.previousElementSibling === c) || (cel.za && cel.el.nextElementSibling === c);
  const nowy = bezRuchu ? null : cel;
  if (celUpuszczenia && nowy && celUpuszczenia.el === nowy.el && celUpuszczenia.za === nowy.za) return;
  if (celUpuszczenia) celUpuszczenia.el.classList.remove('upusc-nad', 'upusc-pod');
  celUpuszczenia = nowy;
  if (nowy) nowy.el.classList.add(nowy.za ? 'upusc-pod' : 'upusc-nad');
}

/** Przy górnej i dolnej krawędzi listy lista sama się przewija (zdarzenie przeciągania przychodzi co ~50 ms). */
function przewinPrzyKrawedzi(y) {
  const l = kolumna();
  const r = l.getBoundingClientRect();
  if (y < r.top + 48) l.scrollTop -= 16;
  else if (y > r.bottom - 48) l.scrollTop += 16;
}

/** Notatka `id` między sąsiadów `nad` (wyżej) i `pod` (niżej); `null` – brzeg sekcji. Jedna po drugiej. */
function przestawNotatke(id, nad, pod, ogloszenieMiejsca = '') {
  kolejkaPrzesuniec = kolejkaPrzesuniec.then(async () => {
    try {
      const r = await wywolaj('przestaw', { id, ...(nad ? { nad } : {}), ...(pod ? { pod } : {}) });
      if (r.paczka) {
        zastosujZmiany(r);
        zapamietajCofniecie(r.paczka, 'Przeniesiono notatkę');
      }
      if (ogloszenieMiejsca) ogloszenie(ogloszenieMiejsca);
    } catch (e) {
      bladToast(e);
    }
    await odswiezListe({ przewin: kolumna().scrollTop });
  });
  return kolejkaPrzesuniec;
}

/** Upuszczenie: kafelek od razu staje w nowym miejscu, rdzeń zapisuje kolejność, lista rysuje się od nowa. */
function upusc(c, cel) {
  const g = grupaKafla(c.el);
  if (!g) return;
  const ids = g.ids.filter((x) => x !== c.id);
  const i = ids.indexOf(cel.el.dataset.id);
  if (i < 0) return;
  const [nad, pod] = cel.za ? [ids[i], ids[i + 1] ?? null] : [ids[i - 1] ?? null, ids[i]];
  if (cel.za) cel.el.after(c.el);
  else cel.el.before(c.el);
  g.ids = [...ids.slice(0, cel.za ? i + 1 : i), c.id, ...ids.slice(cel.za ? i + 1 : i)];
  przestawNotatke(c.id, nad, pod, `${tytulKafla(c.el)}: miejsce ${g.ids.indexOf(c.id) + 1} z ${g.ids.length}`);
}

/** Alt+↑ i Alt+↓ na kafelku: o jedno miejsce w górę albo w dół w jego sekcji. Fokus zostaje na kafelku. */
function przesunKlawiatura(k, kierunek) {
  const g = grupaKafla(k);
  if (!g) return;
  const id = k.dataset.id;
  const j = g.ids.indexOf(id);
  if (j < 0) return;
  if ((kierunek < 0 && j === 0) || (kierunek > 0 && j === g.ids.length - 1)) {
    ogloszenie(`${tytulKafla(k)}: to już ${kierunek < 0 ? 'pierwsze' : 'ostatnie'} miejsce`);
    return;
  }
  const ids = g.ids.filter((x) => x !== id);
  const cel = j + kierunek;
  const nad = ids[cel - 1] ?? null;
  const pod = ids[cel] ?? null;
  const sasiad = kierunek < 0 ? k.previousElementSibling : k.nextElementSibling;
  if (sasiad) {
    if (kierunek < 0) sasiad.before(k);
    else sasiad.after(k);
    k.focus({ preventScroll: true });
    k.scrollIntoView({ block: 'nearest' });
  }
  g.ids = [...ids.slice(0, cel), id, ...ids.slice(cel)];
  przestawNotatke(id, nad, pod, `${tytulKafla(k)}: miejsce ${cel + 1} z ${g.ids.length}`);
}

/** Jeden przystanek Tab w liście (otwarta notatka albo pierwszy wiersz), resztę zmieniają strzałki. */
function ustawPrzystanek(cel = null) {
  const wpisy = $$('#sekcje .wpis');
  const c = cel || wpisy.find((w) => w.getAttribute('aria-current') === 'true') || wpisy[0];
  for (const w of wpisy) w.tabIndex = w === c ? 0 : -1;
}

/** Zaznacza na liście notatkę otwartą obok (albo żadną). */
export function oznaczOtwarta(id) {
  for (const w of $$('#sekcje .wpis[aria-current]')) w.removeAttribute('aria-current');
  const w = id ? $(`#sekcje .wpis[data-id="${CSS.escape(id)}"]`) : null;
  if (w) w.setAttribute('aria-current', 'true');
  ustawPrzystanek(w);
}

/** Liczba na dole listy (telefon) i podpowiedź w pustym panelu obok listy (komputer). */
function rysujLicznik() {
  const ile = S.wynik ? S.wynik.razem : 0;
  $('#licznik-listy').textContent = !ile ? '' : S.zapytanie ? liczba(ile, 'wynik', 'wyniki', 'wyników') : liczba(ile, 'notatka', 'notatki', 'notatek');
  $('#pusty-panel-tekst').textContent = ile ? 'Wybierz notatkę z listy' : '';
}

function tytulWidoku() {
  return S.tag ? `Etykieta ${S.tag}` : NAZWY_WIDOKOW[S.widok];
}

/** Pusta lista: co się stało i co zrobić dalej, z przyciskiem do tego (HIG: pusty ekran). */
function rysujZastepcza() {
  const z = $('#zastepcza');
  const nic = !S.notatki.size;
  let ik = 'notatka';
  let tytul;
  let opis = '';
  const przyciski = [];
  if (S.zapytanie) {
    ik = 'szukaj';
    tytul = 'Brak wyników';
    opis = S.ustawienia.szukaj_albo_utworz ? `Naciśnij Enter, żeby utworzyć notatkę „${S.zapytanie.trim()}”` : 'Spróbuj innych słów';
  } else if (nic && platforma !== 'windows') {
    // Telefon i przeglądarka: notatki zwykle są już na komputerze. Telefon dostaje je z pliku komputera
    // w OneDrive albo na Dysku Google (raz połączony w Ustawieniach), przeglądarka z własnego serwera.
    const s = S.sync || {};
    const w = s.wymiana || {};
    const telefon = platforma === 'android';
    const zPliku = telefon && Boolean((S.platforma || {}).wymiana);
    if (zPliku) {
      ik = 'chmura';
      if (w.stan === 'blad' || w.stan === 'brak') {
        tytul = 'Nie mogę przeczytać pliku z komputera';
        opis = w.komunikat || 'Wymiana teraz nie działa';
      } else {
        tytul = 'Czekam na notatki';
        opis = 'Telefon jest połączony z plikiem z komputera. Notatki pojawią się tu za kilka sekund';
      }
    } else if (!s.polaczona) {
      // Tytuł mówi, co jest, a nie jak nazywa się program (reguła Jacka z 24.10.2026: bez nazwy programu na ekranie).
      tytul = 'Ta przeglądarka nie ma jeszcze notatek';
      if (telefon) {
        // Jacek, 21.10.2026: „It's supposed to do it itself in the background”. Telefon łączy komputer
        // (narzedzia\polacz-github.ps1, przez adb), więc tu nie ma czego wybierać ani łączyć.
        tytul = 'Notatki z komputera są w drodze';
        opis = 'Pojawią się tu same, gdy komputer połączy ten telefon. Możesz już pisać';
      } else if (stronaBezSerwera()) {
        // Strona z GitHub Pages: łączy ją link z Pulpitu (repozytorium i token po #).
        opis = 'Otwórz tę stronę linkiem „Notatki w przeglądarce” z Pulpitu albo zaimportuj notatki z Google Keep';
        przyciski.push(el('button.pigulka', { type: 'button', onclick: () => importujKeep() }, 'Importuj z Google Keep…'));
      } else {
        opis = 'Połącz tę przeglądarkę z serwerem notatek albo zaimportuj notatki z Google Keep';
        przyciski.push(el('button.sugerowany.pigulka', { type: 'button', onclick: () => otworzLogowanie() }, 'Połącz z serwerem…'));
        przyciski.push(el('button.pigulka', { type: 'button', onclick: () => importujKeep() }, 'Importuj z Google Keep…'));
      }
    } else if (s.stan === 'blad') {
      ik = 'chmura';
      tytul = 'Nie mogę pobrać notatek';
      // Bez „Spróbuj ponownie” (Jacek, 24.10.2026: „NO REFRESH BUTTON ANYWHERE … work in the background”):
      // synchronizacja sama próbuje znowu, a notatki pojawią się, gdy się uda.
      opis = s.komunikat || 'Błąd synchronizacji';
    } else if (s.stan === 'offline') {
      ik = 'chmura';
      tytul = 'Brak internetu';
      opis = 'Notatki pobiorą się same, gdy wróci internet';
    } else {
      ik = 'chmura';
      tytul = 'Czekam na notatki';
      opis = `${telefon ? 'Telefon jest połączony' : 'Przeglądarka jest połączona'}. Notatki z komputera pojawią się tu za kilka sekund`;
    }
    przyciski.push(el('button.pigulka', { type: 'button', onclick: () => otworzEdytor(null) }, 'Nowa notatka'));
  } else if (nic) {
    // Bez opisu: dwa przyciski niżej mówią, od czego zacząć (zasada „zacznij prosto”).
    tytul = 'Zacznij od pierwszej notatki';
    przyciski.push(el('button.sugerowany.pigulka', { type: 'button', onclick: () => otworzEdytor(null) }, 'Nowa notatka'));
    przyciski.push(el('button.pigulka', { type: 'button', onclick: () => importujKeep() }, 'Importuj z Google Keep…'));
  } else if (S.tag) {
    ik = 'etykieta';
    tytul = `Brak notatek z etykietą „${S.tag}”`;
  } else if (S.widok === 'archiwum') {
    ik = 'archiwum';
    tytul = 'Archiwum jest puste';
    opis = 'Zarchiwizowane notatki znikają z głównego widoku, ale wyszukiwarka nadal je znajduje';
  } else if (S.widok === 'kosz') {
    ik = 'kosz';
    tytul = 'Kosz jest pusty';
    opis = 'Usunięte notatki leżą tutaj bez terminu i zawsze da się je przywrócić';
    const odzyskaj = przyciskOdzyskaj();
    if (odzyskaj) przyciski.push(odzyskaj);
  } else if (S.widok === 'oproznione') {
    ik = 'historia';
    tytul = 'Nic do odzyskania';
    opis = 'Tu trafiają notatki z opróżnionego kosza';
  } else if (S.widok === 'przypomnienia') {
    ik = 'dzwonek';
    tytul = 'Brak przypomnień';
    // Jacek, 21.10.2026: „Przypomnienia. Nie wiem, co to jest”. Jedno zdanie, czym jest widok, i jedno, jak go zapełnić.
    opis = 'Tu stają notatki, które mają Ci o czymś przypomnieć, od najbliższej. Porę ustawisz dzwonkiem nad otwartą notatką';
  } else {
    tytul = 'Brak notatek';
    przyciski.push(el('button.sugerowany.pigulka', { type: 'button', onclick: () => otworzEdytor(null) }, 'Nowa notatka'));
  }
  // Bez pustych miejsc: replaceChildren zamienia null na tekst „null”.
  z.replaceChildren(...[ikona(ik, 'duza'), el('p.title-2', { tekst: tytul }), opis && el('p.przygaszony', { tekst: opis }), przyciski.length && el('div.chipy', null, przyciski)].filter(Boolean));
  z.hidden = false;
}

// --- widoki i pasek boczny ---

export function rysujPasek() {
  const st = S.statystyka || {};
  let przyp = 0;
  for (const n of S.notatki.values()) if (n.tresc.przypomnienie && !n.tresc.przypomnienie.zrobione && !n.tresc.kosz) przyp += 1;
  $('#licz-notatki').textContent = st.notatki ?? '';
  $('#licz-archiwum').textContent = st.archiwum || '';
  $('#licz-kosz').textContent = st.kosz || '';
  $('#licz-przypomnienia').textContent = przyp || '';
  // „Odzyskaj usunięte” to część kosza: w pasku bocznym stoi wtedy wybrany Kosz.
  const widok = S.widok === 'oproznione' ? 'kosz' : S.widok;
  // Archiwum i Kosz stają w pasku dopiero, gdy coś w nich jest, jak „Ostatnio usunięte” w Notatkach Apple i Archiwum
  // w Bear (zadanie 19, zasada Jacka „zacznij prosto”): nowa osoba widzi Notatki i Przypomnienia, a reszta wchodzi sama,
  // gdy jest potrzebna. Otwarty widok zostaje, a Kosz stoi też przy opróżnionych notatkach do odzyskania.
  const jest = { archiwum: (st.archiwum || 0) > 0, kosz: (st.kosz || 0) + (st.oproznione || 0) > 0 };
  for (const b of $$('#widoki button')) {
    const akt = !S.tag && b.dataset.widok === widok;
    if (akt) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
    if (b.dataset.widok in jest) b.closest('li').hidden = !jest[b.dataset.widok] && !akt;
  }
}

export async function ustawWidok(widok, tag = null) {
  S.widok = widok;
  S.tag = tag;
  // Widok wraca po ponownym uruchomieniu (js/app.js, wrocDoPracy).
  zapamietajMiejsce({ widok, tag, lista: 0 });
  wyczyscZaznaczenie();
  document.body.classList.remove('pasek-otwarty');
  if (S.ekran !== 'lista') {
    const { zamknijEdytor } = await import('./edytor.js');
    await zamknijEdytor({ bezOdswiezania: true });
    ustawEkran('lista');
  }
  if (S.zapytanie) {
    $('#szukaj').value = '';
    S.zapytanie = '';
    S.terminy = [];
    $('#szukaj-wyczysc').hidden = true;
  }
  rysujPasek();
  kolumna().scrollTop = 0;
  return odswiezListe();
}

// --- zaznaczanie (Selection Mode) ---

export function przelaczZaznaczenie(id) {
  if (S.zaznaczone.has(id)) S.zaznaczone.delete(id);
  else S.zaznaczone.add(id);
  aktualizujZaznaczenie();
}

export function wyczyscZaznaczenie() {
  if (!S.zaznaczone.size) return;
  S.zaznaczone.clear();
  aktualizujZaznaczenie();
}

export async function zaznaczWszystkie() {
  if (!S.wynik) return;
  for (const id of await idsWidoku()) S.zaznaczone.add(id);
  aktualizujZaznaczenie();
}

/** Identyfikatory całego obecnego widoku – rdzeń mógł oddać tylko pierwszą porcję. */
export async function idsWidoku() {
  if (!S.wynik) return [];
  if (!S.wynikPelny) await dociagnijReszte();
  return S.wynik.sekcje.flatMap((s) => s.ids);
}

function aktualizujZaznaczenie() {
  const ile = S.zaznaczone.size;
  document.body.classList.toggle('zaznaczanie', ile > 0);
  for (const k of $$('.wpis', $('#sekcje'))) {
    const z = S.zaznaczone.has(k.dataset.id);
    k.classList.toggle('zaznaczona', z);
  }
  if (ile) ogloszenie(`Zaznaczono ${ile}`);
  ustawEkran(S.ekran);
  if (ile) $('#tytul-widoku').textContent = `Zaznaczono ${ile}`;
  rysujPasekAkcji();
}

function rysujPasekAkcji() {
  const p = $('#pasek-akcji');
  const ids = [...S.zaznaczone];
  p.replaceChildren();
  if (!ids.length) {
    p.hidden = true;
    wysokoscPaskaAkcji(p);
    return;
  }
  // Przyciski z napisem: dymek powtórzyłby napis, więc go nie mają (reguła `ikonki-z-dymkami.md`).
  const b = (ik, tekst, f) => el('button', { type: 'button', onclick: f }, ikona(ik), el('span', { tekst }));
  const notatki = ids.map((id) => S.notatki.get(id)).filter(Boolean);
  const wKoszu = notatki.length && notatki.every((n) => n.tresc.kosz);
  const n = ids.length;
  const ile = (a, b2, c) => liczba(n, a, b2, c);
  if (wKoszu) {
    p.append(b('z-kosza', 'Przywróć', () => dzialanie(ids, { typ: 'do_kosza', wartosc: false }, `Przywrócono ${ile('notatkę', 'notatki', 'notatek')}`)));
  } else {
    const wszystkiePrzypiete = notatki.every((x) => x.tresc.przypieta);
    const wszystkieWArchiwum = notatki.every((x) => x.tresc.archiwum);
    p.append(
      b('pinezka', wszystkiePrzypiete ? 'Odepnij' : 'Przypnij', () => dzialanie(ids, { typ: 'przypnij', wartosc: !wszystkiePrzypiete }, wszystkiePrzypiete ? 'Odpięto' : 'Przypięto')),
      b('dzwonek', 'Przypomnienie', (ev) => menuPrzypomnienia(ev.currentTarget, null, (p) => dzialanie(ids, { typ: 'przypomnienie', wartosc: p }, p ? 'Ustawiono przypomnienie' : 'Usunięto przypomnienie'))),
      b(
        wszystkieWArchiwum ? 'z-archiwum' : 'archiwum',
        wszystkieWArchiwum ? 'Z archiwum' : 'Archiwizuj',
        () => dzialanie(ids, { typ: 'archiwizuj', wartosc: !wszystkieWArchiwum }, wszystkieWArchiwum ? `Przywrócono z archiwum ${ile('notatkę', 'notatki', 'notatek')}` : `Zarchiwizowano ${ile('notatkę', 'notatki', 'notatek')}`),
      ),
      b('paleta', 'Kolor', (ev) => {
        const wspolny = notatki.every((x) => (x.tresc.kolor || 'DEFAULT') === (notatki[0].tresc.kolor || 'DEFAULT')) ? notatki[0].tresc.kolor || 'DEFAULT' : null;
        menu([{ tekst: 'Kolor notatek', paleta: { kolory: KOLORY_NOTATEK, wartosc: wspolny, akcja: (k) => zmienKolor(ids, k) } }], ev.currentTarget, 'Kolor notatek');
      }),
      b('kosz', 'Do kosza', () => dzialanie(ids, { typ: 'do_kosza', wartosc: true }, `Przeniesiono do kosza ${ile('notatkę', 'notatki', 'notatek')}`)),
    );
  }
  p.hidden = false;
  wysokoscPaskaAkcji(p);
  // Pasek zawija się na wąskim oknie: komunikaty idą za jego wysokością.
  if (!obserwatorPaskaAkcji && 'ResizeObserver' in window) {
    obserwatorPaskaAkcji = new ResizeObserver(() => wysokoscPaskaAkcji(p));
    obserwatorPaskaAkcji.observe(p);
  }
}

let obserwatorPaskaAkcji = null;
/** Komunikaty (toast z „Cofnij”) stoją nad paskiem działań na zaznaczonych, a nie na jego przyciskach (styl.css, .toasty). */
function wysokoscPaskaAkcji(p) {
  document.documentElement.style.setProperty('--akcje-wys', p.hidden ? '0px' : `${p.offsetHeight}px`);
}


// --- działania na notatkach ---

/** Wkłada wynik polecenia (zmienione notatki, etykiety) do stanu interfejsu. */
export function zastosujZmiany(r) {
  if (!r) return;
  aktualizujNotatki(r.zmienione);
  if (r.tagi) S.tagi = r.tagi;
  przeliczStatystyke();
  rysujPasek();
  if ((r.zmienione || []).some((n) => n.tresc.przypomnienie || S.nastepne.has(n.id))) odswiezPrzypomnienia();
}

// --- przypomnienia: najbliższe wystąpienia (liczy rdzeń) i zegar, który przesuwa plakietki ---

let przypomnieniaWDrodze = null;
let zegarPrzypomnien = null;

/** Mapa id → ms z rdzenia do stanu. Zwraca, czy coś się zmieniło. */
export function ustawNastepne(nastepne) {
  const nowa = new Map(Object.entries(nastepne || {}).map(([id, ms]) => [id, Number(ms)]));
  const inna = nowa.size !== S.nastepne.size || [...nowa].some(([id, ms]) => S.nastepne.get(id) !== ms);
  S.nastepne = nowa;
  zaplanujPrzypomnienia();
  return inna;
}

/**
 * Odświeża najbliższe wystąpienia: po zmianie przypomnień, po zapisie, przy powrocie okna i o czasie.
 * Kilka próśb naraz to jedno polecenie. Gdy coś się zmieniło, lista rysuje się od nowa – karty
 * z niezmienionym terminem przychodzą z pamięci, a widok Przypomnienia dostaje nową kolejność.
 * Błąd to tylko brak odświeżenia (to praca w tle – bez komunikatu): zostaje poprzednia mapa.
 */
export function odswiezPrzypomnienia() {
  if (przypomnieniaWDrodze) return przypomnieniaWDrodze;
  przypomnieniaWDrodze = (async () => {
    try {
      // Prośby z tego samego zadania (np. kilka zmian naraz) łączą się w jedną. Bez czekania na
      // klatkę: w schowanej karcie przeglądarki klatek nie ma.
      await new Promise((r) => setTimeout(r, 0));
      const r = await wywolaj('przypomnienia');
      // Lista stoi obok notatki, więc odświeża się zawsze (nowa kolejność w widoku Przypomnienia, nowe terminy).
      if (ustawNastepne(r.nastepne)) {
        await odswiezListe({ przewin: kolumna().scrollTop });
        odswiezTerminOtwartej();
      }
      return true;
    } catch (e) {
      console.error('iKeeper: przypomnienia', e);
      return false;
    } finally {
      przypomnieniaWDrodze = null;
    }
  })();
  return przypomnieniaWDrodze;
}

/**
 * Jeden zegar na najbliższą przyszłą chwilę (+1 s, żeby rdzeń już ją minął), najwyżej godzinę
 * naprzód – po uśpieniu komputera albo zmianie zegara plakietki i tak dogonią czas. O 9:00:01
 * „Dziś, 9:00” powtarzanego zmienia się więc w „Jutro, 9:00”. Działa tak samo w wersji web.
 */
function zaplanujPrzypomnienia() {
  clearTimeout(zegarPrzypomnien);
  const teraz = Date.now();
  const przyszle = [...S.nastepne.values()].filter((ms) => ms > teraz);
  if (!przyszle.length) return;
  const za = Math.min(Math.min(...przyszle) - teraz + 1000, 3600000);
  zegarPrzypomnien = setTimeout(() => odswiezPrzypomnienia(), za);
}

export function przeliczStatystyke() {
  let notatki = 0;
  let archiwum = 0;
  let kosz = 0;
  let oproznione = 0;
  for (const n of S.notatki.values()) {
    if (n.tresc.kosz && n.tresc.oprozniona) oproznione += 1;
    else if (n.tresc.kosz) kosz += 1;
    else if (n.tresc.archiwum) archiwum += 1;
    else notatki += 1;
  }
  S.statystyka = { notatki, archiwum, kosz, oproznione, razem: S.notatki.size };
}

// --- kosz: opróżnianie, odzyskiwanie, rozmiar (Jacek, 21.10.2026: „opcja na opróżnienie całego śmietnika z potwierdzeniem …
// Ctrl Z … out of sight, out of mind … mała ikonka, żeby zrobić undelete … powyżej 1 gigabajt … przypominajkę”) ---

/** Od tylu bajtów usuniętych (kosz i opróżniony kosz razem) widok kosza mówi, ile zajmują. */
const DUZY_KOSZ = 1024 ** 3;
/** Mała okrągła ikonka „Odzyskaj usunięte”, gdy w opróżnionym koszu coś jest (inaczej `null`). */
function przyciskOdzyskaj() {
  const ile = (S.statystyka || {}).oproznione || 0;
  if (!ile) return null;
  return el(
    'button.ikona.odzyskaj',
    { type: 'button', title: `Odzyskaj usunięte z opróżnionego kosza (${ile.toLocaleString('pl-PL')})`, 'aria-label': 'Odzyskaj usunięte', onclick: () => ustawWidok('oproznione') },
    ikona('historia'),
  );
}
/** Nad listą kosza: zdanie o koszu, „Opróżnij kosz…” i ikonka odzyskiwania; w „Odzyskaj usunięte” zdanie, jak przywrócić. */
function gornaCzescKosza() {
  const g = el('div.gora-kosza');
  if (S.widok === 'kosz') {
    g.append(el('p.caption.przygaszony.uwaga-kosza', { tekst: 'Notatki leżą w koszu bez terminu, dopóki ich stąd nie wyjmiesz' }));
    g.append(el('div.akcje-kosza', null, el('button.pigulka', { type: 'button', onclick: () => oproznijKosz() }, 'Opróżnij kosz…'), przyciskOdzyskaj()));
  } else {
    g.append(el('p.caption.przygaszony.uwaga-kosza', { tekst: 'Opróżnione z kosza. Prawy klik przywraca notatkę' }));
  }
  // Rozmiar liczy rdzeń (pliki tylko z usuniętych notatek). Zdanie dochodzi samo, gdy usunięte przekroczą 1 GB.
  wywolaj('kosz_rozmiar')
    .then((r) => {
      if (!r || r.bajty < DUZY_KOSZ || !g.isConnected) return;
      const gb = (r.bajty / DUZY_KOSZ).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
      g.append(el('p.caption.uwaga-rozmiaru', { tekst: `Usunięte notatki zajmują już ${gb} GB` }));
    })
    .catch(() => {});
  return g;
}
/**
 * Przypominajka o dużym koszu (zadanie 32, Jacek: „powyżej 1 gigabajt … przypominajkę, że się rozrosło”): po starcie,
 * najwyżej raz dziennie, cichy komunikat z „Pokaż kosz”. Nic nie kasuje.
 */
export async function przypomnijODuzymKoszu() {
  const KLUCZ = 'ikeeper.kosz-przypomniany';
  const dzis = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(KLUCZ) === dzis) return;
  } catch {
    /* bez pamięci przeglądarki przypomina przy każdym starcie, gdy kosz jest duży */
  }
  const r = await wywolaj('kosz_rozmiar').catch(() => null);
  if (!r || r.bajty < DUZY_KOSZ) return;
  try {
    localStorage.setItem(KLUCZ, dzis);
  } catch {
    /* jak wyżej */
  }
  const gb = (r.bajty / DUZY_KOSZ).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
  toast(`Usunięte notatki zajmują już ${gb} GB`, { przycisk: 'Pokaż kosz', akcja: () => ustawWidok('kosz'), czas: 10000 });
}
// Inna wysokość kafelków (js/uchwyty.js): pozycje list przechodzą z przecinków na osobne linie i z powrotem.
window.addEventListener('notatki:kafle', () => {
  if (S.wynik) odswiezListe({ przewin: kolumna().scrollTop }).catch(() => {});
});
/** „Opróżnij kosz…”: alert jak w macOS, potem jedno działanie rdzenia, więc Ctrl+Z i „Cofnij” oddają cały kosz. */
async function oproznijKosz() {
  const ids = await idsWidoku();
  if (!ids.length || S.widok !== 'kosz') return;
  const ile = liczba(ids.length, 'notatka zniknie', 'notatki znikną', 'notatek zniknie');
  const tak = await alertMacOS({ znak: 'kosz', tytul: 'Opróżnić kosz?', opis: `${ile} z kosza. Wrócą przez „Odzyskaj usunięte” albo Ctrl+Z`, przycisk: 'Opróżnij kosz' });
  if (!tak) return;
  await dzialanie(ids, { typ: 'oproznij', wartosc: true }, 'Opróżniono kosz');
}

/** Działanie na notatkach + toast z „Cofnij” (HIG: cofanie zamiast pytania o potwierdzenie). */
export async function dzialanie(ids, akcja, opis, { odswiezPasekAkcji = false } = {}) {
  try {
    const r = await wywolaj('akcja', { ids, akcja });
    zastosujZmiany(r);
    zapamietajCofniecie(r.paczka, opis, ids);
    if (!odswiezPasekAkcji && ['do_kosza', 'archiwizuj', 'oproznij'].includes(akcja.typ)) wyczyscZaznaczenie();
    else if (S.zaznaczone.size) rysujPasekAkcji();
    await odswiezListe();
    odswiezOtwarty(r.zmienione);
    if (opis) toast(opis, { przycisk: 'Cofnij', akcja: () => cofnijPaczke(r.paczka), czas: 8000 });
    return r;
  } catch (e) {
    bladToast(e);
    return null;
  }
}

/**
 * Cofa paczkę rdzenia (Ctrl+Z, „Cofnij” w komunikacie, Porządki AI). Cofnięcie jest w rdzeniu nową paczką, więc cofnięcie
 * cofnięcia to ponowienie: idzie na listę do ponowienia (Ctrl+Y). Cofnięcie bez żadnej zmiany nie ma czego ponawiać.
 */
export async function cofnijPaczke(paczka, opis = '', ids = null) {
  try {
    const r = await wywolaj('cofnij', { paczka });
    zastosujZmiany(r);
    const byl = S.cofnij.find((c) => c.paczka === paczka);
    S.cofnij = S.cofnij.filter((c) => c.paczka !== paczka);
    if (r.paczka && r.zmienione && r.zmienione.length) S.ponow.push({ paczka: r.paczka, opis: (byl && byl.opis) || opis, ids: (byl && byl.ids) || ids });
    await odswiezListe();
    odswiezOtwarty(r.zmienione);
    // Cofniętą zmianę widać na liście – komunikat tylko dla czytnika ekranu.
    ogloszenie('Cofnięto');
  } catch (e) {
    bladToast(e);
  }
}

/** „Cofnij” w komunikacie po działaniu okna (bez paczki rdzenia): to samo co Ctrl+Z, ale dla tego jednego działania. */
export async function cofnijWpis(w) {
  const i = S.cofnij.indexOf(w);
  if (i < 0) return;
  S.cofnij.splice(i, 1);
  await w.cofnij();
  S.ponow.push(w);
  ogloszenie('Cofnięto');
}

/** Indeks najnowszego wpisu do cofnięcia albo ponowienia, a z `notatka` najnowszego wpisu tej notatki (-1: nie ma). */
function ostatni(lista, notatka) {
  if (!notatka) return lista.length - 1;
  for (let i = lista.length - 1; i >= 0; i--) if (wpisNotatki(lista[i], notatka)) return i;
  return -1;
}

/**
 * Ctrl+Z: cofa ostatnie działanie, krok po kroku od najnowszego. Krok, który nie ma już czego zmienić (pisanie, po którym
 * tekst wrócił do tego samego), przepada, a Ctrl+Z cofa następny. Z `notatka` (Ctrl+Z w polu otwartej notatki)
 * najnowszy krok tej notatki, choćby nad nim leżały działania na innych notatkach.
 */
export async function cofnijOstatnie({ notatka = null } = {}) {
  for (;;) {
    const i = ostatni(S.cofnij, notatka);
    if (i < 0) {
      if (!notatka) toast('Nie ma nic do cofnięcia');
      return;
    }
    const [c] = S.cofnij.splice(i, 1);
    if (c.cofnij) {
      if ((await c.cofnij()) === false) continue;
      S.ponow.push(c);
      ogloszenie('Cofnięto');
      return;
    }
    await cofnijPaczke(c.paczka, c.opis, c.ids);
    return;
  }
}

/** Ctrl+Y albo Ctrl+Shift+Z: ponawia ostatnio cofnięte działanie (z `notatka` najnowszy krok tej notatki). */
export async function ponowOstatnie({ notatka = null } = {}) {
  for (;;) {
    const i = ostatni(S.ponow, notatka);
    if (i < 0) {
      if (!notatka) toast('Nie ma nic do ponowienia');
      return;
    }
    const [c] = S.ponow.splice(i, 1);
    if (c.ponow) {
      if ((await c.ponow()) === false) continue;
      S.cofnij.push(c);
      ogloszenie('Ponowiono');
      return;
    }
    try {
      // Cofnięcie cofnięcia: rdzeń scala je jak każde cofnięcie, więc późniejsze zmiany zostają.
      const r = await wywolaj('cofnij', { paczka: c.paczka });
      zastosujZmiany(r);
      if (r.paczka && r.zmienione && r.zmienione.length) S.cofnij.push({ paczka: r.paczka, opis: c.opis, ids: c.ids });
      await odswiezListe();
      odswiezOtwarty(r.zmienione);
      ogloszenie('Ponowiono');
    } catch (e) {
      bladToast(e);
    }
    return;
  }
}

export function menuKarty(id, gdzie) {
  const n = S.notatki.get(id);
  if (!n) return;
  const t = n.tresc;
  const jedna = [id];
  if (t.kosz) {
    menu(
      [
        { tekst: 'Przywróć z kosza', ikona: 'z-kosza', akcja: () => dzialanie(jedna, { typ: 'do_kosza', wartosc: false }, 'Przywrócono notatkę') },
        { tekst: 'Historia wersji', ikona: 'historia', akcja: () => otworzHistorie(id) },
      ],
      gdzie,
      'Działania notatki',
    );
    return;
  }
  // Prawy klik na jednej z kilku zaznaczonych: kolor dla wszystkich zaznaczonych.
  const cele = S.zaznaczone.size > 1 && S.zaznaczone.has(id) ? [...S.zaznaczone] : jedna;
  menu(
    [
      { tekst: cele.length > 1 ? 'Kolor zaznaczonych notatek' : 'Kolor notatki', paleta: { kolory: KOLORY_NOTATEK, wartosc: t.kolor || 'DEFAULT', akcja: (k) => zmienKolor(cele, k) } },
      '-',
      { tekst: 'Otwórz', akcja: () => otworzEdytor(id) },
      '-',
      { tekst: t.przypieta ? 'Odepnij' : 'Przypnij', ikona: 'pinezka', akcja: () => dzialanie(jedna, { typ: 'przypnij', wartosc: !t.przypieta }, t.przypieta ? 'Odpięto notatkę' : 'Przypięto notatkę') },
      {
        tekst: 'Przypomnienie…',
        ikona: 'dzwonek',
        akcja: () =>
          menuPrzypomnienia(
            gdzie,
            t.przypomnienie,
            (p) => dzialanie(jedna, { typ: 'przypomnienie', wartosc: p }, p ? tekstPrzypomnienia(p, p.czas) : 'Usunięto przypomnienie'),
            kiedyPrzypomnienie(id, t.przypomnienie),
            {
              zalatw: () => dzialanie(jedna, { typ: 'zalatwione' }, 'Zrobione').then(() => odswiezPrzypomnienia()),
              zaGodzine: Boolean(t.przypomnienie && !t.przypomnienie.powtarzanie && t.przypomnienie.czas <= Date.now()),
            },
          ),
      },
      { tekst: 'Historia wersji', ikona: 'historia', akcja: () => otworzHistorie(id) },
      { tekst: 'Kopiuj tekst', ikona: 'kopiuj', akcja: () => kopiujNotatke(n) },
      S.ustawienia.zaznaczanie !== false ? { tekst: 'Zaznacz', ikona: 'zaznacz', akcja: () => przelaczZaznaczenie(id) } : null,
      '-',
      t.archiwum
        ? { tekst: 'Przywróć z archiwum', ikona: 'z-archiwum', akcja: () => dzialanie(jedna, { typ: 'archiwizuj', wartosc: false }, 'Przywrócono z archiwum') }
        : { tekst: 'Archiwizuj', ikona: 'archiwum', akcja: () => dzialanie(jedna, { typ: 'archiwizuj', wartosc: true }, 'Zarchiwizowano notatkę') },
      { tekst: 'Przenieś do kosza', ikona: 'kosz', akcja: () => dzialanie(jedna, { typ: 'do_kosza', wartosc: true }, 'Przeniesiono do kosza') },
    ],
    gdzie,
    'Działania notatki',
  );
}

export async function kopiujNotatke(n) {
  const t = n.tresc;
  const tekst = [t.tytul, tekstNotatki(t)].filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(tekst);
    toast('Skopiowano do schowka');
  } catch {
    toast('Nie udało się skopiować – schowek jest niedostępny');
  }
}

// --- obsługa zdarzeń na liście (delegacja) ---

/**
 * Otwiera notatkę z listy obok. Kliknięcie zostawia fokus na liście (strzałki dalej zmieniają
 * notatkę, a na telefonie nie wyskakuje klawiatura); Enter przenosi kursor do tekstu.
 */
function otworzZListy(id, doTekstu) {
  return otworzEdytor(id, { bezFokusu: !doTekstu });
}

export function podepnijListe() {
  const kont = $('#sekcje');
  kont.addEventListener('click', (ev) => {
    const k = ev.target.closest('.wpis');
    if (!k) return;
    const id = k.dataset.id;
    if (S.zaznaczone.size || ev.ctrlKey || ev.metaKey || ev.shiftKey) {
      if (S.ustawienia.zaznaczanie !== false) przelaczZaznaczenie(id);
      return;
    }
    otworzZListy(id, false);
  });
  kont.addEventListener('contextmenu', (ev) => {
    const k = ev.target.closest('.wpis');
    if (!k) return;
    ev.preventDefault();
    menuKarty(k.dataset.id, { x: ev.clientX, y: ev.clientY });
  });
  kont.addEventListener('keydown', (ev) => {
    const k = ev.target.closest('.wpis');
    if (!k || ev.target !== k) return;
    const id = k.dataset.id;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (S.zaznaczone.size) przelaczZaznaczenie(id);
      else otworzZListy(id, true);
    } else if (ev.key === ' ') {
      ev.preventDefault();
      if (S.ustawienia.zaznaczanie !== false) przelaczZaznaczenie(id);
    } else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault();
      menuKarty(id, k);
    } else if (ev.key === 'Delete') {
      ev.preventDefault();
      const ids = S.zaznaczone.size ? [...S.zaznaczone] : [id];
      dzialanie(ids, { typ: 'do_kosza', wartosc: true }, `Przeniesiono do kosza ${liczba(ids.length, 'notatkę', 'notatki', 'notatek')}`);
    } else if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && ev.altKey && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey) {
      // Alt+↑ ↓: przesunięcie notatki w jej sekcji (ręczna kolejność, jak przeciąganie myszą).
      ev.preventDefault();
      if (przestawialne()) przesunKlawiatura(k, ev.key === 'ArrowUp' ? -1 : 1);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key) && !ev.altKey && !ev.ctrlKey) {
      ev.preventDefault();
      przejdz(k, ev.key);
    }
  });
  // Przeciąganie kafelków myszą: kreska w kolorze akcentu pokazuje, gdzie stanie notatka, Escape przerywa.
  // Zdarzenia na całej kolumnie, żeby dało się upuścić także pod ostatnim kafelkiem.
  const kolumnaListy = kolumna();
  kont.addEventListener('dragstart', (ev) => {
    const k = ev.target instanceof Element ? ev.target.closest('.wpis') : null;
    if (!k || !k.draggable || !ev.dataTransfer || !przestawialne()) return;
    ciagniety = { id: k.dataset.id, wpisy: k.parentElement, el: k };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(TYP_KAFLA, k.dataset.id);
    // Obraz przeciągania to cały kafelek, więc przygaszamy go dopiero po zrobieniu obrazu.
    requestAnimationFrame(() => {
      if (ciagniety && ciagniety.el === k) k.classList.add('przeciagana');
    });
  });
  kolumnaListy.addEventListener('dragover', (ev) => {
    if (!ciagniety) return;
    const cel = celPod(ev.clientY);
    pokazCel(cel);
    if (!cel) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    przewinPrzyKrawedzi(ev.clientY);
  });
  kolumnaListy.addEventListener('drop', (ev) => {
    if (!ciagniety) return;
    ev.preventDefault();
    const cel = celUpuszczenia;
    const c = ciagniety;
    pokazCel(null);
    if (cel) upusc(c, cel);
  });
  kont.addEventListener('dragend', () => {
    pokazCel(null);
    if (ciagniety) ciagniety.el.classList.remove('przeciagana');
    ciagniety = null;
  });
  // Dorysowywanie przy przewijaniu (raz na klatkę, gdy do końca zostało mniej niż ~2 ekrany).
  const lista = kolumna();
  let czekaPrzewin = false;
  lista.addEventListener(
    'scroll',
    () => {
      if (czekaPrzewin) return;
      czekaPrzewin = true;
      requestAnimationFrame(() => {
        czekaPrzewin = false;
        if (zostaloDoNarysowania() && lista.scrollHeight - lista.scrollTop - lista.clientHeight < 1200) dorysuj(PARTIA);
        // Przewinięcie listy wraca po ponownym uruchomieniu (js/app.js, wrocDoPracy).
        zapamietajMiejsce({ lista: Math.round(lista.scrollTop) });
      });
    },
    { passive: true },
  );
  wysokoscListy = lista.clientHeight;
  new ResizeObserver((w) => {
    wysokoscListy = Math.round(w[0].contentRect.height) || wysokoscListy;
  }).observe(lista);
}

let timerStrzalki = null;

/** Strzałki w górę i w dół, Home i End po wierszach listy. */
function przejdz(k, klawisz) {
  let wpisy = $$('#sekcje .wpis');
  const i = wpisy.indexOf(k);
  let j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: wpisy.length - 1 }[klawisz];
  if (j >= wpisy.length && zostaloDoNarysowania()) {
    dorysuj(PARTIA);
    wpisy = $$('#sekcje .wpis');
  }
  const cel = wpisy[j];
  if (j < 0 || !cel) return;
  ustawPrzystanek(cel);
  cel.focus();
  cel.scrollIntoView({ block: 'nearest' });
  // Na szerokim ekranie notatka obok idzie za strzałkami (jak w Apple Notes). Krótkie opóźnienie:
  // przytrzymana strzałka nie otwiera po drodze każdej notatki.
  if (!waski() && !S.zaznaczone.size) {
    clearTimeout(timerStrzalki);
    timerStrzalki = setTimeout(() => {
      if (document.activeElement === cel) otworzZListy(cel.dataset.id, false);
    }, 150);
  }
}

/** Pierwszy wiersz na liście (Enter w wyszukiwarce, strzałka w dół). */
export function pierwszyWpis() {
  return $('#sekcje .wpis');
}
