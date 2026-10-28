// Karteczka na pulpicie (Windows): jedna notatka w swoim okienku, w kolorze notatki, nad innymi oknami albo jak zwykłe okno
// (Jacek, 25.10.2026: „Karteczki są fajne, ale muszę być w stanie w którymś momencie zmieniać ich kolor”, „Powinno się
// przypinać jako karteczka i różnić się tabem troszeczkę”). Okno robi 04 --- Windows - Rust i Tauri\src\karteczka.rs (etykieta
// k-<id notatki>), na tym samym rdzeniu co okno Notatek: polecenia „notatka”, „zapisz”, „robocza”, „akcja”, „cofnij”, „karteczki”.
//
// Tytuł i tekst pisze się wprost na kartce, z formatowaniem jak w Notatkach (js/tekstowe.js), a lista ma pola do odhaczania.
// Zapis idzie sam pół sekundy po ostatnim klawiszu, jak w oknie Notatek, a zmiana z Notatek albo z innego urządzenia wchodzi na
// kartkę, gdy nic tu nie czeka na zapis (inaczej rdzeń łączy obie). Kolor, pinezka, „Otwórz w Notatkach” i „Schowaj” stoją
// w pasku u góry, a kolor, przypomnienie i „Odklej z pulpitu” także pod prawym klikiem. Gdy przypomnienie nadejdzie, karteczka
// staje na ekranie, mruga i trzyma się nad innymi oknami, dopóki sprawa czeka (pora na pomarańczowo na dole).
//
// „Nowa karteczka” z panelu przy zegarze to szkic: okienko bez notatki w rdzeniu (rdzeń nie zapisuje pustej notatki). Notatka
// powstaje z pierwszym słowem, w brzoskwini i od razu jako karteczka.

import { wywolaj, nasluchuj, okno, sygnal } from './most.js';
import { el, ikona, $, $$, motywSystemu, opisPory, tekstPrzypomnienia, noweId, ustawDymek } from './pomoc.js';
import { toast, bladToast, ogloszenie, menu } from './ui.js';
import { menuPrzypomnienia } from './wybory.js';
import { podepnijDymki } from './dymki.js';
import { TRESC_PUSTA } from './stan.js';
import { KOLORY_PALETY, trescPola, ustawHtmlPola, htmlZTekstu, czysc, skrotFormatu, formatuj, naprawTabele, ustawZaznaczenie } from './tekstowe.js';
import { swiatloPrzyciskow } from './guziki.js';

document.documentElement.dataset.motyw = motywSystemu();
addEventListener('error', (e) => sygnal('blad_ui', { tekst: `karteczka: ${e.message} (${e.filename}:${e.lineno})` }));
addEventListener('unhandledrejection', (e) => sygnal('blad_ui', { tekst: `karteczka: ${String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)}` }));

const KOLORY = KOLORY_PALETY.map(([k, n]) => [k, n]);
/** Zapis wersji po ostatnim klawiszu (ms), jak w oknie Notatek. */
const OPOZNIENIE = 500;
/** Formatowanie ze skrótów, które karteczka przyjmuje (rozmiary pisma zmienia się w Notatkach). */
const FORMATY = new Set(['pogrubienie', 'kursywa', 'podkreslenie', 'przekreslenie', 'kod', 'wyczysc']);

const K = {
  id: '',
  etykieta: '',
  szkic: false,
  istnieje: false,
  baza: null,
  tresc: null,
  zmieniona: false,
  timer: null,
  zapis: null,
  doOdswiezenia: false,
  kolorOkna: null,
  // Pinezka: nad innymi oknami także wtedy, gdy nic nie czeka (pamięta ten komputer, karteczka.rs).
  wierzch: true,
  naWierzchu: null,
  // Pora przypomnienia z rdzenia (polecenie „karteczki”): wystąpienie, które czeka, albo najbliższe.
  czas: null,
  czeka: false,
  // Ctrl+Z i Ctrl+Y poza polami tekstu: { opis, paczka } działań (kolor, pora, Zrobione, odklejenie).
  cofnij: [],
  ponow: [],
};
// Do testów (narzedzia\test-karteczki.ps1).
window.__karteczka = K;

function nazwaKoloru(k) {
  return (KOLORY.find(([x]) => x === k) || KOLORY[0])[1];
}

/** Treść do zapisu bez miejsca na liście: karteczka nie przestawia notatki w Notatkach (silnik.rs, zapisz). */
function doZapisu(t) {
  const { pozycja, ...reszta } = t;
  return reszta;
}

/** To, co widać na kartce. Inna wartość – kartka rysuje się od nowa. */
function porownanie(t) {
  return JSON.stringify([t.tytul, t.tekst, t.tekst_html || null, t.jest_lista, t.lista, t.kolor, t.przypomnienie || null]);
}

function przypomnienie() {
  const p = K.tresc && K.tresc.przypomnienie;
  return p && !p.zrobione ? p : null;
}

// --- zapis ---

let roboczaWDrodze = false;
let roboczaCzeka = false;
/** Kopia robocza wpisywanego tekstu (po awarii wraca jako wersja) – najwyżej jedna w drodze, ostatnia wygrywa. */
async function robocza() {
  if (roboczaWDrodze) {
    roboczaCzeka = true;
    return;
  }
  roboczaWDrodze = true;
  try {
    do {
      roboczaCzeka = false;
      await wywolaj('robocza', { id: K.id, baza: K.baza, tresc: doZapisu(K.tresc) });
    } while (roboczaCzeka);
  } catch (e) {
    console.error('karteczka robocza', e);
  } finally {
    roboczaWDrodze = false;
  }
}

function zmiana() {
  K.zmieniona = true;
  robocza();
  clearTimeout(K.timer);
  K.timer = setTimeout(() => zapisz(), OPOZNIENIE);
}

/** Wersja notatki (kolejkowana – nigdy dwie naraz). Zwraca obietnicę końca zapisu. */
function zapisz() {
  clearTimeout(K.timer);
  if (!K.zmieniona) return K.zapis || Promise.resolve();
  K.zmieniona = false;
  const tresc = doZapisu(structuredClone(K.tresc));
  const poprzedni = K.zapis || Promise.resolve();
  const ten = poprzedni.then(async () => {
    try {
      const r = await wywolaj('zapisz', { id: K.id, baza: K.baza, tresc });
      if (r.notatka) {
        K.istnieje = true;
        K.szkic = false;
        if (!K.zmieniona) {
          K.baza = r.notatka.glowa;
          // Rdzeń połączył zapis ze zmianą z Notatek albo innego urządzenia – kartka pokazuje wynik.
          if (porownanie(r.notatka.tresc) !== porownanie(K.tresc)) {
            K.tresc = structuredClone(r.notatka.tresc);
            rysuj();
          }
        } else K.baza = r.wersja || r.notatka.glowa;
        rysujPrzyciski();
      }
    } catch (e) {
      K.zmieniona = true;
      bladToast(e);
    } finally {
      if (K.zapis === ten) {
        K.zapis = null;
        if (K.doOdswiezenia) {
          K.doOdswiezenia = false;
          pobierz();
        }
      }
    }
  });
  K.zapis = ten;
  return ten;
}

/** Notatka z rdzenia na kartkę, gdy nic tu nie czeka na zapis. Inaczej później: zapis i tak połączy obie wersje. */
function przyjmij(n) {
  if (!n || n.id !== K.id || !K.tresc) return;
  if (K.zmieniona || K.zapis) {
    K.doOdswiezenia = true;
    return;
  }
  K.istnieje = true;
  K.szkic = false;
  K.baza = n.glowa;
  const inna = porownanie(n.tresc) !== porownanie(K.tresc);
  K.tresc = structuredClone(n.tresc);
  if (inna) rysuj();
  rysujPrzyciski();
  odswiezPore();
}

async function pobierz() {
  try {
    const r = await wywolaj('notatka', { id: K.id });
    if (r.notatka) przyjmij(r.notatka);
  } catch (e) {
    console.error('karteczka', e);
  }
}

function zZewnatrz(z) {
  const n = (z.zmienione || []).find((x) => x.id === K.id);
  if (n) przyjmij(n);
}

// --- rysowanie ---

function rysuj() {
  const t = K.tresc;
  const kolor = t.kolor || 'DEFAULT';
  $('#kartka').dataset.kolor = kolor;
  if (K.kolorOkna !== kolor) {
    K.kolorOkna = kolor;
    okno('tlo', { kolor });
  }
  const tyt = $('#k-tytul');
  if (tyt.value !== (t.tytul || '')) {
    const aktywne = document.activeElement === tyt;
    const [a, b] = [tyt.selectionStart, tyt.selectionEnd];
    tyt.value = t.tytul || '';
    if (aktywne) tyt.setSelectionRange(Math.min(a, tyt.value.length), Math.min(b, tyt.value.length));
  }
  const pole = $('#k-tekst');
  pole.hidden = Boolean(t.jest_lista);
  $('#k-lista').hidden = !t.jest_lista;
  if (t.jest_lista) rysujListe();
  else ustawHtmlPola(pole, t.tekst_html || htmlZTekstu(t.tekst || ''));
  rysujPore();
  rysujPinezke();
  rysujPrzyciski();
}

function rysujPrzyciski() {
  $('#k-otworz').disabled = !K.istnieje;
}

function rysujPinezke() {
  const b = $('#k-wierzch');
  b.classList.toggle('wlaczony', K.wierzch);
  b.setAttribute('aria-pressed', String(K.wierzch));
  ustawDymek(b, K.wierzch ? 'Nie trzymaj nad innymi oknami' : 'Trzymaj nad innymi oknami');
}

// --- lista z polami ---

function rysujListe(fokus = null) {
  const ul = $('#k-lista');
  const a = document.activeElement;
  if (!fokus && a && a.classList && a.classList.contains('k-poz-tekst') && ul.contains(a)) {
    fokus = { id: a.closest('.k-poz').dataset.id, od: a.selectionStart, do: a.selectionEnd };
  }
  const l = K.tresc.lista || [];
  const kolejne = [...l.filter((p) => !p.zrobione), ...l.filter((p) => p.zrobione)];
  const dodaj = el('button.k-dodaj.szklany', { type: 'button', onclick: () => dodajPozycje(null) }, ikona('plus'), 'Dodaj pozycję');
  ul.replaceChildren(...kolejne.map(wierszPozycji), el('li.k-dodaj-wiersz', null, dodaj));
  if (fokus) {
    const i = ul.querySelector(`.k-poz[data-id="${CSS.escape(fokus.id)}"] .k-poz-tekst`);
    if (i) {
      i.focus();
      const n = i.value.length;
      i.setSelectionRange(Math.min(fokus.od ?? n, n), Math.min(fokus.do ?? n, n));
    }
  }
}

/** Nowa pusta pozycja za `po` (bez niej – za ostatnią nieodhaczoną) i kursor w niej. */
function dodajPozycje(po) {
  const l = K.tresc.lista || (K.tresc.lista = []);
  const nowa = { id: noweId(), tekst: '', zrobione: false };
  const otwarte = l.filter((p) => !p.zrobione);
  const i = po ? l.indexOf(po) : otwarte.length ? l.indexOf(otwarte[otwarte.length - 1]) : -1;
  l.splice(i + 1, 0, nowa);
  zmiana();
  rysujListe({ id: nowa.id });
}

function wierszPozycji(p) {
  const pole = el('input.k-poz-tekst', { type: 'text', 'aria-label': 'Pozycja listy', autocomplete: 'off', enterkeyhint: 'next' });
  pole.value = p.tekst || '';
  pole.addEventListener('input', () => {
    p.tekst = pole.value;
    zmiana();
  });
  pole.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      dodajPozycje(p);
    } else if (ev.key === 'Backspace' && !pole.value && (K.tresc.lista || []).length > 1) {
      // Pusta pozycja znika, a kursor idzie do poprzedniej, jak w Notatkach.
      ev.preventDefault();
      const widoczne = $$('#k-lista .k-poz').map((w) => w.dataset.id);
      const j = widoczne.indexOf(p.id);
      K.tresc.lista = K.tresc.lista.filter((x) => x !== p);
      zmiana();
      const cel = widoczne[j - 1] || widoczne[j + 1];
      rysujListe(cel ? { id: cel } : null);
    }
  });
  const kolko = el(
    'button.k-pole-wyboru',
    {
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(Boolean(p.zrobione)),
      'aria-label': p.zrobione ? `Odznacz: ${p.tekst}` : `Zrobione: ${p.tekst}`,
      onclick: () => {
        p.zrobione = !p.zrobione;
        zmiana();
        rysujListe();
      },
    },
    ikona('ptaszek'),
  );
  return el(`li.k-poz${p.zrobione ? '.zrobiona' : ''}`, { dataset: { id: p.id } }, kolko, pole);
}

// --- tekst ---

/** Treść z pola do stanu: sformatowany HTML i czysty tekst wyliczony z niego (notatka bez formatowania trzyma sam tekst). */
function zapiszZPola() {
  const { html, tekst, formatowanie } = trescPola($('#k-tekst'));
  const t = K.tresc;
  const noweHtml = formatowanie ? html : null;
  if (t.tekst === tekst && (t.tekst_html ?? null) === noweHtml) return;
  t.tekst = tekst;
  t.tekst_html = noweHtml;
  zmiana();
}

// --- pora przypomnienia ---

async function odswiezPore() {
  if (K.istnieje) {
    try {
      const r = await wywolaj('karteczki');
      const k = (r.karteczki || []).find((x) => x.id === K.id);
      K.czas = k && k.czas != null ? k.czas : null;
      K.czeka = Boolean(k && k.czeka);
    } catch (e) {
      console.error('karteczka pora', e);
    }
  } else {
    K.czas = null;
    K.czeka = false;
  }
  rysujPore();
  ustawWierzch();
}

function rysujPore() {
  const b = $('#k-pora');
  const p = przypomnienie();
  if (!p || K.czas == null) {
    b.hidden = true;
    b.classList.remove('czeka');
    return;
  }
  const opis = opisPory({ czas: K.czas, czeka: K.czeka, przypomnienie: p });
  b.hidden = false;
  b.classList.toggle('czeka', K.czeka);
  b.querySelector('span').textContent = opis;
  b.setAttribute('aria-label', `${opis}. Zmień porę`);
}

/** Nad innymi oknami: pinezka albo sprawa, która czeka. Do okna idzie tylko prawdziwa zmiana. */
function ustawWierzch() {
  const tak = K.wierzch || K.czeka;
  if (tak === K.naWierzchu) return;
  K.naWierzchu = tak;
  okno('wierzch', { wl: tak });
}

function menuPory(kotwica = $('#k-pora')) {
  const p = przypomnienie();
  menuPrzypomnienia(kotwica, p, (np) => ustawPrzypomnienie(np), K.czas ?? (p ? p.czas : null), { zalatw: p ? () => zalatw() : null, zaGodzine: K.czeka });
}

// --- działania (jedna paczka rdzenia = jedno Ctrl+Z) ---

function zapamietaj(wpis) {
  K.cofnij.push(wpis);
  if (K.cofnij.length > 50) K.cofnij.shift();
  K.ponow = [];
  return wpis;
}

/** Działanie rdzenia na tej notatce. Zaległy tekst idzie najpierw, żeby działanie nie zgubiło ostatnich klawiszy. */
async function dzialaj(akcja, opis) {
  await zapisz();
  if (!K.istnieje) return null;
  const r = await wywolaj('akcja', { ids: [K.id], akcja, opis });
  for (const n of r.zmienione || []) przyjmij(n);
  return zapamietaj({ opis, paczka: r.paczka });
}

async function zmienKolor(k) {
  if ((K.tresc.kolor || 'DEFAULT') === k) return;
  if (!K.istnieje) {
    K.tresc.kolor = k;
    rysuj();
    return;
  }
  // Kolor od razu na kartce, a rdzeń potwierdza go wersją.
  $('#kartka').dataset.kolor = k;
  try {
    const w = await dzialaj({ typ: 'kolor', wartosc: k }, `kolor: ${nazwaKoloru(k).toLowerCase()}`);
    if (w) ogloszenie(`Kolor: ${nazwaKoloru(k)}`);
  } catch (e) {
    bladToast(e);
  }
  rysuj();
}

async function ustawPrzypomnienie(np) {
  if (!K.istnieje) {
    K.tresc.przypomnienie = np;
    zmiana();
    await zapisz();
    await odswiezPore();
    return;
  }
  try {
    const w = await dzialaj({ typ: 'przypomnienie', wartosc: np }, np ? 'zmiana pory' : 'usunięcie przypomnienia');
    if (w) toast(np ? tekstPrzypomnienia(np, np.czas) : 'Bez przypomnienia', { przycisk: 'Cofnij', akcja: () => cofnijWpis(w), czas: 8000 });
  } catch (e) {
    bladToast(e);
  }
  await odswiezPore();
}

/** „Zrobione”: jednorazowe przypomnienie wykonane, powtarzane przechodzi na następną porę. Karteczka zostaje na pulpicie. */
async function zalatw() {
  try {
    const w = await dzialaj({ typ: 'zalatwione' }, 'Zrobione');
    if (w) {
      ogloszenie('Zrobione');
      toast('Zrobione', { przycisk: 'Cofnij', akcja: () => cofnijWpis(w), czas: 8000 });
    }
  } catch (e) {
    bladToast(e);
  }
  await odswiezPore();
}

/** „Odklej z pulpitu”: notatka zostaje w Notatkach, a okienko znika (karteczka.rs, sprawdz). Wraca z „Przyklej na pulpicie”. */
async function odklej() {
  try {
    await dzialaj({ typ: 'karteczka', wartosc: false }, 'odklejenie z pulpitu');
  } catch (e) {
    bladToast(e);
  }
}

async function cofnijWpis(wpis = K.cofnij[K.cofnij.length - 1]) {
  if (!wpis) return;
  K.cofnij = K.cofnij.filter((w) => w !== wpis);
  try {
    await zapisz();
    const r = await wywolaj('cofnij', { paczka: wpis.paczka });
    for (const n of r.zmienione || []) przyjmij(n);
    if (r.paczka) K.ponow.push({ opis: wpis.opis, paczka: r.paczka });
    ogloszenie(`Cofnięto: ${wpis.opis}`);
  } catch (e) {
    bladToast(e);
  }
  await odswiezPore();
}

async function ponowWpis() {
  const wpis = K.ponow.pop();
  if (!wpis) return;
  try {
    const r = await wywolaj('cofnij', { paczka: wpis.paczka });
    for (const n of r.zmienione || []) przyjmij(n);
    if (r.paczka) K.cofnij.push({ opis: wpis.opis, paczka: r.paczka });
    ogloszenie(`Ponowiono: ${wpis.opis}`);
  } catch (e) {
    bladToast(e);
  }
  await odswiezPore();
}

// --- okno ---

async function przelaczWierzch() {
  K.wierzch = !K.wierzch;
  rysujPinezke();
  ogloszenie(K.wierzch ? 'Karteczka zostaje nad innymi oknami' : 'Karteczka jak zwykłe okno');
  await okno('przypnij', { wl: K.wierzch });
  ustawWierzch();
}

/** X i Ctrl+W: najpierw zaległy tekst, potem okienko znika (wraca z panelu przy zegarze albo z Notatek). */
async function schowaj() {
  try {
    await zapisz();
  } catch {
    /* błąd zapisu już pokazał komunikat */
  }
  okno('ukryj');
}

async function otworzWNotatkach() {
  await zapisz();
  if (K.istnieje) sygnal('pokaz_notatke', { id: K.id });
}

function mrugnij() {
  const k = $('#kartka');
  k.classList.remove('mruga');
  void k.offsetWidth;
  k.classList.add('mruga');
  setTimeout(() => k.classList.remove('mruga'), 3200);
}

function menuKoloru(kotwica) {
  menu([{ tekst: 'Kolor karteczki', paleta: { kolory: KOLORY, wartosc: K.tresc.kolor || 'DEFAULT', akcja: (k) => zmienKolor(k) } }], kotwica, 'Kolor karteczki');
}

/** Prawy klik na kartce (poza polami tekstu, gdzie zostaje menu systemu: wytnij, kopiuj, wklej). */
function menuKartki(gdzie) {
  menu(
    [
      { tekst: 'Kolor karteczki', paleta: { kolory: KOLORY, wartosc: K.tresc.kolor || 'DEFAULT', akcja: (k) => zmienKolor(k) } },
      '-',
      { tekst: przypomnienie() ? 'Przypomnienie…' : 'Przypomnij…', ikona: 'dzwonek', akcja: () => menuPory(gdzie) },
      K.istnieje ? { tekst: 'Otwórz w Notatkach', ikona: 'notatka', akcja: () => otworzWNotatkach() } : null,
      K.istnieje ? '-' : null,
      K.istnieje ? { tekst: 'Odklej z pulpitu', ikona: 'karteczka', akcja: () => odklej() } : null,
    ],
    gdzie,
    'Karteczka',
  );
}

function podepnij() {
  podepnijDymki();
  swiatloPrzyciskow();
  $('#k-kolor').addEventListener('click', (ev) => menuKoloru(ev.currentTarget));
  $('#k-otworz').addEventListener('click', () => otworzWNotatkach());
  $('#k-wierzch').addEventListener('click', () => przelaczWierzch());
  $('#k-zamknij').addEventListener('click', () => schowaj());
  $('#k-pora').addEventListener('click', (ev) => menuPory(ev.currentTarget));
  const tyt = $('#k-tytul');
  tyt.addEventListener('input', () => {
    K.tresc.tytul = tyt.value;
    zmiana();
  });
  tyt.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    if (K.tresc.jest_lista) {
      const p = $('#k-lista .k-poz-tekst');
      if (p) p.focus();
      else dodajPozycje(null);
    } else {
      const pole = $('#k-tekst');
      pole.focus();
      ustawZaznaczenie(pole, 0);
    }
  });
  const pole = $('#k-tekst');
  pole.addEventListener('input', () => zapiszZPola());
  // Wklejanie: pogrubienia i kolory zostają, ale tylko znane znaczniki (bez skryptów, obrazów z sieci i odnośników).
  pole.addEventListener('paste', (ev) => {
    const dane = ev.clipboardData;
    if (!dane) return;
    ev.preventDefault();
    if ([...(dane.files || [])].some((f) => f.type.startsWith('image/'))) {
      toast('Obraz dodasz w Notatkach');
      return;
    }
    const html = dane.getData('text/html');
    const czysty = html ? czysc(html, { wklejka: true }) : '';
    const wklej = czysty || htmlZTekstu(dane.getData('text/plain').replace(/\r\n?/g, '\n'));
    if (wklej) document.execCommand('insertHTML', false, wklej);
    naprawTabele(pole);
    zapiszZPola();
  });
  pole.addEventListener('drop', (ev) => {
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) ev.preventDefault();
  });
  document.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest && ev.target.closest('input, [contenteditable="true"]')) return;
    ev.preventDefault();
    if (ev.target.closest && ev.target.closest('#kartka')) menuKartki({ x: ev.clientX, y: ev.clientY });
  });
  document.addEventListener('keydown', (ev) => {
    const cel = ev.target;
    const wPolu = cel instanceof HTMLInputElement || (cel instanceof HTMLElement && cel.isContentEditable);
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === 'w') {
        ev.preventDefault();
        schowaj();
        return;
      }
      if (k === 's') {
        ev.preventDefault();
        zapisz();
        return;
      }
      // W polu Ctrl+Z cofa pisanie, jak w Windows. Poza polem cofa i ponawia działania karteczki.
      if ((k === 'z' || k === 'y') && !wPolu) {
        ev.preventDefault();
        if (k === 'z' && !ev.shiftKey) cofnijWpis();
        else ponowWpis();
        return;
      }
    }
    if (cel === pole) {
      const f = skrotFormatu(pole, ev);
      if (f && FORMATY.has(f)) {
        ev.preventDefault();
        formatuj(pole, f);
        zapiszZPola();
      }
    }
  });
  // Okienko traci fokus: zaległy tekst od razu, bez czekania pół sekundy.
  addEventListener('blur', () => zapisz());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    document.documentElement.dataset.motyw = motywSystemu();
    K.kolorOkna = null;
    if (K.tresc) rysuj();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && K.istnieje) odswiezPore();
  });
}

async function start() {
  podepnij();
  const s = await okno('stan');
  if (!s || !s.id) return;
  K.id = s.id;
  K.etykieta = `k-${s.id}`;
  K.wierzch = s.wierzch !== false;
  K.naWierzchu = K.wierzch;
  K.szkic = Boolean(s.szkic);
  if (K.szkic) {
    K.tresc = { ...structuredClone(TRESC_PUSTA), kolor: s.kolor || 'ORANGE', karteczka: true };
    K.kolorOkna = K.tresc.kolor;
  } else {
    const r = await wywolaj('notatka', { id: K.id });
    if (!r.notatka) return;
    K.tresc = structuredClone(r.notatka.tresc);
    K.baza = r.notatka.glowa;
    K.istnieje = true;
    K.kolorOkna = K.tresc.kolor || 'DEFAULT';
  }
  rysuj();
  if (K.szkic) $('#k-tytul').focus();
  await odswiezPore();
  await nasluchuj('zmiany', (z) => zZewnatrz(z));
  // Zmiana z okna Notatek albo z innej karteczki (polecenia.rs); własne zmiany kartka już ma.
  await nasluchuj('zmiany-okna', (z) => {
    if (z.zrodlo !== K.etykieta) zZewnatrz(z);
  });
  // Przypomnienie nadeszło albo wraca (karteczka.rs, przypomnij): ta karteczka mruga i staje nad innymi oknami.
  await nasluchuj('karteczka', (k) => {
    if (!k || k.id !== K.id) return;
    odswiezPore();
    if (k.mrugnij) mrugnij();
  });
  // Co 30 s: napis pory („Za 14 minut”) i sprawa, której pora właśnie nadeszła.
  setInterval(() => {
    if (K.istnieje) odswiezPore();
  }, 30000);
}

if (!window.__karteczkaTest) start();