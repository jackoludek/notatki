// Ustawienia (działy po lewej, listy w ramkach, przełączniki), skróty klawiszowe, O programie,
// import z Google Keep, eksport, migawki, synchronizacja.

import { wywolaj, platforma, naTauri } from './most.js';
import { el, ikona, $, liczba, rozmiar, pelnaData, kiedy, motywSystemu } from './pomoc.js';
import { S, zapamietajCofniecie } from './stan.js';
import { toast, bladToast, ogloszenie, waski } from './ui.js';
import { uporzadkuj, przestawiane } from './kolejnosc.js';
import * as Powiekszenie from './powiekszenie.js';
import { polozenieTekstu, ustawPolozenieTekstu, opisPolozenia, liniePodgladu, ustawLiniePodgladu, opisLiniiPodgladu } from './uchwyty.js';

// Każda dodatkowa funkcja ma przełącznik (wymaganie 10).
const SCHEMAT = [
  {
    id: 'szukanie',
    tytul: 'Wyszukiwanie',
    pozycje: [
      {
        klucz: 'szukaj_tryb',
        typ: 'wybor',
        etykieta: 'Tryb wyszukiwania',
        opis: 'Rozmyty wybacza literówki i brak ogonków',
        opcje: [['rozmyty', 'Rozmyty'], ['dokladny', 'Dokładny']],
      },
      { klucz: 'szukaj_albo_utworz', typ: 'przelacznik', etykieta: 'Szukaj albo utwórz', opis: 'Enter w wyszukiwarce tworzy notatkę, gdy nic nie pasuje' },
    ],
  },
  {
    id: 'uruchamianie',
    tytul: 'Uruchamianie',
    tylko: ['windows'],
    pozycje: [
      { klucz: 'autostart', typ: 'przelacznik', etykieta: 'Uruchamiaj z systemem', opis: 'Notatki czekają w zasobniku i otwierają się od razu' },
      { klucz: 'dwuklik', typ: 'przelacznik', etykieta: 'Podwójne kliknięcie środkowym przyciskiem', opis: 'Otwiera Notatki z każdego programu' },
      { klucz: 'dwuklik_odstep_ms', typ: 'liczba', etykieta: 'Odstęp między kliknięciami', opis: 'Milisekundy, 150–1000. Windows: 500', min: 150, max: 1000, krok: 10, zalezy: 'dwuklik' },
    ],
  },
  {
    id: 'funkcje',
    tytul: 'Funkcje',
    pozycje: [
      { klucz: 'przypomnienia', typ: 'przelacznik', etykieta: 'Przypomnienia', opis: 'Powiadomienie systemowe o wybranej porze' },
      { klucz: 'przypomnienia_wracaja', typ: 'przelacznik', etykieta: 'Przypomnienie wraca', opis: 'Po 10 minutach i co godzinę od 8 do 21, aż klikniesz „Zrobione”', tylko: ['windows', 'android'] },
    
      { klucz: 'ocr', typ: 'przelacznik', etykieta: 'Tekst z obrazów', opis: 'Szuka też tekstu na obrazach; rozpoznaje go ten komputer', tylko: ['windows'] },
      { klucz: 'wklejanie_obrazow', typ: 'przelacznik', etykieta: 'Wklejanie obrazów', opis: 'Wklejony obraz trafia do notatki albo tworzy nową' },
      { klucz: 'notatki_glosowe', typ: 'przelacznik', etykieta: 'Notatki głosowe', opis: 'Nagrywanie z mikrofonu; z kluczem Soniox także transkrypcja' },
      { klucz: 'wykrywanie_linkow', typ: 'przelacznik', etykieta: 'Wykrywanie linków', opis: 'Adresy WWW w treści pokazują się jako odnośniki' },
      { klucz: 'zaznaczanie', typ: 'przelacznik', etykieta: 'Zaznaczanie wielu notatek', opis: 'Działania na wielu notatkach naraz' },
      { klucz: 'udostepnianie', typ: 'przelacznik', etykieta: 'Udostępnianie do Notatek', opis: 'Tekst, linki i obrazy z innych aplikacji trafiają do nowej notatki', tylko: ['android'] },
    ],
  },
  {
    id: 'bezpieczenstwo',
    tytul: 'Blokada',
    tylko: ['android'],
    pozycje: [
      {
        klucz: 'blokada',
        typ: 'wybor',
        etykieta: 'Blokada aplikacji',
        opis: 'Przy powrocie do aplikacji po minucie w tle',
        opcje: [['brak', 'Brak'], ['odcisk', 'Odcisk palca'], ['gest', 'Własny gest: trzy stuknięcia i przytrzymanie']],
      },
    ],
  },
  {
    id: 'transkrypcja',
    tytul: 'Transkrypcja',
    tylko: ['windows', 'android'],
    pozycje: [{ klucz: 'klucz_soniox', typ: 'sekret', etykieta: 'Klucz Soniox', opis: 'Do transkrypcji notatek głosowych (ten sam co w iSpoke)' }],
  },
];

const NAZWY_MODELI = {
  'claude-opus-5-5': 'Claude Opus 5.5 (zalecany)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (szybszy)',
  'claude-haiku-4-5': 'Claude Haiku 4.5 (najszybszy)',
  'claude-fable-5-1': 'Claude Fable 5.1 (najdokładniejszy, droższy)',
};

function widoczne(obiekt) {
  return !obiekt.tylko || obiekt.tylko.includes(platforma);
}

async function ustaw(klucz, wartosc) {
  try {
    const r = await wywolaj('ustaw', { klucz, wartosc });
    S.ustawienia = r.ustawienia;
    zastosujUstawienia();
    const { aiPoZmianieUstawien } = await import('./ai.js');
    aiPoZmianieUstawien();
    return true;
  } catch (e) {
    bladToast(e);
    return false;
  }
}

// Zmiana motywu w systemie w trakcie pracy: okno przemalowuje się od razu, bez restartu.
// Nasłuch podpinamy raz.
let motywPodpiety = false;
function podepnijMotywSystemu() {
  if (motywPodpiety) return;
  motywPodpiety = true;
  const zaSystemem = () => {
    if (document.documentElement.dataset.motyw !== motywSystemu()) zastosujUstawienia();
  };
  // Windows i przeglądarka: zmiana w systemie przychodzi przez media query.
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', zaSystemem);
  // Android: MainActivity.onConfigurationChanged woła to przy zmianie motywu telefonu.
  window.__notatkiMotywSystemu = zaSystemem;
  // Powrót do aplikacji (albo karty): motyw mógł się zmienić, gdy była w tle.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) zaSystemem();
  });
}

/** Ustawienia widoczne od razu w interfejsie. */
export function zastosujUstawienia() {
  const u = S.ustawienia;
  S.rozmyty = u.szukaj_tryb !== 'dokladny';
  document.body.classList.toggle('bez-paska', u.pasek_boczny === false);
  // Motyw zawsze za systemem i zmienia się razem z nim – bez przełącznika i bez zapamiętanego wyboru.
  const motyw = motywSystemu();
  document.documentElement.dataset.motyw = motyw;
  podepnijMotywSystemu();
  // Przeglądarka (pasek adresu na telefonie, okno zainstalowanej aplikacji web): kolor nagłówka.
  const kolor = getComputedStyle(document.documentElement).getPropertyValue('--plyta').trim();
  if (kolor) {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      m.removeAttribute('media');
      m.content = kolor;
    }
  }
  // Android: kolor tła pod paskami systemu i kolor ikon na paskach idą za motywem aplikacji,
  // a przełącznik udostępniania dodaje iKeeper do systemowego „Udostępnij” albo go stamtąd zdejmuje.
  if (window.NotatkiAndroid) {
    if (window.NotatkiAndroid.motyw) window.NotatkiAndroid.motyw(motyw === 'ciemny');
    if (window.NotatkiAndroid.udostepnianie) window.NotatkiAndroid.udostepnianie(u.udostepnianie !== false);
  }
}

export async function przelaczUstawienie(klucz, wartosc) {
  return ustaw(klucz, wartosc);
}

/** Wiersz ustawienia z kluczem `data-klucz`: po nim wiersz wraca na swoje miejsce w grupie (js/kolejnosc.js, zadanie 27). */
function wierszUstawienia(p) {
  const w = budujWiersz(p);
  if (w) w.dataset.klucz = p.klucz;
  return w;
}

function budujWiersz(p) {
  const u = S.ustawienia;
  const idPola = `u-${p.klucz}`;
  const tekst = el('div.wiersz-tekst', null, el('label', { for: idPola, tekst: p.etykieta }), p.opis ? el('span.caption.przygaszony', { tekst: p.opis }) : null);
  if (p.typ === 'przelacznik') {
    const s = el('input', { type: 'checkbox', role: 'switch', id: idPola });
    s.checked = u[p.klucz] !== false;
    s.addEventListener('change', async () => {
      const ok = await ustaw(p.klucz, s.checked);
      if (!ok) s.checked = !s.checked;
      odswiezZaleznosci();
    });
    const w = el('div.wiersz', null, tekst, s);
    w.addEventListener('click', (ev) => {
      if (ev.target === w || ev.target.closest('.wiersz-tekst')) {
        if (ev.target.tagName !== 'LABEL') s.click();
      }
    });
    return w;
  }
  if (p.typ === 'wybor') {
    const opcje = p.opcje === 'modele' ? S.modele.map((m) => [m, NAZWY_MODELI[m] || m]) : p.opcje;
    const sel = el('select', { id: idPola }, ...opcje.map(([v, t]) => el('option', { value: v, tekst: t })));
    sel.value = u[p.klucz];
    sel.addEventListener('change', async () => {
      // Blokada odciskiem włącza się dopiero, gdy odcisk na tym telefonie działa.
      if (p.klucz === 'blokada' && platforma === 'android') {
        const { sprawdzBlokade } = await import('./telefon.js');
        if (!(await sprawdzBlokade(sel.value))) {
          sel.value = S.ustawienia.blokada || 'brak';
          return;
        }
      }
      ustaw(p.klucz, sel.value);
    });
    return el('div.wiersz', null, tekst, sel);
  }
  if (p.typ === 'liczba') {
    const pole = el('input', { type: 'number', id: idPola, min: p.min, max: p.max, step: p.krok, dataset: { zalezy: p.zalezy || '' } });
    pole.value = u[p.klucz];
    const zapisz = async () => {
      const v = Math.round(Number(pole.value));
      if (!Number.isFinite(v) || v === u[p.klucz]) return;
      // Nowa wartość stoi w polu i działa od razu – komunikat tylko dla czytnika ekranu.
      if (!(await ustaw(p.klucz, v))) pole.value = S.ustawienia[p.klucz];
      else ogloszenie('Zapisano');
    };
    pole.addEventListener('change', zapisz);
    pole.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        zapisz();
      }
    });
    return el('div.wiersz', null, tekst, pole);
  }
  if (p.typ === 'sekret') {
    const jest = u[`${p.klucz}_ustawiony`];
    const pole = el('input', { type: 'password', id: idPola, placeholder: jest ? 'Ustawiony – wklej nowy, żeby zmienić' : 'Wklej klucz', autocomplete: 'off', spellcheck: 'false' });
    const zapisz = el('button', { type: 'button' }, 'Zapisz');
    zapisz.addEventListener('click', async () => {
      const v = pole.value.trim();
      if (!v) return;
      if (await ustaw(p.klucz, v)) {
        pole.value = '';
        ogloszenie('Zapisano klucz');
        otworzUstawienia(null, true);
      }
    });
    const przyciski = el('div.przyciski', null, pole, zapisz);
    if (jest) {
      przyciski.append(
        el('button.niszczacy', { type: 'button', onclick: async () => { if (await ustaw(p.klucz, '')) { ogloszenie('Usunięto klucz'); otworzUstawienia(null, true); } } }, 'Usuń'),
      );
    }
    return el('div.wiersz', null, tekst, przyciski);
  }
  return null;
}

function odswiezZaleznosci() {
  for (const pole of document.querySelectorAll('#ustawienia-tresc [data-zalezy]')) {
    const z = pole.dataset.zalezy;
    if (z) pole.disabled = S.ustawienia[z] === false;
  }
}

// Działy ustawień. Widać jeden naraz i każdy mieści się w oknie bez przewijania (zasada 12);
// dział bez żadnej grupy na tej platformie znika z listy.
// Każdy dział ma kafelek ikony w swojej barwie, jak w Ustawieniach systemowych Apple i w pasku bocznym (styl.css, „Wygląd
// z Porównywarek AI”). Barwy bez kolorów stanów i fioletu; ta sama rzecz ma wszędzie tę samą ikonę.
const DZIALY = [
  { id: 'ogolne', nazwa: 'Ogólne', ikona: 'ustawienia', barwa: 'szary', grupy: ['szukanie', 'uruchamianie', 'bezpieczenstwo'] },
  // Osobny dział, bo w Ogólnych trzecia grupa nie mieściła się bez przewijania (zasada 12). Położenie tekstu jest
  // wszędzie, a wielkość okna tylko na Windows: w przeglądarce powiększa przeglądarka, na telefonie Android.
  { id: 'wyglad', nazwa: 'Wygląd', ikona: 'paleta', barwa: 'indygo', grupy: ['wyglad'] },
  { id: 'funkcje', nazwa: 'Funkcje', ikona: 'siatka', barwa: 'niebieski', grupy: ['funkcje'] },
  { id: 'synchronizacja', nazwa: 'Synchronizacja', ikona: 'chmura', barwa: 'cyjan', grupy: ['sync', 'serwer'] },
  { id: 'ai', nazwa: 'AI i głos', ikona: 'ai', barwa: 'turkus', grupy: ['ai', 'transkrypcja'] },
  { id: 'dane', nazwa: 'Dane', ikona: 'folder', barwa: 'braz', grupy: ['dane'] },
  { id: 'migawki', nazwa: 'Migawki', ikona: 'historia', barwa: 'mieta', grupy: ['migawki'] },
  { id: 'kopie', nazwa: 'Kopie', ikona: 'kopiuj', barwa: 'niebieski', grupy: ['kopie'] },
  { id: 'o-programie', nazwa: 'O programie', ikona: 'info', barwa: 'szary', grupy: ['o-programie'] },
];
// Wybrany dział. Na wąskim ekranie null znaczy: lista działów na całym ekranie.
let dzial = null;
let grupyUstawien = new Map();
// Układa grupy wybranego działu w zapisanej kolejności (js/kolejnosc.js); podpięte przy pierwszym otwarciu okna.
let ulozGrupy = () => {};
let wszystkieMigawki = false;

/**
 * Okno ustawień. `sekcja` – grupa do pokazania (na przykład 'sync', 'kopie'), a z nią jej dział.
 * `zostawOtwarte` – przerysuj okno, które już jest otwarte (po zmianie), w tym samym dziale.
 */
export async function otworzUstawienia(sekcja = null, zostawOtwarte = false) {
  const d = $('#d-ustawienia');
  const grupy = new Map();
  for (const g of SCHEMAT.filter(widoczne)) {
    const wiersze = g.pozycje.filter(widoczne).map(wierszUstawienia).filter(Boolean);
    if (!wiersze.length) continue;
    grupy.set(
      g.id,
      el('section.grupa', { id: `grupa-${g.id}` }, el('h3.heading', { tekst: g.tytul }), g.opis ? el('p.caption.przygaszony.opis-grupy', { tekst: g.opis }) : null, el('div.lista', null, wiersze)),
    );
  }
  const ai = await grupaAi();
  if (ai) grupy.set('ai', ai);
  grupy.set('sync', await grupaSynchronizacji());
  // Z GitHubem serwer jest zbędny (połączenie z serwerem odpięłoby repozytorium), więc jego grupy nie ma.
  if (platforma === 'windows' && !przezGithuba()) grupy.set('serwer', grupaSerwera());
  for (const s of await grupyDanych()) grupy.set(s.id.replace('grupa-', ''), s);
  grupy.set('o-programie', grupaOProgramie());
  grupy.set('wyglad', grupaWygladu());
  // Pozycje w każdej grupie: chwyt za napis, kolejność osobno w każdej grupie (zadanie 27). Wiersze bez klucza
  // (stan GitHuba, lista migawek, przyciski serwera) stoją na swoim miejscu.
  for (const [id, s] of grupy) {
    for (const l of s.querySelectorAll(':scope > .lista')) {
      przestawiane(l, {
        grupa: `wiersze-${id}`,
        element: '.wiersz[data-klucz]',
        klucz: (w) => w.dataset.klucz,
        uchwyt: ':scope > .wiersz-tekst',
        nazwa: (w) => w.querySelector('.wiersz-tekst > :first-child').textContent,
        wciecie: 16,
      });
    }
  }
  grupyUstawien = grupy;
  const dostepne = dostepneDzialy();
  if (sekcja) dzial = (dostepne.find((x) => x.grupy.includes(sekcja)) || dostepne[0]).id;
  else if (!zostawOtwarte || !d.open) {
    dzial = waski() ? null : dostepne[0].id;
    wszystkieMigawki = false;
  }
  if (dzial && !dostepne.some((x) => x.id === dzial)) dzial = dostepne[0].id;
  if (!dzial && !waski()) dzial = dostepne[0].id;
  if (!d.dataset.podpiete) {
    d.dataset.podpiete = '1';
    // Grupy w dziale: chwyt za nagłówek, kolejność osobno w każdym dziale (zadanie 27).
    ulozGrupy = przestawiane($('#ustawienia-tresc'), {
      grupa: () => `grupy-${dzial}`,
      element: 'section.grupa:has(> h3)',
      klucz: (s) => s.id,
      uchwyt: ':scope > h3',
      fokus: true,
      nazwa: (s) => s.querySelector(':scope > h3').textContent,
      wciecie: 16,
    });
    $('#u-wstecz').addEventListener('click', () => {
      dzial = null;
      pokazDzial(true);
    });
    // Okno zwężone albo powiększone przy otwartych ustawieniach: układ działów idzie za szerokością
    // (wąski – lista działów albo jeden dział ze strzałką wstecz, szeroki – oba obok siebie).
    window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
      if (!d.open) return;
      if (!dzial && !waski()) dzial = dostepneDzialy()[0].id;
      pokazDzial(false);
    });
  }
  pokazDzial(false);
  odswiezZaleznosci();
  if (!d.open && !zostawOtwarte) d.showModal();
}

/** Działy, które mają co pokazać, w kolejności ustawionej przez użytkownika (js/kolejnosc.js). */
function dostepneDzialy() {
  return uporzadkuj('dzialy', DZIALY.filter((x) => x.grupy.some((g) => grupyUstawien.has(g))), (x) => x.id);
}
/** Rysuje listę działów i treść wybranego. Na wąskim ekranie widać jedno albo drugie. */
function pokazDzial(fokus) {
  const d = $('#d-ustawienia');
  const tresc = $('#ustawienia-tresc');
  const dostepne = dostepneDzialy();
  const nav = $('#u-dzialy');
  nav.replaceChildren(
    ...dostepne.map((x) =>
      el(
        'button',
        {
          type: 'button',
          dataset: { dzial: x.id, barwa: x.barwa },
          'aria-current': x.id === dzial ? 'page' : null,
          onclick: () => {
            dzial = x.id;
            pokazDzial(true);
          },
        },
        el('span.kafel-ikony', { 'aria-hidden': 'true' }, ikona(x.ikona)),
        el('span.nazwa', { tekst: x.nazwa }),
        ikona('dalej'),
      ),
    ),
  );
  const wybrany = dostepne.find((x) => x.id === dzial);
  tresc.replaceChildren(...(wybrany ? wybrany.grupy.map((g) => grupyUstawien.get(g)).filter(Boolean) : []));
  // Jedyna grupa działu nie powtarza nad kartą jego nazwy, bo tę widać w wybranym dziale (reguła bez-oczywistego-wstepu).
  // Funkcje na Windows mieszczą się wtedy w oknie 1280 × 752 bez przewijania (zasada 12; z nagłówkiem i opisem 678 px na 592).
  const pokazane = [...tresc.children];
  for (const s of pokazane) {
    const h = s.querySelector(':scope > h3');
    if (h) h.hidden = pokazane.length === 1 && h.textContent.trim() === wybrany.nazwa;
  }
  ulozGrupy();
  tresc.scrollTop = 0;
  const otwarty = Boolean(wybrany);
  d.classList.toggle('dzial-otwarty', otwarty);
  const wasko = waski();
  $('#u-wstecz').hidden = !(wasko && otwarty);
  $('#d-ustawienia-tytul').textContent = wasko && otwarty ? wybrany.nazwa : 'Ustawienia';
  if (!fokus) return;
  if (wasko && otwarty) $('#u-wstecz').focus();
  else (nav.querySelector('[aria-current="page"]') || nav.querySelector('button'))?.focus();
}

/**
 * Wielkość tekstu i przycisków (tylko Windows): pomniejsz, poziom, powiększ. Poziom zostaje na tym
 * urządzeniu, więc nie ma go w ustawieniach rdzenia. W przeglądarce robi to sama przeglądarka.
 */
function grupaWygladu() {
  const wiersze = [];
  if (Powiekszenie.dostepne) {
    // Nową wartość czytnik ekranu słyszy z ogłoszenia (js/powiekszenie.js), więc bez aria-live tutaj.
    const poziom = el('span.numeric.wielkosc-poziom', { id: 'u-powiekszenie', tekst: Powiekszenie.procent() });
    const mniej = el('button.ikona', { type: 'button', id: 'u-pomniejsz', title: 'Pomniejsz (Ctrl+minus)', 'aria-label': 'Pomniejsz', onclick: () => Powiekszenie.krok(-1) }, el('span.fmt-litery', { 'aria-hidden': 'true', tekst: '−' }));
    const wiecej = el('button.ikona', { type: 'button', id: 'u-powieksz', title: 'Powiększ (Ctrl+plus)', 'aria-label': 'Powiększ', onclick: () => Powiekszenie.krok(1) }, el('span.fmt-litery', { 'aria-hidden': 'true', tekst: '+' }));
    const tekst = el('div.wiersz-tekst', null, el('span', { tekst: 'Wielkość tekstu i przycisków' }), el('span.caption.przygaszony', { tekst: 'Całe okno, od 80 do 200%. Ctrl+0 wraca do 100%' }));
    wiersze.push(el('div.wiersz', { dataset: { klucz: 'powiekszenie' } }, tekst, el('div.przyciski.wielkosc', null, mniej, poziom, wiecej)));
    queueMicrotask(Powiekszenie.odswiezWierszPowiekszenia);
  }
  // Położenie tekstu notatki: to samo, co niewidoczny uchwyt po lewej stronie tekstu (js/uchwyty.js).
  // Na wąskim ekranie tekst i tak zajmuje całą szerokość, więc suwak jest przygaszony, a nie schowany.
  const wasko = waski();
  const suwak = el('input', { type: 'range', id: 'u-polozenie', min: '0', max: '100', step: '5', 'aria-describedby': 'u-polozenie-opis', disabled: wasko || null });
  suwak.value = String(Math.round(polozenieTekstu() * 100));
  suwak.setAttribute('aria-valuetext', opisPolozenia());
  const wartosc = el('span.numeric.wielkosc-poziom', { 'aria-hidden': 'true', tekst: `${suwak.value}%` });
  suwak.addEventListener('input', () => {
    ustawPolozenieTekstu(Number(suwak.value) / 100);
    wartosc.textContent = `${suwak.value}%`;
    suwak.setAttribute('aria-valuetext', opisPolozenia());
  });
  const opis = wasko ? 'Działa w szerszym oknie: tu tekst zajmuje całą szerokość' : '0% przy lewej krawędzi, 50% na środku. Można też przeciągnąć uchwyt po lewej stronie tekstu';
  const tekst = el('div.wiersz-tekst', null, el('label', { for: 'u-polozenie', tekst: 'Położenie tekstu notatki' }), el('span.caption.przygaszony', { id: 'u-polozenie-opis', tekst: opis }));
  wiersze.push(el('div.wiersz', { dataset: { klucz: 'polozenie' } }, tekst, el('div.przyciski', null, suwak, wartosc)));
  // Wysokość kafelków: to samo, co znacznik pod listą (js/uchwyty.js, zadanie 20).
  const kafle = el('input', { type: 'range', id: 'u-kafle', min: '1', max: '5', step: '1', 'aria-describedby': 'u-kafle-opis' });
  kafle.value = String(liniePodgladu());
  kafle.setAttribute('aria-valuetext', opisLiniiPodgladu());
  const ileLinii = el('span.numeric.wielkosc-poziom', { 'aria-hidden': 'true', tekst: liczba(liniePodgladu(), 'linia', 'linie', 'linii') });
  kafle.addEventListener('input', () => {
    ustawLiniePodgladu(Number(kafle.value));
    ileLinii.textContent = liczba(liniePodgladu(), 'linia', 'linie', 'linii');
    kafle.setAttribute('aria-valuetext', opisLiniiPodgladu());
  });
  const tekstKafli = el('div.wiersz-tekst', null, el('label', { for: 'u-kafle', tekst: 'Podgląd w kafelku' }), el('span.caption.przygaszony', { id: 'u-kafle-opis', tekst: 'Wyższe kafelki pokazują więcej tekstu. Można też przeciągnąć znacznik pod listą' }));
  wiersze.push(el('div.wiersz', { dataset: { klucz: 'kafle' } }, tekstKafli, el('div.przyciski', null, kafle, ileLinii)));
  return el('section.grupa', { id: 'grupa-wyglad' }, el('h3.heading', { tekst: 'Wygląd' }), el('div.lista', null, wiersze));
}
/** Wiersz z opisem i kilkoma przyciskami (zamiast osobnego wiersza na każdy przycisk). Z `klucz` da się go przestawiać. */
function wierszZPrzyciskami(tytul, opis, przyciski, klucz = null) {
  return el(
    'div.wiersz',
    klucz ? { dataset: { klucz } } : null,
    el('div.wiersz-tekst', null, el('span', { tekst: tytul }), opis ? el('span.caption.przygaszony.jedna-linia', { tekst: opis, title: opis }) : null),
    el('div.przyciski', null, przyciski.filter(Boolean).map(([t, f]) => el('button', { type: 'button', onclick: f }, t))),
  );
}

function grupaOProgramie() {
  return el(
    'section.grupa.o-programie',
    { id: 'grupa-o-programie' },
    el('img', { src: 'ikona.png', width: '96', height: '96', alt: '' }),
    el('p.title-2', { tekst: 'Notatki' }),
    el('p.caption.przygaszony', { tekst: `Wersja ${S.wersja}${S.urzadzenie ? ` · ${S.urzadzenie}` : ''}` }),
    el('p', { tekst: 'Notatki z historią wersji, kopiami i porządkami AI' }),
    el('p.caption.przygaszony', { tekst: 'Jacek' }),
    // Jedno okno naraz (HIG): skróty otwierają się zamiast ustawień, nie na nich.
    platforma !== 'android'
      ? el('button', { type: 'button', onclick: () => { $('#d-ustawienia').close(); otworzSkroty(); } }, 'Pokaż skróty klawiszowe')
      : null,
  );
}

/** Miejsca pliku wymiany po polsku: „zapisano w OneDrive i na Dysku Google”. */
const MIEJSCA = { OneDrive: 'w OneDrive', 'Dysk Google': 'na Dysku Google' };

/** Stan wymiany plikiem jednym zdaniem: kiedy poszedł plik tego urządzenia i kiedy pisały inne. */
function opisWymiany(w = (S.sync || {}).wymiana || {}) {
  if (w.stan === 'wylaczona') return platforma === 'windows' ? 'Wyłączona – notatki zostają na tym komputerze' : '';
  if (w.stan === 'brak' || w.stan === 'blad') return w.komunikat || 'Wymiana teraz nie działa';
  if (w.stan !== 'dziala') return 'Sprawdzam…';
  const czesci = [];
  if (w.zapisano) czesci.push(`Zapisano ${kiedy(w.zapisano)} ${(w.miejsca || []).map((m) => MIEJSCA[m] || `w: ${m}`).join(' i ')}`.trim());
  for (const u of w.urzadzenia || []) czesci.push(`${u.nazwa}: ${kiedy(u.czas)}`);
  if ((w.ostrzezenia || []).length) czesci.push(w.ostrzezenia[0]);
  return czesci.join(' · ');
}

/** Okno ustawień otwarte: stan wymiany i GitHuba na bieżąco, bez przerysowania okna (fokus zostaje). */
export function odswiezOpisWymiany() {
  const o = document.getElementById('opis-wymiany');
  if (o) o.textContent = opisWymiany();
  const g = document.getElementById('opis-githuba');
  if (g) g.textContent = opisGithuba();
}

/** Strona z GitHub Pages (strona-pages.ps1 dodaje znacznik): bez serwera Notatek za nią. */
export function stronaBezSerwera() {
  return platforma === 'web' && Boolean(document.querySelector('meta[name="notatki-bez-serwera"]'));
}

/** Synchronizacja przez prywatne repozytorium GitHuba jest połączona. */
function przezGithuba() {
  const s = S.sync || {};
  return Boolean(s.polaczona && s.rodzaj === 'github');
}

/** Stan GitHuba jednym zdaniem: repozytorium i co się dzieje. */
function opisGithuba() {
  const s = S.sync || {};
  const stan = {
    polaczono: 'Działa – każda zmiana jest na innych urządzeniach w kilka sekund',
    wysylanie: 'Wysyłanie zmian…',
    offline: `Brak połączenia – ${liczba(s.oczekujace || 0, 'zmiana czeka', 'zmiany czekają', 'zmian czeka')} na wysłanie`,
    blad: s.komunikat || 'Błąd synchronizacji',
  }[s.stan] || 'Łączenie…';
  return `${s.adres || ''} · ${stan}`;
}

/**
 * Synchronizacja. Wszędzie: prywatne repozytorium GitHuba, gdy jest połączone (od 21.10.2026). Komputer i telefon łączy
 * skrypt narzedzia\polacz-github.ps1, bez okien i bez wpisywania (Jacek: „It's supposed to do it itself in the background”),
 * więc tu jest sam stan. Windows: do tego wymiana plikiem w folderach „Kopie Notatek” w OneDrive i na Dysku Google
 * (przełącznik wyłącza). Bez GitHuba: serwer Notatek (telefon i przeglądarka tutaj, Windows w osobnej grupie).
 */
async function grupaSynchronizacji() {
  const lista = el('div.lista');
  if (przezGithuba()) {
    const opis = el('span.caption.przygaszony', { tekst: opisGithuba() });
    opis.id = 'opis-githuba';
    lista.append(el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: 'GitHub · prywatne repozytorium' }), opis)));
  } else if (platforma !== 'windows') {
    return el('section.grupa', { id: 'grupa-sync' }, el('h3.heading', { tekst: 'Synchronizacja' }), listaSerwera());
  }
  if (platforma === 'windows') {
    const w = wierszUstawienia({ klucz: 'wymiana', typ: 'przelacznik', etykieta: 'Wymiana przez OneDrive i Dysk Google', opis: opisWymiany() || ' ' });
    const opis = w.querySelector('.caption');
    if (opis) opis.id = 'opis-wymiany';
    lista.append(w);
  }
  return el('section.grupa', { id: 'grupa-sync' }, el('h3.heading', { tekst: 'Synchronizacja' }), lista);
}

/**
 * Porządki AI. Windows: przez Kiro (Jacek, 25.10.2026, Fiszki Pytań: „Przez Kiro”), bez klucza i bez wyboru modelu, więc
 * grupa mówi tylko, z którego konta Kiro idą kredyty (konto Kiro CLI bywa innym niż konto w oknie Kiro). Przeglądarka
 * z własnym serwerem: model Claude na serwerze. Telefon i przeglądarka bez serwera: grupy nie ma, bo Porządki robi się
 * na komputerze.
 */
async function grupaAi() {
  let lista;
  if (platforma === 'windows') {
    const s = await wywolaj('ai_stan').catch(() => ({}));
    const opis = !s.kiro
      ? 'Nie ma go na tym komputerze – zainstaluj Kiro CLI i zaloguj się'
      : `${s.model} · kredyty z konta ${s.konto || 'Kiro'}`;
    lista = el('div.lista', null, el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: 'Kiro' }), el('span.caption.przygaszony', { tekst: opis }))));
  } else if (S.platforma.ai_przez_serwer) {
    lista = el('div.lista', null, wierszUstawienia({ klucz: 'ai_model', typ: 'wybor', etykieta: 'Model', opcje: 'modele' }));
  } else {
    return null;
  }
  return el('section.grupa', { id: 'grupa-ai' }, el('h3.heading', { tekst: 'Porządki AI' }), lista);
}

/** Własny serwer: na Windows i telefonie druga, rzadsza droga, w przeglądarce jedyna. */
function grupaSerwera() {
  return el('section.grupa', { id: 'grupa-serwer' }, el('h3.heading', { tekst: 'Własny serwer' }), listaSerwera());
}

function listaSerwera() {
  const s = S.sync || {};
  const lista = el('div.lista');
  if (s.polaczona) {
    const opisStanu = {
      polaczono: 'Połączono – zmiany wysyłają się od razu',
      wysylanie: 'Wysyłanie zmian…',
      offline: `Brak połączenia – ${liczba(s.oczekujace || 0, 'zmiana czeka', 'zmiany czekają', 'zmian czeka')} na wysłanie`,
      blad: s.komunikat || 'Błąd synchronizacji',
    }[s.stan] || 'Łączenie…';
    lista.append(
      el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: s.adres || 'Serwer' }), el('span.caption.przygaszony', { tekst: opisStanu }))),
      el(
        'button.wiersz.przycisk-wiersz.niszczacy',
        {
          type: 'button',
          onclick: async () => {
            try {
              await wywolaj('sync_odlacz');
              toast('Odłączono od serwera – notatki zostają na miejscu');
              otworzUstawienia(null, true);
            } catch (e) {
              bladToast(e);
            }
          },
        },
        'Odłącz od serwera',
      ),
    );
  } else if (stronaBezSerwera()) {
    // Strona z GitHub Pages: serwera Notatek za nią nie ma, łączy ją pełny adres z kluczem po # (zakładka albo link z -Link).
    lista.append(el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: 'Jeszcze niepołączona' }), el('span.caption.przygaszony', { tekst: 'Otwórz tę stronę pełnym adresem z kluczem do notatek, na przykład z zakładki' }))));
  } else {
    if (platforma === 'web') lista.append(el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: 'Wyłączona' }), el('span.caption.przygaszony', { tekst: 'Notatki są tylko w tej przeglądarce' }))));
    if (platforma === 'android') lista.append(el('div.wiersz', null, el('div.wiersz-tekst', null, el('span', { tekst: 'Jeszcze niepołączony' }), el('span.caption.przygaszony', { tekst: 'Komputer połączy ten telefon sam' }))));
    lista.append(el('button.wiersz.przycisk-wiersz', { type: 'button', onclick: () => otworzLogowanie() }, platforma === 'web' ? 'Połącz z serwerem…' : 'Połącz z własnym serwerem…'));
  }
  return lista;
}
/**
 * Dane, Migawki i Kopie poza komputerem – trzy grupy, każda w swoim dziale. Kilka przycisków
 * jednej sprawy stoi w jednym wierszu (zamiast wiersza na przycisk), więc każdy dział mieści się
 * w oknie bez przewijania.
 */
async function grupyDanych() {
  const wiersze = [];
  // Na telefonie nie ma wyboru folderu z eksportem Keep – notatki przychodzą z komputera.
  if (platforma !== 'android') wiersze.push(wierszZPrzyciskami('Google Keep', 'Notatki z eksportu Google Takeout. Ponowny import niczego nie dubluje', [['Importuj…', () => importujKeep()]], 'keep'));
  wiersze.push(
    wierszZPrzyciskami('Eksport', 'Wszystkie notatki naraz, do pliku albo do schowka', [
      ['Markdown', () => eksportuj('md')],
      ['JSON', () => eksportuj('json')],
      ['Kopiuj', () => kopiujWszystko()],
    ], 'eksport'),
  );
  if (naTauri) wiersze.push(wierszZPrzyciskami('Folder danych', 'Baza notatek, obrazy i nagrania na tym urządzeniu', [['Otwórz', () => wywolaj('otworz_folder_danych').catch(bladToast)]], 'folder'));
  const grupy = [el('section.grupa', { id: 'grupa-dane' }, el('h3.heading', { tekst: 'Dane' }), el('div.lista', null, wiersze))];
  if (naTauri) grupy.push(...(await grupyMigawek()));
  return grupy;
}

// Kopie poza komputerem (Windows): OneDrive i Dysk Google, gdy są na tym komputerze,
// oraz własny folder. Przełącznik przy każdym celu; opis mówi, gdzie i kiedy była ostatnia kopia.
function wierszKopii(k) {
  const opis = k.folder ? `${k.folder} · ${k.ostatnia ? `ostatnia kopia ${k.ostatnia}` : 'jeszcze bez kopii'}` : k.uwaga || 'Niedostępne';
  const tekst = el('div.wiersz-tekst', null, el('span', { tekst: k.nazwa }), el('span.caption.przygaszony.jedna-linia', { tekst: opis, title: opis }));
  if (k.klucz === 'wlasny') {
    const usun = el('button.niszczacy', { type: 'button' }, 'Usuń');
    usun.addEventListener('click', async () => {
      if (await ustaw('kopie_folder', '')) otworzUstawienia('kopie', true);
    });
    return el('div.wiersz', { dataset: { klucz: k.klucz } }, tekst, usun);
  }
  const klucz = k.klucz === 'onedrive' ? 'kopia_onedrive' : 'kopia_dysk_google';
  const s = el('input', { type: 'checkbox', role: 'switch', 'aria-label': `Kopia na ${k.nazwa}` });
  s.checked = k.wlaczony;
  s.addEventListener('change', async () => {
    if (!(await ustaw(klucz, s.checked))) s.checked = !s.checked;
  });
  return el('div.wiersz', { dataset: { klucz: k.klucz } }, tekst, s);
}

async function kopieTeraz(przycisk) {
  przycisk.disabled = true;
  try {
    const { wyniki } = await wywolaj('kopie_teraz');
    const bledy = wyniki.filter((w) => w.blad);
    const dobre = wyniki.filter((w) => w.kopia).map((w) => w.nazwa);
    if (!wyniki.length) toast('Żadna kopia poza komputerem nie jest włączona');
    // Udana kopia widać w wierszach („ostatnia kopia …”) – komunikat tylko dla czytnika ekranu.
    else if (!bledy.length) ogloszenie(`Kopia gotowa: ${dobre.join(', ')}`);
    else toast(`${dobre.length ? `Kopia gotowa: ${dobre.join(', ')}. ` : ''}${bledy.map((b) => `${b.nazwa}: ${b.blad}`).join(' · ')}`, { czas: 12000 });
    otworzUstawienia('kopie', true);
  } catch (e) {
    bladToast(e);
  } finally {
    przycisk.disabled = false;
  }
}

const MIGAWEK_NA_START = 5;

async function grupyMigawek() {
  const box = el('div.lista');
  const opis = el('p.caption.przygaszony.opis-grupy', { tekst: 'Kopia całej bazy raz dziennie, 90 dni wstecz, bez kluczy i tokenów. Przywrócenie nie kasuje historii i da się je cofnąć' });
  let kopie = [];
  try {
    const odp = await wywolaj('migawki_lista');
    const { migawki, folder } = odp;
    kopie = odp.kopie || [];
    box.append(
      wierszZPrzyciskami('Folder migawek', folder, [
        ['Zrób migawkę', async () => { try { await wywolaj('migawka_teraz'); ogloszenie('Zrobiono migawkę'); otworzUstawienia('migawki', true); } catch (e) { bladToast(e); } }],
        ['Zmień…', async () => { try { const r = await wywolaj('wybierz_folder_migawek'); if (r && r.folder) { ogloszenie(`Migawki: ${r.folder}`); otworzUstawienia('migawki', true); } } catch (e) { bladToast(e); } }],
      ]),
    );
    // Najnowsze dni od razu; całą listę (do 90) na życzenie – inaczej dział przewijałby się na kilka ekranów.
    const widoczne = wszystkieMigawki ? migawki.slice(0, 90) : migawki.slice(0, MIGAWEK_NA_START);
    for (const m of widoczne) {
      box.append(
        el(
          'div.wiersz',
          null,
          el('div.wiersz-tekst', null, el('span', { tekst: m.dzien + (m.reczna ? ' (ręczna)' : '') }), el('span.caption.przygaszony', { tekst: rozmiar(m.rozmiar) })),
          el('button', { type: 'button', onclick: () => przywrocMigawke(m) }, 'Przywróć'),
        ),
      );
    }
    if (!migawki.length) box.append(el('div.wiersz', null, el('span.przygaszony', { tekst: 'Jeszcze nie ma żadnej migawki – pierwsza zrobi się dziś sama' })));
    if (!wszystkieMigawki && migawki.length > MIGAWEK_NA_START) {
      box.append(
        el('button.wiersz.przycisk-wiersz', { type: 'button', onclick: () => { wszystkieMigawki = true; otworzUstawienia('migawki', true); } }, `Pokaż wszystkie (${migawki.length})`),
      );
    }
  } catch (e) {
    box.append(el('div.wiersz', null, el('span.przygaszony', { tekst: e.komunikat || 'Migawki są niedostępne' })));
  }
  const grupy = [el('section.grupa', { id: 'grupa-migawki' }, el('h3.heading', { tekst: 'Migawki' }), opis, box)];
  if (kopie.length) {
    const maWlasny = kopie.some((k) => k.klucz === 'wlasny');
    const wiersz = wierszZPrzyciskami('Kopia', 'Codziennie po migawce, sama', [
      ['Zrób teraz', (ev) => kopieTeraz(ev.currentTarget)],
      [maWlasny ? 'Zmień własny folder…' : 'Własny folder…', async () => {
        try {
          const r = await wywolaj('wybierz_folder_kopii');
          if (r && r.folder) {
            ogloszenie(`Kopie także do: ${r.folder}`);
            otworzUstawienia('kopie', true);
          }
        } catch (e) {
          bladToast(e);
        }
      }],
    ], 'kopia');
    grupy.push(
      el(
        'section.grupa',
        { id: 'grupa-kopie' },
        el('h3.heading', { tekst: 'Kopie poza komputerem' }),
        el('p.caption.przygaszony.opis-grupy', { tekst: 'Migawki i obrazy z notatek trafiają też do folderu „Kopie Notatek”, bez kluczy i tokenów' }),
        el('div.lista', null, wiersz, ...kopie.map(wierszKopii)),
      ),
    );
  }
  return grupy;
}

async function przywrocMigawke(m) {
  try {
    const r = await wywolaj('migawka_przywroc', { nazwa: m.nazwa });
    const { zastosujZmiany, odswiezListe, cofnijPaczke } = await import('./lista.js');
    zastosujZmiany(r);
    zapamietajCofniecie(r.paczka, 'Przywrócenie migawki');
    await odswiezListe();
    $('#d-ustawienia').close();
    toast(`Przywrócono stan z ${m.dzien} (${liczba(r.zmienione.length, 'notatka', 'notatki', 'notatek')})`, { przycisk: 'Cofnij', akcja: () => cofnijPaczke(r.paczka), czas: 12000 });
  } catch (e) {
    bladToast(e);
  }
}

// --- import i eksport ---

export async function importujKeep() {
  try {
    toast('Wybierz folder „Keep” z eksportu Google Takeout');
    const r = await wywolaj('import_keep', {});
    if (!r || r.anulowano) return;
    const { przeladuj } = await import('./app.js');
    await przeladuj();
    const rap = r.raport;
    const czesci = [`${liczba(rap.nowych, 'nowa notatka', 'nowe notatki', 'nowych notatek')}`];
    if (rap.zaktualizowanych) czesci.push(`${rap.zaktualizowanych} zaktualizowanych`);
    if (rap.bez_zmian) czesci.push(`${rap.bez_zmian} bez zmian`);
    toast(`Import z Keep: ${czesci.join(', ')}`, { czas: 9000 });
    if (rap.bledy.length || rap.brakujace_pliki.length) {
      const { szczegolyBledu } = await import('./ui.js');
      szczegolyBledu('Część plików nie dała się zaimportować', [...rap.bledy, ...rap.brakujace_pliki].join('\n'));
    }
  } catch (e) {
    bladToast(e);
  }
}

export async function eksportuj(format) {
  try {
    if (naTauri) {
      const r = await wywolaj('zapisz_eksport', { format });
      toast(`Zapisano ${r.nazwa} w Pobranych (${rozmiar(r.rozmiar)})`, { przycisk: 'Pokaż', akcja: () => wywolaj('pokaz_w_folderze', { sciezka: r.sciezka }) });
    } else {
      const r = await wywolaj('eksport', { format });
      const a = el('a', { href: URL.createObjectURL(new Blob([r.tekst], { type: r.typ })), download: r.nazwa });
      document.body.append(a);
      a.click();
      a.remove();
    }
  } catch (e) {
    bladToast(e);
  }
}

export async function kopiujWszystko() {
  try {
    const r = await wywolaj('eksport', { format: 'md' });
    await navigator.clipboard.writeText(r.tekst);
    toast(`Skopiowano wszystkie notatki (${rozmiar(new Blob([r.tekst]).size)}) – wklej w dowolny czat`);
  } catch (e) {
    bladToast(e);
  }
}

// --- synchronizacja: logowanie raz na urządzenie ---

export function otworzLogowanie() {
  const d = $('#d-logowanie');
  // W przeglądarce serwer to strona, z której otwarto Notatki.
  $('#l-adres').value = S.ustawienia.serwer_adres || (platforma === 'web' ? location.origin : '');
  $('#l-haslo').value = '';
  $('#l-blad').hidden = true;
  d.showModal();
  ($('#l-adres').value ? $('#l-haslo') : $('#l-adres')).focus();
}

export function podepnijLogowanie() {
  $('#logowanie-formularz').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const adres = $('#l-adres').value.trim().replace(/\/+$/, '');
    const haslo = $('#l-haslo').value;
    const b = $('#l-zaloguj');
    b.disabled = true;
    $('#l-blad').hidden = true;
    try {
      await wywolaj('sync_zaloguj', { adres, haslo });
      $('#l-haslo').value = '';
      $('#d-logowanie').close();
      toast('Połączono z serwerem – to urządzenie nie będzie już pytać o hasło');
      if ($('#d-ustawienia').open) otworzUstawienia('serwer', true);
    } catch (e) {
      $('#l-blad').textContent = e.komunikat || 'Nie udało się połączyć';
      $('#l-blad').hidden = false;
    } finally {
      b.disabled = false;
    }
  });
}

// --- skróty klawiszowe ---

// Cztery kolumny obok siebie: całe okno mieści się bez przewijania na laptopie (zasada 12).
const SKROTY = [
  ['Ogólne', [['Szukaj', 'Ctrl+F'], ['Nowa notatka', 'Ctrl+N'], ['Nowa lista', 'Ctrl+Shift+N'], ['Ustawienia', 'Ctrl+,'], ['Skróty klawiszowe', 'Ctrl+?'], ['Ściąga', 'F1'], ['Pasek boczny', 'F9'], ['Sam tekst, na cały ekran', 'F11'], ['Widoki z paska bocznego', 'Alt+1…4'], ['Przestaw przycisk', 'Alt+strzałka'], ['Powiększ', 'Ctrl+plus'], ['Pomniejsz', 'Ctrl+minus'], ['Wielkość 100%', 'Ctrl+0'], ['Schowaj okno', 'Ctrl+W'], ['Zakończ', 'Ctrl+Q']]],
  ['Lista', [['Poprzednia, następna', '↑ ↓'], ['Pierwsza, ostatnia', 'Home, End'], ['Pisz w notatce', 'Enter'], ['Zaznacz', 'Spacja'], ['Zaznacz wszystkie', 'Ctrl+A'], ['Przenieś do kosza', 'Delete'], ['Menu notatki', 'Shift+F10'], ['Cofnij ostatnie działanie', 'Ctrl+Z'], ['Ponów cofnięte działanie', 'Ctrl+Y']]],
  ['Notatka', [['Wróć do listy', 'Esc'], ['Więcej działań', 'F10'], ['Zapisz wersję teraz', 'Ctrl+S'], ['Historia wersji', 'Ctrl+H'], ['Nowa pozycja listy', 'Enter'], ['Odhacz pozycję', 'Ctrl+Enter'], ['Przenieś pozycję', 'Alt+↑ ↓'], ['Wklej obraz', 'Ctrl+V']]],
  [
    'Formatowanie',
    [
      ['Pogrubienie', 'Ctrl+B'],
      ['Kursywa', 'Ctrl+I'],
      ['Podkreślenie', 'Ctrl+U'],
      ['Przekreślenie', 'Ctrl+Shift+S'],
      ['Stała szerokość', 'Ctrl+Shift+K'],
      ['Większe pismo', 'Ctrl+Shift+.'],
      ['Mniejsze pismo', 'Ctrl+Shift+,'],
      ['Bez formatowania', 'Ctrl+\\'],
      ['Kolor, wyróżnienie, rozmiar', 'przycisk Aa'],
    ],
  ],
];

export function otworzSkroty() {
  $('#skroty-tresc').replaceChildren(
    ...SKROTY.map(([sekcja, lista]) =>
      el('section.grupa', null, el('h3.heading', { tekst: sekcja }), el('div.lista', null, ...lista.map(([co, klaw]) => el('div.wiersz', null, el('span', { tekst: co }), el('kbd', { tekst: klaw }))))),
    ),
  );
  $('#d-skroty').showModal();
}

export function czasMigawki(ms) {
  return pelnaData(ms);
}
