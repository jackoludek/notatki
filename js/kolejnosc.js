// Przestawianie: pasek boczny, pasek nad notatką (jego części i przyciski w grupach), formatowanie, a w Ustawieniach
// działy, grupy i pozycje w grupach.
//
// Reguła Jacka z 10.10.2026: przyciski da się przeciągać myszą w inną kolejność, kolejność wraca
// po ponownym uruchomieniu i jest też droga z klawiatury. Tu: Alt+↑ ↓ w listach w pionie,
// Alt+← → w paskach w poziomie, na przycisku z fokusem. Kolejność zostaje w pamięci tego
// urządzenia, jak układ okna, więc telefon i komputer mogą mieć różną.
// Od 22.10.2026 (zadanie 27, Jacek: „jak najwięcej rzeczy dragable”) także grupy i pozycje Ustawień. Grupę chwyta się
// za nagłówek, a pozycję za jej napis, bo przełącznik, lista i pole zostają zwykłymi kontrolkami.
// Od 23.10.2026 (zadanie 26, Jacek: „ona musi być jako całość też dragable i te co są … z prawej strony, czyli chmura
// i dzwonek”) pasek nad notatką: Sam tekst, grupa narzędzi, chmura i para Przypomnienie z Więcej zmieniają miejsce
// w pasku, a grupę chwyta się między jej przyciskami. Pojemnik w pojemniku: przycisk w grupie zmienia miejsce w grupie,
// a cała grupa w pasku.
import { ogloszenie } from './ui.js';
import { zapamietajDzialanie } from './stan.js';

const PREFIKS = 'ikeeper.kolejnosc.';
// Własny typ danych: przeciągany przycisk upuszczony w tekście notatki nie wkleja niczego.
const TYP = 'application/x-ikeeper-kolejnosc';
const MYSZ = window.matchMedia('(hover: hover) and (pointer: fine)');
// Na dotyku (telefon) przeciągania nie ma, więc chwyty grup nie dostają fokusu ani opisu klawiszy: czytnik ekranu
// czytałby „Alt+strzałka” przy każdej grupie, a palcem nie ma czego przestawiać.
const DOTYK = window.matchMedia('(pointer: coarse)');
let przeciagany = null; // { el, pojemnik }
// Grupa przycisków (pojemnik w pojemniku) rusza tylko ze swojego pola, czyli z przerw między przyciskami. Wciśnięta w swoim
// wnętrzu, na przykład na pływającym pasku formatowania, który leży w grupie narzędzi i przesuwa się własnym chwytem
// (edytor.js), do puszczenia myszy się nie przeciąga. Przyciski w niej przeciągają się dalej same, bo są bliżej.
const wstrzymane = [];
document.addEventListener('pointerdown', (ev) => {
  const t = ev.target instanceof Element ? ev.target : null;
  const wyzej = (e) => (e && e.parentElement ? e.parentElement.closest('[data-przestawiane][draggable="true"]') : null);
  for (let g = t && t.closest('[data-przestawiane][draggable="true"]'); g; g = wyzej(g)) {
    if (g === t) continue;
    g.draggable = false;
    wstrzymane.push(g);
  }
}, true);
const wznow = () => {
  for (const g of wstrzymane.splice(0)) g.draggable = true;
};
document.addEventListener('pointerup', wznow, true);
document.addEventListener('pointercancel', wznow, true);

// Układanie każdego pojemnika po kluczu pojemnika. Słaba mapa nie trzyma list Ustawień, które zniknęły po przerysowaniu
// okna (dawny nasłuch myszy na każdą listę trzymał je w pamięci na zawsze). Zmiana myszy i cofnięcie przestawienia
// układają wszystkie pojemniki, które są na stronie.
const ULOZ = new WeakMap();
function ulozWszystkie() {
  for (const p of document.querySelectorAll('[data-przestawiane]')) {
    const f = ULOZ.get(p);
    if (f) f();
  }
}
MYSZ.addEventListener('change', ulozWszystkie);
DOTYK.addEventListener('change', ulozWszystkie);

function wczytaj(grupa) {
  try {
    const k = JSON.parse(localStorage.getItem(PREFIKS + grupa) || '[]');
    return Array.isArray(k) ? k.map(String) : [];
  } catch {
    return [];
  }
}
function zapisz(grupa, klucze) {
  try {
    localStorage.setItem(PREFIKS + grupa, JSON.stringify(klucze));
  } catch {
    /* bez pamięci przeglądarki kolejność zostaje do zamknięcia okna */
  }
}

/**
 * Nowa kolejność obecnych pozycji, a pozycje, których teraz nie ma (grupa narzędzi na dolnym pasku w wąskim oknie, dział
 * bez grup na tej platformie), zostają w zapisie, każda za tą, za którą stała. Bez tego nieobecna pozycja wypadała
 * z zapisu i po powrocie stawała na końcu.
 */
export function scal(stary, nowy) {
  const wynik = [...nowy];
  for (let i = 0; i < stary.length; i++) {
    if (wynik.includes(stary[i])) continue;
    let j = i - 1;
    while (j >= 0 && !wynik.includes(stary[j])) j--;
    wynik.splice(j < 0 ? 0 : wynik.indexOf(stary[j]) + 1, 0, stary[i]);
  }
  return wynik;
}

/** Kopia `lista` w zapisanej kolejności grupy. Nowe pozycje idą na koniec, w swojej kolejności. */
export function uporzadkuj(grupa, lista, klucz) {
  const zapis = wczytaj(grupa);
  if (!zapis.length) return [...lista];
  const miejsce = (x) => {
    const i = zapis.indexOf(String(klucz(x)));
    return i < 0 ? zapis.length : i;
  };
  return lista
    .map((x, i) => [x, miejsce(x), i])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map((t) => t[0]);
}

// Kroki przestawienia w otwartym oknie (Ustawienia). Skróty programu stoją, gdy jest otwarte okno z zasłoną (app.js),
// więc okno ma własne Ctrl+Z i Ctrl+Y tylko dla swoich przestawień. Zamknięcie okna je kończy: po zamknięciu cofnięcia
// nie byłoby widać. W polu do pisania (klucz API, liczba) Ctrl+Z cofa pisanie, jak w Windows.
const KROKI = new WeakMap();
const NIE_PISANIE = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);
function wPisaniu(t) {
  if (!(t instanceof Element)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && !NIE_PISANIE.has(t.type);
}
function krokiOkna(d) {
  let k = KROKI.get(d);
  if (k) return k;
  k = { cofnij: [], ponow: [] };
  KROKI.set(d, k);
  d.addEventListener('close', () => {
    k.cofnij.length = 0;
    k.ponow.length = 0;
  });
  d.addEventListener('keydown', (ev) => {
    const litera = ev.key.length === 1 ? ev.key.toLowerCase() : '';
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || (litera !== 'z' && litera !== 'y') || wPisaniu(ev.target)) return;
    ev.preventDefault();
    const wstecz = litera === 'z' && !ev.shiftKey;
    const w = (wstecz ? k.cofnij : k.ponow).pop();
    if (!w) {
      ogloszenie(wstecz ? 'Nie ma nic do cofnięcia' : 'Nie ma nic do ponowienia');
      return;
    }
    if (wstecz) w.cofnij();
    else w.ponow();
    (wstecz ? k.ponow : k.cofnij).push(w);
    ogloszenie(wstecz ? 'Cofnięto' : 'Ponowiono');
  });
  return k;
}

const wezel = (cel) => (cel instanceof Element ? cel : (cel && cel.parentElement) || null);

/**
 * Kreska celu (zadanie 26): jedna w głównym oknie i jedna w każdym okienku, nad wszystkim, w połowie przerwy, w której
 * stanie przeciągana rzecz, 2 px w kolorze linku. Dawna kreska z cienia w krawędzi przycisku (.cel-przed, .cel-za)
 * przegrywała z cieniem pigułek i okrągłych przycisków, więc przy nich jej nie było widać (zmierzone 22.10.2026). Klasy
 * zostają: mówią, przy czym stanie rzecz, i sprawdzają je testy.
 */
const kreski = new WeakMap(); // warstwa (body albo okienko) → kreska
let widocznaKreska = null;
function kreskaW(warstwa) {
  let k = kreski.get(warstwa);
  if (!k) {
    k = document.createElement('div');
    k.className = 'kreska-celu';
    k.setAttribute('aria-hidden', 'true');
    k.hidden = true;
    warstwa.append(k);
    kreski.set(warstwa, k);
  }
  return k;
}
/** Kreska w pikselach ekranu (x, y, szerokość, wysokość); w okienku przeliczona na jego układ (przesunięcie i skala, arkusze.js). */
function pokazKreske(pojemnik, x, y, w, h) {
  const d = pojemnik.closest('dialog');
  const k = kreskaW(d || document.body);
  if (widocznaKreska && widocznaKreska !== k) widocznaKreska.hidden = true;
  // Na pełne piksele ekranu, żeby kreska była ostra przy każdej skali.
  const px = (v) => Math.round(v * devicePixelRatio) / devicePixelRatio;
  let s = { left: px(x), top: px(y), width: px(w), height: px(h) };
  if (d) {
    const r = d.getBoundingClientRect();
    const skala = d.offsetWidth ? r.width / d.offsetWidth : 1;
    s = { left: (s.left - r.left) / skala - d.clientLeft, top: (s.top - r.top) / skala - d.clientTop, width: s.width / skala, height: s.height / skala };
  }
  k.style.position = d ? 'absolute' : 'fixed';
  k.style.left = `${(s.left + (d ? d.scrollLeft : 0)).toFixed(2)}px`;
  k.style.top = `${(s.top + (d ? d.scrollTop : 0)).toFixed(2)}px`;
  k.style.width = `${Math.max(0, s.width).toFixed(2)}px`;
  k.style.height = `${Math.max(0, s.height).toFixed(2)}px`;
  k.hidden = false;
  widocznaKreska = k;
}
function schowajKreske() {
  if (widocznaKreska) widocznaKreska.hidden = true;
  widocznaKreska = null;
}

/**
 * Na czas przeciągania przygasza miejsca, do których rzecz z `zrodlo` nie wejdzie (reguła Jacka z 21.10.2026: bez znaku
 * zakazu, a miejsce, na które nie wolno upuścić, jest przygaszone): obce pojemniki w całości, a w pojemniku, który obejmuje
 * źródło (pasek nad notatką wokół grupy narzędzi, dział wokół grupy Ustawień), jego pozostałe pozycje. W oknie tylko
 * pojemniki tego okna, w głównym oknie bez okien. Pojemnik w przygaszonym pojemniku nie gaśnie drugi raz.
 */
function przygas(zrodlo) {
  const okno = zrodlo.closest('dialog');
  const obce = [...(okno || document).querySelectorAll('[data-przestawiane]')].filter(
    (p) => p !== zrodlo && !p.contains(zrodlo) && !zrodlo.contains(p) && (okno || !p.closest('dialog')),
  );
  for (const p of obce) if (!obce.some((q) => q !== p && q.contains(p))) p.classList.add('nie-tu');
  const wyzej = (e) => (e.parentElement ? e.parentElement.closest('[data-przestawiane]') : null);
  for (let a = wyzej(zrodlo); a; a = wyzej(a)) {
    for (const c of a.children) if (!c.contains(zrodlo)) c.classList.add('nie-tu');
  }
}
function zgasCel() {
  for (const e of document.querySelectorAll('.cel-przed, .cel-za')) e.classList.remove('cel-przed', 'cel-za');
  schowajKreske();
}
function czysc() {
  for (const e of document.querySelectorAll('.cel-przed, .cel-za, .przestawiany, .nie-tu, .obraz-przeciagania')) {
    e.classList.remove('cel-przed', 'cel-za', 'przestawiany', 'nie-tu', 'obraz-przeciagania');
  }
  schowajKreske();
}
// Przeciąganie wyszło poza swój pojemnik: tam nie ma gdzie upuścić (upuszczenie nic nie robi, app.js), więc kreska znika.
document.addEventListener('dragover', (ev) => {
  if (przeciagany && !przeciagany.pojemnik.contains(wezel(ev.target))) zgasCel();
}, true);

/**
 * Robi z dzieci `pojemnik` pasujących do `element` pozycje do przestawiania. Zwraca funkcję, która od razu układa je
 * w zapisanej kolejności; dzieci rysowane od nowa (etykiety, działy i grupy ustawień) wracają do niej też same.
 * - `grupa`: nazwa zapisanej kolejności albo funkcja, która ją podaje (grupy Ustawień: osobno w każdym dziale),
 * - `klucz(dziecko)`: stały identyfikator pozycji, `poziomo`: pasek w poziomie zamiast listy w pionie,
 * - `uchwyt`: selektor chwytu w pozycji (na przykład ':scope > h3') albo funkcja, która podaje chwyty pozycji (pasek nad
 *   notatką: sama pozycja, odstęp żadnego); bez niego chwyta się przycisk,
 * - `fokus`: chwyt dostaje fokus z klawiatury i tylko na nim działa Alt+strzałka (nagłówek grupy, grupa przycisków),
 * - `nazwa(dziecko)`: co czytnik ekranu mówi po przestawieniu, `wciecie`: o ile kreska celu jest krótsza z obu stron (px).
 * Pojemnik w pojemniku (pozycje w grupie Ustawień, przyciski w grupie narzędzi) dostaje swoje zdarzenia pierwszy,
 * a klawisze z jego wnętrza nie przestawiają pozycji pojemnika nad nim.
 */
export function przestawiane(pojemnik, { grupa, element, klucz, poziomo = false, uchwyt = null, fokus = false, nazwa = null, wciecie = 0 }) {
  if (!pojemnik) return () => {};
  pojemnik.dataset.przestawiane = '';
  const nazwaGrupy = () => (typeof grupa === 'function' ? grupa() : grupa);
  const swoje = (c) => Boolean(c) && c.parentElement === pojemnik && c.matches(element);
  const elementy = () => [...pojemnik.children].filter(swoje);
  const widac = (c) => c.getClientRects().length > 0;
  const dziecko = (cel) => {
    let c = wezel(cel);
    while (c && c.parentElement !== pojemnik) c = c.parentElement;
    return swoje(c) ? c : null;
  };
  // Zdarzenie należy do tego pojemnika, gdy przyszło z jego pozycji albo z jej wnętrza, ale nie z pojemnika w niej
  // (przycisk w grupie narzędzi zmienia miejsce w grupie, a nie w pasku).
  const naszCel = (cel) => {
    const e = wezel(cel);
    const c = dziecko(e);
    return Boolean(c) && (e === c || e.closest('[data-przestawiane]') === pojemnik);
  };
  const przycisk = (c) => (c.matches('button') ? c : c.querySelector('button')) || c;
  const chwyty = (c) => (typeof uchwyt === 'function' ? [].concat(uchwyt(c) || []) : uchwyt ? [...c.querySelectorAll(uchwyt)] : [przycisk(c)]);
  const wChwycie = (c, cel) => chwyty(c).some((h) => h.contains(wezel(cel)));
  // Klasy celu i przygaszenie: na całej pozycji, gdy ma własny chwyt, a w paskach na przycisku.
  const znak = (c) => (uchwyt ? c : przycisk(c));
  const nazwaPozycji = (c) => {
    if (nazwa) return String(nazwa(c) || '').trim();
    const b = przycisk(c);
    const n = b.querySelector('.nazwa');
    return ((n && n.textContent) || b.getAttribute('aria-label') || b.textContent || '').trim();
  };
  const kolejnoscTeraz = () => elementy().map((c) => String(klucz(c)));
  const zachowaj = (klucze, g = nazwaGrupy()) => zapisz(g, scal(wczytaj(g), klucze));
  // Przestawienie to działanie jak każde: Ctrl+Z je cofa, a Ctrl+Y ponawia (lista.js, w otwartym oknie krokiOkna).
  const zapamietajPrzestawienie = (przed) => {
    const po = kolejnoscTeraz();
    if (przed.join('\n') === po.join('\n')) return;
    const g = nazwaGrupy();
    const ustaw = (klucze) => {
      zachowaj(klucze, g);
      ulozWszystkie();
    };
    const wpis = { opis: 'Przestawiono przycisk', cofnij: () => ustaw(przed), ponow: () => ustaw(po) };
    const okno = pojemnik.closest('dialog');
    if (!okno) {
      zapamietajDzialanie(wpis);
      return;
    }
    const k = krokiOkna(okno);
    k.cofnij.push(wpis);
    if (k.cofnij.length > 50) k.cofnij.shift();
    k.ponow.length = 0;
  };
  // Miejsce liczy się wśród pozycji, które widać: schowana (chmura bez synchronizacji, przycisk w menu Więcej) nie ma numeru.
  const powiedzMiejsce = (c) => {
    const lista = elementy().filter(widac);
    ogloszenie(`${nazwaPozycji(c)}: miejsce ${lista.indexOf(c) + 1} z ${lista.length}`);
  };
  const opisChwytu = poziomo ? 'Alt+strzałka w lewo albo w prawo zmienia miejsce' : 'Alt+strzałka w górę albo w dół zmienia miejsce';

  // Zapisana kolejność i chwyt do przeciągania – przy starcie i po każdym przerysowaniu dzieci. Przeciąganie tylko
  // przy myszy (na dotyku długie przytrzymanie zostaje zwykłym stuknięciem) i tylko, gdy jest z czym zamienić miejsce.
  const uloz = () => {
    const teraz = elementy();
    const ruch = teraz.length > 1;
    const klawiatura = ruch && !DOTYK.matches;
    for (const c of teraz) {
      for (const h of chwyty(c)) {
        h.draggable = MYSZ.matches && ruch;
        if (!fokus) continue;
        if (klawiatura) {
          h.tabIndex = 0;
          h.setAttribute('aria-description', opisChwytu);
        } else {
          h.removeAttribute('tabindex');
          h.removeAttribute('aria-description');
        }
      }
    }
    const nowe = uporzadkuj(nazwaGrupy(), teraz, klucz);
    if (nowe.every((c, i) => c === teraz[i])) return;
    const aktywny = document.activeElement;
    let k = 0;
    pojemnik.replaceChildren(...[...pojemnik.children].map((c) => (swoje(c) ? nowe[k++] : c)));
    if (aktywny && pojemnik.contains(aktywny) && document.activeElement !== aktywny) aktywny.focus({ preventScroll: true });
  };
  ULOZ.set(pojemnik, uloz);
  uloz();
  new MutationObserver(uloz).observe(pojemnik, { childList: true });

  // Prostokąt pozycji, jaki widać. Grupa przycisków (pojemnik w pojemniku) ma wokół przycisków pole chwytu, więc liczy się
  // jej wnętrze bez tego pola.
  const prostokat = (c) => {
    const e = znak(c);
    const r = e.getBoundingClientRect();
    if (!e.hasAttribute('data-przestawiane')) return r;
    const s = getComputedStyle(e);
    const [l, p, g, d] = [s.paddingLeft, s.paddingRight, s.paddingTop, s.paddingBottom].map((v) => parseFloat(v) || 0);
    return new DOMRect(r.left + l, r.top + g, Math.max(0, r.width - l - p), Math.max(0, r.height - g - d));
  };
  const zaPolowa = (c, ev) => {
    const r = prostokat(c);
    return poziomo ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  };
  // W przerwie między pozycjami (w paskach 12–24 px, między grupami ustawień 24 px) liczy się najbliższa widoczna pozycja.
  const najblizsza = (ev) => {
    if (!pojemnik.contains(wezel(ev.target))) return null;
    let wynik = null;
    let odleglosc = Infinity;
    for (const c of elementy()) {
      if (!widac(c)) continue;
      const r = prostokat(c);
      const d = poziomo ? Math.max(r.left - ev.clientX, 0, ev.clientX - r.right) : Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom);
      if (d < odleglosc) {
        odleglosc = d;
        wynik = c;
      }
    }
    return wynik;
  };
  const celPod = (ev) => dziecko(ev.target) || najblizsza(ev);
  // Kreska w połowie przerwy między `c` a sąsiadem po stronie `za`; bez sąsiada w tym rzędzie 4 px od krawędzi.
  // W poziomie wysoka jak pozycje obok (odstęp nie ma wysokości, więc bierze ją od sąsiada), w pionie szeroka jak pozycja.
  const rysujKreske = (c, za) => {
    const lista = elementy().filter(widac);
    const r = prostokat(c);
    const s = lista[lista.indexOf(c) + (za ? 1 : -1)];
    const rs = s ? prostokat(s) : null;
    const obok = Boolean(rs) && (poziomo ? rs.top < r.bottom && rs.bottom > r.top : rs.left < r.right && rs.right > r.left);
    const d = pojemnik.closest('dialog');
    const skala = d && d.offsetWidth ? d.getBoundingClientRect().width / d.offsetWidth : 1;
    const g = (Math.round(2 * devicePixelRatio) / devicePixelRatio) * skala;
    const w = wciecie * skala;
    if (poziomo) {
      const x = obok ? (za ? (r.right + rs.left) / 2 : (rs.right + r.left) / 2) : za ? r.right + 4 : r.left - 4;
      const pas = [r, obok ? rs : null].filter((q) => q && q.height > 0);
      const gora = pas.length ? Math.min(...pas.map((q) => q.top)) : r.top - 12;
      const dol = pas.length ? Math.max(...pas.map((q) => q.bottom)) : r.top + 12;
      pokazKreske(pojemnik, x - g / 2, gora + w, g, dol - gora - 2 * w);
    } else {
      const y = obok ? (za ? (r.bottom + rs.top) / 2 : (rs.bottom + r.top) / 2) : za ? r.bottom + 4 : r.top - 4;
      pokazKreske(pojemnik, r.left + w, y - g / 2, r.width - 2 * w, g);
    }
  };

  pojemnik.addEventListener('dragstart', (ev) => {
    const c = dziecko(ev.target);
    if (!c || !ev.dataTransfer || !naszCel(ev.target) || !wChwycie(c, ev.target)) return;
    ev.stopPropagation();
    przeciagany = { el: c, pojemnik };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(TYP, String(klucz(c)));
    if (uchwyt) {
      // Obraz przeciągania to cała pozycja (wiersz albo grupa), a nie sam napis, za który się ją chwyta.
      const r = c.getBoundingClientRect();
      c.classList.add('obraz-przeciagania');
      try {
        ev.dataTransfer.setDragImage(c, Math.round(ev.clientX - r.left), Math.round(ev.clientY - r.top));
      } catch {
        /* bez własnego obrazu przeglądarka pokazuje sam chwyt */
      }
    }
    // Przygaszamy dopiero po zrobieniu obrazu przeciągania, jak kafelki (lista.js).
    requestAnimationFrame(() => {
      c.classList.remove('obraz-przeciagania');
      if (!przeciagany || przeciagany.el !== c) return;
      znak(c).classList.add('przestawiany');
      przygas(pojemnik);
    });
  });
  pojemnik.addEventListener('dragover', (ev) => {
    if (!przeciagany || przeciagany.pojemnik !== pojemnik) return;
    const c = celPod(ev);
    if (!c) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = 'move';
    const b = znak(c);
    for (const x of pojemnik.querySelectorAll('.cel-przed, .cel-za')) if (x !== b) x.classList.remove('cel-przed', 'cel-za');
    if (c === przeciagany.el) {
      b.classList.remove('cel-przed', 'cel-za');
      schowajKreske();
      return;
    }
    const za = zaPolowa(c, ev);
    b.classList.toggle('cel-za', za);
    b.classList.toggle('cel-przed', !za);
    rysujKreske(c, za);
  });
  pojemnik.addEventListener('drop', (ev) => {
    if (!przeciagany || przeciagany.pojemnik !== pojemnik) return;
    ev.preventDefault();
    ev.stopPropagation();
    const c = celPod(ev);
    const ruszany = przeciagany.el;
    czysc();
    if (!c || c === ruszany) return;
    const przed = kolejnoscTeraz();
    if (zaPolowa(c, ev)) c.after(ruszany);
    else c.before(ruszany);
    zachowaj(kolejnoscTeraz());
    zapamietajPrzestawienie(przed);
    powiedzMiejsce(ruszany);
  });
  pojemnik.addEventListener('dragend', () => {
    if (przeciagany && przeciagany.pojemnik !== pojemnik) return;
    czysc();
    przeciagany = null;
  });

  pojemnik.addEventListener('keydown', (ev) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const krok = (poziomo ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[ev.key];
    const c = krok && naszCel(ev.target) ? dziecko(ev.target) : null;
    // Z chwytem z fokusem (nagłówek grupy, grupa przycisków) klawisz działa tylko na samym chwycie.
    if (!c || (fokus && !chwyty(c).includes(wezel(ev.target)))) return;
    // Alt+strzałka przeskakuje schowane pozycje, więc każde naciśnięcie coś widać przesuwa.
    const lista = elementy().filter(widac);
    // Sama jedna pozycja: klawisz zostaje kontrolce (Alt+↓ rozwija listę wyboru).
    if (lista.length < 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    const sasiad = lista[lista.indexOf(c) + krok];
    if (!sasiad) {
      ogloszenie(`${nazwaPozycji(c)}: to już ${krok < 0 ? 'pierwsze' : 'ostatnie'} miejsce`);
      return;
    }
    // Przesuwa się sąsiad, a nie pozycja z fokusem: fokus zostaje tam, gdzie był.
    const przed = kolejnoscTeraz();
    if (krok < 0) c.after(sasiad);
    else c.before(sasiad);
    zachowaj(kolejnoscTeraz());
    zapamietajPrzestawienie(przed);
    powiedzMiejsce(c);
  });
  return uloz;
}