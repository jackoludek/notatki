// Formatowanie treści notatki: pogrubienie, kursywa, podkreślenie, przekreślenie, kod, kolor tekstu,
// wyróżnienie tłem, rozmiar pisma i proste tabele. Ten sam plik działa na Windows, w przeglądarce
// i na telefonie – pole treści to `contenteditable`, a formatowanie zapisujemy jako ograniczony HTML
// w `tresc.tekst_html` (czysty tekst zostaje w `tresc.tekst`).
//
// Kolor, wyróżnienie, rozmiar i interlinia to klasy (`<span class="k-czerwony t-zolty r-duzy l-2">`), a nie styl
// w atrybucie: okno ma ścisłą politykę treści (CSP `style-src 'self'`), która blokuje atrybut `style`.
// Do 15.10.2026 formatowanie szło stylem i dlatego ani kolor, ani wyróżnienie, ani rozmiar nigdy się
// nie pokazały. Odcienie klas są w styl.css, osobno dla jasnego i ciemnego motywu.
//
// Postać kanoniczną, którą wysyłamy do rdzenia, robi automat `Czysciciel` – ten sam co w rdzeniu
// (02 --- Rdzen - Rust/src/format.rs). Dla postaci kanonicznej oba dają znak w znak ten sam wynik,
// inaczej każdy zapis wyglądałby jak zmiana z innego urządzenia. Zmieniasz jeden – zmieniasz oba.

const PROSTE = new Map([['b', 'b'], ['strong', 'b'], ['i', 'i'], ['em', 'i'], ['u', 'u'], ['s', 's'], ['strike', 's'], ['del', 's'], ['code', 'code']]);
const BLOKI = new Set(['div', 'p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);
const BEZ_TRESCI = new Set(['script', 'style', 'template']);
const SEKCJE = new Set(['tbody', 'thead', 'tfoot']);
const KOMORKI = new Set(['td', 'th']);
// Znaczniki formatowania w polu edycji (to, co wolno rozcinać przy kolorowaniu fragmentu).
const W_LINII = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'span', 'font', 'a', 'sub', 'sup', 'mark', 'small', 'big']);
const MAX_GLEBOKOSC = 32;
const ODSTEPY = /^[\t\n\f\r ]*$/;
const SPACJE = /[\t\n\f\r ]+/;

/**
 * Jedna paleta Apple na wszystko: kolor notatki (kafelek), kolor tekstu i wyróżnienie. Klucz jak kolory notatek z Google
 * Keep (tak zapisuje je rdzeń, a styl.css barwi nim kółka: [data-kolor]), nazwa do dymku i dla czytnika ekranu, klasa
 * koloru tekstu i klasa wyróżnienia. Ta sama lista klas jest w rdzeniu (format.rs) – zmieniasz obie.
 */
export const KOLORY_PALETY = [
  ['DEFAULT', 'Bez koloru', '', ''],
  ['RED', 'Czerwony', 'k-czerwony', 't-czerwony'],
  ['ORANGE', 'Pomarańczowy', 'k-pomaranczowy', 't-pomaranczowy'],
  ['YELLOW', 'Żółty', 'k-zolty', 't-zolty'],
  ['GREEN', 'Zielony', 'k-zielony', 't-zielony'],
  ['TEAL', 'Miętowy', 'k-mietowy', 't-mietowy'],
  ['BLUE', 'Błękitny', 'k-blekitny', 't-blekitny'],
  ['CERULEAN', 'Niebieski', 'k-niebieski', 't-niebieski'],
  ['PURPLE', 'Fioletowy', 'k-fioletowy', 't-fioletowy'],
  ['PINK', 'Różowy', 'k-rozowy', 't-rozowy'],
  ['BROWN', 'Brązowy', 'k-brazowy', 't-brazowy'],
  ['GRAY', 'Szary', 'k-szary', 't-szary'],
];

/** Kolory tekstu (nazwa + klasa). */
export const KOLORY_TEKSTU = KOLORY_PALETY.map(([, n, k]) => [n, k]);

/** Wyróżnienia tłem, jak zakreślacz (nazwa + klasa). */
export const KOLORY_TLA = KOLORY_PALETY.map(([, n, , t]) => [t ? n : 'Bez wyróżnienia', t]);

/** Paleta do menu (ui.js, paleta) dla grupy 0 (kolor tekstu) albo 1 (wyróżnienie): [klucz, nazwa]. */
export function paletaFormatu(grupa) {
  const nazwy = grupa === 0 ? KOLORY_TEKSTU : KOLORY_TLA;
  return KOLORY_PALETY.map(([k], i) => [k, nazwy[i][0]]);
}

/** Klasa koloru tekstu (grupa 0) albo wyróżnienia (grupa 1) dla klucza z palety. */
export function klasaKoloru(grupa, klucz) {
  const w = KOLORY_PALETY.find(([k]) => k === klucz);
  return w ? w[grupa === 0 ? 2 : 3] : '';
}

/** Klucz palety dla klasy koloru tekstu albo wyróżnienia ('DEFAULT', gdy klasy nie ma). */
export function kluczKoloru(grupa, klasa) {
  const w = klasa && KOLORY_PALETY.find((x) => x[grupa === 0 ? 2 : 3] === klasa);
  return w ? w[0] : 'DEFAULT';
}

/** Rozmiary pisma, od najmniejszego. */
export const ROZMIARY = [
  ['Mały', 'r-maly'],
  ['Zwykły', ''],
  ['Duży', 'r-duzy'],
  ['Nagłówek', 'r-naglowek'],
  ['Tytuł', 'r-tytul'],
];

/**
 * Interlinia (Jacek, 25.10.2026: „Interlinię, żebym mógł wybierać”): odstęp wierszy jako wielokrotność wielkości pisma.
 * Klasa leży na całych akapitach (zmienInterlinie), a styl.css ma ją tylko w polu treści, więc kafelki zostają zwarte.
 * Mniejszej niż zwykła nie ma: klasa w wierszu nie zmniejszy odstępu bloku, a ściśnięty tekst to to, czego Jacek nie chce.
 * Ta sama lista klas jest w rdzeniu (format.rs, INTERLINIE) – zmieniasz obie.
 */
export const INTERLINIE = [
  ['1,5 (zwykła)', ''],
  ['1,75', 'l-175'],
  ['2', 'l-2'],
  ['2,5', 'l-25'],
];

/** Tabela z szerokimi, prawie przezroczystymi liniami zamiast cienkich. */
export const TABELA_SZEROKA = 'linie-szerokie';

// Grupy klas w kolejności, w jakiej stoją w atrybucie `class`: kolor, wyróżnienie, rozmiar, interlinia.
const GRUPY = [KOLORY_TEKSTU, KOLORY_TLA, ROZMIARY, INTERLINIE].map((lista) => lista.map(([, k]) => k).filter(Boolean));

// Formatowanie stylem sprzed 15.10.2026: dokładne wartości z dawnej palety przechodzą na klasy.
const STARE_KOLORY = new Map([['220,38,38', 'k-czerwony'], ['234,88,12', 'k-pomaranczowy'], ['22,163,74', 'k-zielony'], ['37,99,235', 'k-niebieski'], ['124,58,237', 'k-fioletowy'], ['219,39,119', 'k-rozowy'], ['107,114,128', 'k-szary']]);
const STARE_TLA = new Map([['253,230,138', 't-zolty'], ['187,247,208', 't-zielony'], ['191,219,254', 't-niebieski'], ['251,207,232', 't-rozowy']]);
const STARE_ROZMIARY = new Map([['0.85em', 'r-maly'], ['1.25em', 'r-duzy'], ['1.6em', 'r-naglowek'], ['2em', 'r-tytul']]);
const STARE_FONT = new Map([['1', 'r-maly'], ['2', 'r-maly'], ['4', 'r-duzy'], ['5', 'r-naglowek'], ['6', 'r-tytul'], ['7', 'r-tytul']]);

/** `#rgb`, `#rrggbb`, `rgb(r, g, b)` albo `rgb(r g b)` jako napis „r,g,b” (albo null). */
function rgb(v) {
  const w = String(v || '').trim().toLowerCase();
  if (!/^[\x20-\x7e]*$/.test(w)) return null;
  if (w.startsWith('#')) {
    let h = w.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
  }
  const m = /^rgba?\((.*)\)$/.exec(w);
  if (!m) return null;
  const liczby = m[1].split(/[, /]/).filter(Boolean).slice(0, 3);
  if (liczby.length !== 3 || !liczby.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return liczby.map(Number).join(',');
}

/** Klasy formatowania znacznika `span` albo `font` w postaci kanonicznej (albo null, gdy żadnej). */
function klasyZnacznika(nazwa, atr) {
  const grupy = [null, null, null, null];
  for (const slowo of (atr('class') || '').split(SPACJE)) {
    GRUPY.forEach((g, i) => {
      if (!grupy[i] && g.includes(slowo)) grupy[i] = slowo;
    });
  }
  if (nazwa === 'font') {
    if (!grupy[0]) grupy[0] = STARE_KOLORY.get(rgb(atr('color'))) || null;
    if (!grupy[2]) grupy[2] = STARE_FONT.get((atr('size') || '').trim()) || null;
  } else {
    for (const poz of (atr('style') || '').split(';')) {
      const i = poz.indexOf(':');
      if (i < 0) continue;
      const n = poz.slice(0, i).trim().toLowerCase();
      const wartosc = poz.slice(i + 1);
      let g;
      let k;
      if (n === 'color') [g, k] = [0, STARE_KOLORY.get(rgb(wartosc))];
      else if (n === 'background-color') [g, k] = [1, STARE_TLA.get(rgb(wartosc))];
      else if (n === 'font-size') [g, k] = [2, STARE_ROZMIARY.get(wartosc.trim().toLowerCase())];
      else continue;
      if (!grupy[g]) grupy[g] = k || null;
    }
  }
  const w = grupy.filter(Boolean);
  return w.length ? w.join(' ') : null;
}

function zakoduj(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Automat postaci kanonicznej – ten sam co `Czysciciel` w rdzeniu. Dostaje po kolei tekst, podziały
 * wiersza i znaczniki (otwarcie, zamknięcie), a oddaje bezpieczny HTML:
 * - otwarcia czekają na treść, więc puste znaczniki znikają;
 * - `br` czekają na treść, więc na końcu treści i na końcu komórki znikają;
 * - tabela stoi zawsze na najwyższym poziomie, a formatowanie wokół niej wraca za nią.
 */
class Czysciciel {
  constructor() {
    this.wynik = '';
    this.stos = [];
    this.ileBr = 0;
    this.poczatek = true;
    this.tabela = null;
  }

  granica() {
    const t = this.tabela;
    if (!t) return 0;
    return t.komorka !== null ? t.komorka : t.dno;
  }

  tekst(s) {
    if (!s) return;
    // Nowa linia w tekście to podział wiersza: pole ma `white-space: pre-wrap`, więc Shift+Enter
    // wstawia tam znak nowej linii, a nie `<br>`. Twarda spacja na zwykłą – rdzeń robi to samo.
    s = s.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    if (this.tabela && this.tabela.komorka === null) {
      // Odstępy między wierszami i komórkami w HTML-u to nie treść.
      if (ODSTEPY.test(s)) return;
      this.otworzKomorke();
    }
    s.split('\n').forEach((kawalek, nr) => {
      if (nr > 0) this.br();
      if (kawalek) {
        this.wypiszCzekajace();
        this.wynik += zakoduj(kawalek);
        this.poczatek = false;
      }
    });
  }

  wypiszCzekajace() {
    this.wynik += '<br>'.repeat(this.ileBr);
    this.ileBr = 0;
    for (let i = this.granica(); i < this.stos.length; i++) {
      const w = this.stos[i];
      if (!w.wypisany && w.otwarcie) {
        this.wynik += w.otwarcie;
        w.wypisany = true;
      }
    }
  }

  br() {
    if (this.tabela && this.tabela.komorka === null) return;
    this.ileBr += 1;
    this.poczatek = true;
  }

  linia() {
    if (!this.poczatek) this.br();
  }

  wTabeli() {
    return Boolean(this.tabela) && this.tabela.zagniezdzone === 0;
  }

  otworz(n, atr) {
    if (n === 'br') return this.br();
    if (n === 'table') {
      if (this.tabela) {
        this.tabela.zagniezdzone += 1;
        return undefined;
      }
      const szeroka = (atr('class') || '').split(SPACJE).includes(TABELA_SZEROKA);
      this.tabela = { szeroka, dno: this.stos.length, wypisana: false, wiersz: 'brak', komorka: null, zagniezdzone: 0 };
      return undefined;
    }
    if (n === 'tr') {
      if (!this.wTabeli()) return undefined;
      this.zamknijKomorke();
      if (this.tabela.wiersz === 'otwarty') this.wynik += '</tr>';
      this.tabela.wiersz = 'czeka';
      return undefined;
    }
    if (KOMORKI.has(n)) {
      if (!this.wTabeli()) return undefined;
      this.zamknijKomorke();
      this.otworzKomorke();
      return undefined;
    }
    if (SEKCJE.has(n)) return undefined;
    if (BLOKI.has(n)) return this.linia();
    let nazwa;
    let otwarcie;
    if (PROSTE.has(n)) {
      nazwa = PROSTE.get(n);
      otwarcie = `<${nazwa}>`;
    } else if (n === 'span' || n === 'font') {
      nazwa = 'span';
      const k = klasyZnacznika(n, atr);
      otwarcie = k ? `<span class="${k}">` : null;
    } else {
      // Nieznany znacznik: pomijamy sam znacznik, treść w środku zostaje.
      return undefined;
    }
    this.stos.push({ nazwa, otwarcie: this.stos.length < MAX_GLEBOKOSC ? otwarcie : null, wypisany: false });
    return undefined;
  }

  zamknij(n) {
    if (n === 'br') return this.br();
    if (n === 'table') {
      if (!this.tabela) return undefined;
      if (this.tabela.zagniezdzone > 0) {
        this.tabela.zagniezdzone -= 1;
        return undefined;
      }
      return this.zamknijTabele();
    }
    if (n === 'tr') {
      if (!this.wTabeli()) return undefined;
      this.zamknijKomorke();
      if (this.tabela.wiersz === 'otwarty') this.wynik += '</tr>';
      this.tabela.wiersz = 'brak';
      return undefined;
    }
    if (KOMORKI.has(n)) {
      if (this.wTabeli()) this.zamknijKomorke();
      return undefined;
    }
    if (SEKCJE.has(n)) return undefined;
    if (BLOKI.has(n)) return this.linia();
    const kanoniczna = n === 'span' || n === 'font' ? 'span' : PROSTE.get(n);
    if (!kanoniczna) return undefined;
    const od = this.granica();
    let poz = -1;
    for (let i = this.stos.length - 1; i >= od; i--) {
      if (this.stos[i].nazwa === kanoniczna) {
        poz = i;
        break;
      }
    }
    if (poz < 0) return undefined;
    // Zamyka znacznik razem z tymi, które otwarto po nim (inaczej wyszedłby krzyżowy HTML).
    while (this.stos.length > poz) {
      const w = this.stos.pop();
      if (w.wypisany) this.wynik += `</${w.nazwa}>`;
    }
    return undefined;
  }

  otworzKomorke() {
    const t = this.tabela;
    if (!t) return;
    if (!t.wypisana) {
      for (let i = t.dno - 1; i >= 0; i--) {
        const w = this.stos[i];
        if (w.wypisany) {
          this.wynik += `</${w.nazwa}>`;
          w.wypisany = false;
        }
      }
      this.wynik += '<br>'.repeat(this.ileBr);
      this.ileBr = 0;
      this.wynik += t.szeroka ? `<table class="${TABELA_SZEROKA}"><tbody>` : '<table><tbody>';
      t.wypisana = true;
    }
    if (t.wiersz !== 'otwarty') {
      this.wynik += '<tr>';
      t.wiersz = 'otwarty';
    }
    this.wynik += '<td>';
    t.komorka = this.stos.length;
    this.poczatek = true;
  }

  zamknijKomorke() {
    const t = this.tabela;
    if (!t || t.komorka === null) return;
    this.ileBr = 0;
    while (this.stos.length > t.komorka) {
      const w = this.stos.pop();
      if (w.wypisany) this.wynik += `</${w.nazwa}>`;
    }
    this.wynik += '</td>';
    t.komorka = null;
  }

  zamknijTabele() {
    this.zamknijKomorke();
    const t = this.tabela;
    if (!t) return;
    this.tabela = null;
    if (t.wiersz === 'otwarty') this.wynik += '</tr>';
    if (this.stos.length > t.dno) this.stos.length = t.dno;
    if (t.wypisana) {
      this.wynik += '</tbody></table>';
      this.poczatek = true;
    }
  }

  koniec() {
    if (this.tabela) this.zamknijTabele();
    this.ileBr = 0;
    while (this.stos.length) {
      const w = this.stos.pop();
      if (w.wypisany) this.wynik += `</${w.nazwa}>`;
    }
    return this.wynik;
  }
}

const ZACHOWUJE_ODSTEPY = /white-space\s*:\s*(pre|break-spaces)/i;

/**
 * `wklejka` – HTML ze schowka: na stronie, z której pochodzi, odstępy i nowe linie w kodzie to jedna
 * spacja, więc tak je czytamy (poza `<pre>` i elementami z `white-space: pre…`, na przykład kopią
 * z tego pola). Bez tego tekst złamany w kodzie strony wklejał się w kilku wierszach.
 */
function przejdz(wezel, c, wklejka, zachowaj) {
  for (const w of wezel.childNodes) {
    if (w.nodeType === Node.TEXT_NODE) {
      let s = w.nodeValue;
      if (wklejka && !zachowaj) {
        s = s.replace(/[\t\n\r\f ]+/g, ' ');
        if (c.poczatek) s = s.replace(/^ /, '');
      }
      c.tekst(s);
    } else if (w.nodeType === Node.ELEMENT_NODE) {
      const n = w.localName;
      if (n === 'br') c.br();
      else if (!BEZ_TRESCI.has(n)) {
        c.otworz(n, (a) => w.getAttribute(a));
        przejdz(w, c, wklejka, zachowaj || n === 'pre' || n === 'textarea' || ZACHOWUJE_ODSTEPY.test(w.getAttribute('style') || ''));
        c.zamknij(n);
      }
    }
  }
}

/**
 * Sprowadza dowolny HTML do postaci kanonicznej. Parsujemy przez `DOMParser`, więc nic się
 * po drodze nie wykonuje i nic się nie pobiera z sieci – nawet gdyby ktoś podmienił plik
 * synchronizacji w chmurze.
 */
export function czysc(html, { wklejka = false } = {}) {
  if (!html) return '';
  const dok = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const c = new Czysciciel();
  przejdz(dok.body, c, wklejka, false);
  return c.koniec();
}

const ZNACZNIK_KANONICZNY = /<(\/?)([a-z]+)[^>]*>/g;

function odkoduj(s) {
  return s.indexOf('&') < 0 ? s : s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Czysty tekst z postaci kanonicznej – ten sam przepis co `do_tekstu` w rdzeniu. Na napisie, bez parsera HTML:
 * postać kanoniczną robi tylko `Czysciciel`, więc znaczniki są proste, a tekst ma tylko &amp; &lt; &gt;
 * (10 mln znaków w kilkadziesiąt milisekund zamiast kilkuset).
 */
function tekstKanoniczny(kanoniczny) {
  const czesci = [];
  let dlugosc = 0;
  let ostatni = '';
  const dodaj = (s) => {
    if (!s) return;
    czesci.push(s);
    dlugosc += s.length;
    ostatni = s[s.length - 1];
  };
  let wiersze = 0;
  let komorki = 0;
  let od = 0;
  ZNACZNIK_KANONICZNY.lastIndex = 0;
  for (let m = ZNACZNIK_KANONICZNY.exec(kanoniczny); m; m = ZNACZNIK_KANONICZNY.exec(kanoniczny)) {
    dodaj(odkoduj(kanoniczny.slice(od, m.index)));
    od = ZNACZNIK_KANONICZNY.lastIndex;
    const zamyka = m[1] === '/';
    const n = m[2];
    if (n === 'br') dodaj('\n');
    else if (n === 'table') {
      if (zamyka) dodaj('\n');
      else {
        if (dlugosc && ostatni !== '\n') dodaj('\n');
        wiersze = 0;
      }
    } else if (n === 'tr' && !zamyka) {
      if (wiersze > 0) dodaj('\n');
      wiersze += 1;
      komorki = 0;
    } else if (KOMORKI.has(n) && !zamyka) {
      if (komorki > 0) dodaj('\t');
      komorki += 1;
    }
  }
  dodaj(odkoduj(kanoniczny.slice(od)));
  return czesci.join('').replace(/\n+$/, '');
}

/** Postać kanoniczna prosto z pola edycji (bez zamiany na napis i ponownego parsowania). */
export function czyscPole(pole) {
  const c = new Czysciciel();
  przejdz(pole, c, false, false);
  return c.koniec();
}

/** Czysty tekst z pola (dokładnie to, co widzi użytkownik). */
export function tekstZPola(pole) {
  return tekstKanoniczny(czyscPole(pole));
}

/** Treść pola do zapisu jednym przejściem: postać kanoniczna, czysty tekst i czy formatowanie coś wnosi. */
export function trescPola(pole) {
  const html = czyscPole(pole);
  const tekst = tekstKanoniczny(html);
  return { html, tekst, formatowanie: Boolean(html) && html !== htmlZTekstu(tekst) };
}

const LINII_W_BLOKU = 64;
const BLOKI_OD = 256;

/**
 * Długa notatka w polu edycji: wiersze w blokach po 64 (`<div>`), a nie jeden blok z tysiącami `<br>`. Przeglądarka
 * przelicza wtedy po klawiszu jeden blok, a nie całą notatkę (zmierzone 15.10.2026: przy milionie znaków klawisz
 * z 0,15 s do 0,005 s). Zapis tego nie widzi: blok to w postaci kanonicznej zwykła nowa linia, więc
 * `czysc(wBlokach(k)) === k`. Podział tylko na `<br>` poza formatowaniem i tabelą, za niepustym wierszem i nie zaraz
 * za tabelą – tam blok zmieniłby treść.
 */
export function wBlokach(k) {
  if (!k || k.split('<br>', BLOKI_OD + 1).length <= BLOKI_OD) return k;
  const bloki = [];
  let poczatek = 0;
  let glebokosc = 0;
  let wiersze = 0;
  let ostatni = 'start';
  let od = 0;
  ZNACZNIK_KANONICZNY.lastIndex = 0;
  for (let m = ZNACZNIK_KANONICZNY.exec(k); m; m = ZNACZNIK_KANONICZNY.exec(k)) {
    if (m.index > od) ostatni = 'tekst';
    od = ZNACZNIK_KANONICZNY.lastIndex;
    const n = m[2];
    if (n === 'br') {
      if (glebokosc === 0) {
        wiersze += 1;
        if (wiersze >= LINII_W_BLOKU && ostatni === 'tekst') {
          bloki.push(k.slice(poczatek, m.index));
          poczatek = od;
          wiersze = 0;
          ostatni = 'start';
          continue;
        }
      }
      ostatni = 'br';
    } else if (m[1] === '/') {
      glebokosc -= 1;
      ostatni = n === 'table' ? 'tabela' : 'tekst';
    } else {
      glebokosc += 1;
    }
  }
  if (!bloki.length) return k;
  bloki.push(k.slice(poczatek));
  return bloki.map((b) => `<div>${b}</div>`).join('');
}

/**
 * Długa wklejka (ponad 100 tys. znaków): bez polecenia przeglądarki, które przy 10 mln znaków liczy kilka sekund,
 * i od razu w blokach (wBlokach), żeby pisanie potem nie zwalniało. Ctrl+Z cofa ją jak każde wklejenie (edytor.js).
 */
export function wklejDuzo(pole, html) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !pole.contains(s.getRangeAt(0).startContainer)) return false;
  const r = s.getRangeAt(0);
  r.deleteContents();
  r.insertNode(r.createContextualFragment(html));
  r.collapse(false);
  s.removeAllRanges();
  s.addRange(r);
  const z = zaznaczenie(pole);
  pole.innerHTML = wBlokach(czyscPole(pole));
  naprawTabele(pole);
  if (z) ustawZaznaczenie(pole, z[0], z[1]);
  return true;
}

/** Czysty tekst ze sformatowanej treści: komórki tabeli rozdziela tabulator, wiersze nowa linia. */
export function tekstZHtml(html) {
  return tekstKanoniczny(czysc(String(html || '')));
}

/** Sformatowana treść z czystego tekstu (bez formatowania) – jak `z_tekstu` w rdzeniu. */
export function htmlZTekstu(tekst) {
  return String(tekst || '').split('\n').map(zakoduj).join('<br>');
}

/** Czy sformatowana treść wnosi coś ponad czysty tekst. */
export function maFormatowanie(html) {
  const k = czysc(html);
  return Boolean(k) && k !== htmlZTekstu(tekstKanoniczny(k));
}

// --- kursor: pozycje liczone w znakach czystego tekstu ---

/**
 * Znaki czystego tekstu na żywym polu edycji, po kolei: węzły tekstu i znaki, które tekst dokłada
 * (nowa linia z `<br>`, z bloku i wokół tabeli, tabulator między komórkami). Każdy znak dokładany ma
 * miejsce w polu, w którym stoi kursor tuż przed nim. Podziały wiersza na końcu komórki mają długość
 * 0, jak w `Czysciciel` (pole edycji dokłada tam `<br>`, żeby było gdzie postawić kursor).
 */
function znakiPola(pole) {
  const lista = [];
  let poczatek = true;
  let ostatni = '';
  let czekajace = [];
  // Miejsce znaku dokładanego zapisane jako element („przed nim” albo „na jego końcu”), a jego indeks wśród rodzeństwa
  // liczony dopiero wtedy, gdy trzeba (miejsceZnaku): długa notatka po wklejeniu ma setki tysięcy wierszy w jednym
  // rodzicu i liczenie indeksu każdego dawało czas kwadratowy (16.10.2026: milion znaków – 8,6 s).
  const przedEl = (el) => ({ przed: el });
  const naKoncu = (el) => ({ naKoncu: el });
  const nowaLinia = (miejsce, czeka) => {
    const z = { dl: 1, ...miejsce };
    lista.push(z);
    if (czeka) czekajace.push(z);
    poczatek = true;
    ostatni = '\n';
  };
  const potwierdz = () => {
    czekajace = [];
  };
  const chodz = (el) => {
    for (const w of el.childNodes) {
      if (w.nodeType === Node.TEXT_NODE) {
        if (!w.nodeValue || SEKCJE.has(el.localName) || el.localName === 'table' || el.localName === 'tr') continue;
        lista.push({ wezel: w, dl: w.nodeValue.length });
        potwierdz();
        poczatek = false;
        ostatni = w.nodeValue[w.nodeValue.length - 1];
        continue;
      }
      if (w.nodeType !== Node.ELEMENT_NODE) continue;
      const n = w.localName;
      if (n === 'br') nowaLinia(przedEl(w), true);
      else if (n === 'table') tabela(w);
      else if (BEZ_TRESCI.has(n)) continue;
      else {
        if (BLOKI.has(n) && !poczatek) nowaLinia(przedEl(w), true);
        chodz(w);
        if (BLOKI.has(n) && !poczatek) nowaLinia(naKoncu(w), true);
      }
    }
  };
  const tabela = (t) => {
    potwierdz();
    if (ostatni && ostatni !== '\n') nowaLinia(przedEl(t), false);
    let poprzednia = null;
    let wiersz = 0;
    for (const tr of t.rows) {
      if (wiersz++ > 0) nowaLinia(poprzednia ? naKoncu(poprzednia) : przedEl(tr), false);
      let k = 0;
      for (const td of tr.cells) {
        if (k++ > 0) {
          lista.push({ dl: 1, ...naKoncu(poprzednia) });
          ostatni = '\t';
        }
        poczatek = true;
        chodz(td);
        for (const z of czekajace) z.dl = 0;
        czekajace = [];
        poprzednia = td;
      }
    }
    nowaLinia(poprzednia ? naKoncu(poprzednia) : przedEl(t), false);
  };
  chodz(pole);
  return lista;
}

/** Punkt w polu (węzeł, przesunięcie), w którym stoi kursor tuż przed znakiem dokładanym. */
function miejsceZnaku(z) {
  if (z.przed) return [z.przed.parentNode, Array.prototype.indexOf.call(z.przed.parentNode.childNodes, z.przed)];
  return [z.naKoncu, z.naKoncu.childNodes.length];
}

function policzDoPunktu(pole, wezel, offset) {
  const znaki = znakiPola(pole);
  // Kursor prawie zawsze stoi w węźle tekstu albo tuż obok niego: wtedy wystarczy znaleźć ten węzeł na liście,
  // bez porównywania punktów w DOM (przy długiej notatce byłyby ich setki tysięcy).
  let w = wezel;
  let o = offset;
  if (w.nodeType !== Node.TEXT_NODE) {
    const za = w.childNodes[o];
    const przed = o > 0 ? w.childNodes[o - 1] : null;
    if (za && za.nodeType === Node.TEXT_NODE && za.nodeValue) [w, o] = [za, 0];
    else if (przed && przed.nodeType === Node.TEXT_NODE && przed.nodeValue) [w, o] = [przed, przed.nodeValue.length];
  }
  if (w.nodeType === Node.TEXT_NODE) {
    let n = 0;
    for (const z of znaki) {
      if (z.wezel === w) return n + Math.min(o, z.dl);
      n += z.dl;
    }
  }
  // Kursor między elementami: pierwszy znak, który stoi w miejscu kursora albo za nim. Znaki są w porządku
  // dokumentu, więc wyszukiwanie połówkowe – kilkanaście porównań zamiast jednego na każdy znak.
  const r = document.createRange();
  r.setStart(wezel, offset);
  r.collapse(true);
  const zaKursorem = (z) => (z.wezel ? r.comparePoint(z.wezel, 0) : r.comparePoint(...miejsceZnaku(z))) >= 0;
  let od = 0;
  let do_ = znaki.length;
  while (od < do_) {
    const s = (od + do_) >> 1;
    if (zaKursorem(znaki[s])) do_ = s;
    else od = s + 1;
  }
  let n = 0;
  for (let i = 0; i < od; i++) n += znaki[i].dl;
  return n;
}

/** Długość tekstu w polu liczona tak jak pozycje kursora (z liniami na końcu). */
function dlugoscPola(pole) {
  return znakiPola(pole).reduce((s, z) => s + z.dl, 0);
}

/** Zaznaczenie w polu jako pozycje w tekście (albo `null`, gdy kursora tam nie ma). */
export function zaznaczenie(pole) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!pole.contains(r.startContainer)) return null;
  const od = policzDoPunktu(pole, r.startContainer, r.startOffset);
  const do_ = r.collapsed ? od : policzDoPunktu(pole, r.endContainer, r.endOffset);
  return [od, do_];
}

function punkt(pole, poz) {
  let n = 0;
  for (const z of znakiPola(pole)) {
    if (z.wezel) {
      if (poz <= n + z.dl) return [z.wezel, poz - n];
    } else if (z.dl && poz <= n) {
      return miejsceZnaku(z);
    }
    n += z.dl;
  }
  return [pole, pole.childNodes.length];
}

/** Ustawia kursor (albo zaznaczenie) na podanych pozycjach w tekście. */
export function ustawZaznaczenie(pole, od, do_ = od) {
  const s = window.getSelection();
  if (!s) return;
  const r = document.createRange();
  const [w1, o1] = punkt(pole, od);
  const [w2, o2] = punkt(pole, do_);
  try {
    r.setStart(w1, o1);
    r.setEnd(w2, o2);
  } catch {
    r.selectNodeContents(pole);
    r.collapse(false);
  }
  s.removeAllRanges();
  s.addRange(r);
}

/** Kursor na końcu treści elementu (komórki). */
function kursorNaKoncu(el) {
  const s = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(el);
  // Podział wiersza na końcu komórki jest tylko po to, żeby było gdzie postawić kursor: kursor przed nim.
  const ost = el.lastChild;
  if (ost && ost.nodeName === 'BR') r.setEndBefore(ost);
  r.collapse(false);
  s.removeAllRanges();
  s.addRange(r);
}

/**
 * Tabele w polu: zawsze na najwyższym poziomie (nie w pogrubieniu ani w kolorze – postać kanoniczna
 * i tak je stamtąd wyjmie) i z linią pod tabelą, która stoi na samym końcu – inaczej nie byłoby
 * gdzie postawić kursora, żeby pisać dalej.
 */
export function naprawTabele(pole) {
  for (const t of pole.querySelectorAll('table')) {
    let gorny = null;
    for (let x = t.parentNode; x && x !== pole && W_LINII.has(x.localName); x = x.parentNode) gorny = x;
    if (gorny) {
      wyodrebnij(t, gorny.parentNode);
      gorny.replaceWith(t);
    }
  }
  // Tabela na końcu pola albo na końcu bloku (Enter robi z linii <div>): za nią musi być linia.
  for (const t of pole.querySelectorAll('table')) {
    if (!t.nextSibling && !t.parentNode.closest('td')) t.after(document.createElement('br'));
  }
}

/** Wstawia treść pola, zachowując pozycję kursora (przy odświeżeniu po scaleniu). */
export function ustawHtmlPola(pole, html) {
  const nowy = czysc(html);
  if (czyscPole(pole) === nowy) return;
  const aktywne = document.activeElement === pole;
  const z = aktywne ? zaznaczenie(pole) : null;
  pole.innerHTML = wBlokach(nowy);
  naprawTabele(pole);
  if (z) {
    const dl = dlugoscPola(pole);
    ustawZaznaczenie(pole, Math.min(z[0], dl), Math.min(z[1], dl));
  }
}

/** Zakres w polu między pozycjami w tekście (trafienie z szukania, edytor.js). `null`, gdy pole już ich nie ma. */
export function zakresPola(pole, od, do_) {
  const [w1, o1] = punkt(pole, od);
  const [w2, o2] = punkt(pole, do_);
  const r = document.createRange();
  try {
    r.setStart(w1, o1);
    r.setEnd(w2, o2);
  } catch {
    return null;
  }
  return r;
}

// --- polecenia formatowania ---

let stylCss = false;

function wlaczStylCss() {
  if (stylCss) return;
  stylCss = true;
  // Dzięki temu pogrubienie i kursywa wychodzą jako <b>/<i>, a nie jako style w atrybucie.
  try {
    document.execCommand('styleWithCSS', false, false);
  } catch {
    /* starsze WebView – zostaje domyślne zachowanie */
  }
}

/** Najbliższy przodek, który nie jest znacznikiem formatowania (pole, komórka, blok). */
function kontener(w, pole) {
  let p = w.parentNode;
  while (p && p !== pole && W_LINII.has(p.localName)) p = p.parentNode;
  return p || pole;
}

/**
 * Wydziela węzeł z jego znaczników formatowania aż do `kontener`: każdy przodek zostaje rozcięty
 * tak, że zawiera już tylko ten węzeł. Węzły tekstu się nie zmieniają, tylko przechodzą do kopii
 * przodków, więc zmiana klasy przodka dotyczy potem dokładnie tego węzła.
 */
function wyodrebnij(w, kont) {
  while (w.parentNode && w.parentNode !== kont) {
    const p = w.parentNode;
    if (w.previousSibling) {
      const przed = p.cloneNode(false);
      while (p.firstChild !== w) przed.appendChild(p.firstChild);
      p.before(przed);
    }
    if (w.nextSibling) {
      const za = p.cloneNode(false);
      while (w.nextSibling) za.appendChild(w.nextSibling);
      p.after(za);
    }
    w = p;
  }
}

/** Węzły tekstu w zaznaczeniu, po rozcięciu tych na jego brzegach. */
function tekstyZaznaczenia(pole) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return [];
  const r = s.getRangeAt(0);
  if (r.collapsed || !pole.contains(r.commonAncestorContainer)) return [];
  if (r.endContainer.nodeType === Node.TEXT_NODE && r.endOffset > 0 && r.endOffset < r.endContainer.nodeValue.length) {
    r.endContainer.splitText(r.endOffset);
  }
  if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset > 0 && r.startOffset < r.startContainer.nodeValue.length) {
    const reszta = r.startContainer.splitText(r.startOffset);
    r.setStart(reszta, 0);
  }
  const wynik = [];
  const ch = document.createTreeWalker(pole, NodeFilter.SHOW_TEXT);
  for (let t = ch.nextNode(); t; t = ch.nextNode()) {
    const p = t.parentNode.localName;
    if (!t.nodeValue || SEKCJE.has(p) || p === 'table' || p === 'tr' || !r.intersectsNode(t)) continue;
    const od = t === r.startContainer ? r.startOffset : 0;
    const do_ = t === r.endContainer ? r.endOffset : t.nodeValue.length;
    if (do_ > od) wynik.push(t);
  }
  return wynik;
}

function klasySpana(s) {
  return (s.getAttribute('class') || '').split(SPACJE).filter((x) => GRUPY.some((g) => g.includes(x)));
}

function ustawKlasy(s, lista) {
  const k = GRUPY.map((g) => lista.find((x) => g.includes(x))).filter(Boolean);
  if (k.length) s.setAttribute('class', k.join(' '));
  else s.removeAttribute('class');
}

function maPrzodka(w, nazwa, granica) {
  for (let p = w.parentNode; p && p !== granica; p = p.parentNode) if (p.localName === nazwa) return true;
  return false;
}

/** Po zmianie: bez pustych znaczników, bez `span` bez klas, a sąsiednie takie same znaczniki w jeden. */
function uporzadkuj(el) {
  let w = el.firstChild;
  while (w) {
    let nast = w.nextSibling;
    if (w.nodeType === Node.ELEMENT_NODE) {
      const n = w.localName;
      if (W_LINII.has(n)) {
        if (n === 'span' && !w.getAttribute('class')) {
          const pierwszy = w.firstChild;
          w.replaceWith(...w.childNodes);
          w = pierwszy || nast;
          continue;
        }
        if (!w.textContent && !w.querySelector('br')) {
          w.remove();
          w = nast;
          continue;
        }
        while (nast && nast.nodeType === Node.ELEMENT_NODE && nast.localName === n && (nast.getAttribute('class') || '') === (w.getAttribute('class') || '')) {
          while (nast.firstChild) w.appendChild(nast.firstChild);
          const dalej = nast.nextSibling;
          nast.remove();
          nast = dalej;
        }
      }
      uporzadkuj(w);
    }
    w = nast;
  }
}

/**
 * Zmiana formatowania zaznaczonego fragmentu: `grupa` 0 kolor, 1 wyróżnienie, 2 rozmiar, 3 interlinia (z klasą albo
 * '' – bez), 'kod' (włącza albo wyłącza) albo 'wyczysc' (zdejmuje wszystko). Działa tylko na
 * zaznaczeniu: reszta tekstu zostaje taka, jaka była.
 */
function zmienZaznaczenie(pole, grupa, klasa = '') {
  const z = zaznaczenie(pole);
  if (!z || z[0] === z[1]) return false;
  const przed = pole.innerHTML;
  const teksty = tekstyZaznaczenia(pole);
  if (!teksty.length) return false;
  const kodWszedzie = grupa === 'kod' && teksty.every((t) => maPrzodka(t, 'code', kontener(t, pole)));
  for (const t of teksty) {
    const kont = kontener(t, pole);
    wyodrebnij(t, kont);
    if (grupa === 'wyczysc') {
      let gorny = null;
      for (let p = t.parentNode; p && p !== kont; p = p.parentNode) gorny = p;
      if (gorny) gorny.replaceWith(t);
    } else if (grupa === 'kod') {
      if (kodWszedzie) {
        for (let p = t.parentNode; p && p !== kont; ) {
          const wyzej = p.parentNode;
          if (p.localName === 'code') p.replaceWith(...p.childNodes);
          p = wyzej;
        }
      } else if (!maPrzodka(t, 'code', kont)) {
        const c = document.createElement('code');
        t.before(c);
        c.appendChild(t);
      }
    } else {
      const spany = [];
      for (let p = t.parentNode; p && p !== kont; p = p.parentNode) if (p.localName === 'span') spany.push(p);
      for (const s of spany) ustawKlasy(s, klasySpana(s).filter((x) => !GRUPY[grupa].includes(x)));
      if (klasa) {
        let s = spany[0];
        if (!s) {
          s = document.createElement('span');
          t.before(s);
          s.appendChild(t);
        }
        ustawKlasy(s, [...klasySpana(s), klasa]);
      }
    }
  }
  pole.normalize();
  uporzadkuj(pole);
  pole.normalize();
  ustawZaznaczenie(pole, z[0], z[1]);
  return pole.innerHTML !== przed;
}

/**
 * Interlinia całych akapitów, jak w Wordzie: wierszy, których dotyka zaznaczenie, a bez zaznaczenia wiersza z kursorem.
 * Wiersz to tekst między nowymi liniami, razem z jego zawinięciami. Zaznaczenie wraca potem takie, jakie było.
 */
function zmienInterlinie(pole, klasa) {
  const z = zaznaczenie(pole);
  if (!z) return false;
  const tekst = tekstZPola(pole);
  const poczatek = z[0] > 0 ? tekst.lastIndexOf('\n', z[0] - 1) + 1 : 0;
  // Zaznaczenie, które kończy się tuż za nową linią (na przykład potrójny klik), nie bierze wiersza pod nią.
  const doZnaku = z[1] > z[0] && tekst[z[1] - 1] === '\n' ? z[1] - 1 : z[1];
  const nl = tekst.indexOf('\n', doZnaku);
  const koniec = nl < 0 ? tekst.length : nl;
  if (koniec <= poczatek) return false;
  ustawZaznaczenie(pole, poczatek, koniec);
  const zmiana = zmienZaznaczenie(pole, 3, klasa);
  ustawZaznaczenie(pole, z[0], z[1]);
  return zmiana;
}

/**
 * Jedno polecenie formatowania. Zwraca `true`, gdy coś się zmieniło.
 * `pogrubienie|kursywa|podkreslenie|przekreslenie|kod|kolor|tlo|rozmiar|interlinia|wyczysc`
 */
export function formatuj(pole, co, wartosc = '') {
  wlaczStylCss();
  pole.focus();
  const wykonaj = (komenda, v = null) => {
    try {
      return document.execCommand(komenda, false, v);
    } catch {
      return false;
    }
  };
  switch (co) {
    case 'pogrubienie':
      return wykonaj('bold');
    case 'kursywa':
      return wykonaj('italic');
    case 'podkreslenie':
      return wykonaj('underline');
    case 'przekreslenie':
      return wykonaj('strikeThrough');
    case 'kod':
      return zmienZaznaczenie(pole, 'kod');
    case 'kolor':
      return zmienZaznaczenie(pole, 0, wartosc);
    case 'tlo':
      return zmienZaznaczenie(pole, 1, wartosc);
    case 'rozmiar':
      return zmienZaznaczenie(pole, 2, wartosc);
    case 'interlinia':
      return zmienInterlinie(pole, wartosc);
    case 'wyczysc':
      return zmienZaznaczenie(pole, 'wyczysc');
    default:
      return false;
  }
}

/** Czy zaznaczenie jest już pogrubione/kursywą itd. – do podświetlenia przycisków. */
export function wlaczone(co) {
  const komendy = { pogrubienie: 'bold', kursywa: 'italic', podkreslenie: 'underline', przekreslenie: 'strikeThrough' };
  try {
    return Boolean(komendy[co] && document.queryCommandState(komendy[co]));
  } catch {
    return false;
  }
}

/** Klasa z danej grupy (0 kolor, 1 wyróżnienie, 2 rozmiar, 3 interlinia) w miejscu kursora, '' gdy żadnej. */
export function klasaZaznaczenia(pole, grupa) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return '';
  for (let w = s.getRangeAt(0).startContainer; w && w !== pole; w = w.parentNode) {
    if (w.nodeType === Node.ELEMENT_NODE && w.localName === 'span') {
      const k = klasySpana(w).find((x) => GRUPY[grupa].includes(x));
      if (k) return k;
    }
  }
  return '';
}

/**
 * Skróty klawiszowe formatowania. Zwraca nazwę polecenia, gdy skrót jest nasz.
 * Ctrl+B pogrubienie, Ctrl+I kursywa, Ctrl+U podkreślenie, Ctrl+Shift+S przekreślenie,
 * Ctrl+Shift+K kod, Ctrl+Shift+, / . mniejsze i większe pismo, Ctrl+\ czyści formatowanie.
 */
export function skrotFormatu(pole, ev) {
  if (!ev.ctrlKey && !ev.metaKey) return null;
  const k = ev.key.toLowerCase();
  if (!ev.shiftKey && k === 'b') return 'pogrubienie';
  if (!ev.shiftKey && k === 'i') return 'kursywa';
  if (!ev.shiftKey && k === 'u') return 'podkreslenie';
  if (ev.shiftKey && k === 's') return 'przekreslenie';
  if (ev.shiftKey && k === 'k') return 'kod';
  if (k === '\\') return 'wyczysc';
  if (ev.shiftKey && (k === '.' || k === '>')) return 'wieksze';
  if (ev.shiftKey && (k === ',' || k === '<')) return 'mniejsze';
  return null;
}

/** Rozmiar o jeden stopień w górę albo w dół względem obecnego. */
export function zmienRozmiar(pole, kierunek) {
  const lista = ROZMIARY.map(([, v]) => v);
  let i = lista.indexOf(klasaZaznaczenia(pole, 2));
  if (i < 0) i = lista.indexOf('');
  const nowy = lista[Math.min(lista.length - 1, Math.max(0, i + kierunek))];
  return formatuj(pole, 'rozmiar', nowy);
}

// --- tabele ---

/** Komórka tabeli, w której stoi kursor (albo początek zaznaczenia). */
export function komorkaKursora(pole) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  for (let w = s.getRangeAt(0).startContainer; w && w !== pole; w = w.parentNode) {
    if (w.nodeType === Node.ELEMENT_NODE && KOMORKI.has(w.localName)) return pole.contains(w) ? w : null;
  }
  return null;
}

function nowaKomorka() {
  const c = document.createElement('td');
  c.appendChild(document.createElement('br'));
  return c;
}

/** Najwięcej linii zaznaczenia, z których powstaje tabela. Przy dłuższym zaznaczeniu tabela staje za nim. */
const TABELA_Z_ZAZNACZENIA = 50;

/**
 * Tabela z zaznaczonego tekstu (Jacek, 21.10.2026: „Nie możesz niszczyć rzeczy”): jak w Notatkach Apple każda linia
 * to wiersz, a tabulator dzieli kolumny. `null`, gdy z zaznaczenia tabeli nie będzie: wtedy kursor staje na jego
 * końcu, a zaznaczony tekst zostaje, jak był.
 */
function tabelaZZaznaczenia(pole) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.getRangeAt(0).collapsed) return null;
  const r = s.getRangeAt(0);
  const z = zaznaczenie(pole);
  const tekst = z ? tekstZPola(pole).slice(z[0], z[1]).replace(/\n+$/, '') : '';
  const linie = tekst ? tekst.split('\n') : [];
  const zTabela = [...pole.querySelectorAll('table')].some((t) => r.intersectsNode(t));
  if (!linie.length || zTabela || linie.length > TABELA_Z_ZAZNACZENIA) {
    r.collapse(false);
    s.removeAllRanges();
    s.addRange(r);
    return null;
  }
  const komorki = linie.map((l) => l.split('\t'));
  const szer = Math.max(...komorki.map((k) => k.length));
  const wiersz = (k) => `<tr>${Array.from({ length: szer }, (_, i) => `<td>${k[i] ? zakoduj(k[i]) : '<br>'}</td>`).join('')}</tr>`;
  return `<table><tbody>${komorki.map(wiersz).join('')}</tbody></table>`;
}

/** Nowa tabela 2 × 2 w miejscu kursora (albo z zaznaczonego tekstu), kursor w pierwszej komórce. */
export function wstawTabele(pole, wiersze = 2, kolumny = 2) {
  wlaczStylCss();
  pole.focus();
  if (komorkaKursora(pole)) return false;
  const stare = new Set(pole.querySelectorAll('table'));
  const wiersz = `<tr>${'<td><br></td>'.repeat(kolumny)}</tr>`;
  const html = tabelaZZaznaczenia(pole) || `<table><tbody>${wiersz.repeat(wiersze)}</tbody></table>`;
  try {
    if (!document.execCommand('insertHTML', false, html)) return false;
  } catch {
    return false;
  }
  const nowa = [...pole.querySelectorAll('table')].find((t) => !stare.has(t));
  if (!nowa) return false;
  naprawTabele(pole);
  kursorNaKoncu(nowa.rows[0].cells[0]);
  return true;
}

/**
 * Zmiana tabeli, w której stoi kursor: `wiersz` (nowy pod bieżącym), `kolumna` (nowa z prawej),
 * `usun-wiersz`, `usun-kolumne`, `linie` (szerokie, przezroczyste albo cienkie) i `usun`.
 * `wiersz-na-koncu` dokłada wiersz na dole i stawia kursor w jego pierwszej komórce (Tab w ostatniej).
 */
export function zmienTabele(pole, co) {
  const td = komorkaKursora(pole);
  if (!td) return false;
  const tabela = td.closest('table');
  const tr = td.parentNode;
  const wiersze = [...tabela.rows];
  const kol = [...tr.cells].indexOf(td);
  const szerokosc = Math.max(...wiersze.map((r) => r.cells.length));
  let cel = null;
  const usunTabele = () => {
    const r = document.createRange();
    r.setStartBefore(tabela);
    r.collapse(true);
    tabela.remove();
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  if (co === 'wiersz' || co === 'wiersz-na-koncu') {
    const nowy = document.createElement('tr');
    for (let i = 0; i < szerokosc; i++) nowy.appendChild(nowaKomorka());
    (co === 'wiersz' ? tr : wiersze[wiersze.length - 1]).after(nowy);
    cel = nowy.cells[co === 'wiersz' ? Math.min(kol, szerokosc - 1) : 0];
  } else if (co === 'kolumna') {
    for (const r of wiersze) {
      const nowa = nowaKomorka();
      const obok = r.cells[Math.min(kol, r.cells.length - 1)];
      if (obok) obok.after(nowa);
      else r.appendChild(nowa);
      if (r === tr) cel = nowa;
    }
  } else if (co === 'usun-wiersz') {
    if (wiersze.length <= 1) usunTabele();
    else {
      const i = wiersze.indexOf(tr);
      const sasiad = wiersze[i + 1] || wiersze[i - 1];
      tr.remove();
      cel = sasiad.cells[Math.min(kol, sasiad.cells.length - 1)];
    }
  } else if (co === 'usun-kolumne') {
    if (szerokosc <= 1) usunTabele();
    else {
      for (const r of wiersze) {
        if (r.cells[kol]) r.cells[kol].remove();
        if (!r.cells.length) r.remove();
      }
      cel = tr.isConnected ? tr.cells[Math.min(kol, tr.cells.length - 1)] : tabela.rows[0] && tabela.rows[0].cells[0];
    }
  } else if (co === 'linie') {
    tabela.classList.toggle(TABELA_SZEROKA);
    cel = td;
  } else if (co === 'usun') {
    usunTabele();
  } else {
    return false;
  }
  naprawTabele(pole);
  if (cel) kursorNaKoncu(cel);
  return true;
}

/** Czy tabela z kursorem ma szerokie, przezroczyste linie. */
export function tabelaSzeroka(pole) {
  const td = komorkaKursora(pole);
  return Boolean(td && td.closest('table').classList.contains(TABELA_SZEROKA));
}

/**
 * Klawisze w komórce tabeli: Tab i Shift+Tab – następna i poprzednia komórka (Tab w ostatniej dokłada
 * wiersz), Enter – komórka niżej (w ostatnim wierszu nowy wiersz), Shift+Enter – nowa linia w komórce.
 * Backspace na początku i Delete na końcu komórki nic nie robią: komórki się nie sklejają.
 * Zwraca 'zmiana' (treść się zmieniła), 'ruch' (tylko kursor) albo `null` (klawisz nie nasz).
 */
export function klawiszWTabeli(pole, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return null;
  const td = komorkaKursora(pole);
  if (!td) return null;
  const tabela = td.closest('table');
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const komorki = [...tabela.rows].flatMap((r) => [...r.cells]);
    const cel = komorki[komorki.indexOf(td) + (ev.shiftKey ? -1 : 1)];
    if (cel) {
      kursorNaKoncu(cel);
      return 'ruch';
    }
    if (ev.shiftKey) return 'ruch';
    return zmienTabele(pole, 'wiersz-na-koncu') ? 'zmiana' : 'ruch';
  }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (ev.shiftKey) {
      try {
        document.execCommand('insertLineBreak');
      } catch {
        return null;
      }
      return 'zmiana';
    }
    return enterWTabeli(pole) ? 'zmiana' : 'ruch';
  }
  if ((ev.key === 'Backspace' || ev.key === 'Delete') && naBrzeguKomorki(td, ev.key === 'Backspace')) {
    ev.preventDefault();
    return 'ruch';
  }
  return null;
}

/** Enter w komórce: komórka niżej, a z ostatniego wiersza nowy wiersz. Zwraca `true`, gdy dołożył wiersz. */
export function enterWTabeli(pole) {
  const td = komorkaKursora(pole);
  if (!td) return false;
  const tr = td.parentNode;
  const wiersze = [...td.closest('table').rows];
  const nast = wiersze[wiersze.indexOf(tr) + 1];
  if (nast && nast.cells.length) {
    kursorNaKoncu(nast.cells[Math.min([...tr.cells].indexOf(td), nast.cells.length - 1)]);
    return false;
  }
  return zmienTabele(pole, 'wiersz');
}

function naBrzeguKomorki(td, poczatek) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.getRangeAt(0).collapsed) return false;
  const r = s.getRangeAt(0);
  const zakres = document.createRange();
  zakres.selectNodeContents(td);
  if (poczatek) zakres.setEnd(r.startContainer, r.startOffset);
  else zakres.setStart(r.endContainer, r.endOffset);
  const tresc = zakres.cloneContents();
  // Przed kursorem nic albo tylko podział wiersza, który pole dokłada na końcu komórki.
  const brs = tresc.querySelectorAll('br').length;
  return !tresc.textContent && (brs === 0 || (!poczatek && brs === 1 && td.lastChild && td.lastChild.nodeName === 'BR'));
}