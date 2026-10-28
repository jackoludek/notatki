// iKeeper – start interfejsu, pasek nagłówka, skróty klawiszowe, zdarzenia z rdzenia, pomiary.

import { wywolaj, nasluchuj, okno, sygnal, platforma, naTauri, drogi } from './most.js';
import { $, $$, czekaj, poKlatce, liczba, kiedy, motywSystemu, strefaUrzadzenia, ustawDymek } from './pomoc.js';
import { S, aktualizujNotatki, zapamietajCofniecie, wczytajMiejsce } from './stan.js';
import { toast, bladToast, popoverOtwarty, zamknijPopover, waski, ogloszenie, baner, bezBaneru } from './ui.js';
import {
  odswiezListe, ustawZapytanie, ustawWidok, rysujPasek, podepnijListe, przeliczStatystyke,
  wyczyscZaznaczenie, zaznaczWszystkie, cofnijOstatnie, ponowOstatnie, cofnijPaczke, pierwszyWpis, ostatnieOdswiezenie, ustawNastepne, odswiezPrzypomnienia,
  dzialanie, przypomnijODuzymKoszu, idsWidoku, przewinListeDo,
} from './lista.js';
import {
  otworzEdytor, zamknijEdytor, zapiszWersje, podepnijEdytor, odswiezOtwarty, dodajPliki, edytorOtwarty, historiaNotatki, menuWiecej, chwilowyStan,
  otworzWMiejscu, wrocFokusDoNotatki,
} from './edytor.js';
import { podepnijHistorie } from './historia.js';
import { otworzAi, zamknijAi, podepnijAi } from './ai.js';
import { przestawiane } from './kolejnosc.js';
import { podepnijUklad } from './uchwyty.js';
import { otworzSciage, zamknijSciage, podepnijSciage } from './sciaga.js';
import { podepnijDymki } from './dymki.js';
import { podepnijArkusze } from './arkusze.js';
import { podepnijPowiekszenie, przywrocPowiekszenie } from './powiekszenie.js';
import { swiatloPrzyciskow } from './guziki.js';
import {
  zastosujUstawienia, przelaczUstawienie, otworzUstawienia, otworzSkroty, podepnijLogowanie, otworzLogowanie, odswiezOpisWymiany, stronaBezSerwera,
} from './ustawienia.js';

// Motyw idzie zawsze za systemem, bez przełącznika (decyzja Jacka z 10.10.2026) – ustawiony
// przed pierwszym rysowaniem. Wybór zapamiętany przez dawny przełącznik znika.
document.documentElement.dataset.motyw = motywSystemu();
try {
  localStorage.removeItem('motyw');
} catch {
  /* bez pamięci przeglądarki */
}

window.addEventListener('error', (e) => sygnal('blad_ui', { tekst: `${e.message} @ ${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => sygnal('blad_ui', { tekst: `Promise: ${(e.reason && (e.reason.komunikat || e.reason.message)) || e.reason}` }));

/** Wczytuje wszystko od nowa (start, po imporcie). */
export async function przeladuj() {
  // Strefa urządzenia (Intl) – w niej liczy się powtarzanie przypomnień.
  const d = await wywolaj('start', { strefa: strefaUrzadzenia() || undefined });
  S.strefa = d.strefa || '';
  ustawNastepne(d.przypomnienia);
  S.notatki = new Map(d.notatki.map((n) => [n.id, n]));
  S.tagi = d.tagi;
  S.ustawienia = d.ustawienia;
  S.statystyka = d.statystyka;
  S.kolory = d.kolory;
  S.modele = d.modele_ai;
  S.podpowiedziAi = d.podpowiedzi_ai;
  S.urzadzenie = d.urzadzenie;
  S.wersja = d.wersja;
  S.platforma = d.platforma || {};
  if (d.sync) S.sync = d.sync;
  zastosujUstawienia();
  przeliczStatystyke();
  rysujPasek();
  rysujStanSync();
  await odswiezListe();
}

async function start() {
  document.body.classList.add(platforma);
  // Dymki i arkusze najpierw: zanim cokolwiek się pokaże, dymki systemu (title) przechodzą do dymków iKeepera.
  podepnijDymki();
  podepnijArkusze();
  swiatloPrzyciskow();
  if (!naTauri) {
    const { uruchomWeb } = await import('./web.js');
    await uruchomWeb();
  }
  podepnijNaglowek();
  podepnijListe();
  podepnijEdytor();
  podepnijHistorie();
  podepnijAi();
  podepnijLogowanie();
  podepnijKlawiature();
  podepnijPowiekszenie();
  podepnijSchowekIUpuszczanie();
  // Widok, w którym skończyła się praca (wrocDoPracy), od razu: lista rysuje się raz, już w nim.
  const miejsce = wczytajMiejsce();
  if (WIDOKI_PRACY.has(miejsce.widok)) {
    S.widok = miejsce.widok === 'oproznione' ? 'kosz' : miejsce.widok;
    S.tag = typeof miejsce.tag === 'string' && miejsce.tag ? miejsce.tag : null;
  }
  try {
    await przeladuj();
    // Etykieta, której już nie ma (usunięta na innym urządzeniu): sam widok bez niej.
    if (S.tag && !S.tagi.some(([t]) => t === S.tag)) await ustawWidok(S.widok);
  } catch (e) {
    bladToast(e);
    return;
  }
  przypomnijODuzymKoszu().catch(() => {});
  await nasluchuj('pokaz', pokazano);
  await nasluchuj('zmiany', zmianyZZewnatrz);
  await nasluchuj('sync', (s) => {
    const klucz = (x) => (x ? `${x.polaczona}|${x.stan}|${(x.wymiana || {}).stan}` : '');
    const byl = klucz(S.sync);
    S.sync = s;
    rysujStanSync();
    odswiezOpisWymiany();
    // Pusty ekran telefonu opisuje stan połączenia – odświeżamy go, gdy ten stan się zmieni.
    if (!S.notatki.size && byl !== klucz(s)) odswiezListe().catch(() => {});
  });
  await nasluchuj('komunikat', (k) => toast(k.tekst, { czas: k.czas || 6000 }));
  // Kliknięte przypomnienie na Windows (win.rs) otwiera swoją notatkę.
  await nasluchuj('otworz-notatke', (k) => otworzZPowiadomienia(k.id));
  // Zmiana z karteczki na pulpicie (drugie okno, polecenia.rs): jak zmiana z zewnątrz. Własne zmiany okno już ma.
  await nasluchuj('zmiany-okna', (z) => {
    if (z.zrodlo !== 'glowne') zmianyZZewnatrz(z);
  });
  if (naTauri) {
    // Okno na wierzchu: pliki innych urządzeń sprawdzane co 10 s, schowane – co minutę, a po powrocie
    // od razu. Schowana aplikacja najpierw zapisuje wersję z otwartej notatki: plik wymiany idzie
    // zaraz potem i ma ją już w sobie. Na Windows stan na start i przy chowaniu do zasobnika zna samo
    // okno (main.rs, okno_aktywne): tam strona uważa się za widoczną zawsze.
    const widocznosc = async () => {
      if (document.hidden && S.e) await zapiszWersje().catch(() => {});
      wywolaj('widocznosc', { widoczne: !document.hidden }).catch(() => {});
    };
    document.addEventListener('visibilitychange', widocznosc);
    if (platforma === 'android') widocznosc();
  }
  if (platforma === 'android') {
    // WebView Androida gubi nazwę przycisku z aria-haspopup="menu": TalkBack mówi samo „przycisk”
    // (zmierzone 13.10.2026, Więcej i formatowanie). Na telefonie to zwykłe przyciski z nazwą.
    for (const b of $$('[aria-haspopup="menu"]')) b.removeAttribute('aria-haspopup');
    // Przycisk i gest „wstecz” obsługuje aktywność Android (MainActivity.kt) przez tę funkcję:
    // zamyka to, co jest na wierzchu; `false` – nic nie było otwarte, aplikacja idzie w tło.
    window.__notatkiWstecz = () => {
      // Najpierw okno z zasłoną, bo stoi nad ściągą, która jest obok pracy.
      const d = document.querySelector('dialog:modal') || document.querySelector('dialog[open]');
      if (d) {
        d.close();
        return true;
      }
      if (popoverOtwarty()) {
        zamknijPopover();
        return true;
      }
      if (S.zaznaczone.size) {
        wyczyscZaznaczenie();
        return true;
      }
      if (document.body.classList.contains('pasek-otwarty')) {
        document.body.classList.remove('pasek-otwarty');
        return true;
      }
      if (S.ekran !== 'lista') {
        wstecz();
        return true;
      }
      if ($('#szukaj').value) {
        $('#szukaj').value = '';
        ustawZapytanie('');
        return true;
      }
      return false;
    };
    const { uruchomTelefon } = await import('./telefon.js');
    await uruchomTelefon({
      poZmianach: async () => {
        przeliczStatystyke();
        rysujPasek();
        await odswiezListe();
      },
      otworz: (id) => otworzEdytor(id),
      zPowiadomienia: otworzZPowiadomienia,
      zalatw: zalatwZPowiadomienia,
    });
  } else {
    kursorWSzukaniu();
  }
  // Pierwsze otwarcie wersji web: bez połączenia z serwerem nie ma jeszcze żadnych notatek.
  // Strona z GitHub Pages nie ma serwera: łączy ją link z Pulpitu, a nie okno logowania.
  if (platforma === 'web' && !stronaBezSerwera() && !(S.sync && S.sync.polaczona) && S.notatki.size === 0) otworzLogowanie();
  // Zapisane powiększenie i krój przed pokazaniem okna – bez mignięcia w 100 % i w kroju systemu.
  await przywrocPowiekszenie().catch(() => {});
  await Promise.race([document.fonts ? document.fonts.ready : null, czekaj(400)]);
  // Powrót do pracy przed pokazaniem okna, po powiększeniu i kroju, bo od nich zależy przewinięcie.
  await wrocDoPracy(miejsce, { lista: true }).catch((e) => sygnal('blad_ui', { tekst: `Powrót do pracy: ${(e && e.message) || e}` }));
  const tryb = await sygnal('gotowe', {});
  if (tryb && tryb.pomiar) pomiarUi();
}

/**
 * Kliknięte albo dotknięte przypomnienie otwiera swoją notatkę, a nie samą listę (Windows: win.rs,
 * Android: MainActivity.kt). Okienka na wierzchu zamykamy, bo zasłoniłyby notatkę. Na telefonie
 * bez kursora w tekście: przypomnienie się czyta, a klawiatura zasłoniłaby pół notatki.
 */
/**
 * „Zrobione” w przypomnieniu na telefonie (Przypomnienia.kt). Tylko sprawa, której pora nadeszła: stare powiadomienie
 * nie załatwia następnego terminu, gdy komputer już ją załatwił. Wynik jak na liście: komunikat z „Cofnij”.
 */
async function zalatwZPowiadomienia(id) {
  const n = id && S.notatki.get(id);
  const p = n && n.tresc.przypomnienie;
  if (!p || p.zrobione || p.czas > Date.now()) return;
  await dzialanie([id], { typ: 'zalatwione' }, 'Zrobione');
  odswiezPrzypomnienia();
}

async function otworzZPowiadomienia(id) {
  if (!id) return;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  await otworzEdytor(id, { bezFokusu: platforma === 'android' });
}

// --- pasek nagłówka ---

function podepnijNaglowek() {
  // Szerokości kolumn, położenie tekstu i napis „Schowaj / Pokaż pasek boczny” (js/uchwyty.js).
  podepnijUklad();
  podepnijSciage();
  $('#pasek-przelacz').addEventListener('click', przelaczPasek);
  $('#wstecz').addEventListener('click', wstecz);
  $('#nowa').addEventListener('click', () => otworzEdytor(null));
  $('#sam-tekst').addEventListener('click', () => przelaczSamTekst());
  // Notatka zamknięta (Escape, kosz, inna droga): sam tekst się kończy, bo bez notatki nie ma czego czytać.
  new MutationObserver(() => {
    if (document.body.dataset.ekran !== 'edytor' && document.body.classList.contains('sam-tekst')) przelaczSamTekst(false);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-ekran'] });
  // W przeglądarce Escape kończy pełny ekran sam: wtedy wracają też panele.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('sam-tekst')) przelaczSamTekst(false);
  });
  $('#nowa-dol').addEventListener('click', () => otworzEdytor(null));
  $('#anuluj-zaznaczanie').addEventListener('click', wyczyscZaznaczenie);
  $('#nav-ai').addEventListener('click', () => {
    zamknijWysuniety();
    // Drugi klik zamyka Porządki, jak „i” ściągę: przycisk ma stan wciśnięty (js/ui.js, ustawEkran).
    if (S.ekran === 'ai') zamknijAi();
    else otworzAi();
  });
  $('#nav-ustawienia').addEventListener('click', () => {
    zamknijWysuniety();
    otworzUstawienia();
  });
  // Wysunięty pasek boczny (okno do 1100 px) chowa się po stuknięciu obok.
  document.addEventListener('pointerdown', (ev) => {
    if (document.body.classList.contains('pasek-otwarty') && !ev.target.closest('#pasek, #pasek-przelacz')) zamknijWysuniety();
  });
  ulozNarzedzia();
  window.matchMedia('(max-width: 760px)').addEventListener('change', ulozNarzedzia);
  // Przyciski do przestawienia myszą albo Alt+strzałką; kolejność zostaje na tym urządzeniu.
  const wiersz = (f) => (li) => f(li.querySelector('button'));
  przestawiane($('#widoki'), { grupa: 'widoki', element: 'li', klucz: wiersz((b) => b.dataset.widok) });
  przestawiane($('#pasek .dol-paska'), { grupa: 'dol-paska', element: 'li', klucz: wiersz((b) => b.id) });
  przestawiane($('#narzedzia-tekstu'), { grupa: 'narzedzia', element: 'button', klucz: (b) => b.id, poziomo: true });
  przestawiane($('#pasek-formatu'), { grupa: 'formatowanie', element: 'button', klucz: (b) => b.dataset.fmt || b.id, poziomo: true });
  // Klucz „przyciski-notatki” od 27.10.2026, gdy doszły pinezka i kolor: zapisana kolejność dawnej pary (dzwonek, Więcej)
  // postawiłaby nowe koła za Więcej (js/kolejnosc.js dokłada nowe na koniec), a Więcej stoi ostatnie.
  przestawiane($('#przyciski-edytora'), { grupa: 'przyciski-notatki', element: 'button', klucz: (b) => b.id, poziomo: true });
  // Pasek nad notatką (zadanie 26, Jacek: „ona musi być jako całość też dragable i te co są … z prawej strony, czyli chmura
  // i dzwonek”): Sam tekst, grupa narzędzi, chmura i grupa działań notatki zmieniają miejsce w pasku, także przez
  // odstęp na drugą stronę. Grupę chwyta się między przyciskami albo przy nich (js/kolejnosc.js), z klawiatury Alt+← →
  // na samej grupie. Przyciski w grupie dalej zmieniają miejsce w grupie. Wstecz (wąski ekran) stoi zawsze pierwszy.
  const CZESCI_PASKA = {
    'sam-tekst': 'Sam tekst', 'narzedzia-tekstu': 'Narzędzia tekstu', 'stan-sync': 'Stan synchronizacji',
    'przyciski-edytora': 'Działania notatki', rozpychacz: 'Odstęp',
  };
  przestawiane($('#naglowek .n-tresc'), {
    grupa: 'pasek-notatki',
    element: '#sam-tekst, #narzedzia-tekstu, .rozpychacz, #stan-sync, #przyciski-edytora',
    klucz: (c) => c.id || 'rozpychacz',
    poziomo: true,
    uchwyt: (c) => (c.classList.contains('rozpychacz') ? [] : [c]),
    fokus: true,
    nazwa: (c) => CZESCI_PASKA[c.id || 'rozpychacz'],
  });
  // Pasek nad listą (zasada 3 z „05 --- Jacek Design Guidelines”: wszystko, co stoi w rzędzie): Szukaj i Nowa notatka
  // zamieniają się miejscami. Chwyta się Nową notatkę, bo pole szukania zostaje polem do pisania, a Alt+← działa w nim
  // jak dotąd. Przycisk paska bocznego stoi z brzegu, bo należy do paska bocznego.
  przestawiane($('#naglowek .n-lista'), {
    grupa: 'pasek-listy',
    element: '#szukajka, #nowa',
    klucz: (c) => c.id,
    poziomo: true,
    uchwyt: (c) => (c.id === 'nowa' ? [c] : []),
    fokus: true,
    nazwa: (c) => (c.id === 'nowa' ? 'Nowa notatka' : 'Szukaj'),
  });
  // Pole szukania w ciasnym pasku listy zwija się do okrągłego przycisku z lupą: dopasujSzukanie po każdej zmianie jego
  // miejsca i wielkości, w następnej klatce. Każde zwinięcie i rozwinięcie zmienia szerokość pola, więc tu wraca też dymek.
  // Fokus rozwija pole, a dymek zasłaniałby pisanie: fokus zdejmuje go, zanim js/dymki.js go pokaże (słucha wyżej, na dokumencie).
  const obserwatorSzukania = new ResizeObserver(() => {
    cancelAnimationFrame(klatkaSzukania);
    klatkaSzukania = requestAnimationFrame(dopasujSzukanie);
  });
  for (const e of [$('#szukajka'), $('#szukaj')]) obserwatorSzukania.observe(e);
  document.fonts.ready.then(dopasujSzukanie);
  // Pasek nad listą kończy się równo z kafelkami, a kafelek pod kursorem nie wychodzi poza zapas kolumny: --rynna-listy to
  // miejsce na pasek przewijania listy (przy myszy stałe, na dotyku 0), --kafel-rosnie i --kafel-rosnie-wcisniety to 4 % i 6 %
  // wzrostu kafelka, najwyżej tyle, ile mieści się w wypełnieniu kolumny razem z pierścieniem otwartego (4 px, styl.css).
  // Zmiana w następnej klatce, jak przy szukaniu (zmiana w samym ResizeObserver dawałaby błąd pętli).
  const kolumna = $('#kolumna-listy');
  const zapasListy = () => {
    const cs = getComputedStyle(kolumna);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const szer = kolumna.clientWidth - pl - pr;
    const max = szer > 0 ? 1 + (2 * Math.max(0, Math.min(pl, pr) - 4)) / szer : 1;
    const s = document.documentElement.style;
    s.setProperty('--rynna-listy', `${Math.max(0, kolumna.offsetWidth - kolumna.clientWidth)}px`);
    s.setProperty('--kafel-rosnie', Math.min(1.04, max).toFixed(4));
    s.setProperty('--kafel-rosnie-wcisniety', Math.min(1.06, max).toFixed(4));
  };
  let klatkaListy = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(klatkaListy);
    klatkaListy = requestAnimationFrame(zapasListy);
  }).observe(kolumna);
  zapasListy();
  $('#szukajka').addEventListener('focusin', () => ustawDymek($('#szukaj'), ''));
  // Pasek nad notatką mieści się w każdej szerokości kolumny: dopasujPasek po każdej zmianie rozmiaru paska i jego części,
  // w następnej klatce (zmiana w samym ResizeObserver dawałaby błąd pętli).
  const obserwatorPaska = new ResizeObserver(() => {
    cancelAnimationFrame(klatkaPaska);
    klatkaPaska = requestAnimationFrame(dopasujPasek);
  });
  const pasekNotatki = $('#naglowek .n-tresc');
  for (const e of [pasekNotatki, ...pasekNotatki.children, ...document.querySelectorAll('#narzedzia-tekstu > button, #przyciski-edytora > button, #dol .dol-lista, #e-karta')]) obserwatorPaska.observe(e);
  // Siatka pasków zależy też od tego, co w nich stoi (przycisk paska bocznego przy schowanym pasku i w oknie do 1100 px,
  // ekran listy albo notatki) i od położenia tekstu, które przesuwa kartkę bez zmiany jej wielkości (js/uchwyty.js).
  const przelicz = () => {
    cancelAnimationFrame(klatkaSzukania);
    klatkaSzukania = requestAnimationFrame(dopasujSzukanie);
    cancelAnimationFrame(klatkaPaska);
    klatkaPaska = requestAnimationFrame(dopasujPasek);
  };
  new MutationObserver(przelicz).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ekran'] });
  new MutationObserver(przelicz).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', przelicz);
  // Pierwsza klatka już na siatce (obserwatory liczą dopiero w następnej).
  dopasujSzukanie();
  przestawiane($('#u-dzialy'), { grupa: 'dzialy', element: 'button', klucz: (b) => b.dataset.dzial });
  $('#okno-min').addEventListener('click', () => okno('minimalizuj'));
  $('#okno-max').addEventListener('click', async () => {
    const r = await okno('maksymalizuj');
    ustawIkoneMaks(r && r.maks);
  });
  $('#okno-zamknij').addEventListener('click', () => okno('ukryj'));
  window.addEventListener('resize', async () => {
    if (platforma !== 'windows') return;
    const r = await okno('stan');
    ustawIkoneMaks(r && r.maks);
  });
  $('#widoki').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-widok]');
    if (b) ustawWidok(b.dataset.widok);
  });
  const szukaj = $('#szukaj');
  szukaj.addEventListener('input', () => ustawZapytanie(szukaj.value));
  szukaj.addEventListener('keydown', async (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      await ostatnieOdswiezenie();
      const k = pierwszyWpis();
      if (k) otworzEdytor(k.dataset.id);
      else if (szukaj.value.trim() && S.ustawienia.szukaj_albo_utworz) {
        const tytul = szukaj.value.trim();
        szukaj.value = '';
        await ustawZapytanie('');
        otworzEdytor(null, { tytul });
      }
    } else if (ev.key === 'ArrowDown') {
      const k = pierwszyWpis();
      if (k) {
        ev.preventDefault();
        k.tabIndex = 0;
        k.focus();
      }
    } else if (ev.key === 'Escape' && szukaj.value) {
      ev.preventDefault();
      ev.stopPropagation();
      szukaj.value = '';
      ustawZapytanie('');
    }
  });
  $('#szukaj-wyczysc').addEventListener('click', () => {
    szukaj.value = '';
    ustawZapytanie('');
    szukaj.focus();
  });
}

function ustawIkoneMaks(maks) {
  const b = $('#okno-max');
  // Bez dymku: przyciski okna Windows są oczywiste (reguła `ikonki-z-dymkami.md`), a czytnik ekranu dostaje nazwę.
  b.setAttribute('aria-label', maks ? 'Przywróć' : 'Maksymalizuj');
  b.querySelector('use').setAttribute('href', maks ? '#i-przywroc-okno' : '#i-max');
}

/** Szerokie okno: pokaż albo schowaj pasek boczny (zapamiętane). Do 1100 px: wysuń go nad listę. */
async function przelaczPasek() {
  if (window.matchMedia('(max-width: 1100px)').matches) {
    document.body.classList.toggle('pasek-otwarty');
    return;
  }
  await przelaczUstawienie('pasek_boczny', S.ustawienia.pasek_boczny === false);
}

function zamknijWysuniety() {
  document.body.classList.remove('pasek-otwarty');
}

/**
 * Sam tekst (Jacek, 21.10.2026: „full screen, żeby oba taby … zsunąć do ściany. Pozostaje sam tekst”): F11 albo przycisk
 * z rogami nad notatką. Pasek boczny i lista zjeżdżają do lewej ściany (styl.css), okno idzie na cały ekran. F11, ten sam
 * przycisk albo Escape wracają. Tylko przy otwartej notatce i na szerokim ekranie: na telefonie notatka i tak stoi sama.
 */
async function przelaczSamTekst(wl = !document.body.classList.contains('sam-tekst')) {
  if (wl && (waski() || S.ekran !== 'edytor')) return;
  if (wl === document.body.classList.contains('sam-tekst')) return;
  zamknijWysuniety();
  document.body.classList.toggle('sam-tekst', wl);
  const b = $('#sam-tekst');
  const nazwa = wl ? 'Pokaż pasek boczny i listę' : 'Sam tekst, na cały ekran';
  b.setAttribute('aria-label', nazwa);
  b.setAttribute('aria-pressed', wl ? 'true' : 'false');
  b.querySelector('use').setAttribute('href', wl ? '#i-pelny-wyjdz' : '#i-pelny');
  ustawDymek(b, `${nazwa} (F11)`);
  if (platforma === 'windows') await okno('pelny_ekran', { wl });
  else if (wl && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else if (!wl && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  ogloszenie(wl ? 'Sam tekst' : 'Pasek boczny i lista wróciły');
}

/**
 * Narzędzia tekstu (Aa, pola wyboru, obraz, głos): na szerokim ekranie w nagłówku nad notatką,
 * na wąskim na dolnym pasku, pod kciukiem (HIG: częste kontrolki na dole ekranu telefonu).
 */
function ulozNarzedzia() {
  const n = $('#narzedzia-tekstu');
  if (waski()) {
    // Na dolnym pasku grupa nie zmienia miejsca jako całość: bez chwytu i bez fokusu. Po powrocie do paska nad notatką
    // dostaje je z powrotem i staje na swoim zapisanym miejscu (js/kolejnosc.js).
    n.draggable = false;
    n.removeAttribute('tabindex');
    n.removeAttribute('aria-description');
    $('#dol').append(n);
  } else $('#sam-tekst').after(n);
  dopasujPasek();
}

/**
 * Pasek nad notatką w wąskiej kolumnie (okno od 761 do około 890 px, powiększenie 125 % na zwykłym oknie, szeroka lista):
 * to, co się nie mieści, przechodzi do menu Więcej, od tego, bez czego najłatwiej, jak pasek narzędzi w macOS. Sam tekst
 * ma też F11, pinezka i kolor mają swoje pozycje w menu, stan synchronizacji idzie ostatni, bo to jedyny stan na pasku.
 * Zmierzone 23.10.2026: przy 761 px treść paska
 * miała 418 px na 303 px miejsca i wchodziła pod przyciski okna. Na wąskim ekranie narzędzia są na dolnym pasku i nic się nie chowa.
 */
const DO_MENU = ['sam-tekst', 'e-przypnij', 'e-glos', 'e-obraz', 'e-kolor', 'e-typ', 'stan-sync'];
let klatkaPaska = 0;
function dopasujPasek() {
  const t = $('#naglowek .n-tresc');
  const czesci = DO_MENU.map((id) => document.getElementById(id));
  for (const e of czesci) e.classList.remove('w-menu');
  kolaNaSiatce();
  const s = t.style;
  if (waski() || S.ekran !== 'edytor') {
    s.removeProperty('--tekst-od');
    s.removeProperty('--tekst-do');
    return;
  }
  // O ile części wychodzą za prawe wcięcie paska (oddech przed przyciskami okna). Krawędź części liczy się z jej marginesem,
  // jak w układzie: grupa ma margines −4 px wokół pola chwytu. Sama szerokość przewijania nie wystarcza, bo nie liczy prawego
  // wcięcia (przy 761 px pasek kończył się 3 px przed przyciskami okna).
  const nadmiar = () => {
    const koniec = t.getBoundingClientRect().right - parseFloat(getComputedStyle(t).paddingRight);
    let m = 0;
    for (const c of t.children) {
      if (c.getClientRects().length) m = Math.max(m, c.getBoundingClientRect().right + (parseFloat(getComputedStyle(c).marginRight) || 0) - koniec);
    }
    return m;
  };
  // Siatka kolumny notatki (reguła siatka-wszedzie): pasek zaczyna się i kończy równo z tekstem notatki. Gdy wtedy brakuje
  // miejsca albo tekst sięga pod przyciski okna, pasek kończy się zwykłym wcięciem, potem zaczyna się 16 px od brzegu,
  // a dopiero gdy i to nie wystarcza, przyciski idą do menu Więcej.
  const karta = $('#e-karta');
  const r = t.getBoundingClientRect();
  const k = karta.getClientRects().length ? karta.getBoundingClientRect() : null;
  const od = k ? Math.max(16, k.left - r.left) : 16;
  const doP = k ? Math.max(12, r.right - k.right) : 12;
  for (const [a, b] of [[od, doP], [od, 12], [16, 12]]) {
    s.setProperty('--tekst-od', `${a}px`);
    s.setProperty('--tekst-do', `${b}px`);
    if (nadmiar() <= 0.5) return;
  }
  for (const e of czesci) {
    if (nadmiar() <= 0.5) return;
    if (e.getClientRects().length) e.classList.add('w-menu');
  }
}

/**
 * Wąski ekran (reguła siatka-wszedzie): koła w paskach nad notatką i pod listą stoją na siatce paska, tej samej co lista:
 * 12 kolumn między marginesami, odstęp 8 px, od 380 px 12 px. Koło dostaje margines do środka swojego miejsca z tylu kolumn,
 * ilu potrzebuje (na telefonie dwóch), a miejsca idą co jeden odstęp. Odstępnik zjada jeden odstęp (styl.css), więc koła za
 * nim liczą się od prawego marginesu i też stoją na liniach. Narzędzia tekstu na dole dzielą pasek po równo (styl.css).
 * Gdy kół jest więcej, niż mieści 12 kolumn (telefon węższy niż 360 px), pinezka i kolor idą do menu Więcej, jak na
 * szerokim pasku, a koło nigdy nie wychodzi poza swoje miejsce.
 */
const naSiatce = new Set();
function kolaNaSiatce() {
  const wasko = waski();
  for (const [pasek, wybor, doMenu] of [
    [$('#naglowek .n-tresc'), ':scope > .ikona, :scope > .przyciski-edytora > .ikona', ['e-przypnij', 'e-kolor']],
    [$('#dol .dol-lista'), ':scope > .ikona', []],
  ]) {
    if (!pasek) continue;
    const g = wasko && pasek.getClientRects().length ? siatka(pasek) : null;
    const kola = () => [...pasek.querySelectorAll(wybor)].filter((b) => b.getClientRects().length);
    if (g && g.kol > 0) {
      for (const id of doMenu) {
        if (kola().reduce((n, b) => n + g.kolumn(b.offsetWidth), 0) <= 12) break;
        document.getElementById(id).classList.add('w-menu');
      }
    }
    for (const b of pasek.querySelectorAll(wybor)) {
      if (!g || g.kol <= 0 || !b.getClientRects().length) {
        if (naSiatce.delete(b)) b.style.removeProperty('margin-inline');
        continue;
      }
      const w = b.offsetWidth;
      b.style.marginInline = `${(g.miejsce(g.kolumn(w)) - w) / 2}px`;
      naSiatce.add(b);
    }
  }
}

/**
 * Pole szukania w ciasnym pasku listy (zasada 2 z „05 --- Jacek Design Guidelines”: ucięte „Szı” to rzecz niedokończona).
 * Zmierzone 23.10.2026: w oknie od 761 do 1100 px (domyślne ma 1040 px) lista ma 320 px i przycisk paska bocznego, więc
 * na napis „Szukaj” (47 px) zostawało 20 px. Wtedy pole stoi jako okrągły przycisk z lupą, jak w Notatkach macOS: klik,
 * Ctrl+F albo pisanie z listy rozwija je na całe miejsce, a Nowa notatka jest na ten czas samym plusem (styl.css).
 * Od 27.10.2026 pasek stoi na siatce (reguła siatka-wszedzie): 12 kolumn między wcięciami paska, czyli w brzegach kafelków,
 * z odstępem jak między kafelkami. Koło (przycisk paska bocznego, zwinięte pole, plus) stoi na środku miejsca z tylu kolumn,
 * ilu potrzebuje. Nowa notatka bierze pół paska, a gdy napis się nie mieści, tyle kolumn, ile trzeba. Szukaj bierze resztę,
 * a gdy nie zmieści w niej napisu „Szukaj”, stoi kołem i Nowa notatka rośnie do niego. Przy zaznaczaniu Anuluj bierze tyle
 * kolumn, ile trzeba, a liczba zaznaczonych resztę. Klasa „zwinieta” schodzi na chwilę, żeby style koła nie zmieniły miar,
 * i wraca, zanim okno się narysuje, więc nic nie miga. Na wąskim ekranie Nowej notatki w pasku nie ma.
 */
const DYMEK_SZUKANIA = 'Szukaj notatek (Ctrl+F)';
let klatkaSzukania = 0;
let pioro = null;
/** Szerokość napisu krojem elementu, z płótna (bez układu strony). */
function szerNapisu(e, tekst) {
  const st = getComputedStyle(e);
  pioro ||= document.createElement('canvas').getContext('2d');
  pioro.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
  return pioro.measureText(tekst).width + (parseFloat(st.letterSpacing) || 0) * tekst.length;
}
/** Napis razem z wypełnieniem elementu z lewej i z prawej. */
function naNapis(e, tekst) {
  const st = getComputedStyle(e);
  return parseFloat(st.paddingLeft) + parseFloat(st.paddingRight) + szerNapisu(e, tekst);
}
/**
 * Siatka paska (reguła siatka-wszedzie): 12 kolumn między wcięciami paska, z jego odstępem. `miejsce(n)` to szerokość
 * n kolumn z odstępami między nimi, a `kolumn(w)` najmniejsza liczba kolumn, w której mieści się w pikseli.
 */
function siatka(pasek) {
  const cs = getComputedStyle(pasek);
  const W = pasek.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const G = parseFloat(cs.columnGap) || 0;
  const kol = (W - 11 * G) / 12;
  const miejsce = (n) => n * kol + (n - 1) * G;
  const kolumn = (w) => {
    let n = 1;
    while (n < 12 && miejsce(n) < w - 0.01) n++;
    return n;
  };
  return { W, G, kol, miejsce, kolumn };
}
function dopasujSzukanie() {
  const s = $('#szukajka');
  const pole = $('#szukaj');
  const l = $('#naglowek .n-lista');
  const nowa = $('#nowa');
  const p = $('#pasek-przelacz');
  // Miary bez zwinięcia i bez samego plusa: ich style zdejmują wypełnienia, a liczy się napis w zwykłym polu i przycisku.
  s.classList.remove('zwinieta');
  nowa.classList.remove('plus');
  let zwin = false;
  let plus = false;
  const g = l.getClientRects().length ? siatka(l) : null;
  if (g && g.kol > 0) {
    // Przycisk paska bocznego stoi w pasku listy do 1100 px i przy schowanym pasku, a przy pasku bocznym na nim (styl.css).
    const kk = g.kolumn(p.offsetWidth || 36);
    const kp = p.getClientRects().length && getComputedStyle(p).position !== 'absolute' ? kk : 0;
    let kn = 0;
    if (nowa.getClientRects().length) {
      const znak = nowa.querySelector('svg');
      const naNowa = naNapis(nowa, nowa.textContent.trim()) + (parseFloat(getComputedStyle(nowa).columnGap) || 0) + (znak ? parseFloat(getComputedStyle(znak).width) || 0 : 0);
      const maks = 12 - kp - kk;
      // Napis nie mieści się nawet obok zwiniętego pola (najwęższa lista w wąskim oknie): Nowa notatka stoi samym plusem.
      plus = g.miejsce(maks) < naNowa - 0.01;
      kn = plus ? kk : Math.min(maks, Math.max(6, g.kolumn(naNowa)));
      zwin = g.miejsce(12 - kp - kn) < naNapis(pole, pole.placeholder) - 0.01;
    }
    const anuluj = $('#anuluj-zaznaczanie');
    const ka = g.kolumn(naNapis(anuluj, anuluj.textContent.trim()));
    const v = l.style;
    v.setProperty('--k-kolo', String(kk));
    v.setProperty('--k-sz', String(Math.max(1, 12 - kp - kn)));
    v.setProperty('--k-nt', String(Math.max(1, kn)));
    v.setProperty('--k-zw', String(Math.max(1, 12 - kp - kk)));
    v.setProperty('--k-an', String(ka));
    v.setProperty('--k-ty', String(Math.max(1, 12 - kp - ka)));
  } else if (!waski() && s.getClientRects().length) {
    // Siatki nie da się policzyć (start w schowanym oknie bez szerokości): decyduje samo pole, jak przed siatką. Bez tego
    // kursor stawał na starcie w polu, które po pokazaniu okna i tak stoi kołem (test powrotu, 27.10.2026).
    const st = getComputedStyle(pole);
    zwin = pole.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) < szerNapisu(pole, pole.placeholder);
  }
  nowa.classList.toggle('plus', plus);
  s.classList.toggle('zwinieta', zwin);
  // Dymek tylko wtedy, gdy pole naprawdę stoi kołem: bez fokusu i bez tekstu (z tekstem zostaje rozwinięte).
  ustawDymek(pole, zwin && !s.matches(':focus-within') && !pole.value ? DYMEK_SZUKANIA : '');
}

/**
 * Kursor w wyszukiwarce na starcie i po pokazaniu okna, gdy nie ma do czego wracać. Zwinięte pole bez tekstu zostaje
 * zwinięte: pierwszy ekran ma wtedy napis „Nowa notatka” (Jacek, 21.10.2026: sam plus „not obvious”), a szukanie rusza
 * od pierwszej litery albo od Ctrl+F.
 */
function kursorWSzukaniu() {
  dopasujSzukanie();
  const s = $('#szukaj');
  if ($('#szukajka').classList.contains('zwinieta') && !s.value) return;
  s.focus();
  s.select();
}

async function wstecz() {
  if (S.ekran === 'edytor') await zamknijEdytor();
  else if (S.ekran === 'ai') await zamknijAi();
}

function rysujStanSync() {
  const s = S.sync || {};
  const w = s.wymiana || {};
  const ik = $('#stan-sync');
  // Chmurka w nagłówku: działa wymiana plikiem (OneDrive, Dysk Google) albo własny serwer.
  const wymiana = w.stan === 'dziala' || w.stan === 'blad';
  const widac = Boolean(s.polaczona || wymiana);
  ik.hidden = !widac;
  const napisSerwera = s.polaczona ? { polaczono: 'Zsynchronizowano', wysylanie: 'Wysyłanie zmian…', offline: 'Brak połączenia – zmiany czekają', blad: s.komunikat || 'Błąd synchronizacji' }[s.stan] || '' : '';
  const klopot = w.stan === 'blad' ? w.komunikat || 'Wymiana teraz nie działa' : (w.ostrzezenia || [])[0] || '';
  const napisWymiany = wymiana ? klopot || (w.zapisano ? `Wymiana działa · zapisano ${kiedy(w.zapisano)}` : 'Wymiana działa') : '';
  const napisStanu = [napisSerwera, napisWymiany].filter(Boolean).join(' · ');
  ik.setAttribute('aria-label', napisStanu);
  ustawDymek(ik, napisStanu);
  ik.replaceChildren();
  if (widac) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-chmura');
    svg.append(u);
    ik.append(svg);
    ik.classList.toggle('przygaszony', (s.polaczona && s.stan !== 'polaczono') || Boolean(klopot));
  }
  // Baner tylko dla trwałego stanu (HIG: Banners) – praca offline z serwerem dłużej niż chwilę. Zamknięty nie wraca,
  // póki praca offline trwa (ui.js, baner), a baner drugiej karty z web.js stoi obok niego.
  if (s.polaczona && s.stan === 'offline' && s.od && Date.now() - s.od > 15000) {
    // Krótko, żeby na telefonie stał w jednej linii (Jacek: „To mi zabiera real estate”), tymi samymi słowami co dymek
    // chmurki i Ustawienia.
    const czeka = s.oczekujace || 0;
    baner('offline', czeka ? `Brak połączenia – ${liczba(czeka, 'zmiana czeka', 'zmiany czekają', 'zmian czeka')}` : 'Brak połączenia');
  } else {
    bezBaneru('offline');
  }
}

// --- skróty klawiszowe (GNOME HIG: Standard Keyboard Shortcuts) ---

function wPolu(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

// Ptaszek, przełącznik i suwak to nie pole tekstowe: Ctrl+Z na ptaszku cofa ostatnie działanie, a nie pisanie.
const NIE_TEKST = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file']);

/** Pole, w którym się pisze: tam Ctrl+Z i Ctrl+Y cofają pisanie (w notatce: edytor.js, podepnijCofanie). */
function wPoluTekstowym(e) {
  return Boolean(wPolu(e) && !(e.target.tagName === 'INPUT' && NIE_TEKST.has(e.target.type)));
}

/** Klawisz wciśnięty w otwartej notatce albo w Porządkach AI (a nie na liście czy w pasku bocznym). */
function naNotatce(e) {
  return Boolean(e.target && e.target.closest && e.target.closest('#tresc, .naglowek .n-tresc, #dol'));
}

function podepnijKlawiature() {
  document.addEventListener('keydown', async (ev) => {
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    // Okno z zasłoną ma własne Esc i Tab. Ściąga stoi obok pracy, więc przy niej skróty działają dalej.
    const otwartyDialog = document.querySelector('dialog:modal');
    if (otwartyDialog && !(ctrl && k === 'q')) return;
    if (ctrl && k === 'n') {
      ev.preventDefault();
      otworzEdytor(null, { lista: ev.shiftKey });
    } else if (ctrl && k === 'f') {
      ev.preventDefault();
      if (S.ekran !== 'lista') await wstecz();
      $('#szukaj').focus();
      $('#szukaj').select();
    } else if (ctrl && k === ',') {
      ev.preventDefault();
      otworzUstawienia();
    } else if (ctrl && (k === '?' || (ev.shiftKey && k === '/'))) {
      ev.preventDefault();
      otworzSkroty();
    } else if (ev.key === 'F1' && !ctrl && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      otworzSciage();
    } else if (ctrl && k === 'w') {
      ev.preventDefault();
      if (S.e) await zapiszWersje();
      okno('ukryj');
    } else if (ctrl && k === 'q') {
      ev.preventDefault();
      if (S.e) await zapiszWersje();
      okno('zakoncz');
    } else if (ctrl && k === 's' && S.e) {
      ev.preventDefault();
      await zapiszWersje();
      chwilowyStan('Zapisano wersję');
    } else if (ctrl && k === 'h' && S.e) {
      ev.preventDefault();
      historiaNotatki();
    } else if (ctrl && (k === 'z' || k === 'y') && !wPoluTekstowym(ev)) {
      // Ctrl+Z cofa ostatnie działanie, a Ctrl+Y i Ctrl+Shift+Z je ponawiają, także przy otwartej notatce, gdy kursor nie stoi
      // w polu (reguła Jacka z 16.10.2026). W polu tekstowym cofają pisanie, jak w Windows (przeglądarka i edytor.js).
      ev.preventDefault();
      if (k === 'z' && !ev.shiftKey) cofnijOstatnie();
      else ponowOstatnie();
    } else if (ctrl && k === 'a' && !wPolu(ev) && !naNotatce(ev) && S.ustawienia.zaznaczanie !== false) {
      ev.preventDefault();
      zaznaczWszystkie();
    } else if (ev.key === 'F10' && !ev.shiftKey) {
      ev.preventDefault();
      if (S.ekran === 'edytor') menuWiecej();
    } else if (ev.key === 'F11') {
      ev.preventDefault();
      przelaczSamTekst();
    } else if (ev.key === 'F9') {
      ev.preventDefault();
      if (document.body.classList.contains('sam-tekst')) await przelaczSamTekst(false);
      else przelaczPasek();
    } else if (ev.altKey && ['1', '2', '3', '4'].includes(ev.key)) {
      ev.preventDefault();
      // Po kolei jak w pasku bocznym, także po przestawieniu widoków, bez schowanych (puste Archiwum i Kosz).
      const widoki = [...$$('#widoki button[data-widok]')].filter((b) => !b.closest('li').hidden).map((b) => b.dataset.widok);
      if (widoki[Number(ev.key) - 1]) ustawWidok(widoki[Number(ev.key) - 1]);
    } else if ((ev.altKey && ev.key === 'ArrowLeft') || (ev.key === 'Escape' && !popoverOtwarty())) {
      if (ev.key === 'Escape' && zamknijSciage()) {
        ev.preventDefault();
      } else if (ev.key === 'Escape' && document.body.classList.contains('pasek-otwarty')) {
        ev.preventDefault();
        zamknijWysuniety();
      } else if (ev.key === 'Escape' && !$('#panel-formatu').hidden) {
        ev.preventDefault();
        $('#e-aa').click();
      } else if (ev.key === 'Escape' && S.zaznaczone.size) {
        ev.preventDefault();
        wyczyscZaznaczenie();
      } else if (ev.key === 'Escape' && document.body.classList.contains('sam-tekst')) {
        ev.preventDefault();
        await przelaczSamTekst(false);
      } else if (S.widok === 'oproznione' && S.ekran === 'lista') {
        // Z „Odzyskaj usunięte” Escape i Alt+← wracają do kosza.
        ev.preventDefault();
        await ustawWidok('kosz');
      } else if (S.ekran !== 'lista') {
        ev.preventDefault();
        await wstecz();
      }
    } else if (!ctrl && !ev.altKey && ev.key.length === 1 && !wPolu(ev) && !naNotatce(ev) && !S.zaznaczone.size && ev.key !== ' ') {
      // „Pisz, żeby szukać” (HIG: Search) – z listy i paska bocznego, nie z otwartej notatki.
      const s = $('#szukaj');
      s.focus();
    }
  });
}

// --- schowek i przeciąganie plików ---

function podepnijSchowekIUpuszczanie() {
  document.addEventListener('paste', async (ev) => {
    if (S.ustawienia.wklejanie_obrazow === false) return;
    const pliki = [...(ev.clipboardData ? ev.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
    if (!pliki.length) return;
    ev.preventDefault();
    if (!edytorOtwarty()) await otworzEdytor(null);
    await dodajPliki(pliki);
  });
  // Przeciąganie z wnętrza programu (kafelki, pozycje listy, przyciski, widoki) bez czerwonego znaku zakazu (Jacek,
  // 21.10.2026): poza miejscami, które przyjmują upuszczenie, kursor zostaje zwykły, a upuszczenie tam nic nie robi.
  // Zaznaczony tekst przeciągany w polu (przeniesienie fragmentu) zostaje zwykłym przeciąganiem przeglądarki.
  let wewnetrzne = false;
  document.addEventListener('dragstart', (ev) => {
    const t = ev.target instanceof Element ? ev.target : ev.target && ev.target.parentElement;
    wewnetrzne = !(t && t.closest('[contenteditable="true"], input, textarea'));
  }, true);
  document.addEventListener('dragend', () => {
    wewnetrzne = false;
  }, true);
  document.addEventListener('dragover', (ev) => {
    if (wewnetrzne && ev.dataTransfer && !ev.defaultPrevented) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      return;
    }
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  document.addEventListener('drop', async (ev) => {
    if (wewnetrzne) {
      // Tu nic nie przyjmuje upuszczenia: bez wklejania przeciąganego tekstu i bez otwierania czegokolwiek.
      if (!ev.defaultPrevented) ev.preventDefault();
      return;
    }
    const pliki = [...(ev.dataTransfer ? ev.dataTransfer.files : [])];
    if (!pliki.length || edytorOtwarty()) return;
    ev.preventDefault();
    await otworzEdytor(null);
    await dodajPliki(pliki);
  });
}

// --- zdarzenia z rdzenia ---

const WIDOKI_PRACY = new Set(['notatki', 'przypomnienia', 'archiwum', 'kosz', 'oproznione']);

/**
 * Powrót do pracy (Jacek, 22.10.2026: „Jak na nie kliknę, żeby pozostawały na ostatnim tabie, który był otwarty … a nie że
 * otwiera mi się pusta strona. We come back to where we left off the work”). Przy starcie i przy pokazaniu okna bez
 * otwartej notatki: przewinięcie listy (`lista`, tylko przy starcie) i ostatnia notatka w tym samym miejscu tekstu
 * (miejsce pracy w stan.js). Notatka otwarta przy wyjściu wraca zawsze. Zamknięta wraca na szerokim ekranie, gdy jest
 * w tym widoku, żeby panel obok listy nie stał pusty; na wąskim (telefon) zamknięta znaczy „wróciłem do listy”.
 * `true`, gdy notatka wróciła.
 */
async function wrocDoPracy(m, { lista = false } = {}) {
  if (lista && m.lista > 0 && S.ekran === 'lista') await przewinListeDo(m.lista);
  const n = m.notatka ? S.notatki.get(m.notatka) : null;
  if (!n || S.ekran !== 'lista') return false;
  if (!m.otwarta && (waski() || !(await idsWidoku()).includes(n.id))) return false;
  return otworzWMiejscu(n.id, m, { fokus: platforma !== 'android' });
}

/**
 * Okno pokazane (ikona, podwójne kliknięcie środkowym, zasobnik): wraca tam, gdzie skończyła się praca (wrocDoPracy).
 * Otwarta notatka zostaje otwarta, a fokus wraca do niej, gdy stał poza nią; Porządki AI też zostają. Przerwane szukanie
 * (tekst w wyszukiwarce) i brak notatki do powrotu dają kursor w wyszukiwarce, jak dawniej, poza zwiniętym polem bez tekstu
 * (kursorWSzukaniu). Do szukania jest zawsze Ctrl+F.
 */
async function pokazano(p) {
  zamknijPopover(false);
  for (const d of $$('dialog[open]')) d.close();
  if (p && p.tryb === 'nowa') {
    await otworzEdytor(null);
  } else if (S.ekran === 'edytor') {
    wrocFokusDoNotatki();
  } else if (S.ekran === 'lista' && (S.zapytanie || !(await wrocDoPracy(wczytajMiejsce())))) {
    kursorWSzukaniu();
  }
  if (p && p.pomiar) {
    await poKlatce();
    sygnal('zmierzono', { id: p.pomiar });
  }
}

let timerZmian = null;

/** Obrazy i nagrania, które właśnie przyszły z innego urządzenia: elementy, które wcześniej
 *  nie miały czego pokazać, wczytują je od nowa (adres z dopiskiem omija zapamiętany błąd). */
function przeladujObrazy(hashe) {
  if (!hashe || !hashe.length) return;
  const nowe = new Set(hashe);
  for (const m of document.querySelectorAll('img[src], audio[src]')) {
    const src = m.getAttribute('src');
    const hash = (src.split('?')[0].match(/[0-9a-f]{64}$/) || [])[0];
    if (hash && nowe.has(hash)) m.setAttribute('src', `${src.split('?')[0]}?${Date.now()}`);
  }
}

/** Zmiany zrobione poza oknem: MCP (Kiro), synchronizacja, przypomnienia, OCR. */
function zmianyZZewnatrz(z) {
  przeladujObrazy(z.pliki);
  // Przypomnienie z synchronizacji albo z MCP: najbliższe wystąpienie liczy rdzeń. Bez tego wiersz
  // listy i otwarta notatka pokazywałyby kotwicę sprzed dni zamiast najbliższego terminu.
  const przypomnienia = (z.zmienione || []).some((n) => n.tresc.przypomnienie || S.nastepne.has(n.id)) || (z.usuniete || []).some((id) => S.nastepne.has(id));
  aktualizujNotatki(z.zmienione);
  for (const id of z.usuniete || []) S.notatki.delete(id);
  if (przypomnienia) odswiezPrzypomnienia();
  if (z.tagi) S.tagi = z.tagi;
  przeliczStatystyke();
  rysujPasek();
  odswiezOtwarty(z.zmienione);
  clearTimeout(timerZmian);
  // Lista stoi obok notatki, więc odświeża się zawsze, w tym samym miejscu przewinięcia.
  timerZmian = setTimeout(() => odswiezListe({ przewin: $('#kolumna-listy').scrollTop }), 80);
  for (const a of z.ai || []) {
    zapamietajCofniecie(a.paczka, a.opis);
    toast(a.opis || 'Zmiana AI', { przycisk: 'Cofnij', akcja: () => cofnijPaczke(a.paczka), czas: 10000 });
  }
}

// --- pomiary szybkości w prawdziwym oknie (tryb --pomiar-ui) ---

async function pomiarUi() {
  const wyniki = {};
  const dodaj = (nazwa, ms) => {
    (wyniki[nazwa] = wyniki[nazwa] || []).push(Math.round(ms * 1000) / 1000);
  };
  const r1 = (ms) => Math.round(ms * 10) / 10;
  // Czas klatki rozbity na czekanie na nią (początek klatki, requestAnimationFrame) i jej
  // rysowanie (styl, układ, malowanie – zadanie po klatce startuje, gdy jest już narysowana).
  const zmierz = async (nazwa, f) => {
    const t0 = performance.now();
    await f();
    const t1 = performance.now();
    let tKlatki = 0;
    await new Promise((r) => requestAnimationFrame(() => {
      tKlatki = performance.now();
      setTimeout(r, 0);
    }));
    const t2 = performance.now();
    dodaj(`${nazwa}_przetwarzanie`, t1 - t0);
    dodaj(`${nazwa}_do_klatki`, t2 - t0);
    return { przetwarzanie: r1(t1 - t0), czekanie_na_klatke: r1(tKlatki - t1), rysowanie_klatki: r1(t2 - tKlatki), razem: r1(t2 - t0) };
  };
  await czekaj(500);
  const szukaj = $('#szukaj');
  // Każdy klawisz osobno (zapytanie, czasy, droga do rdzenia) – najwolniejsze trafiają do wyniku,
  // żeby było widać, które zapytanie i dlaczego.
  const klawisze = [];
  // Pisanie jak człowiek: klawisz co ~120 ms (przerwa po klatce), każda litera to nowe szukanie.
  for (const q of ['żółw', 'zolw', 'spotkanie', 'spotknaie', 'prokinetyki', 'prokinetki', 'faktura podatek', 'gdynia pociąg']) {
    for (let i = 1; i <= q.length; i++) {
      szukaj.value = q.slice(0, i);
      const zajetyPrzed = drogi.zajety;
      const k = await zmierz('szukanie_klawisz', () => ustawZapytanie(szukaj.value));
      // Już po pomiarze: sam rdzeń (bez IPC) i chwile wejścia i wyjścia z polecenia – zna je
      // Windows. Z nich: ile szło zapytanie do rdzenia, a ile wracała odpowiedź.
      const c = await sygnal('czas_rdzenia');
      if (S.czasyListy) {
        const cl = S.czasyListy;
        const jest = c && typeof c.rdzen_us === 'number' && c.od_us > 0;
        dodaj('szukanie_rdzen_i_ipc', cl.rdzen);
        dodaj('szukanie_rysowanie_kart', cl.rysowanie);
        dodaj('szukanie_rysowanie_klatki', k.rysowanie_klatki);
        if (jest) {
          dodaj('szukanie_sam_rdzen', c.rdzen_us / 1000);
          dodaj('szukanie_ipc_do_rdzenia', c.od_us / 1000 - cl.wyslane);
          dodaj('szukanie_ipc_z_rdzenia', cl.odebrane - c.do_us / 1000);
        }
        klawisze.push({
          nr: klawisze.length + 1,
          zapytanie: szukaj.value,
          ...k,
          sam_rdzen: jest ? r1(c.rdzen_us / 1000) : null,
          ipc_do_rdzenia: jest ? r1(c.od_us / 1000 - cl.wyslane) : null,
          ipc_z_rdzenia: jest ? r1(cl.odebrane - c.do_us / 1000) : null,
          rdzen_i_ipc: r1(cl.rdzen),
          wiersze_dom: r1(S.czasyListy.rysowanie),
          wierszy: S.czasyListy.narysowano,
          silnik_zajety: drogi.zajety > zajetyPrzed,
        });
      }
      await czekaj(100);
    }
    szukaj.value = '';
    await ustawZapytanie('');
    await czekaj(300);
  }
  for (let i = 0; i < 10; i++) {
    const k = $$('#sekcje .wpis')[i];
    if (!k) break;
    await zmierz('otwarcie_notatki', () => otworzEdytor(k.dataset.id));
    await zmierz('powrot_do_listy', () => zamknijEdytor());
  }
  for (let i = 0; i < 5; i++) {
    await zmierz('nowa_notatka', () => otworzEdytor(null));
    await zamknijEdytor();
  }
  for (let i = 0; i < 3; i++) {
    for (const w of ['archiwum', 'kosz', 'przypomnienia', 'notatki']) await zmierz('zmiana_widoku', () => ustawWidok(w));
  }
  for (const [t] of S.tagi.slice(0, 10)) await zmierz('filtr_etykiety', () => ustawWidok('notatki', t));
  await ustawWidok('notatki');
  const szczegoly = {
    drogi: { ...drogi },
    najwolniejsze_klawisze: [...klawisze].sort((a, b) => b.przetwarzanie - a.przetwarzanie).slice(0, 10),
    // Każdy klawisz po kolei – narzedzia\pomiar-szukania.ps1 łączy z nich kilka przebiegów.
    klawisze,
  };
  await sygnal('zapisz_pomiar', { wyniki, notatek: S.notatki.size, szczegoly });
}

start();
