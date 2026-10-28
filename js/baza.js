// IndexedDB wersji web – wspólna dla strony (web.js) i service workera (sw.js).
//
// Magazyny:
//   zapisy  – dziennik zmian rdzenia (wersje, pliki, ustawienia, nagrobki), klucz rosnący,
//   robocze – kopie robocze wpisywanego tekstu (jedna na notatkę, nadpisywana),
//   pliki   – zawartość obrazów i nagrań { hash, typ, blob },
//   meta    – token urządzenia, nazwa urządzenia i drobne ustawienia strony.

const NAZWA = 'notatki';
const WERSJA = 1;

let obietnica = null;

export function otworzBaze() {
  if (obietnica) return obietnica;
  obietnica = new Promise((ok, zle) => {
    const r = indexedDB.open(NAZWA, WERSJA);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('zapisy')) db.createObjectStore('zapisy', { autoIncrement: true });
      if (!db.objectStoreNames.contains('robocze')) db.createObjectStore('robocze', { keyPath: 'notatka' });
      if (!db.objectStoreNames.contains('pliki')) db.createObjectStore('pliki', { keyPath: 'hash' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => {
      const db = r.result;
      // Nowa wersja strony w innej karcie – zamykamy połączenie, żeby jej nie blokować.
      db.onversionchange = () => db.close();
      ok(db);
    };
    r.onerror = () => zle(r.error);
    r.onblocked = () => zle(new Error('Baza notatek jest zablokowana przez inną kartę'));
  });
  return obietnica;
}

function zadanie(r) {
  return new Promise((ok, zle) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => zle(r.error);
  });
}

function koniec(t) {
  return new Promise((ok, zle) => {
    t.oncomplete = () => ok();
    t.onerror = () => zle(t.error);
    t.onabort = () => zle(t.error || new Error('Zapis przerwany'));
  });
}

export async function pobierz(magazyn, klucz) {
  const db = await otworzBaze();
  return zadanie(db.transaction(magazyn).objectStore(magazyn).get(klucz));
}

export async function wszystkie(magazyn) {
  const db = await otworzBaze();
  return zadanie(db.transaction(magazyn).objectStore(magazyn).getAll());
}

export async function wstaw(magazyn, wartosc, klucz) {
  const db = await otworzBaze();
  const t = db.transaction(magazyn, 'readwrite');
  if (klucz === undefined) t.objectStore(magazyn).put(wartosc);
  else t.objectStore(magazyn).put(wartosc, klucz);
  return koniec(t);
}

export async function usun(magazyn, klucz) {
  const db = await otworzBaze();
  const t = db.transaction(magazyn, 'readwrite');
  t.objectStore(magazyn).delete(klucz);
  return koniec(t);
}

/** Same klucze (np. skróty plików, które są w przeglądarce) – bez wczytywania zawartości. */
export async function klucze(magazyn) {
  const db = await otworzBaze();
  return zadanie(db.transaction(magazyn).objectStore(magazyn).getAllKeys());
}

export async function ma(magazyn, klucz) {
  const db = await otworzBaze();
  const n = await zadanie(db.transaction(magazyn).objectStore(magazyn).count(klucz));
  return n > 0;
}

/** Zapisy z jednego polecenia rdzenia – w jednej transakcji (wszystko albo nic). */
export async function dopiszZapisy(zapisy) {
  if (!zapisy || !zapisy.length) return;
  const db = await otworzBaze();
  const t = db.transaction(['zapisy', 'robocze'], 'readwrite');
  const dz = t.objectStore('zapisy');
  const rob = t.objectStore('robocze');
  for (const z of zapisy) {
    if (z.rodzaj === 'robocza') rob.put(z.robocza);
    else if (z.rodzaj === 'robocza_usun') rob.delete(z.notatka);
    else dz.add(z);
  }
  return koniec(t);
}

/** Zastępuje cały dziennik krótszym zrzutem stanu (atomowo). */
export async function zastapZapisy(zapisy) {
  const db = await otworzBaze();
  const t = db.transaction(['zapisy', 'robocze'], 'readwrite');
  const dz = t.objectStore('zapisy');
  const rob = t.objectStore('robocze');
  dz.clear();
  rob.clear();
  for (const z of zapisy) {
    if (z.rodzaj === 'robocza') rob.put(z.robocza);
    else dz.add(z);
  }
  return koniec(t);
}

/** Dziennik w kolejności zapisu + kopie robocze na końcu (tak odtwarza je rdzeń). */
export async function caloscDoOdtworzenia() {
  const zapisy = await wszystkie('zapisy');
  const robocze = await wszystkie('robocze');
  for (const r of robocze) zapisy.push({ rodzaj: 'robocza', robocza: r });
  return zapisy;
}
