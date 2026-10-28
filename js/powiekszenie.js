// Powiększenie okna na Windows: Ctrl+plus, Ctrl+minus, Ctrl+0, Ctrl z kółkiem myszy i ustawienie
// „Wielkość” w Ogólnych. Tekst da się powiększyć do 200 % (WCAG 1.4.4, wytyczne Apple). Działa jak
// powiększenie w przeglądarce: okno ma wtedy mniej pikseli CSS, więc przy dużym powiększeniu układ
// sam przechodzi w węższy, zamiast ucinać tekst. Poziom zostaje na tym urządzeniu, jak układ okna.
// W przeglądarce robi to sama przeglądarka (te same skróty), na telefonie – rozmiar czcionki Androida.
import { okno, platforma } from './most.js';
import { ogloszenie } from './ui.js';

const KLUCZ = 'ikeeper.powiekszenie';
/** Kroki jak w przeglądarce: drobne przy 100 %, gdzie różnicę czuć, większe dalej. */
export const POZIOMY = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const dostepne = platforma === 'windows';
let poziom = 1;

function zapisany() {
  try {
    const v = Number(localStorage.getItem(KLUCZ));
    return POZIOMY.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function obecne() {
  return poziom;
}

/** „125%” */
export function procent(v = poziom) {
  return `${Math.round(v * 100)}%`;
}

/** Ustawia poziom (najbliższy z kroków), zapisuje go i odświeża wiersz w ustawieniach, gdy jest otwarty. */
export async function ustawPowiekszenie(v) {
  if (!dostepne) return;
  poziom = POZIOMY.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  try {
    localStorage.setItem(KLUCZ, String(poziom));
  } catch {
    /* bez pamięci przeglądarki poziom zostaje do zamknięcia okna */
  }
  await okno('powiekszenie', { skala: poziom });
  odswiezWiersz();
  ogloszenie(`Wielkość ${procent()}`);
}

/** O jeden krok w górę (1) albo w dół (-1). Na końcu zakresu zostaje. */
export function krok(o) {
  const i = POZIOMY.indexOf(poziom);
  return ustawPowiekszenie(POZIOMY[Math.max(0, Math.min(POZIOMY.length - 1, i + o))]);
}

/** Przy starcie, zanim okno się pokaże: zapisany poziom wraca bez mignięcia. */
export async function przywrocPowiekszenie() {
  if (!dostepne) return;
  poziom = zapisany();
  if (poziom !== 1) await okno('powiekszenie', { skala: poziom });
}

/** Skróty jak w przeglądarce. Działają także w polu tekstowym i w otwartym oknie ustawień. */
export function podepnijPowiekszenie() {
  if (!dostepne) return;
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      const o = { '=': 1, '+': 1, '-': -1 }[ev.key];
      if (o) {
        ev.preventDefault();
        ev.stopPropagation();
        krok(o);
      } else if (ev.key === '0' && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        ustawPowiekszenie(1);
      }
    },
    true,
  );
  // Ctrl z kółkiem albo szczypanie na gładziku: jeden krok na wyraźny obrót, nie na każde zdarzenie.
  let suma = 0;
  let ostatni = 0;
  document.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      suma += ev.deltaY;
      const teraz = performance.now();
      if (Math.abs(suma) < 50 || teraz - ostatni < 120) return;
      krok(suma < 0 ? 1 : -1);
      suma = 0;
      ostatni = teraz;
    },
    { passive: false },
  );
}

/** Wiersz w ustawieniach: „Pomniejsz”, poziom, „Powiększ”. Przycisk na końcu zakresu jest przygaszony. */
function odswiezWiersz() {
  const w = document.getElementById('u-powiekszenie');
  if (!w) return;
  w.textContent = procent();
  const [mniej, wiecej] = [document.getElementById('u-pomniejsz'), document.getElementById('u-powieksz')];
  if (mniej) mniej.disabled = poziom <= POZIOMY[0];
  if (wiecej) wiecej.disabled = poziom >= POZIOMY[POZIOMY.length - 1];
}
export { odswiezWiersz as odswiezWierszPowiekszenia };