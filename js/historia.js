// Historia wersji notatki: przeglądanie krok po kroku, różnice, przywrócenie dowolnej wersji.
// Przywrócenie to nowa wersja – nic nie znika, a przywrócenie też da się cofnąć.

import { wywolaj } from './most.js';
import { el, $, $$, pelnaData } from './pomoc.js';
import { S, aktualizujNotatki, tekstNotatki } from './stan.js';
import { toast, bladToast, ogloszenie } from './ui.js';

const ZRODLA = {
  ja: 'Twoja zmiana',
  ai: 'Zmiana AI',
  import: 'Import z Google Keep',
  scalenie: 'Połączenie zmian z dwóch urządzeń',
  przywrocenie: 'Przywrócenie',
  migawka: 'Przywrócenie z migawki',
};

export async function otworzHistorie(id) {
  try {
    const { wersje } = await wywolaj('historia', { id });
    if (!wersje.length) {
      toast('Ta notatka nie ma jeszcze historii');
      return;
    }
    S.h = { id, wersje, i: 0 };
    rysujListeWersji();
    const d = $('#d-historia');
    d.showModal();
    await wybierz(0);
  } catch (e) {
    bladToast(e);
  }
}

function rysujListeWersji() {
  const box = $('#h-lista');
  box.replaceChildren(
    ...S.h.wersje.map((w, i) => {
      const gora = el('span.heading', null, i === 0 ? 'Obecna wersja' : pelnaData(w.czas));
      if (w.zrodlo === 'ai') gora.append(' ', el('span.chip.ai', { tekst: 'AI' }));
      const zrodlo = ZRODLA[w.zrodlo] || w.zrodlo;
      const kto = w.zrodlo === 'ja' && w.urzadzenie ? ` · ${w.urzadzenie}` : '';
      return el(
        'button',
        { type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', dataset: { i: String(i) }, onclick: () => wybierz(i) },
        gora,
        el('span.caption.przygaszony', { tekst: `${i === 0 ? `${pelnaData(w.czas)} · ` : ''}${zrodlo}${kto}` }),
        w.opis ? el('span.caption.przygaszony', { tekst: w.opis }) : null,
      );
    }),
  );
}

export function rysujRoznice(roznice) {
  const pre = el('pre.roznice');
  for (const [znak, linia] of roznice) {
    const klasa = znak === '+' ? 'plus' : znak === '-' ? 'minus' : 'rowne';
    pre.append(el(`span.${klasa}`, { tekst: linia || ' ' }));
  }
  return pre;
}

async function wybierz(i) {
  const h = S.h;
  if (!h) return;
  h.i = Math.max(0, Math.min(i, h.wersje.length - 1));
  for (const b of $$('#h-lista button')) {
    const tak = Number(b.dataset.i) === h.i;
    b.setAttribute('aria-selected', tak ? 'true' : 'false');
    b.tabIndex = tak ? 0 : -1;
    if (tak) {
      b.focus({ preventScroll: true });
      b.scrollIntoView({ block: 'nearest' });
    }
  }
  const w = h.wersje[h.i];
  const obecna = h.wersje[0];
  const p = $('#h-podglad');
  p.replaceChildren(el('p.title-4', { tekst: w.tresc.tytul || '(bez tytułu)' }));
  if (h.i === 0) {
    p.append(el('pre.roznice', { tekst: tekstNotatki(w.tresc) || '(pusta)' }));
  } else {
    try {
      const { roznice } = await wywolaj('roznice', { a: tekstNotatki(obecna.tresc), b: tekstNotatki(w.tresc) });
      if (S.h !== h || h.i !== h.wersje.indexOf(w)) return;
      const zmiany = roznice.filter(([z]) => z !== '=').length;
      p.append(
        el('p.caption.przygaszony', { tekst: zmiany ? 'Po przywróceniu wiersze zielone wrócą, a przekreślone znikną' : 'Tekst taki sam jak obecnie' }),
        rysujRoznice(roznice),
      );
    } catch (e) {
      bladToast(e);
    }
    const tagiPrzed = (obecna.tresc.tagi || []).join(', ');
    const tagiPo = (w.tresc.tagi || []).join(', ');
    if (tagiPrzed !== tagiPo) p.append(el('p.caption', { tekst: `Etykiety: ${tagiPo || 'brak'} (teraz: ${tagiPrzed || 'brak'})` }));
    if ((obecna.tresc.tytul || '') !== (w.tresc.tytul || '')) p.append(el('p.caption', { tekst: `Tytuł teraz: ${obecna.tresc.tytul || '(bez tytułu)'}` }));
  }
  $('#h-przywroc').disabled = h.i === 0;
  $('#h-starsza').disabled = h.i >= h.wersje.length - 1;
  $('#h-nowsza').disabled = h.i === 0;
}

async function przywroc() {
  const h = S.h;
  if (!h || h.i === 0) return;
  const w = h.wersje[h.i];
  const poprzednia = h.wersje[0].id;
  try {
    const r = await wywolaj('przywroc_wersje', { id: h.id, wersja: w.id });
    aktualizujNotatki([r.notatka]);
    $('#d-historia').close();
    const { zastosujZmiany, odswiezListe } = await import('./lista.js');
    zastosujZmiany({ zmienione: [r.notatka], tagi: r.tagi });
    const { odswiezOtwarty } = await import('./edytor.js');
    odswiezOtwarty([r.notatka]);
    await odswiezListe();
    toast(`Przywrócono wersję z ${pelnaData(w.czas)}`, {
      przycisk: 'Cofnij',
      czas: 8000,
      akcja: async () => {
        try {
          const c = await wywolaj('przywroc_wersje', { id: h.id, wersja: poprzednia });
          zastosujZmiany({ zmienione: [c.notatka], tagi: c.tagi });
          odswiezOtwarty([c.notatka]);
          await odswiezListe();
          ogloszenie('Cofnięto przywrócenie');
        } catch (e) {
          bladToast(e);
        }
      },
    });
  } catch (e) {
    bladToast(e);
  }
}

export function podepnijHistorie() {
  $('#h-przywroc').addEventListener('click', przywroc);
  $('#h-starsza').addEventListener('click', () => wybierz(S.h.i + 1));
  $('#h-nowsza').addEventListener('click', () => wybierz(S.h.i - 1));
  $('#h-lista').addEventListener('keydown', (ev) => {
    if (!S.h) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      wybierz(S.h.i + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      wybierz(S.h.i - 1);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      wybierz(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      wybierz(S.h.wersje.length - 1);
    } else if (ev.key === 'Enter' && S.h.i > 0) {
      ev.preventDefault();
      przywroc();
    }
  });
  $('#d-historia').addEventListener('close', () => {
    S.h = null;
  });
}
