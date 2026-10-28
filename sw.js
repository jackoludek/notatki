// Service worker wersji web: kolejne wizyty otwierają się z kopii w przeglądarce, bez czekania
// na sieć (pliki interfejsu i rdzeń WebAssembly z pamięci podręcznej, nowa wersja w tle).
// Obrazy i nagrania (pliki/<sha256>) idą z IndexedDB. Przy własnym serwerze brakujące pobiera
// z serwera z tokenem urządzenia.

// Nowa nazwa pamięci podręcznej = od razu nowa powłoka (tu: synchronizacja bez GitHuba, 19.10.2026).
// Baza IndexedDB „notatki” to dane użytkownika – jej nazwa się nie zmienia.
const WERSJA = 'notatki-20261028-2336';
const POWLOKA = [
  './', 'index.html', 'styl.css', 'manifest.webmanifest', 'ikona.png', 'ikona-512.png', 'notatki.wasm',
  'js/app.js', 'js/most.js', 'js/pomoc.js', 'js/stan.js', 'js/ui.js', 'js/wybory.js', 'js/lista.js', 'js/edytor.js',
  'js/historia.js', 'js/ai.js', 'js/ustawienia.js', 'js/web.js', 'js/baza.js', 'js/tekstowe.js', 'js/telefon.js',
  'js/kolejnosc.js', 'js/powiekszenie.js', 'js/uchwyty.js', 'js/sciaga.js', 'js/dymki.js', 'js/arkusze.js', 'js/guziki.js',
  'czcionki/inter-latin.woff2', 'czcionki/inter-latin-ext.woff2', 'czcionki/inter-kursywa-latin.woff2', 'czcionki/inter-kursywa-latin-ext.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(WERSJA).then((c) => c.addAll(POWLOKA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== WERSJA) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

function baza() {
  return new Promise((ok, zle) => {
    const r = indexedDB.open('notatki', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('zapisy')) db.createObjectStore('zapisy', { autoIncrement: true });
      if (!db.objectStoreNames.contains('robocze')) db.createObjectStore('robocze', { keyPath: 'notatka' });
      if (!db.objectStoreNames.contains('pliki')) db.createObjectStore('pliki', { keyPath: 'hash' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => zle(r.error);
  });
}

function pobierz(db, magazyn, klucz) {
  return new Promise((ok, zle) => {
    const r = db.transaction(magazyn).objectStore(magazyn).get(klucz);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => zle(r.error);
  });
}

function wstaw(db, magazyn, wartosc) {
  return new Promise((ok, zle) => {
    const t = db.transaction(magazyn, 'readwrite');
    t.objectStore(magazyn).put(wartosc);
    t.oncomplete = () => ok();
    t.onerror = () => zle(t.error);
  });
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function plik(hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response('', { status: 404 });
  const db = await baza();
  const z = await pobierz(db, 'pliki', hash);
  const naglowki = (typ) => ({ 'Content-Type': typ || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (z) return new Response(z.blob, { headers: naglowki(z.typ) });
  const token = await pobierz(db, 'meta', 'token');
  if (!token) return new Response('', { status: 404 });
  let r;
  try {
    r = await fetch(`api/pliki/${hash}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    return new Response('', { status: 504 });
  }
  if (!r.ok) return new Response('', { status: r.status });
  const typ = r.headers.get('Content-Type') || 'application/octet-stream';
  const bufor = await r.arrayBuffer();
  // Adres pliku to skrót zawartości – uszkodzony plik nie trafia do bazy.
  if (hex(await crypto.subtle.digest('SHA-256', bufor)) !== hash) return new Response('', { status: 502 });
  const blob = new Blob([bufor], { type: typ });
  await wstaw(db, 'pliki', { hash, typ, blob });
  return new Response(blob, { headers: naglowki(typ) });
}

// Ścieżki względem miejsca strony (serwer może ją podawać z podfolderu).
const ZAKRES = new URL(self.registration.scope).pathname;

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== 'GET') return;
  const p = u.pathname.startsWith(ZAKRES) ? u.pathname.slice(ZAKRES.length) : null;
  if (p === null || p.startsWith('api/') || p.startsWith('oauth') || p.startsWith('.well-known/') || p === 'mcp') return;
  if (p.startsWith('pliki/')) {
    e.respondWith(plik(p.slice('pliki/'.length)));
    return;
  }
  // Najpierw kopia w przeglądarce, w tle odświeżenie z sieci (nowa wersja od następnej wizyty).
  e.respondWith(
    (async () => {
      const c = await caches.open(WERSJA);
      const zapis = await c.match(e.request, { ignoreSearch: true });
      const siec = fetch(e.request)
        .then((r) => {
          if (r.ok && r.type === 'basic') c.put(e.request, r.clone());
          return r;
        })
        .catch(() => null);
      if (zapis) {
        e.waitUntil(siec);
        return zapis;
      }
      const r = await siec;
      if (r) return r;
      const glowna = e.request.mode === 'navigate' ? await c.match('index.html') : null;
      return glowna || new Response('Brak połączenia', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })(),
  );
});
