// szklo.js: żywe Liquid Glass w WebGL2 dla panelu Notatek przy zegarze (zasobnik.html, js/zasobnik.js). Kopia silnika
// z programu Dyktowanie (projekt 17, zrodlo\panel\szklo.js, 16.10.2026), który Jacek wskazał jako wzór (25.10.2026: „taki fajny
// glass. Który w dodatku działa po ciemku”). Zmiany względem wzoru: tło z surowych pikseli zdjęcia ekranu (tloPiksele),
// przezroczysta baza poza kartą (uBaza = 0: okno Notatek jest przezroczyste, więc pod marginesem widać prawdziwy pulpit)
// i wyraźniejsza ciemniejsza obwódka w jasnym motywie (ramka karty, reguła zx-ramki-blokow).
//
//
// Co z czego (badanie bibliotek z GitHuba, 15.10.2026, opis w „Liquid Glass - wiedza dla AI.md”):
//  - kube.io: załamanie wg prawa Snella, profil brzegu squircle, gałka z profilem „lip”.
//  - iyinchao/liquid-glass-studio: superelipsa, Fresnel przy krawędzi, osobny współczynnik załamania na kanał.
//  - naughtyduk/liquidGL: soczewka na zdjęciu tła (u nas zdjęcie ekranu od programu), mocniejsze odchylenie niebieskiego.
//  - rdev/liquid-glass-react: światło i odblask idą za myszą, elastyczność „liquid feel”.
//  - Kyant0/AndroidLiquidGlass: vibrancy (nasycenie), soczewka pod palcem, sprężyny.
//  - Apple (HIG, iOS 26 i 27): wariant regular z jasnością pod tekst, poświata w miejscu dotyku, ciemniejsza obwódka.
// Ruch galarety (ścinanie i rozciąganie) liczy panel.js. Tu przychodzi jako macierz uDef i uDefX: kształty są
// opisane bez odkształcenia, a shader dla każdego piksela cofa odkształcenie.
// Tło: jedna tekstura sRGB z mipmapami (zdjęcie monitora albo scena strony). Rozmycie to 12 próbek po spirali
// z poziomu mipmapy dobranego do promienia, więc odświeżenie kawałka tła kosztuje jedno przesłanie i mipmapy.
'use strict';
window.Szklo = (function () {
  const MAX = 16;
  const VS = '#version 300 es\nin vec2 a;\nvoid main() { gl_Position = vec4(a, 0., 1.); }';
  const FS = `#version 300 es
precision highp float;
uniform sampler2D uTlo;
uniform vec2 uTex;
uniform vec2 uOkno;
uniform vec2 uRes;
uniform float uDpr;
uniform float uCiemny;
uniform float uRozmycie;
uniform float uOdcien;
uniform float uLmin;
uniform float uLmax;
uniform float uLminBrzeg;
uniform float uLmaxBrzeg;
uniform float uNasycenie;
uniform float uCien;
uniform float uBlask;
uniform float uDysp;
uniform float uFresnel;
uniform float uBaza;
uniform vec3 uGlifOn;
uniform vec3 uGlifOff;
uniform vec2 uSwiatlo;
uniform vec4 uDef;
uniform vec2 uDefX;
uniform vec4 uMysz;
uniform vec2 uKropla;
uniform int uN;
uniform vec4 uK[${MAX}];
uniform vec4 uP[${MAX}];
uniform vec4 uC[${MAX}];
out vec4 o;

vec3 doLin(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 zLin(vec3 c) { c = clamp(c, 0., 1.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float jas(vec3 l) { return dot(l, vec3(.2126, .7152, .0722)); }
vec4 nad(vec4 gora, vec4 dol) { return gora + dol * (1. - gora.a); }

// Odkształcenie galarety: CSS matrix(sx, 0, shx, sy, tx, 0) od lewego górnego rogu panelu. Tu odwrotność.
vec2 doQ(vec2 p) {
  vec2 r = p - uDef.xy;
  float y = r.y / uDef.w;
  float x = (r.x - uDefX.y - uDef.z * y) / uDefX.x;
  return uDef.xy + vec2(x, y);
}

// Odległość od brzegu prostokąta z rogami: n = 2 koło, n = 4 róg ciągły jak u Apple (superelipsa).
float sd(vec2 p, vec4 k, float r, float n) {
  vec2 c = k.xy + k.zw * .5;
  vec2 q = abs(p - c) - k.zw * .5 + r;
  vec2 m = max(q, 0.);
  float rog = n > 2.5 ? pow(pow(m.x, n) + pow(m.y, n), 1. / n) : length(m);
  return rog + min(max(q.x, q.y), 0.) - r;
}

vec2 nor(vec2 p, vec4 k, float r, float n) {
  float h = .5;
  vec2 g = vec2(sd(p + vec2(h, 0.), k, r, n) - sd(p - vec2(h, 0.), k, r, n),
                sd(p + vec2(0., h), k, r, n) - sd(p - vec2(0., h), k, r, n));
  float l = length(g);
  return l > 1e-5 ? g / l : vec2(0.);
}

float wyp(float t) { t = clamp(t, 0., 1.); return pow(max(1. - pow(1. - t, 4.), 0.), .25); }
float profil(float t, float rodz) {
  float a = wyp(t);
  if (rodz < .5) return a;
  float s = t * t * t * (t * (t * 6. - 15.) + 10.);
  return mix(a, 1. - a, s);
}
float nachylenie(float t, float B, float T, float rodz) {
  float h = .004, t0 = max(t - h, 0.), t1 = min(t + h, 1.);
  return (profil(t1, rodz) - profil(t0, rodz)) / max(t1 - t0, 1e-4) * T / B;
}
// Przesunięcie promienia w pikselach: wysokość szkła razy tangens kąta po załamaniu (Snell, współczynnik n).
float przes(float t, float B, float T, float rodz, float n) {
  float s = nachylenie(t, B, T, rodz);
  vec2 N = normalize(vec2(-s, 1.));
  float eta = 1. / n;
  float k = 1. - eta * eta * (1. - N.y * N.y);
  vec2 R = vec2(0., -eta) + (eta * N.y - sqrt(max(k, 0.))) * N;
  return profil(t, rodz) * T * R.x / max(-R.y, .05);
}

// Tło z tekstury sRGB (wartości liniowe). Rozmycie: 12 próbek po spirali, poziom mipmapy dobrany do promienia.
vec3 tex(vec2 px, float lod) {
  vec2 uv = clamp((uOkno + px) / uTex, vec2(.5) / uTex, vec2(1.) - vec2(.5) / uTex);
  return textureLod(uTlo, uv, lod).rgb;
}
vec3 szron(vec2 px, float r) {
  if (r < .75) return tex(px, 0.);
  float lod = clamp(log2(r / 2.5), 0., 8.);
  vec3 s = vec3(0.);
  float w = 0.;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.39996323;
    float rr = sqrt((fi + .5) / 12.) * r;
    float wi = exp(-1.5 * rr * rr / (r * r));
    s += tex(px + vec2(cos(a), sin(a)) * rr, lod) * wi;
    w += wi;
  }
  return s / w;
}

// Szkło regular: nasycenie, odcień, potem jasność wciśnięta w pas, w którym tekst ma kontrast.
// Na samym brzegu (bez tekstu) pas jest szerszy, żeby załamanie było widać także w ciemnym motywie.
vec3 matowe(vec3 l, float brzeg) {
  float L = jas(l);
  l = max(mix(vec3(L), l, uNasycenie), 0.);
  l = mix(l, vec3(1. - uCiemny), uOdcien);
  L = jas(l);
  float lmin = mix(uLmin, uLminBrzeg, brzeg), lmax = mix(uLmax, uLmaxBrzeg, brzeg);
  if (uCiemny < .5) { if (L < lmin) l = mix(l, vec3(1.), (lmin - L) / max(1. - L, 1e-4)); }
  else if (L > lmax) l *= lmax / max(L, 1e-4);
  return l;
}

vec4 panel(vec2 p, vec2 q, int i) {
  vec4 k = uK[i], P = uP[i], C = uC[i];
  float r = P.x, n = P.w, B = C.x, T = C.y;
  float d = sd(q, k, r, n);
  float dc = sd(q - vec2(0., 8. * uDpr), k, r, n);
  float cien = uCien * (.62 * exp(-pow(max(dc, 0.) / (17. * uDpr), 2.)) + .38 * exp(-pow(max(d, 0.) / (2.5 * uDpr), 2.)));
  vec4 wyn = vec4(0., 0., 0., cien * C.z);
  float a = clamp(.5 - d, 0., 1.);
  if (a <= 0.) return wyn;
  float e = max(-d, 0.);
  float t = clamp(e / B, 0., 1.);
  vec2 nIn = -nor(q, k, r, n);
  // Kropla pod wciśniętym kursorem: wypukła soczewka, która powiększa to, co leży pod palcem.
  vec2 dq = q - uKropla;
  float s2 = pow(46. * uDpr, 2.);
  vec2 kropla = -uMysz.w * .34 * dq * exp(-dot(dq, dq) / (2. * s2));
  float zasieg = uRozmycie * mix(.3, 1., smoothstep(0., .8, t));
  float brzegJ = 1. - smoothstep(0., 8. * uDpr, e);
  vec3 c;
  if (t < 1.) {
    vec2 b = p + kropla;
    float Dg = przes(t, B, T, 0., 1.5);
    float Dr = przes(t, B, T, 0., 1.5 - uDysp);
    float Db = przes(t, B, T, 0., 1.5 + uDysp * 1.4);
    c = vec3(szron(b + nIn * Dr, zasieg).r, szron(b + nIn * Dg, zasieg).g, szron(b + nIn * Db, zasieg).b);
  } else c = szron(p + kropla, zasieg);
  c = matowe(c, brzegJ);
  // Fresnel: przy stromym brzegu szkło odbija to, co leży tuż za krawędzią (jak u Apple).
  float sl = nachylenie(t, B, T, 0.);
  float F = .04 + .96 * pow(1. - inversesqrt(1. + sl * sl), 5.);
  vec3 odb = matowe(szron(p - nIn * (2. * e + 5. * uDpr), uRozmycie * .45), 1.);
  c = mix(c, odb * 1.15, clamp(F * uFresnel, 0., .85));
  // Odblask na krawędzi: kierunek światła idzie za myszą, dwa przeciwległe brzegi świecą.
  float brzeg = 1. - smoothstep(0., .32, t);
  float kier = pow(max(dot(-nIn, uSwiatlo), 0.), 1.5);
  float rim = 1. - smoothstep(0., 2.5 * uDpr, e);
  c = mix(c, vec3(1.), clamp((brzeg * (.12 + .9 * kier) + rim * .45) * uBlask, 0., 1.));
  // Poświata w miejscu dotyku (iOS 26): słaba pod kursorem, mocniejsza przy wciśnięciu.
  vec2 mq = q - uMysz.xy;
  float glow = uMysz.z * exp(-dot(mq, mq) / (2. * pow(74. * uDpr, 2.)));
  c = mix(c, vec3(1.), glow * (uCiemny > .5 ? .085 : .2));
  float obw = 1. - smoothstep(0., 1.25 * uDpr, e);
  c *= 1. - obw * (uCiemny > .5 ? .5 : .36);
  return nad(vec4(zLin(c), 1.) * a, wyn);
}

vec4 tor(vec2 q, int i) {
  vec4 k = uK[i], P = uP[i], C = uC[i];
  float d = sd(q, k, P.x, 2.);
  float a = clamp(.5 - d, 0., 1.) * C.a;
  if (a <= 0.) return vec4(0.);
  vec3 c = C.rgb;
  float s = uDpr, on = P.z;
  float cy = k.y + k.w * .5;
  vec2 pI = vec2(k.x + k.z * .27, cy);
  float dI = sd(q, vec4(pI - vec2(.8, 5.) * s, vec2(1.6, 10.) * s), .8 * s, 2.);
  float dO = abs(length(q - vec2(k.x + k.z * .73, cy)) - 4.2 * s) - .8 * s;
  c = mix(c, uGlifOn, clamp(.5 - dI, 0., 1.) * on);
  c = mix(c, uGlifOff, clamp(.5 - dO, 0., 1.) * (1. - on));
  return vec4(c, 1.) * a;
}

vec3 scenaPod(vec2 pp) {
  vec4 c = vec4(zLin(matowe(szron(pp, uRozmycie), 0.)), 1.);
  vec2 qq = doQ(pp);
  for (int j = 0; j < ${MAX}; j++) {
    if (j >= uN) break;
    if (abs(uP[j].y - 2.) < .5) c = nad(tor(qq, j), c);
  }
  return c.rgb;
}

vec4 galka(vec2 p, vec2 q, int i) {
  vec4 k = uK[i], P = uP[i], C = uC[i];
  float r = min(k.z, k.w) * .5;
  float d = sd(q, k, r, 2.);
  float g = P.z;
  float dc = sd(q - vec2(0., 1.6 * uDpr), k, r, 2.);
  float cien = (.26 * exp(-pow(max(dc, 0.) / (3.2 * uDpr), 2.)) + mix(.1, .55, uCiemny) * exp(-pow(max(d, 0.) / (.9 * uDpr), 2.))) * (1. - .55 * g) * C.a;
  vec4 wyn = vec4(0., 0., 0., cien);
  float a = clamp(.5 - d, 0., 1.) * C.a;
  if (a <= 0.) return wyn;
  vec3 c = vec3(1.);
  if (g > .001) {
    float B = r, T = r * 1.15;
    float e = max(-d, 0.);
    float t = clamp(e / B, 0., 1.);
    vec2 nIn = -nor(q, k, r, 2.);
    vec3 sc = scenaPod(p + nIn * przes(t, B, T, 1., 1.5));
    float brzeg = 1. - smoothstep(0., .5, t);
    float kier = pow(abs(dot(-nIn, uSwiatlo)), 2.);
    sc = mix(sc, vec3(1.), clamp(.05 + brzeg * (.22 + .6 * kier), 0., 1.));
    float obw = 1. - smoothstep(0., uDpr, e);
    sc *= 1. - obw * .18;
    c = mix(c, sc, g);
  }
  return nad(vec4(c, 1.) * a, wyn);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = doQ(p);
  // Baza to surowy pulpit (wycinek z tekstury), piksel w piksel jak ekran: margines okna zlewa się z pulpitem.
  vec4 w = uBaza > .5 ? vec4(zLin(tex(p, 0.)), 1.) : vec4(0.);
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break; if (abs(uP[i].y - 1.) < .5) w = nad(panel(p, q, i), w); }
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break; if (abs(uP[i].y - 2.) < .5) w = nad(tor(q, i), w); }
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break; if (abs(uP[i].y - 3.) < .5) w = nad(galka(p, q, i), w); }
  o = w;
}`;

  function shader(gl, typ, zrodlo) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, zrodlo);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }

  function utworz(canvas) {
    let gl = null;
    try { gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (e) { gl = null; }
    if (!gl) return null;
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    } catch (e) {
      console.warn('Szklo: shader nie wszedł', e);
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const la = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(la);
    gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    ['uTlo', 'uTex', 'uOkno', 'uRes', 'uDpr', 'uCiemny', 'uRozmycie', 'uOdcien', 'uLmin', 'uLmax', 'uLminBrzeg', 'uLmaxBrzeg',
      'uNasycenie', 'uCien', 'uBlask', 'uDysp', 'uFresnel', 'uBaza', 'uGlifOn', 'uGlifOff', 'uSwiatlo', 'uDef', 'uDefX', 'uMysz', 'uKropla',
      'uN', 'uK', 'uP', 'uC'].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });
    const t0 = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(u.uTlo, 0);
    let rozmiar = [1, 1], maTlo = false;
    const K = new Float32Array(MAX * 4), P = new Float32Array(MAX * 4), C = new Float32Array(MAX * 4);
    const opcje = { ciemny: 0, rozmycie: 20, odcien: .2, lmin: .7, lmax: .02, lminBrzeg: .35, lmaxBrzeg: .14, nasycenie: 1.6,
      cien: .3, blask: .6, dysp: .045, fresnel: .9, glifOn: [1, 1, 1], glifOff: [.11, .11, .12], swiatlo: [-.62, -.78], okno: [0, 0], baza: 1 };

    return {
      gl: gl,
      // Całe tło: zdjęcie monitora albo scena strony.
      tlo: function (zr) {
        const w = zr.naturalWidth || zr.width, h = zr.naturalHeight || zr.height;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, zr);
        gl.generateMipmap(gl.TEXTURE_2D);
        rozmiar = [w, h];
        maTlo = true;
      },
      // Całe tło z surowych pikseli RGBA (wiersze od góry): zdjęcie ekranu spod okna od programu (zasobnik.rs).
      tloPiksele: function (dane, w, h) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, dane);
        gl.generateMipmap(gl.TEXTURE_2D);
        rozmiar = [w, h];
        maTlo = true;
      },
      // Świeży kawałek tła pod oknem (program robi zdjęcie z oknem wykluczonym z przechwytywania).
      czesc: function (zr, x, y) {
        if (!maTlo) return;
        const w = zr.naturalWidth || zr.width, h = zr.naturalHeight || zr.height;
        if (x < 0 || y < 0 || x + w > rozmiar[0] || y + h > rozmiar[1]) return;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, zr);
        gl.generateMipmap(gl.TEXTURE_2D);
      },
      // Klatka na żywo: piksele RGBA kawałka ekranu (wspólny bufor WebView2) w miejscu (x, y) zdjęcia monitora.
      czescPiksele: function (dane, x, y, w, h) {
        if (!maTlo || x < 0 || y < 0 || x + w > rozmiar[0] || y + h > rozmiar[1]) return false;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, dane);
        gl.generateMipmap(gl.TEXTURE_2D);
        return true;
      },
      maTlo: function () { return maTlo; },
      ustaw: function (o) { for (const n in o) opcje[n] = o[n]; },
      // Kształty w pikselach CSS, bez odkształcenia: { x, y, w, h, r, typ: 1 szkło | 2 tor | 3 gałka, a, n, c: [4] }.
      // def: { x, y, shx, sy, sx, tx } (CSS px), mysz: { x, y, poswiata, kropla, kx, ky }.
      rysuj: function (ksztalty, def, mysz) {
        const dpr = window.devicePixelRatio || 1;
        const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        gl.viewport(0, 0, W, H);
        const n = Math.min(MAX, ksztalty.length);
        for (let i = 0; i < n; i++) {
          const s = ksztalty[i], c = s.c || [0, 0, 0, 1];
          K[i * 4] = s.x * dpr; K[i * 4 + 1] = s.y * dpr; K[i * 4 + 2] = s.w * dpr; K[i * 4 + 3] = s.h * dpr;
          P[i * 4] = (s.r || 0) * dpr; P[i * 4 + 1] = s.typ; P[i * 4 + 2] = s.a || 0; P[i * 4 + 3] = s.n || 2;
          if (s.typ === 1) { C[i * 4] = s.faza * dpr; C[i * 4 + 1] = s.grubosc * dpr; C[i * 4 + 2] = s.cien == null ? 1 : s.cien; C[i * 4 + 3] = 1; }
          else { C[i * 4] = c[0]; C[i * 4 + 1] = c[1]; C[i * 4 + 2] = c[2]; C[i * 4 + 3] = c[3]; }
        }
        const d = def || { x: 0, y: 0, shx: 0, sy: 1, sx: 1, tx: 0 };
        const m = mysz || { x: -9999, y: -9999, poswiata: 0, kropla: 0, kx: -9999, ky: -9999 };
        gl.uniform2f(u.uTex, rozmiar[0], rozmiar[1]);
        gl.uniform2f(u.uOkno, opcje.okno[0], opcje.okno[1]);
        gl.uniform2f(u.uRes, W, H);
        gl.uniform1f(u.uDpr, dpr);
        gl.uniform1f(u.uCiemny, opcje.ciemny);
        gl.uniform1f(u.uRozmycie, opcje.rozmycie * dpr);
        gl.uniform1f(u.uOdcien, opcje.odcien);
        gl.uniform1f(u.uLmin, opcje.lmin);
        gl.uniform1f(u.uLmax, opcje.lmax);
        gl.uniform1f(u.uLminBrzeg, opcje.lminBrzeg);
        gl.uniform1f(u.uLmaxBrzeg, opcje.lmaxBrzeg);
        gl.uniform1f(u.uNasycenie, opcje.nasycenie);
        gl.uniform1f(u.uCien, opcje.cien);
        gl.uniform1f(u.uBlask, opcje.blask);
        gl.uniform1f(u.uDysp, opcje.dysp);
        gl.uniform1f(u.uFresnel, opcje.fresnel);
        gl.uniform1f(u.uBaza, opcje.baza);
        gl.uniform3fv(u.uGlifOn, opcje.glifOn);
        gl.uniform3fv(u.uGlifOff, opcje.glifOff);
        const l = Math.hypot(opcje.swiatlo[0], opcje.swiatlo[1]) || 1;
        gl.uniform2f(u.uSwiatlo, opcje.swiatlo[0] / l, opcje.swiatlo[1] / l);
        gl.uniform4f(u.uDef, d.x * dpr, d.y * dpr, d.shx, d.sy);
        gl.uniform2f(u.uDefX, d.sx, d.tx * dpr);
        gl.uniform4f(u.uMysz, m.x * dpr, m.y * dpr, m.poswiata, m.kropla);
        gl.uniform2f(u.uKropla, m.kx * dpr, m.ky * dpr);
        gl.uniform1i(u.uN, n);
        gl.uniform4fv(u.uK, K);
        gl.uniform4fv(u.uP, P);
        gl.uniform4fv(u.uC, C);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      // Do testów: najjaśniejszy i najciemniejszy piksel w prostokącie CSS (jasność względna WCAG).
      jasnosc: function (x, y, w, h) {
        const dpr = window.devicePixelRatio || 1;
        const X = Math.round(x * dpr), Y = canvas.height - Math.round((y + h) * dpr), Wd = Math.max(1, Math.round(w * dpr)), Hd = Math.max(1, Math.round(h * dpr));
        const px = new Uint8Array(Wd * Hd * 4);
        gl.readPixels(X, Y, Wd, Hd, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let mn = 1, mx = 0;
        for (let i = 0; i < px.length; i += 4) {
          const al = px[i + 3] / 255;
          if (al < .99) continue;
          const L = jasnoscWzgledna([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
          if (L < mn) mn = L;
          if (L > mx) mx = L;
        }
        return { min: mn, max: mx };
      }
    };
  }

  function lin(c) { return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function jasnoscWzgledna(rgb) { return .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]); }
  function kolor(hex) { const h = String(hex).trim().replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }
  // Najniższa jasność tła (jasny motyw), przy której każdy z kolorów ma co najmniej `prog`.
  function dolnaGranica(kolory, prog) { let m = 0; kolory.forEach(function (k) { m = Math.max(m, prog * (jasnoscWzgledna(kolor(k)) + .05) - .05); }); return Math.min(1, m); }
  // Najwyższa jasność tła (ciemny motyw), przy której każdy z kolorów ma co najmniej `prog`.
  function gornaGranica(kolory, prog) { let m = 1; kolory.forEach(function (k) { m = Math.min(m, (jasnoscWzgledna(kolor(k)) + .05) / prog - .05); }); return Math.max(0, m); }

  return { utworz: utworz, kolor: kolor, jasnoscWzgledna: jasnoscWzgledna, dolnaGranica: dolnaGranica, gornaGranica: gornaGranica, MAX: MAX };
})();