// Ściąga „i” (reguła Jacka z 15.10.2026): co robią ikonki bez podpisu, gdzie jest prawy klik, co się przeciąga
// i najważniejsze skróty. Arkusz jak w macOS, bez tytułu i bez zdania o programie: w każdej części ta sama ikonka
// co w programie i kilka słów. Na dotyku (telefon) tylko to, co działa palcem.
// Nowa ikonka, prawy klik, przeciąganie albo skrót w programie to nowa pozycja tutaj. narzedzia\test-uklad.ps1
// sprawdza, że każda ikonka z nagłówka okna jest w ściądze.

import { el, ikona, $ } from './pomoc.js';
import { S } from './stan.js';
import { platforma } from './most.js';
import { zamknijPopover } from './ui.js';
import { otworzSkroty } from './ustawienia.js';

/**
 * Części ściągi: [tytuł, pozycje, klasa listy]. Pozycja to [znak, napis, rodzaj]. Znak to nazwa ikony ze spritu
 * w index.html, a rodzaj: „litery” (napis zamiast ikony, jak „Aa” na przycisku), „klawisz” albo „szeroka” (cały wiersz).
 */
function czesci() {
  // Telefon i dotyk bez myszy: tylko przyciski. Prawy klik, przeciąganie i skróty są dla myszy i klawiatury.
  const mysz = platforma !== 'android' && window.matchMedia('(any-pointer: fine)').matches;
  const wynik = [
    [
      'Przyciski',
      [
        // Po dwa w rzędzie (styl.css, „Ściąga w dwóch kolumnach”), więc każdy opis mieści się w jednej linii.
        ['pasek', 'Pasek boczny'],
        // Pole szukania w ciasnym pasku stoi samą lupą (js/app.js, dopasujSzukanie). Czternasta pozycja wypełnia ostatni rząd.
        ['szukaj', 'Szukaj'],
        ['pelny', 'Sam tekst'],
        ['nowa', 'Nowa notatka'],
        ['Aa', 'Pismo i kolory', 'litery'],
        ['tabela', 'Tabela'],
        ['pola', 'Lista z polami'],
        ['tekst', 'Zwykły tekst'],
        ['obraz', 'Obraz'],
        ['mikrofon', 'Nagranie głosu'],
        ['dzwonek', 'Przypomnienie'],
        ['wiecej', 'Kolor, historia…'],
        ['chmura', 'Synchronizacja'],
        ['historia', 'Odzyskaj usunięte'],
      ],
    ],
  ];
  // Na palec przytrzymanie ikonki pokazuje jej dymek (js/dymki.js), jak w Androidzie. To jedyny ukryty gest na telefonie.
  if (!mysz) {
    wynik.push(['Gesty', [['info', 'Przytrzymaj ikonkę: co robi', 'szeroka']]]);
    return wynik;
  }
  // Krótkie opisy w jednej linii (reguła ikonka-i): co robi, bez powtarzania tego, co widać na znaku.
  wynik.push(['Prawy klik', [['notatka', 'Kafelek: kolor, przypnij, archiwum, kosz', 'szeroka'], ['tekst', 'Tekst: wytnij, kopiuj, wklej, pismo', 'szeroka']]]);
  wynik.push([
    'Przeciąganie',
    [
      ['uchwyt', 'Kafelki, pozycje, przyciski, ustawienia: kolejność', 'szeroka'],
      ['uchwyt', 'Między przyciskami: cała grupa', 'szeroka'],
      ['szerokosc', 'Krawędź kolumny: szerokość, dwuklik wraca', 'szeroka'],
      ['wysokosc', 'Znacznik pod listą: wysokość, dwuklik wraca', 'szeroka'],
      ['pobierz', 'Plik z dysku: do notatki', 'szeroka'],
      ['rog', 'Okienko: przesuń, róg zmienia rozmiar', 'szeroka'],
    ],
  ]);
  const skroty = [
    ['Ctrl+N', 'Nowa notatka', 'klawisz'],
    ['Ctrl+F', 'Szukaj', 'klawisz'],
    ['Ctrl+Z|Ctrl+Y', 'Cofnij, ponów', 'klawisz'],
    ['Ctrl+klik', 'Zaznacz kilka', 'klawisz'],
    ['Alt+↑ ↓', 'Przestaw kafelek', 'klawisz'],
  ];
  // Podwójne kliknięcie środkowym przyciskiem (kółkiem) otwiera iKeeper z każdego programu: tylko Windows, gdy jest włączone.
  if (platforma === 'windows' && S.ustawienia.dwuklik !== false) skroty.push(['mysz', 'Dwuklik kółkiem: Notatki']);
  wynik.push(['Skróty', skroty, 'klawisze']);
  return wynik;
}

function pozycja([znak, napis, rodzaj = '']) {
  // Klawisz czytnik ekranu czyta razem z napisem („Ctrl+N, Nowa notatka”), a ikonka i litery są tylko dla oka.
  // Kilka klawiszy dla jednej pozycji rozdziela „|” („Ctrl+Z|Ctrl+Y”): każdy na swoim kafelku.
  const kafelek =
    rodzaj === 'klawisz'
      ? el('span.sciaga-klawisze', null, ...znak.split('|').map((k) => el('kbd.sciaga-znak', { tekst: k })))
      : el('span.sciaga-znak', { 'aria-hidden': 'true' }, rodzaj === 'litery' ? el('span.fmt-litery', { tekst: znak }) : ikona(znak));
  return el(`li.sciaga-pozycja${rodzaj === 'szeroka' ? '.szeroka' : ''}`, null, kafelek, el('span', { tekst: napis }));
}

let przed = null;

/** „i” (i jego stan „włączone”) na pasku bocznym i na dolnym pasku wąskiego ekranu. */
function zaznaczInfo(otwarta) {
  for (const b of [$('#nav-info'), $('#info-dol')]) if (b) b.setAttribute('aria-expanded', String(otwarta));
}

/**
 * „i” i F1 otwierają ściągę, a drugi raz ją zamykają. Treść rysuje się przy każdym otwarciu, bo mysz i ustawienia mogą
 * się zmienić. Ściąga stoi obok pracy, bez zasłony (Jacek, 17.10.2026: „detached window … jak ktoś chce mieć małą
 * ściągę”): okno pod nią działa dalej, a ona przesuwa się i skaluje jak każdy arkusz (js/arkusze.js).
 */
export function otworzSciage() {
  const d = $('#d-sciaga');
  if (!d) return;
  if (d.open) {
    d.close();
    return;
  }
  zamknijPopover(false);
  const c = czesci();
  const sekcje = c.map(([tytul, pozycje, klasa]) =>
    el('section.sciaga-czesc', null, el('h3.caption-heading.przygaszony', { tekst: tytul }), el(`ul.sciaga-lista${klasa ? `.${klasa}` : ''}`, null, ...pozycje.map(pozycja))),
  );
  // Dwie kolumny, każda ze swoimi częściami, więc krótka część nie zostawia dziury obok długiej (reguła ikonka-i).
  // W wąskim oknie kolumny znikają ze stylu (display: contents) i części stoją jedna pod drugą.
  $('#sciaga-tresc').replaceChildren(
    ...(sekcje.length === 4 ? [el('div.sciaga-kolumna', null, sekcje[0], sekcje[1]), el('div.sciaga-kolumna', null, sekcje[2], sekcje[3])] : sekcje),
  );
  // „Wszystkie skróty” tylko tam, gdzie są skróty klawiszowe. Bez nich ściąga nie ma rzędu przycisków.
  $('#sciaga-przyciski').hidden = !c.some(([t]) => t === 'Skróty');
  przed = document.activeElement;
  d.show();
  zaznaczInfo(true);
}

/** Escape (app.js): ściąga stoi na wierzchu, więc zamyka się pierwsza, jak Wstecz na telefonie. `true`, gdy była otwarta. */
export function zamknijSciage() {
  const d = $('#d-sciaga');
  if (!d || !d.open) return false;
  d.close();
  return true;
}

/** Przycisk „i” w pasku bocznym i na dolnym pasku wąskiego ekranu, „Wszystkie skróty” i powrót fokusu. */
export function podepnijSciage() {
  const d = $('#d-sciaga');
  if (!d) return;
  for (const b of [$('#nav-info'), $('#info-dol')]) if (b) b.addEventListener('click', otworzSciage);
  $('#sciaga-skroty').addEventListener('click', () => {
    const wroc = przed;
    d.close();
    otworzSkroty();
    $('#d-skroty').addEventListener(
      'close',
      () => {
        if (wroc && wroc.isConnected) wroc.focus();
      },
      { once: true },
    );
  });
  // Klik obok nie zamyka (reguła Jacka o ściądze): obok ściągi się pracuje. Fokus wraca na „i” tylko wtedy, gdy był
  // w ściądze (po zamknięciu stoi wtedy na body). Gdy Jacek pisze obok, zostaje tam, gdzie jest.
  d.addEventListener('close', () => {
    zaznaczInfo(false);
    if (przed && przed.isConnected && document.activeElement === document.body && !document.querySelector('dialog:modal')) przed.focus();
    przed = null;
  });
}