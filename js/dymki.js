// Dymki (reguły Jacka z 16.10.2026, `dymki-na-miejscu.md` i `ikonki-z-dymkami.md`): dymek stoi zawsze na środku pod rzeczą,
// której dotyczy, a gdy pod nią brakuje miejsca, na środku nad nią. Nigdy tam, gdzie akurat stoi kursor, jak dymek systemu
// z `title`. Napis leży w `data-dymek` (pomoc.js, ustawDymek): stare `title` przechodzą tam przy starcie i przy każdej zmianie.
// Napis mówi, co się stanie, od czasownika, a skrót klawiszowy z nawiasu na końcu („Utwórz notatkę (Ctrl+N)”) stoi za nim
// drugim planem. Rzecz, której widoczny napis mówi to samo, dymku nie dostaje, chyba że napis jest ucięty wielokropkiem.
// Karta w stylu Apple z równym wypełnieniem u góry i u dołu, więc tekst stoi na środku w pionie.
// Mysz: po pół sekundy, a następny zaraz po poprzednim od razu. Klawiatura: od razu przy fokusie. Palec: przytrzymanie
// ikonki bez napisu pokazuje dymek, jak w Androidzie, i wtedy puszczenie palca nie klika. Dymek znika, gdy kursor odejdzie
// i od rzeczy, i od dymku, po kliknięciu, przewinięciu, pisaniu i Escape. Nie łapie myszy: kursor może po nim przejechać
// (WCAG 1.4.13), a kliknięcie trafia w to, co pod nim.
import { el, ustawDymek } from './pomoc.js';

const ZWLOKA = 500;
// Tyle po zniknięciu dymku następny pokazuje się od razu, jak w systemie.
const ROZGRZANY = 700;
// Przytrzymanie palcem, po którym pokazuje się dymek, i jak długo zostaje po puszczeniu palca.
const PRZYTRZYMANIE = 500;
const PO_PALCU = 1500;
// Tyle pikseli ruchu palca przerywa przytrzymanie (to już przewijanie).
const DRGNIECIE = 10;
const ODSTEP = 6;
const BRZEG = 8;
// Skrót na końcu napisu: „(Ctrl+N)”, „(F10)”, „(Esc)”, „(↓)”.
const SKROT = /^(.*?\S)\s*\(((?:Ctrl|Alt|Shift|Esc|Enter|Tab|Delete|Del|Spacja|F\d{1,2}|[↑↓←→])[^()]*)\)$/;

let dymek = null;
let wierzch = false; // przeglądarka zna warstwę wierzchnią (popover)
let kotwica = null; // rzecz, której dymek jest pokazany albo czeka
let zrodlo = ''; // 'mysz', 'fokus' albo 'dotyk'
let pokazany = false;
let pokazanyNapis = '';
let czasomierz = 0;
let straznik = 0;
let schowanyO = -Infinity;
// Kliknięta albo zamknięta Escape: jej dymek wraca dopiero wtedy, gdy kursor z niej zejdzie.
let zablokowana = null;
// Przytrzymanie palcem: { e, id, x, y, czasomierz, pokazal } i rzecz, po której puszczeniu łapiemy klik i menu.
let palec = null;
let poPalcu = null; // { e, czas }

const widoczna = (e) => e.isConnected && e.getClientRects().length > 0;
const wRect = (r, x, y, m = 0) => x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
const napisNa = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();

/** Napis ucięty wielokropkiem w tej rzeczy albo w niej (wtedy dymek pokazuje go w całości). */
function uciety(e) {
  for (const c of [e, ...e.querySelectorAll('*')]) if (c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 1) return true;
  return false;
}

/** Treść dymku: napis i skrót albo `null`, gdy dymek nie ma czego dodać. Na palec bez skrótu i tylko przy ikonkach. */
function tresc(e, dotyk) {
  const pelny = (e.dataset.dymek || '').trim();
  if (!pelny) return null;
  const m = SKROT.exec(pelny);
  const glowny = m ? m[1] : pelny;
  const skrot = m && !dotyk ? m[2] : '';
  const widac = napisNa(e);
  if (dotyk && widac && !uciety(e)) return null;
  if (!skrot && glowny === widac && !uciety(e)) return null;
  return { glowny, skrot };
}

function ukryj() {
  clearTimeout(czasomierz);
  clearInterval(straznik);
  if (pokazany) {
    schowanyO = performance.now();
    if (!wierzch) dymek.hidden = true;
    else if (dymek.matches(':popover-open')) dymek.hidePopover();
  }
  pokazany = false;
  kotwica = null;
  zrodlo = '';
}

function ustaw() {
  const r = kotwica.getBoundingClientRect();
  const w = dymek.offsetWidth;
  const h = dymek.offsetHeight;
  const x = Math.max(BRZEG, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - BRZEG));
  let y = r.bottom + ODSTEP;
  // Pod rzeczą brakuje miejsca: na środku nad nią. Gdy nad nią też nie (bardzo wysoka rzecz), tam, gdzie się mieści.
  if (y + h > innerHeight - BRZEG) y = r.top - ODSTEP - h;
  if (y < BRZEG) y = Math.max(BRZEG, Math.min(r.bottom + ODSTEP, innerHeight - h - BRZEG));
  dymek.style.left = `${Math.round(x)}px`;
  dymek.style.top = `${Math.round(y)}px`;
}

function pokaz() {
  clearTimeout(czasomierz);
  const e = kotwica;
  const t = e && widoczna(e) ? tresc(e, zrodlo === 'dotyk') : null;
  if (!t) {
    ukryj();
    return;
  }
  // Otwarte okno (<dialog>) leży w warstwie wierzchniej: dymek z reszty strony stałby pod nim, więc idzie do okna.
  const gdzie = e.closest('dialog[open]') || document.body;
  if (dymek.parentElement !== gdzie) gdzie.append(dymek);
  dymek.replaceChildren(t.glowny, ...(t.skrot ? [el('span.dymek-skrot', { tekst: t.skrot })] : []));
  pokazanyNapis = e.dataset.dymek;
  dymek.style.left = '0px';
  dymek.style.top = '0px';
  if (!wierzch) dymek.hidden = false;
  else if (!dymek.matches(':popover-open')) dymek.showPopover();
  ustaw();
  pokazany = true;
  clearInterval(straznik);
  straznik = setInterval(pilnuj, 250);
}

/** Rzecz zniknęła albo zmieniła napis czy miejsce (przesunięte okienko, nowy stan synchronizacji). */
function pilnuj() {
  if (!kotwica || !kotwica.dataset.dymek || !widoczna(kotwica)) {
    ukryj();
    return;
  }
  if (kotwica.dataset.dymek !== pokazanyNapis) pokaz();
  else ustaw();
}

function zaplanuj(e, skad) {
  if (e === kotwica) {
    zrodlo = skad;
    return;
  }
  clearTimeout(czasomierz);
  const odRazu = skad === 'fokus' || pokazany || performance.now() - schowanyO < ROZGRZANY;
  kotwica = e;
  zrodlo = skad;
  if (odRazu) pokaz();
  else czasomierz = setTimeout(pokaz, ZWLOKA);
}

function koniecPalca(ev) {
  const p = palec;
  if (!p || ev.pointerId !== p.id) return;
  clearTimeout(p.czasomierz);
  palec = null;
  if (!p.pokazal) return;
  // Puszczenie po dymku nie klika ani nie otwiera menu, a dymek zostaje jeszcze chwilę.
  poPalcu = { e: p.e, czas: performance.now() };
  czasomierz = setTimeout(() => {
    if (zrodlo === 'dotyk') ukryj();
  }, PO_PALCU);
}

/** Klik albo menu zaraz po puszczeniu palca, który pokazał dymek: to nie jest stuknięcie. */
function zPalca(ev) {
  return Boolean(poPalcu) && performance.now() - poPalcu.czas < 800 && ev.target instanceof Node && poPalcu.e.contains(ev.target);
}

export function podepnijDymki() {
  if (dymek) return;
  dymek = el('div.dymek#dymek', { role: 'tooltip' });
  wierzch = typeof dymek.showPopover === 'function';
  if (wierzch) dymek.setAttribute('popover', 'manual');
  else dymek.hidden = true;
  document.body.append(dymek);
  for (const e of document.body.querySelectorAll('[title]')) ustawDymek(e, e.getAttribute('title'));
  // Kod, który jeszcze ustawia `title`: napis od razu przechodzi do dymku.
  new MutationObserver((zapisy) => {
    for (const z of zapisy) if (z.target instanceof Element && z.target.hasAttribute('title')) ustawDymek(z.target, z.target.getAttribute('title'));
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] });

  document.addEventListener(
    'pointerover',
    (ev) => {
      if (ev.pointerType === 'touch' || !(ev.target instanceof Element)) return;
      const stary = ev.target.closest('[title]');
      if (stary) ustawDymek(stary, stary.getAttribute('title'));
      const e = ev.target.closest('[data-dymek]');
      if (e && e !== zablokowana) zaplanuj(e, 'mysz');
    },
    true,
  );
  document.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.pointerType === 'touch') {
        if (palec && ev.pointerId === palec.id && Math.hypot(ev.clientX - palec.x, ev.clientY - palec.y) > DRGNIECIE) {
          clearTimeout(palec.czasomierz);
          if (palec.pokazal) ukryj();
          palec = null;
        }
        return;
      }
      if (!kotwica && !zablokowana) return;
      const x = ev.clientX;
      const y = ev.clientY;
      if (zablokowana && !wRect(zablokowana.getBoundingClientRect(), x, y)) zablokowana = null;
      if (!kotwica || zrodlo !== 'mysz') return;
      // Kursor może zjechać na dymek, także przez szczelinę między rzeczą a dymkiem.
      const nad = wRect(kotwica.getBoundingClientRect(), x, y) || (pokazany && wRect(dymek.getBoundingClientRect(), x, y, ODSTEP + 2));
      if (!nad) ukryj();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'pointerout',
    (ev) => {
      if (ev.pointerType !== 'touch' && !ev.relatedTarget && zrodlo === 'mysz') ukryj();
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const e = ev.target instanceof Element ? ev.target.closest('[data-dymek]') : null;
      zablokowana = ev.pointerType === 'touch' ? null : e;
      if (kotwica) ukryj();
      if (ev.pointerType !== 'touch' || !e || !tresc(e, true)) return;
      const p = { e, id: ev.pointerId, x: ev.clientX, y: ev.clientY, pokazal: false, czasomierz: 0 };
      p.czasomierz = setTimeout(() => {
        if (palec !== p) return;
        kotwica = e;
        zrodlo = 'dotyk';
        pokaz();
        p.pokazal = pokazany;
      }, PRZYTRZYMANIE);
      palec = p;
    },
    true,
  );
  document.addEventListener('pointerup', koniecPalca, true);
  // Przeglądarka przejmuje palec (przewijanie albo własne przytrzymanie): bez dymku od razu koniec, z dymkiem po chwili.
  document.addEventListener('pointercancel', koniecPalca, true);
  addEventListener(
    'click',
    (ev) => {
      if (!zPalca(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
    },
    true,
  );
  document.addEventListener(
    'contextmenu',
    (ev) => {
      // Przytrzymanie palcem daje też menu kontekstowe (na Androidzie w trakcie, na Windows po puszczeniu): przy ikonce
      // z dymkiem zostaje sam dymek.
      const t = ev.target instanceof Element ? ev.target : null;
      if ((palec && t && palec.e.contains(t)) || zPalca(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (palec && !palec.pokazal) {
          clearTimeout(palec.czasomierz);
          kotwica = palec.e;
          zrodlo = 'dotyk';
          pokaz();
          palec.pokazal = pokazany;
        }
        return;
      }
      if (kotwica) ukryj();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!kotwica) return;
      if (ev.key === 'Escape') {
        zablokowana = kotwica;
        ukryj();
      } else if (zrodlo !== 'fokus') ukryj();
    },
    true,
  );
  // Fokus z klawiatury (Tab, strzałki w menu kolorów): dymek od razu pod rzeczą z fokusem. Fokus po kliknięciu dymku nie daje.
  document.addEventListener('focusin', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    const e = t && t.closest('[data-dymek]');
    if (e && t.matches(':focus-visible')) zaplanuj(e, 'fokus');
    else if (zrodlo === 'fokus') ukryj();
  });
  document.addEventListener('focusout', (ev) => {
    if (zrodlo === 'fokus' && kotwica && kotwica.contains(ev.target)) ukryj();
  });
  for (const typ of ['scroll', 'wheel', 'dragstart']) {
    document.addEventListener(
      typ,
      () => {
        if (kotwica) ukryj();
      },
      { capture: true, passive: true },
    );
  }
  for (const typ of ['resize', 'blur']) {
    addEventListener(typ, () => {
      if (kotwica) ukryj();
    });
  }
}