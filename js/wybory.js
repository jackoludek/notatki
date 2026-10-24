// Okienko przypomnienia – to samo w edytorze, w menu wiersza listy i w trybie zaznaczania.

import { el, ikona, czasPrzypomnienia, doPolaDaty, rytm, strefaUrzadzenia, NAZWY_POWTARZANIA, MAKS_PRZYPOMNIENIA } from './pomoc.js';
import { S } from './stan.js';
import { popover, zamknijPopover } from './ui.js';
import { platforma } from './most.js';

let numerMenu = 0;

/**
 * Uwaga o dniu, którego nie ma w każdym miesiącu albo roku. Przypomnienia wtedy nie ma – jak
 * w Kalendarzu Google: „31.” znaczy 31., a nie raz 30., raz 28.
 */
function uwagaODniu(co, ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (co === 'miesiac' && d.getDate() >= 29) return `W miesiącach bez ${d.getDate()}. dnia przypomnienia nie będzie`;
  if (co === 'rok' && d.getMonth() === 1 && d.getDate() === 29) return 'Tylko w latach przestępnych';
  return '';
}

/**
 * Przypomnienie: powtarzanie, gotowe terminy i własna data. `ustaw(p | null)`, gdzie p to `{ czas }`
 * albo `{ czas, powtarzanie: { co, strefa } }`. `kiedy` – najbliższe wystąpienie obecnego
 * przypomnienia (u powtarzanego to zwykle nie jest `obecne.czas`); od niego startuje pole daty.
 *
 * Powtarzanie to jeden wiersz rozwijany w miejscu (jak AdwExpanderRow w GNOME): zwinięty pokazuje
 * bieżący wybór i nie zabiera miejsca terminom. Wybór rytmu niczego nie zapisuje – zapisuje gotowy
 * termin albo „Ustaw”, oba z wybranym rytmem (jak w Keep: najpierw „jak często”, potem termin).
 * Strefa reguły to zawsze strefa tego urządzenia, bo w niej użytkownik wpisuje godzinę.
 *
 * `zalatw` – „Zrobione” na górze, gdy przypomnienie jest ustawione: sprawa załatwiona (powtarzane – to wystąpienie),
 * a przypomnienie przestaje wracać. `zaGodzine` – pierwszy gotowy termin „Za godzinę” (sprawa, która czeka).
 */
export function menuPrzypomnienia(kotwica, obecne, ustawBezZgody, kiedy = obecne ? obecne.czas : null, { zalatw = null, zaGodzine = false, otworz = null } = {}) {
  // Android 13+: zgoda na powiadomienia pytana wtedy, gdy jest potrzebna – przy pierwszym przypomnieniu.
  const ustaw = (p) => {
    if (p && platforma === 'android') import('./telefon.js').then((m) => m.zezwolNaPowiadomienia()).catch(() => {});
    ustawBezZgody(p);
  };
  const aktywne = obecne && !obecne.zrobione ? obecne : null;
  // Bez strefy urządzenia rdzeń odrzuciłby regułę – wtedy menu powtarzania nie proponuje.
  const strefa = strefaUrzadzenia() || S.strefa || '';
  let co = strefa ? rytm(aktywne) : '';
  const wybierz = (czas) => {
    zamknijPopover();
    ustaw(co ? { czas, powtarzanie: { co, strefa } } : { czas });
  };
  const nr = ++numerMenu;

  const teraz = new Date();
  const o = (dni, godz) => {
    const d = new Date(teraz);
    d.setDate(d.getDate() + dni);
    d.setHours(godz, 0, 0, 0);
    return d.getTime();
  };
  const presety = [];
  if (zaGodzine) presety.push(['Za godzinę', Math.ceil((teraz.getTime() + 3600000) / 60000) * 60000]);
  if (teraz.getHours() < 17) presety.push(['Dziś wieczorem', o(0, 18)]);
  presety.push(['Jutro rano', o(1, 8)]);
  const doPoniedzialku = ((8 - teraz.getDay()) % 7) || 7;
  presety.push(['W przyszłym tygodniu', o(doPoniedzialku, 8)]);
  const gotowe = presety.map(([t, ms]) =>
    el('button.menu-pozycja', { type: 'button', onclick: () => wybierz(ms) }, el('span', { tekst: t }), el('kbd', { tekst: czasPrzypomnienia(ms) })),
  );

  // Własna data. Pole przyjmuje lata do 275760, a rdzeń 1970–9999 – sprawdzamy tu, z komunikatem
  // przy polu, zamiast wysyłać przypomnienie, którego notatka nie zapisze.
  const uwaga = el('p.caption.przygaszony.uwaga-przypomnienia', { id: `uwaga-przypomnienia-${nr}`, 'aria-live': 'polite', hidden: true });
  const pole = el('input', {
    type: 'datetime-local',
    'aria-label': 'Data i godzina przypomnienia',
    'aria-describedby': uwaga.id,
    min: '1970-01-01T00:00',
    max: '9999-12-31T23:59',
  });
  pole.value = doPolaDaty(aktywne ? (kiedy ?? aktywne.czas) : o(1, 8));
  const odswiezUwage = (blad = '') => {
    const tekst = blad || uwagaODniu(co, pole.value ? new Date(pole.value).getTime() : NaN);
    uwaga.textContent = tekst;
    uwaga.hidden = !tekst;
    uwaga.classList.toggle('blad', Boolean(blad));
    if (blad) pole.setAttribute('aria-invalid', 'true');
    else pole.removeAttribute('aria-invalid');
  };
  const ustawWlasne = () => {
    const ms = pole.value ? new Date(pole.value).getTime() : NaN;
    if (!(ms >= 0 && ms <= MAKS_PRZYPOMNIENIA)) {
      odswiezUwage(pole.value ? 'Wybierz datę z lat 1970–9999' : 'Wpisz datę i godzinę');
      pole.focus();
      return;
    }
    wybierz(ms);
  };
  pole.addEventListener('input', () => odswiezUwage());
  pole.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ustawWlasne();
    }
  });

  // Powtarzanie: wiersz rozwijany w miejscu i grupa radiowa z jednym przystankiem Tab.
  let powtarzanie = null;
  if (strefa) {
    const nazwa = (k) => (k ? NAZWY_POWTARZANIA[k] : 'Nie powtarzaj');
    const wybor = el('span', { tekst: nazwa(co) });
    const strzalka = ikona('dol');
    const grupa = el('div.powtarzanie', { id: `powtarzanie-${nr}`, role: 'radiogroup', 'aria-label': 'Powtarzanie', hidden: true });
    const wiersz = el(
      'button.menu-pozycja',
      { type: 'button', 'aria-expanded': 'false', 'aria-controls': grupa.id, onclick: () => (grupa.hidden ? rozwin() : zwin()) },
      el('span', null, ikona('powtarzaj'), 'Powtarzanie'),
      el('span.wybor.przygaszony', null, wybor, strzalka),
    );
    const opcje = ['', ...Object.keys(NAZWY_POWTARZANIA)].map((k) => {
      const b = el('button.menu-pozycja', { type: 'button', role: 'radio', onclick: () => wybierzRytm(k) }, el('span', { tekst: nazwa(k) }));
      b.dataset.co = k;
      return b;
    });
    const zaznacz = () => {
      for (const b of opcje) {
        const tak = b.dataset.co === co;
        b.setAttribute('aria-checked', tak ? 'true' : 'false');
        b.tabIndex = tak ? 0 : -1;
        const znak = b.querySelector('svg');
        if (tak && !znak) b.append(ikona('ptaszek'));
        if (!tak && znak) znak.remove();
      }
    };
    const rozwin = () => {
      grupa.hidden = false;
      wiersz.setAttribute('aria-expanded', 'true');
      strzalka.querySelector('use').setAttribute('href', '#i-gora');
      (opcje.find((b) => b.dataset.co === co) || opcje[0]).focus();
    };
    const zwin = () => {
      grupa.hidden = true;
      wiersz.setAttribute('aria-expanded', 'false');
      strzalka.querySelector('use').setAttribute('href', '#i-dol');
    };
    const wybierzRytm = (k) => {
      co = k;
      wybor.textContent = nazwa(k);
      zaznacz();
      zwin();
      wiersz.focus();
      odswiezUwage();
    };
    grupa.addEventListener('keydown', (ev) => {
      const krok = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
      const i = opcje.indexOf(document.activeElement);
      if (!krok || i < 0) return;
      ev.preventDefault();
      const nast = opcje[(i + krok + opcje.length) % opcje.length];
      for (const b of opcje) b.tabIndex = b === nast ? 0 : -1;
      nast.focus();
    });
    grupa.append(...opcje);
    zaznacz();
    powtarzanie = [wiersz, grupa, el('hr.menu-separator')];
  }

  // Na górze to, co robi się ze sprawą: „Zrobione” i (karteczka) „Otwórz w Notatkach”. Niżej inna pora.
  const gora = [
    aktywne && zalatw ? el('button.menu-pozycja', { type: 'button', onclick: () => { zamknijPopover(); zalatw(); } }, el('span', null, ikona('ptaszek'), 'Zrobione')) : null,
    otworz ? el('button.menu-pozycja', { type: 'button', onclick: () => { zamknijPopover(); otworz(); } }, el('span', null, ikona('notatka'), 'Otwórz w Notatkach')) : null,
  ].filter(Boolean);
  const zrobione = gora.length ? [...gora, el('hr.menu-separator')] : [];
  const e = popover(
    [
      el('div.naglowek-popovera.heading', { tekst: 'Przypomnienie' }),
      ...zrobione,
      ...(powtarzanie || []),
      ...gotowe,
      el('hr.menu-separator'),
      el('div.wiersz.bez-odstepu', null, pole, el('button.sugerowany', { type: 'button', onclick: ustawWlasne }, 'Ustaw')),
      uwaga,
      aktywne
        ? el('button.menu-pozycja.niszczacy', { type: 'button', onclick: () => { zamknijPopover(); ustaw(null); } }, el('span', null, ikona('kosz'), 'Usuń przypomnienie'))
        : null,
    ],
    kotwica,
    { etykieta: 'Przypomnienie' },
  );
  odswiezUwage();
  // Fokus na pierwszym terminie, jak przed powtarzaniem (popover dałby go wierszowi „Powtarzanie”).
  gotowe[0].focus();
  return e;
}
