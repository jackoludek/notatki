// Światło na przyciskach (wariant 4 „Szkło z iOS 26”): błysk na górnej krawędzi idzie za kursorem, a wciśnięty przycisk
// rozświetla się od miejsca dotyku. Jeden słuchacz na cały dokument: szklane przyciski karteczki i panelu (guziki.css) oraz
// przyciski, kafelki, pigułki i odnośniki okna Notatek (styl.css, „Błysk”). Zmienne idą przez CSSOM (style.setProperty), które
// ścisła polityka treści okna przepuszcza, w przeciwieństwie do atrybutu style.

const CEL = '.szklany, button, .wpis, label.chip, .e-link';

function swiatlo(ev) {
  const b = ev.target && ev.target.closest ? ev.target.closest(CEL) : null;
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--mx', `${Math.round(ev.clientX - r.left)}px`);
  b.style.setProperty('--my', `${Math.round(ev.clientY - r.top)}px`);
}

export function swiatloPrzyciskow(korzen = document) {
  korzen.addEventListener('pointermove', swiatlo, { passive: true });
  korzen.addEventListener('pointerdown', swiatlo, { passive: true });
}