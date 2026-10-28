// Porządki AI: polecenie → AI przez rdzeń (Windows: Kiro CLI, przeglądarka: własny serwer z kluczem Claude, który nigdy
// nie trafia do strony) → podgląd propozycji → przyjęcie całości albo wybranych → toast z „Cofnij”.

import { wywolaj, platforma } from './most.js';
import { el, ikona, $, $$, liczba, kiedy } from './pomoc.js';
import { S, aktualizujNotatki } from './stan.js';
import { toast, bladToast, ustawEkran, ogloszenie } from './ui.js';
import { rysujRoznice } from './historia.js';
import { zastosujZmiany, odswiezListe, cofnijPaczke, idsWidoku } from './lista.js';
import { przestawiane } from './kolejnosc.js';

const TYPY = {
  edytuj: 'Edycja',
  utworz: 'Nowa notatka',
  polacz: 'Połączenie duplikatów',
  taguj: 'Etykiety',
  archiwizuj: 'Archiwizacja',
  z_archiwum: 'Powrót z archiwum',
  do_kosza: 'Do kosza',
};

let zegar = null;

export async function otworzAi() {
  const { zamknijEdytor } = await import('./edytor.js');
  if (S.e) await zamknijEdytor({ bezOdswiezania: true, bezFokusu: true });
  S.ekranPrzedAi = S.ekran;
  ustawEkran('ai');
  $('#tresc').scrollTop = 0;
  // Bez AI na tym urządzeniu kursor zostaje, gdzie był: karta mówi, gdzie zrobić Porządki, a dalej nie ma dokąd iść.
  if (rysujStan()) $('#ai-polecenie').focus();
  rysujPaczki();
}

/**
 * Powrót do listy. Kursor wraca do wyszukiwarki, a gdy ta stoi samą lupą (js/app.js, dopasujSzukanie), na przycisk
 * Porządków AI w pasku bocznym: tam, skąd Jacek przyszedł, a Nowa notatka zostaje z napisem.
 */
export async function zamknijAi() {
  ustawEkran('lista');
  await odswiezListe();
  const s = $('#szukaj');
  const przycisk = $('#nav-ai');
  if (!$('#szukajka').classList.contains('zwinieta') || s.value) s.focus();
  else if (przycisk && przycisk.getClientRects().length) przycisk.focus();
}

/**
 * Stan przycisków i pól. Zwraca, czy AI działa na tym urządzeniu: Windows przez Kiro CLI (`ai: "kiro"` w opisie platformy,
 * Jacek 25.10.2026: „Przez Kiro”), przeglądarka przez własny serwer. Telefon i przeglądarka bez serwera mówią, że Porządki
 * robi się na komputerze, a zmiany przyjdą same.
 */
function rysujStan() {
  const jest = S.platforma.ai === 'kiro' || Boolean(S.platforma.ai_przez_serwer);
  $('#ai-niedostepne').hidden = jest;
  if (!jest) {
    const naWindows = platforma === 'windows';
    $('#ai-niedostepne-tytul').textContent = naWindows ? 'Najpierw Kiro CLI' : 'Porządki AI są na komputerze';
    $('#ai-niedostepne-opis').textContent = naWindows
      ? 'Zainstaluj je i zaloguj się, a Porządki pójdą z kredytów Kiro'
      : 'Zrób je w Notatkach na Windows, a zmiany przyjdą tu same';
  }
  // Bez AI pola stoją przygaszone (fieldset): widać, co będzie, a nic się nie klika i nie dostaje fokusu.
  $('#ai-pola').disabled = !jest;
  $('#ai-uruchom').disabled = !jest || Boolean(S.ai.trwa);
  $('#ai-podpowiedzi').replaceChildren(
    ...S.podpowiedziAi.map((p) =>
      el('button.chip', { type: 'button', onclick: () => { $('#ai-polecenie').value = p; $('#ai-polecenie').focus(); } }, p),
    ),
  );
  return jest;
}

async function wybraneIds() {
  const zakres = ($('input[name="ai-zakres"]:checked') || {}).value || 'wszystkie';
  if (zakres === 'archiwum') return [...S.notatki.values()].filter((n) => n.tresc.archiwum && !n.tresc.kosz).map((n) => n.id);
  // Okno trzyma czasem tylko pierwszą porcję wyniku – „ten widok” to zawsze cała lista.
  if (zakres === 'widok' && S.wynik) return idsWidoku();
  return null;
}

async function uruchom(ev) {
  ev.preventDefault();
  const polecenie = $('#ai-polecenie').value.trim();
  if (!polecenie || S.ai.trwa) return;
  const ids = await wybraneIds();
  // Dociąganie listy trwa chwilę – drugie „Uruchom” w tym czasie nie zaczyna drugiej analizy.
  if (S.ai.trwa) return;
  const ile = ids ? ids.length : [...S.notatki.values()].filter((n) => !n.tresc.kosz).length;
  if (!ile) {
    toast('W wybranym zakresie nie ma notatek');
    return;
  }
  const token = ++S.ai.token;
  S.ai.trwa = { start: Date.now(), token };
  S.ai.plan = null;
  $('#ai-plan').hidden = true;
  $('#ai-stan').hidden = false;
  $('#ai-uruchom').disabled = true;
  const opis = `AI analizuje ${liczba(ile, 'notatkę', 'notatki', 'notatek')}`;
  const tik = () => {
    const s = Math.round((Date.now() - S.ai.trwa.start) / 1000);
    $('#ai-stan-tekst').textContent = `${opis}… ${s} s`;
  };
  tik();
  clearInterval(zegar);
  zegar = setInterval(tik, 1000);
  try {
    const plan = await wywolaj('ai_zaproponuj', { polecenie, ids });
    if (S.ai.token !== token) return;
    S.ai.plan = plan;
    S.ai.polecenie = polecenie;
    rysujPlan();
  } catch (e) {
    if (S.ai.token === token) bladToast(e);
  } finally {
    if (S.ai.token === token) {
      clearInterval(zegar);
      S.ai.trwa = null;
      $('#ai-stan').hidden = true;
      rysujStan();
    }
  }
}

function anuluj() {
  S.ai.token += 1;
  S.ai.trwa = null;
  clearInterval(zegar);
  // Kiro CLI kończy się od razu, więc dalej nie liczy kredytów; odpowiedź serwera zostaje pominięta.
  if (S.platforma.ai === 'kiro') wywolaj('ai_anuluj').catch(() => {});
  $('#ai-stan').hidden = true;
  rysujStan();
  ogloszenie('Anulowano');
}

function tytulNotatki(n) {
  return (n && (n.tresc.tytul || (n.tresc.tekst || '').slice(0, 60))) || '(bez tytułu)';
}

function rysujPlan() {
  const plan = S.ai.plan;
  $('#ai-plan').hidden = false;
  $('#ai-podsumowanie').textContent = plan.podsumowanie || '';
  // Kredyty Kiro zużyte na te propozycje, drugim planem nad ostrzeżeniami (kredyty są Jacka).
  const k = Number(plan.kredyty) || 0;
  const koszt = k > 0 ? [el('p', { tekst: `Kredyty Kiro: ${k < 0.01 ? 'poniżej 0,01' : k.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}` })] : [];
  $('#ai-ostrzezenia').replaceChildren(...koszt, ...(plan.ostrzezenia || []).map((o) => el('p', { tekst: o })));
  const box = $('#ai-propozycje');
  if (!plan.propozycje.length) {
    box.replaceChildren(el('div.wiersz', null, el('span.przygaszony', { tekst: 'Nic do zmiany przy tym poleceniu' })));
    $('#ai-zastosuj').disabled = true;
    $('#ai-wszystkie').disabled = true;
    return;
  }
  $('#ai-wszystkie').disabled = false;
  $('#ai-wszystkie').checked = true;
  box.replaceChildren(
    ...plan.propozycje.map((p) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': `Przyjmij: ${p.opis}`, dataset: { id: p.id } });
      cb.checked = true;
      cb.addEventListener('change', liczWybrane);
      // Najpierw co się stanie (opis), pod spodem rodzaj zmiany i notatki, których dotyczy (drugim planem), niżej szczegóły.
      const meta = el(
        'div.propozycja-meta',
        null,
        el('span.propozycja-typ', { tekst: TYPY[p.typ] || p.typ }),
        p.przed && p.przed.length ? el('span.caption.przygaszony', { tekst: `Dotyczy: ${p.przed.map(tytulNotatki).join(' · ')}` }) : null,
      );
      const tresc = el('div.propozycja-tresc', null, el('span.heading', { tekst: p.opis }), meta);
      if (p.po && (p.typ === 'utworz' || p.typ === 'polacz' || p.typ === 'edytuj') && p.po.tytul) {
        tresc.append(el('p.caption', { tekst: `Tytuł: ${p.po.tytul}` }));
      }
      if (p.roznice && p.roznice.some(([z]) => z !== '=')) tresc.append(rysujRoznice(p.roznice));
      const tagi = [...(p.tagi_dodaj || []).map((t) => `+ ${t}`), ...(p.tagi_usun || []).map((t) => `− ${t}`)];
      if (tagi.length) tresc.append(el('div.chipy', null, ...tagi.map((t) => el('span.chip', { tekst: t }))));
      return el('label.propozycja', null, cb, tresc);
    }),
  );
  liczWybrane();
}

function liczWybrane() {
  const pola = $$('#ai-propozycje input[type="checkbox"]');
  const ile = pola.filter((c) => c.checked).length;
  $('#ai-zastosuj').textContent = ile === pola.length ? `Zastosuj wszystkie (${ile})` : `Zastosuj wybrane (${ile})`;
  $('#ai-zastosuj').disabled = !ile;
  const wszystkie = $('#ai-wszystkie');
  wszystkie.checked = ile === pola.length;
  wszystkie.indeterminate = ile > 0 && ile < pola.length;
}

async function zastosuj() {
  const plan = S.ai.plan;
  if (!plan) return;
  const wybrane = new Set($$('#ai-propozycje input[type="checkbox"]').filter((c) => c.checked).map((c) => c.dataset.id));
  const propozycje = plan.propozycje.filter((p) => wybrane.has(p.id));
  if (!propozycje.length) return;
  $('#ai-zastosuj').disabled = true;
  try {
    const r = await wywolaj('ai_zastosuj', { polecenie: S.ai.polecenie, propozycje });
    aktualizujNotatki(r.zmienione);
    zastosujZmiany(r);
    S.ai.plan = null;
    $('#ai-plan').hidden = true;
    const n = propozycje.length;
    toast(`Zastosowano ${liczba(n, 'zmianę AI', 'zmiany AI', 'zmian AI')}`, { przycisk: 'Cofnij', akcja: () => cofnijPaczke(r.paczka).then(rysujPaczki), czas: 10000 });
    rysujPaczki();
  } catch (e) {
    bladToast(e);
    $('#ai-zastosuj').disabled = false;
  }
}

export async function rysujPaczki() {
  const box = $('#ai-paczki');
  try {
    const { paczki } = await wywolaj('paczki_ai');
    // Bez zmian grupy nie ma: pierwszy ekran zostaje prosty. Zmiany od AI, także z Kiro przez MCP, pokażą się tu same.
    $('#ai-ostatnie').hidden = !paczki.length;
    if (!paczki.length) {
      box.replaceChildren();
      return;
    }
    box.replaceChildren(
      ...paczki.map((p) =>
        el(
          'div.wiersz',
          null,
          el('div.wiersz-tekst', null, el('span', { tekst: p.opis || 'Zmiana AI' }), el('span.caption.przygaszony', { tekst: `${kiedy(p.czas)} · ${liczba(p.notatek, 'notatka', 'notatki', 'notatek')}` })),
          p.cofnieta
            ? el('span.caption.przygaszony', { tekst: 'Cofnięto' })
            : el('button', { type: 'button', onclick: async () => { await cofnijPaczke(p.id); rysujPaczki(); } }, ikona('cofnij'), 'Cofnij'),
        ),
      ),
    );
  } catch (e) {
    bladToast(e);
  }
}

export function podepnijAi() {
  // Kolejność po swojemu (zasada 3 Jacka: co stoi w rzędzie, przestawia się): przykładowe polecenia, zakres i dwa działania
  // nad propozycjami przeciąga się myszą albo przestawia Alt+strzałką, kolejność zostaje, a Ctrl+Z cofa przestawienie.
  // Propozycje i ostatnie zmiany zostają w swojej kolejności, bo ta coś znaczy (od AI, od najnowszej).
  przestawiane($('#ai-podpowiedzi'), { grupa: 'ai-podpowiedzi', element: 'button', klucz: (b) => b.textContent, poziomo: true });
  przestawiane($('.porzadki .wybor'), { grupa: 'ai-zakres', element: 'label', klucz: (l) => l.querySelector('input').value, poziomo: true });
  przestawiane($('.ai-dzialania'), { grupa: 'ai-dzialania', element: 'label, button', klucz: (c) => c.id || c.querySelector('input').id, poziomo: true });
  $('#ai-formularz').addEventListener('submit', uruchom);
  $('#ai-anuluj').addEventListener('click', anuluj);
  $('#ai-zastosuj').addEventListener('click', zastosuj);
  $('#ai-wszystkie').addEventListener('change', (ev) => {
    for (const c of $$('#ai-propozycje input[type="checkbox"]')) c.checked = ev.target.checked;
    liczWybrane();
  });
}

/** Po zmianie ustawień (np. dodaniu klucza) – odśwież przycisk. */
export function aiPoZmianieUstawien() {
  if (S.ekran === 'ai') rysujStan();
}
