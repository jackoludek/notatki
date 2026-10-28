// Wspólne elementy interfejsu: toasty, popovery, menu, szczegóły błędów, przełączanie ekranów.

import { el, ikona, $, $$ } from './pomoc.js';
import { S } from './stan.js';

/**
 * Alert jak w macOS (reguła `bez-okienek.md`: pyta tylko przed czymś, co znika z widoku): ikonka, pogrubiony tytuł,
 * krótki opis, „Anuluj” i niebieski przycisk z czasownikiem po prawej. Return potwierdza, Escape anuluje.
 * Oddaje obietnicę: `true` – potwierdzone.
 */
export function alertMacOS({ znak = 'kosz', tytul, opis = '', przycisk }) {
  return new Promise((gotowe) => {
    const d = el('dialog.alert', { 'aria-labelledby': 'alert-tytul', 'aria-describedby': opis ? 'alert-opis' : null });
    let zamkniety = false;
    const koniec = (wynik) => {
      if (zamkniety) return;
      zamkniety = true;
      d.close();
      d.remove();
      gotowe(wynik);
    };
    const tak = el('button.sugerowany', { type: 'button', onclick: () => koniec(true) }, przycisk);
    d.append(
      el('span.alert-znak', { 'aria-hidden': 'true' }, ikona(znak)),
      el('h2.heading#alert-tytul', { tekst: tytul }),
      opis ? el('p.caption#alert-opis', { tekst: opis }) : null,
      el('div.alert-przyciski', null, el('button', { type: 'button', onclick: () => koniec(false) }, 'Anuluj'), tak),
    );
    d.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      koniec(false);
    });
    document.body.append(d);
    d.showModal();
    tak.focus();
  });
}
/** Komunikat dla czytnika ekranu (bez przeszkadzania wzrokowi). */
export function ogloszenie(tekst) {
  const o = $('#ogloszenie');
  o.textContent = '';
  requestAnimationFrame(() => {
    o.textContent = tekst;
  });
}

/** Toast (HIG: krótki tytuł, co najwyżej jeden przycisk, na dole na środku). */
export function toast(tekst, { przycisk = null, akcja = null, czas = 5000 } = {}) {
  const pojemnik = $('#toasty');
  while (pojemnik.childElementCount >= 3) pojemnik.firstElementChild.remove();
  let timer = null;
  const t = el('div.toast', { role: 'status' }, el('span', { tekst, title: tekst }));
  const usun = () => {
    clearTimeout(timer);
    t.remove();
  };
  if (przycisk && akcja) {
    t.append(el('button', { type: 'button', onclick: () => { usun(); akcja(); } }, przycisk));
  }
  t.append(el('button.zamknij-toast', { type: 'button', 'aria-label': 'Zamknij powiadomienie', onclick: usun }, ikona('zamknij')));
  const odliczaj = () => {
    clearTimeout(timer);
    timer = setTimeout(usun, czas);
  };
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', odliczaj);
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('focusout', odliczaj);
  pojemnik.append(t);
  odliczaj();
  return usun;
}

/** Błąd po ludzku; szczegóły techniczne tylko na życzenie. */
export function bladToast(e) {
  const komunikat = (e && e.komunikat) || 'Coś poszło nie tak';
  const szczegoly = (e && e.szczegoly) || (e && !e.komunikat && e.message) || null;
  console.error(komunikat, szczegoly || e);
  toast(komunikat, szczegoly ? { przycisk: 'Szczegóły', akcja: () => szczegolyBledu(komunikat, szczegoly), czas: 9000 } : { czas: 7000 });
}

// --- banery u góry: trwały stan (praca offline, druga karta przeglądarki) ---
// Zamyka je krzyżyk i przesunięcie palcem w lewo albo w prawo (reguła pelny-ekran-telefon, Jacek: „To mi zabiera real
// estate”), a zamknięty nie wraca, póki trwa ten sam stan. Stan nazywa `klucz`: ta sama wiadomość z nową liczbą to dalej
// ten sam baner. Gdy stan minie (bezBaneru), następny raz baner pokaże się znowu.
const zamknieteBanery = new Set();

/** Pokazuje albo zmienia baner `klucz`. Oddaje element albo null, gdy ten baner jest zamknięty. */
export function baner(klucz, tekst) {
  const box = $('#banery');
  if (!box) return null;
  let b = box.querySelector(`.baner[data-klucz="${klucz}"]`);
  if (zamknieteBanery.has(klucz)) {
    if (b) b.remove();
    return null;
  }
  if (!b) {
    b = el(
      'div.baner',
      { role: 'status', dataset: { klucz } },
      el('span.baner-tekst'),
      el('button.zamknij-baner', { type: 'button', 'aria-label': 'Zamknij wiadomość', onclick: () => zamknijBaner(b) }, ikona('zamknij')),
    );
    przesuwanyBaner(b);
    box.append(b);
  }
  b.querySelector('.baner-tekst').textContent = tekst;
  return b;
}

/** Stan minął: baner znika, a gdy stan wróci, pokaże się znowu, także po zamknięciu. */
export function bezBaneru(klucz) {
  zamknieteBanery.delete(klucz);
  const b = $(`#banery .baner[data-klucz="${klucz}"]`);
  if (b) b.remove();
}

function zamknijBaner(b, kierunek = 0) {
  zamknieteBanery.add(b.dataset.klucz);
  if (!kierunek) {
    b.remove();
    return;
  }
  b.style.transform = `translateX(${kierunek * b.offsetWidth}px)`;
  b.style.opacity = '0';
  setTimeout(() => b.remove(), 200);
}

// Baner jedzie w bok za palcem albo myszą, a po 30% szerokości (najmniej 64 px) odjeżdża i się zamyka. Krótsze przesunięcie
// wraca na miejsce. W pionie przewija się strona (touch-action: pan-y w styl.css), a przeglądarka kończy wtedy gest.
function przesuwanyBaner(b) {
  let start = null;
  b.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button')) return;
    start = { x: ev.clientX, id: ev.pointerId };
    b.setPointerCapture(ev.pointerId);
    b.style.transition = 'none';
  });
  b.addEventListener('pointermove', (ev) => {
    if (!start || ev.pointerId !== start.id) return;
    const dx = ev.clientX - start.x;
    b.style.transform = `translateX(${dx}px)`;
    b.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / b.offsetWidth));
  });
  const koniec = (ev) => {
    if (!start || ev.pointerId !== start.id) return;
    const dx = ev.clientX - start.x;
    start = null;
    b.style.transition = '';
    if (ev.type === 'pointerup' && Math.abs(dx) >= Math.max(64, b.offsetWidth * 0.3)) {
      zamknijBaner(b, Math.sign(dx));
      return;
    }
    b.style.transform = '';
    b.style.opacity = '';
  };
  b.addEventListener('pointerup', koniec);
  b.addEventListener('pointercancel', koniec);
}

export function szczegolyBledu(komunikat, szczegoly) {
  const d = el(
    'dialog',
    { 'aria-labelledby': 'blad-tytul' },
    el('header.dialog-naglowek', null, el('h2.heading#blad-tytul', { tekst: 'Szczegóły błędu' })),
    el('div.dialog-tresc', null, el('p', { tekst: komunikat }), el('pre.roznice', { tekst: String(szczegoly) })),
    el(
      'div.dialog-przyciski',
      null,
      el('button', { type: 'button', onclick: () => navigator.clipboard?.writeText(`${komunikat}\n${szczegoly}`) }, 'Kopiuj'),
      el('button.sugerowany', { type: 'button', onclick: () => d.close() }, 'Zamknij'),
    ),
  );
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

// --- popovery: jeden naraz, zamykane Esc, kliknięciem obok i utratą fokusu okna ---

let aktywny = null;

export function popoverOtwarty() {
  return Boolean(aktywny);
}

export function zamknijPopover(przywrocFokus = true) {
  if (!aktywny) return;
  const { e, kotwica, poZamknieciu } = aktywny;
  aktywny = null;
  e.remove();
  if (kotwica instanceof HTMLElement) {
    kotwica.setAttribute('aria-expanded', 'false');
    if (przywrocFokus && document.contains(kotwica)) kotwica.focus();
  }
  if (poZamknieciu) poZamknieciu();
}

/** Popover przy przycisku (kotwica: element) albo w punkcie kliknięcia (kotwica: {x, y}). */
export function popover(zawartosc, kotwica, { rola = 'dialog', etykieta = '', poZamknieciu = null } = {}) {
  zamknijPopover(false);
  const e = el('div.popover', { role: rola, 'aria-label': etykieta || null, tabindex: '-1' });
  e.append(...[zawartosc].flat().filter(Boolean));
  document.body.append(e);
  const przycisk = kotwica instanceof HTMLElement;
  const r = przycisk ? kotwica.getBoundingClientRect() : { left: kotwica.x, right: kotwica.x, top: kotwica.y, bottom: kotwica.y };
  const w = e.offsetWidth;
  const h = e.offsetHeight;
  let x = przycisk ? r.right - w : r.left;
  if (x < 8) x = r.left;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = r.bottom + 4;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  if (przycisk) kotwica.setAttribute('aria-expanded', 'true');
  aktywny = { e, kotwica, poZamknieciu };
  // Fokus na bieżącym kolorze, gdy menu zaczyna się od kolorów – pod kółkami widać wtedy jego nazwę.
  // Dwa osobne zapytania: lista selektorów oddałaby pierwszy pasujący w dokumencie, czyli „Bez koloru”.
  const pierwszy = e.querySelector('.paleta-kolor[aria-checked="true"]') || e.querySelector('input:not([type="checkbox"]), button:not([disabled]), input');
  (pierwszy || e).focus();
  return e;
}

/**
 * Menu (HIG: czasowniki, grupy rozdzielone liniami, skróty po prawej). Pozycja może mieć `probka`
 * (klasa koloru – kółko przed nazwą, 'brak' – puste kółko), `styl` (klasa nazwy, na przykład
 * rozmiar pisma), `zaznaczone` (wybór z listy: ptaszek po prawej), `przelacznik` (włączone albo
 * nie, też z ptaszkiem) i `niszczacy` (na czerwono, na przykład usuwanie).
 */
export function menu(pozycje, kotwica, etykieta = 'Menu') {
  const e = [];
  for (const p of pozycje) {
    if (!p) continue;
    if (p === '-') {
      if (e.length) e.push(el('hr.menu-separator', { role: 'separator' }));
      continue;
    }
    if (p.paleta) {
      e.push(paleta(p));
      continue;
    }
    const wybor = p.zaznaczone !== undefined || p.przelacznik !== undefined;
    const wlaczone = Boolean(p.zaznaczone || p.przelacznik);
    e.push(
      el(
        `button.menu-pozycja${p.niszczacy ? '.niszczacy' : ''}`,
        {
          type: 'button',
          role: p.przelacznik !== undefined ? 'menuitemcheckbox' : wybor ? 'menuitemradio' : 'menuitem',
          'aria-checked': wybor ? String(wlaczone) : null,
          disabled: p.wylaczone || null,
          onclick: () => {
            zamknijPopover();
            p.akcja();
          },
        },
        el(
          'span',
          null,
          p.ikona ? ikona(p.ikona) : null,
          p.probka ? el(`span.probka.${p.probka}`, { 'aria-hidden': 'true' }) : null,
          p.styl ? el(`span.${p.styl}`, { tekst: p.tekst }) : p.tekst,
        ),
        p.skrot ? el('kbd.skrot', { tekst: p.skrot }) : wybor && wlaczone ? ikona('ptaszek', 'zaznaczone') : null,
      ),
    );
  }
  return popover(e, kotwica, { rola: 'menu', etykieta });
}

/**
 * Kolory w menu: same kółka w kolorach Apple, bez nazw na widoku (Jacek, 15.10.2026: „picture saves 1000 words”).
 * Nazwa koloru jest w dymku i dla czytnika ekranu, a bieżący kolor ma pierścień, więc kolor nie jest jedyną informacją.
 * `p.paleta` = { kolory: [[klucz, nazwa], …], wartosc, akcja }. Strzałki w lewo i w prawo chodzą po kółkach,
 * w górę i w dół do reszty menu.
 */
function paleta(p) {
  const { kolory, wartosc, akcja } = p.paleta;
  const kolka = kolory.map(([k, n]) =>
    el(
      'button.paleta-kolor',
      {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': k === wartosc ? 'true' : 'false',
        'aria-label': n,
        title: n,
        dataset: { kolor: k },
        onclick: () => {
          zamknijPopover();
          akcja(k);
        },
      },
      el('span.probka', { 'aria-hidden': 'true' }),
    ),
  );
  return el('div.paleta-wiersz', null, el('div.paleta', { role: 'group', 'aria-label': p.tekst || 'Kolor' }, kolka));
}

document.addEventListener(
  'pointerdown',
  (ev) => {
    if (!aktywny) return;
    const w = aktywny.e.contains(ev.target) || (aktywny.kotwica instanceof HTMLElement && aktywny.kotwica.contains(ev.target));
    if (!w) zamknijPopover(false);
  },
  true,
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (!aktywny) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      zamknijPopover();
      return;
    }
    if (aktywny.e.getAttribute('role') !== 'menu') return;
    const akt = document.activeElement;
    const wPalecie = (b) => Boolean(b && b.classList && b.classList.contains('paleta-kolor'));
    if (wPalecie(akt) && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      const kolka = $$('.paleta-kolor', akt.parentElement);
      ev.preventDefault();
      kolka[(kolka.indexOf(akt) + (ev.key === 'ArrowRight' ? 1 : -1) + kolka.length) % kolka.length].focus();
      return;
    }
    // Kółka kolorów to jeden przystanek strzałek w górę i w dół: bieżący kolor albo ten z fokusem.
    const reprezentant = wPalecie(akt) ? akt : aktywny.e.querySelector('.paleta-kolor[aria-checked="true"]') || aktywny.e.querySelector('.paleta-kolor');
    const p = $$('[role^="menuitem"]:not([disabled])', aktywny.e).filter((b) => !wPalecie(b) || b === reprezentant);
    const i = p.indexOf(document.activeElement);
    let j = null;
    if (ev.key === 'ArrowDown') j = (i + 1) % p.length;
    else if (ev.key === 'ArrowUp') j = (i - 1 + p.length) % p.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = p.length - 1;
    if (j !== null && p.length) {
      ev.preventDefault();
      p[j].focus();
    }
  },
  true,
);

window.addEventListener('blur', () => zamknijPopover(false));

// Przyciski [data-zamknij] zamykają swoje okno dialogowe.
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-zamknij]');
  if (b) b.closest('dialog')?.close();
});

/** Wąski ekran (telefon, wąskie okno): widać listę albo notatkę, nie obie naraz. */
export function waski() {
  return window.matchMedia('(max-width: 760px)').matches;
}

/**
 * Przełącza ekran: „lista” (nic nie jest otwarte), „edytor” (notatka obok listy) albo „ai”
 * (Porządki AI obok listy). Na szerokim ekranie lista stoi zawsze; na wąskim CSS pokazuje
 * jedną kolumnę według `data-ekran`. Nagłówek zmienia się razem z widokiem (HIG).
 */
export function ustawEkran(ekran) {
  S.ekran = ekran;
  const edytor = ekran === 'edytor';
  const ai = ekran === 'ai';
  const zazn = S.zaznaczone.size > 0;
  document.body.dataset.ekran = ekran;
  $('#widok-edytor').hidden = !edytor;
  $('#widok-ai').hidden = !ai;
  // Porządki AI w pasku bocznym są przełącznikiem: wciśnięte, póki stoją obok listy (drugi klik zamyka, js/app.js).
  const przyciskAi = document.getElementById('nav-ai');
  if (przyciskAi) przyciskAi.setAttribute('aria-pressed', String(ai));
  $('#pusty-panel').hidden = edytor || ai;
  $('#przyciski-edytora').hidden = !edytor;
  $('#narzedzia-tekstu').hidden = !edytor;
  if (!edytor) {
    $('#panel-formatu').hidden = true;
    $('#e-aa').setAttribute('aria-expanded', 'false');
  }
  $('#pasek-akcji').hidden = !zazn;
  $('#anuluj-zaznaczanie').hidden = !zazn;
  $('#szukajka').hidden = zazn;
  $('#nowa').hidden = zazn;
  const tytul = $('#tytul-widoku');
  tytul.hidden = !zazn;
}
