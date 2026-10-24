// Arkusze (okna <dialog>) przesuwane i skalowane (Jacek, 16.10.2026: „THE INFO WINDOW IS DRAGABLE AND RESIZIABLE - THEY ALL ARE”).
// Chwyt myszą w wolnym miejscu arkusza przesuwa go, a róg z dwiema kreskami i Ctrl+kółko nad arkuszem zmieniają rozmiar
// (75–160%). Dwuklik na rogu wraca do 100% i na środek. Arkusz otwiera się zawsze na środku i nigdy nie wychodzi poza okno:
// stoi co najmniej 24 px od brzegu. Rozmiar zostaje do zamknięcia programu, osobno dla każdego arkusza, jak ściąga w Centrum
// (OknoInfo.cs, SkalujInfo). Przesunięcie to `translate`, a rozmiar `scale`, więc układ w środku arkusza się nie zmienia.
// Na dotyku nic się nie zmienia, a arkusz na całe okno (ustawienia na wąskim ekranie) stoi tak, jak stał.
import { el, ikona } from './pomoc.js';

const MIN = 0.75;
const MAKS = 1.6;
const MARGINES = 24;
// Tyle pikseli ruchu, zanim chwyt zrobi się przesuwaniem: zwykły klik zostaje klikiem.
const PROG = 4;
// Gdzie chwyt nie przesuwa: przyciski, pola, odnośniki, suwaki, tekst, który się zaznacza i kopiuje, i to, co się
// przestawia (nagłówki grup i napisy pozycji w Ustawieniach, js/kolejnosc.js): inaczej arkusz jechałby razem z grupą.
const NIE_CHWYTAJ =
  'button, a, input, select, textarea, label, summary, audio, video, pre, [contenteditable], [role="slider"], [role="separator"], [role="listbox"], [draggable="true"], .historia-podglad, #d-obraz-ocr';

const stan = new WeakMap(); // arkusz → { x, y, s }
const rozmiary = new Map(); // arkusz (id) → skala, do zamknięcia programu
let chwyt = null;

const klucz = (d) => d.id || d.className || 'arkusz';

function granica(d) {
  const w = d.offsetWidth;
  const h = d.offsetHeight;
  return { w, h, maks: w && h ? Math.min(MAKS, (innerWidth - 2 * MARGINES) / w, (innerHeight - 2 * MARGINES) / h) : 1 };
}

/** Skala w granicach, miejsce w oknie, potem styl. */
function popraw(d, st) {
  const { w, h, maks } = granica(d);
  const staly = maks < 0.99;
  st.s = staly ? 1 : Math.max(MIN, Math.min(Math.max(1, maks), st.s));
  if (staly) {
    st.x = 0;
    st.y = 0;
  }
  const mx = Math.max(0, (innerWidth - w * st.s) / 2 - MARGINES);
  const my = Math.max(0, (innerHeight - h * st.s) / 2 - MARGINES);
  st.x = Math.max(-mx, Math.min(mx, st.x));
  st.y = Math.max(-my, Math.min(my, st.y));
  d.style.scale = Math.abs(st.s - 1) > 0.001 ? String(Math.round(st.s * 1000) / 1000) : '';
  // Róg arkusza zawsze na całym pikselu ekranu. Arkusz na środku okna stoi w ułamkowym miejscu (przy 150 % okno 1366 px
  // daje 267 px, czyli 400,5 piksela ekranu), a wtedy kafelki i znaki w nim przyciągają się do pikseli każdy inaczej:
  // 23.10.2026 znak w kafelku działu „Ogólne” stał piksel ekranu od środka. Dosunięcie nie wchodzi do `st`, więc nic nie dryfuje.
  d.style.translate = `${st.x}px ${st.y}px`;
  const k = devicePixelRatio || 1;
  const r = d.getBoundingClientRect();
  const tx = st.x + (Math.round(r.left * k) - r.left * k) / k;
  const ty = st.y + (Math.round(r.top * k) - r.top * k) / k;
  d.style.translate = Math.abs(tx) > 0.001 || Math.abs(ty) > 0.001 ? `${Math.round(tx * 1000) / 1000}px ${Math.round(ty * 1000) / 1000}px` : '';
  const rog = d.querySelector(':scope > .rog-arkusza');
  if (rog) rog.hidden = staly;
}

const rozmiar = new ResizeObserver((wpisy) => {
  for (const w of wpisy) if (w.target.open && stan.has(w.target)) popraw(w.target, stan.get(w.target));
});

function otwarty(d) {
  let st = stan.get(d);
  if (!st) {
    st = { x: 0, y: 0, s: 1 };
    stan.set(d, st);
  }
  st.x = 0;
  st.y = 0;
  st.s = rozmiary.get(klucz(d)) ?? 1;
  if (!d.querySelector(':scope > .rog-arkusza')) d.append(el('div.rog-arkusza', { 'aria-hidden': 'true' }, ikona('rog')));
  popraw(d, st);
  rozmiar.observe(d);
}

function naZaslonie(d, ev) {
  const r = d.getBoundingClientRect();
  return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
}

/** Kliknięcie w pasek przewijania (poza treścią przewijanego miejsca). */
function naPaskuPrzewijania(ev) {
  const t = ev.target;
  return t instanceof HTMLElement && (t.scrollHeight > t.clientHeight || t.scrollWidth > t.clientWidth) && (ev.offsetX > t.clientWidth || ev.offsetY > t.clientHeight);
}

function puszczony(ev) {
  const c = chwyt;
  if (!c || ev.pointerId !== c.id) return;
  chwyt = null;
  document.body.classList.remove('arkusz-ruch', 'rog-arkusza-ruch');
  if (!c.ruszony) return;
  rozmiary.set(klucz(c.d), c.st.s);
  // Klik po przesunięciu nic nie robi, bo podgląd obrazu zamyka się kliknięciem.
  const zlap = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', zlap, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', zlap, { capture: true }), 0);
}

export function podepnijArkusze() {
  new MutationObserver((zapisy) => {
    for (const z of zapisy) {
      const d = z.target;
      if (!(d instanceof HTMLDialogElement)) continue;
      if (d.open) otwarty(d);
      else rozmiar.unobserve(d);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

  document.addEventListener(
    'pointerdown',
    (ev) => {
      if (ev.button !== 0 || ev.pointerType === 'touch' || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.metaKey) return;
      const t = ev.target instanceof Element ? ev.target : null;
      const d = t && t.closest('dialog[open]');
      if (!d || !stan.has(d) || naZaslonie(d, ev)) return;
      const rog = t.closest('.rog-arkusza');
      if (rog ? rog.hidden : t.closest(NIE_CHWYTAJ) || naPaskuPrzewijania(ev)) return;
      const st = stan.get(d);
      const { w, h } = granica(d);
      chwyt = { d, st, rog: Boolean(rog), id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, sx: st.x, sy: st.y, s0: st.s, w, h, ruszony: false };
      if (rog) ev.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'pointermove',
    (ev) => {
      const c = chwyt;
      if (!c || ev.pointerId !== c.id) return;
      const dx = ev.clientX - c.x0;
      const dy = ev.clientY - c.y0;
      if (!c.ruszony) {
        if (Math.hypot(dx, dy) < PROG) return;
        c.ruszony = true;
        try {
          c.d.setPointerCapture(ev.pointerId);
        } catch {
          /* wskaźnik już puszczony */
        }
        document.body.classList.add(c.rog ? 'rog-arkusza-ruch' : 'arkusz-ruch');
        getSelection()?.removeAllRanges();
      }
      if (c.rog) {
        // Prawy dolny róg idzie za kursorem, a lewy górny stoi w miejscu, jak przy zmianie wielkości okna.
        const { maks } = granica(c.d);
        const s = Math.max(MIN, Math.min(Math.max(1, maks), c.s0 + (c.w * dx + c.h * dy) / (c.w * c.w + c.h * c.h)));
        c.st.s = s;
        c.st.x = c.sx + (c.w * (s - c.s0)) / 2;
        c.st.y = c.sy + (c.h * (s - c.s0)) / 2;
      } else {
        c.st.x = c.sx + dx;
        c.st.y = c.sy + dy;
      }
      popraw(c.d, c.st);
    },
    true,
  );
  document.addEventListener('pointerup', puszczony, true);
  document.addEventListener('pointercancel', puszczony, true);
  document.addEventListener(
    'dblclick',
    (ev) => {
      const rog = ev.target instanceof Element ? ev.target.closest('.rog-arkusza') : null;
      const d = rog && rog.closest('dialog[open]');
      if (!d || !stan.has(d)) return;
      ev.preventDefault();
      const st = stan.get(d);
      st.x = 0;
      st.y = 0;
      st.s = 1;
      rozmiary.delete(klucz(d));
      popraw(d, st);
    },
    true,
  );
  // Ctrl+kółko nad arkuszem zmienia jego rozmiar, a nie wielkość całego okna (powiekszenie.js): jeden ząbek to 10%.
  // Punkt pod kursorem zostaje pod kursorem, więc arkusz nie ucieka spod niego, a jeden ruch kółkiem (przerwy krótsze
  // niż 0,4 s) zostaje przy arkuszu do końca. Nad zasłoną obok arkusza Ctrl+kółko dalej powiększa całe okno.
  let kolkiem = null; // { d, czas }
  document.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey) return;
      const teraz = performance.now();
      let d = ev.target instanceof Element ? ev.target.closest('dialog[open]') : null;
      if (d && naZaslonie(d, ev)) d = null;
      if (!d && kolkiem && kolkiem.d.open && teraz - kolkiem.czas < 400) d = kolkiem.d;
      if (!d || !stan.has(d)) return;
      kolkiem = { d, czas: teraz };
      ev.preventDefault();
      ev.stopPropagation();
      const st = stan.get(d);
      const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 800 : ev.deltaY;
      // Ząbek kółka myszy to zawsze 10%, choć przeglądarka podaje go jako 100–150 px, zależnie od skali ekranu (przy 150%
      // jako 150, zmierzone 17.10.2026). Gładzik daje wiele małych kroków, więc tam rozmiar idzie płynnie, za palcami.
      const zabki = Math.abs(dy) >= 50 ? Math.sign(dy) : dy / 100;
      const r = d.getBoundingClientRect();
      const przed = st.s;
      const { maks } = granica(d);
      st.s = Math.max(MIN, Math.min(Math.max(1, maks), przed * Math.pow(1.1, -zabki)));
      const k = st.s / przed;
      st.x += (ev.clientX - (r.left + r.width / 2)) * (1 - k);
      st.y += (ev.clientY - (r.top + r.height / 2)) * (1 - k);
      popraw(d, st);
      rozmiary.set(klucz(d), st.s);
    },
    { capture: true, passive: false },
  );
  addEventListener('resize', () => {
    for (const d of document.querySelectorAll('dialog[open]')) if (stan.has(d)) popraw(d, stan.get(d));
  });
}