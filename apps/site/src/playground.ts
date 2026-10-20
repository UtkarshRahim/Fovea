/* Exposure playground: a lake photograph re-rendered as if shot with different aperture, shutter and ISO.
   The source frame (f/4, 1/800 s, ISO 64) is sharp from front to back, so blur can be added but never removed. */

type Pt = [number, number];

const BASE = { aperture: 4, shutter: 1 / 800, iso: 64 };

const APERTURES = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
const SHUTTERS = [
  8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 100, 80, 60, 50, 40, 30, 25, 20,
  15, 13, 10, 8, 6, 5, 4, 1 / 0.3, 1 / 0.4, 1 / 0.5, 1 / 0.6, 1 / 0.8, 1,
].map((d) => 1 / d);
const ISOS = [64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];
const EXPOSURE_COMPS = [-3, -2.67, -2.33, -2, -1.67, -1.33, -1, -0.67, -0.33, 0, 0.33, 0.67, 1, 1.33, 1.67, 2, 2.33, 2.67, 3];

/* Scene model, in normalised image coordinates (0..1, origin top-left). Depth is stored as inverse distance (1/m). */
const TIGER: Pt[] = [
  [0.2015, 0.7916], [0.21, 0.7835], [0.2254, 0.7799], [0.2409, 0.7803], [0.2533, 0.7817], [0.2657, 0.7781], [0.2749, 0.7776], [0.2842, 0.7826],
  [0.2904, 0.7812], [0.2923, 0.783], [0.2958, 0.7841], [0.2994, 0.7803], [0.3028, 0.7819], [0.304, 0.7886], [0.3074, 0.7965], [0.3105, 0.8066],
  [0.3116, 0.8141], [0.3082, 0.8172], [0.304, 0.819], [0.302, 0.8231], [0.2981, 0.8201], [0.2935, 0.8269], [0.2889, 0.837], [0.295, 0.8483],
  [0.2984, 0.8573], [0.2997, 0.8685], [0.2974, 0.8723], [0.2927, 0.8712], [0.2916, 0.8618], [0.2873, 0.8505], [0.2803, 0.8404], [0.2749, 0.837],
  [0.2726, 0.8505], [0.2706, 0.8651], [0.2742, 0.8707], [0.2734, 0.8741], [0.2641, 0.8741], [0.2613, 0.8707], [0.2605, 0.855], [0.2592, 0.8393],
  [0.2579, 0.8291], [0.2486, 0.8269], [0.2394, 0.8262], [0.2347, 0.8246], [0.2313, 0.8348], [0.2301, 0.8483], [0.2324, 0.8618], [0.2378, 0.8667],
  [0.2412, 0.8696], [0.2401, 0.873], [0.2332, 0.873], [0.2288, 0.8685], [0.2247, 0.8573], [0.2216, 0.8438], [0.2185, 0.8303], [0.2131, 0.8258],
  [0.2072, 0.828], [0.2015, 0.8381], [0.1961, 0.8471], [0.1896, 0.8573], [0.186, 0.8651], [0.1883, 0.8703], [0.1865, 0.8734], [0.1798, 0.8719],
  [0.1793, 0.8651], [0.1829, 0.8528], [0.1896, 0.8381], [0.1957, 0.8235], [0.1984, 0.8134], [0.1961, 0.8118], [0.1914, 0.8073], [0.188, 0.7992],
  [0.1865, 0.7902], [0.1872, 0.783], [0.1899, 0.781], [0.1923, 0.7841], [0.1917, 0.7882], [0.1906, 0.7943], [0.1933, 0.8037], [0.1976, 0.8082],
  [0.1999, 0.7999],
];
const ISLAND: Pt[] = [
  [0.3105, 0.5938], [0.3125, 0.554], [0.332, 0.5227], [0.293, 0.4574], [0.21, 0.4759], [0.2002, 0.4545], [0.2246, 0.4119], [0.2295, 0.3764],
  [0.2637, 0.3338], [0.293, 0.3054], [0.3418, 0.2813], [0.4004, 0.277], [0.4492, 0.2912], [0.4883, 0.3267], [0.4932, 0.3693], [0.4785, 0.4119],
  [0.459, 0.4432], [0.5029, 0.4801], [0.5322, 0.4659], [0.5518, 0.4261], [0.5713, 0.3807], [0.5908, 0.3906], [0.6006, 0.419], [0.5957, 0.4545],
  [0.6982, 0.4574], [0.7031, 0.5199], [0.7422, 0.5142], [0.7813, 0.5185], [0.8252, 0.5327], [0.8418, 0.5611], [0.8457, 0.5895], [0.835, 0.6023],
  [0.6836, 0.6108], [0.4883, 0.6108], [0.3906, 0.5994],
];
/* Flat ground and water: a point at height y in the frame lies 1 / ((y - HORIZON) / GROUND_K) metres away. Tuned so the tiger's feet are ~30 m. */
const HORIZON = 0.5;
const GROUND_K = 11.1;
const ground = (y: number) => Math.max(y - HORIZON, 0) / GROUND_K;
const shoreAt = (x: number) => 0.528 - 0.023 * x;
const TIGER_INV = ground(0.873);
const ISLAND_INV = ground(0.597);
const FAR_INV = 1 / 900;
/* Inverse depths are packed into 8 bits as inv / INV_MAX. */
const INV_MAX = 0.05;
/* Blur strength. Real optics at 70 mm give only a few pixels of blur here, so this is exaggerated to make the effect visible. */
const BLUR_K = 0.5;
const MAX_BLUR = 0.03;
/* Blur below this fraction of the frame width counts as sharp, for the depth-of-field readout. */
const SHARP = 0.0012;
/* Frame widths per second. A walk (~1.2 m/s) would be 0.08; this is about three times that so slow shutters visibly smear. */
const TIGER_SPEED = 0.25;

const VERT = `#version 300 es
in vec2 p;
out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

/* Pass 1: put the tiger, smeared by the shutter, over a clean plate. Output colour + packed inverse depth. */
const MOTION = `#version 300 es
precision highp float;
uniform sampler2D uImg, uMask, uDepth;
uniform float uSmear, uTigerInv;
in vec2 vUv;
out vec4 o;
const float PLATE = 0.145;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float m0 = texture(uMask, uv).r;
  vec3 bg = mix(texture(uImg, uv).rgb, texture(uImg, uv + vec2(PLATE, 0.0)).rgb, smoothstep(0.0, 0.05, m0));
  float a = 0.0;
  vec3 c = vec3(0.0);
  const int N = 48;
  for (int i = 0; i < N; i++) {
    float s = (float(i) + 0.5) / float(N) - 0.5;
    vec2 q = uv - vec2(s * uSmear, 0.0);
    float m = texture(uMask, q).r;
    a += m;
    c += texture(uImg, q).rgb * m;
  }
  c = a > 0.0 ? c / a : bg;
  a /= float(N);
  o = vec4(mix(bg, c, a), mix(texture(uDepth, uv).r, uTigerInv, a));
}`;

/* Pass 2: depth-of-field gather, then exposure, sensor noise and display encoding. */
const LENS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uFocus, uBlur, uMaxR, uAspect, uPx, uGain, uNoise;
in vec2 vUv;
out vec4 o;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float coc(float d) { return min(uBlur * abs(d - uFocus), uMaxR); }
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(uvec3 p) { return (float(pcg(p.x + pcg(p.y + pcg(p.z)))) + 0.5) / 4294967296.0; }
float gauss(vec2 f, uint k) {
  uvec2 q = uvec2(f);
  return sqrt(-2.0 * log(rnd(uvec3(q, k)))) * cos(6.2831853 * rnd(uvec3(q, k + 1u)));
}
void main() {
  vec4 c0 = texture(uScene, vUv);
  float r0 = coc(c0.a);
  vec3 sum = lin(c0.rgb);
  float w = 1.0;
  if (uMaxR > uPx * 0.75) {
    const int N = 96;
    for (int i = 0; i < N; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / float(N));
      float th = fi * 2.39996;
      float dist = rr * uMaxR;
      vec2 off = vec2(cos(th), sin(th) * uAspect) * dist;
      vec4 s = texture(uScene, vUv + off);
      float rs = coc(s.a);
      /* Something farther away than this pixel can't spread its blur over it. */
      float eff = s.a < c0.a ? min(rs, r0) : rs;
      float wt = clamp((eff - dist) / uPx + 0.5, 0.0, 1.0);
      sum += lin(s.rgb) * wt;
      w += wt;
    }
  }
  vec3 col = sum / w * uGain;
  vec3 sigma = uNoise * sqrt(col + 0.01);
  vec2 f = gl_FragCoord.xy;
  col += sigma * gauss(f, 0u) + sigma * 0.5 * vec3(gauss(f, 2u), gauss(f, 4u), gauss(f, 6u));
  o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

const fmtAperture = (n: number) => `f/${n}`;
const fmtShutter = (t: number) => (t >= 0.3 ? `${+t.toFixed(1)} s` : `1/${Math.round(1 / t)} s`);
const fmtIso = (n: number) => `ISO ${n}`;
const fmtExposureComp = (ev: number) => {
  const r = Math.round(ev * 3) / 3;
  if (Math.abs(r) < 0.01) return "±0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)} EV`;
};
const fmtEv = (ev: number) => {
  const r = Math.round(ev * 3) / 3;
  if (Math.abs(r) < 0.01) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
};

function polygonCanvas(points: Pt[], w: number, h: number, blur = 0) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
  ctx.closePath();
  ctx.fill();
  return c;
}

/* Inverse depth for the whole frame, without the tiger (it's added in the shader so it can move). */
function buildDepth(img: HTMLImageElement, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const island = polygonCanvas(ISLAND, w, h).getContext("2d")!.getImageData(0, 0, w, h).data;
  const inv = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) / w;
      const k = j * w + i;
      if (island[k * 4]! > 127) inv[k] = ISLAND_INV;
      else if (y > shoreAt(x)) inv[k] = ground(y);
      else {
        const lum = (0.2126 * px[k * 4]! + 0.7152 * px[k * 4 + 1]! + 0.0722 * px[k * 4 + 2]!) / 255;
        inv[k] = lum > 0.68 ? 0 : FAR_INV;
      }
    }
  }
  return inv;
}

const metres = (inv: number) => {
  const d = 1 / inv;
  const step = d < 100 ? 1 : d < 1000 ? 10 : 100;
  return `${Math.round(d / step) * step} m`;
};

function depthOfField(focusInv: number, aperture: number) {
  const spread = (SHARP * aperture) / BLUR_K;
  const near = metres(focusInv + spread);
  const far = focusInv - spread > 0 ? metres(focusInv - spread) : "infinity";
  return `Sharp from about ${near} to ${far}`;
}

function describe(x: number, y: number, inv: number, onTiger: boolean) {
  const dist = inv > 0 ? `about ${metres(inv)} away` : "at infinity";
  if (onTiger) return `Focused on the tiger, ${dist}`;
  const isl = polygonContains(ISLAND, x, y);
  if (isl) return `Focused on the island, ${dist}`;
  if (y <= shoreAt(x)) return inv === 0 ? "Focused on the sky, at infinity" : `Focused on the far hills, ${dist}`;
  if (y > 0.86) return `Focused on the near bank, ${dist}`;
  return `Focused on the water, ${dist}`;
}

function polygonContains(poly: Pt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function compile(gl: WebGL2RenderingContext, frag: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  const loc = (name: string) => gl.getUniformLocation(prog, name);
  return { prog, loc };
}

function texture(gl: WebGL2RenderingContext, src: TexImageSource | null, w = 0, h = 0) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function initPlayground(root: HTMLElement) {
  const frame = root.querySelector<HTMLElement>("[data-play-frame]")!;
  const img = frame.querySelector<HTMLImageElement>("img")!;
  const canvas = frame.querySelector<HTMLCanvasElement>("canvas")!;
  const afBox = frame.querySelector<HTMLElement>("[data-play-af]")!;
  const focusLabel = root.querySelector<HTMLElement>("[data-play-focus]")!;
  const dofLabel = root.querySelector<HTMLElement>("[data-play-dof]")!;
  const evLabel = root.querySelector<HTMLElement>("[data-ev]")!;
  const meter = root.querySelector<HTMLElement>("[data-meter]")!;
  const controls = {
    aperture: root.querySelector<HTMLInputElement>('[data-ctl="aperture"]')!,
    shutter: root.querySelector<HTMLInputElement>('[data-ctl="shutter"]')!,
    iso: root.querySelector<HTMLInputElement>('[data-ctl="iso"]')!,
    expComp: root.querySelector<HTMLInputElement>('[data-ctl="expComp"]')!,
  };
  const outputs = {
    aperture: root.querySelector<HTMLOutputElement>('[data-out="aperture"]')!,
    shutter: root.querySelector<HTMLOutputElement>('[data-out="shutter"]')!,
    iso: root.querySelector<HTMLOutputElement>('[data-out="iso"]')!,
    expComp: root.querySelector<HTMLOutputElement>('[data-out="expComp"]')!,
  };

  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
  if (!gl) {
    root.classList.add("is-unsupported");
    return;
  }

  const defaults = { aperture: APERTURES.indexOf(BASE.aperture), shutter: 10, iso: 0, expComp: 9 };
  controls.aperture.max = String(APERTURES.length - 1);
  controls.shutter.max = String(SHUTTERS.length - 1);
  controls.iso.max = String(ISOS.length - 1);

  /* Meter ticks: -3..+3 EV in thirds */
  meter.replaceChildren(
    ...Array.from({ length: 19 }, (_, i) => {
      const t = document.createElement("i");
      if ((i - 9) % 3 === 0) t.className = "major";
      return t;
    }),
  );
  const ticks = Array.from(meter.children) as HTMLElement[];

  const hi = new Image();
  hi.decoding = "async";
  hi.src = img.src.replace("-1200", "-2400");

  void hi.decode().then(() => {
    const DW = 600;
    const DH = Math.round((DW * hi.naturalHeight) / hi.naturalWidth);
    const inv = buildDepth(hi, DW, DH);
    const packed = new Uint8Array(DW * DH * 4);
    for (let k = 0; k < inv.length; k++) packed[k * 4] = Math.round(Math.min(inv[k]! / INV_MAX, 1) * 255);
    const maskCanvas = polygonCanvas(TIGER, 1200, Math.round((1200 * hi.naturalHeight) / hi.naturalWidth), 0.6);
    const maskData = maskCanvas.getContext("2d")!.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texImg = texture(gl, hi);
    const texMask = texture(gl, maskCanvas);
    const texDepth = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texDepth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, DW, DH, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const motion = compile(gl, MOTION);
    const lens = compile(gl, LENS);

    let sceneTex: WebGLTexture | null = null;
    let fbo: WebGLFramebuffer | null = null;
    let size = { w: 0, h: 0 };
    let lastSmear = -1;

    const state = { ...defaults, focusInv: TIGER_INV, focus: [0.25, 0.81] as Pt };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.min(2400, Math.round(rect.width * Math.min(devicePixelRatio, 2)));
      const h = Math.round((w * hi.naturalHeight) / hi.naturalWidth);
      if (w === size.w || w === 0) return false;
      size = { w, h };
      canvas.width = w;
      canvas.height = h;
      if (sceneTex) gl.deleteTexture(sceneTex);
      if (fbo) gl.deleteFramebuffer(fbo);
      sceneTex = texture(gl, null, w, h);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      lastSmear = -1;
      return true;
    };

    const draw = () => {
      if (!size.w) return;
      const N = APERTURES[state.aperture]!;
      const t = SHUTTERS[state.shutter]!;
      const iso = ISOS[state.iso]!;
      const smear = TIGER_SPEED * t;

      gl.viewport(0, 0, size.w, size.h);
      if (smear !== lastSmear) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.useProgram(motion.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texMask);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, texDepth);
        gl.uniform1i(motion.loc("uImg"), 0);
        gl.uniform1i(motion.loc("uMask"), 1);
        gl.uniform1i(motion.loc("uDepth"), 2);
        gl.uniform1f(motion.loc("uSmear"), smear);
        gl.uniform1f(motion.loc("uTigerInv"), TIGER_INV / INV_MAX);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        lastSmear = smear;
      }

      const blur = (BLUR_K / N) * INV_MAX;
      const maxR = Math.min(MAX_BLUR, blur * Math.max(state.focusInv / INV_MAX, 1 - state.focusInv / INV_MAX));
      const comp = EXPOSURE_COMPS[state.expComp]!;
      const ev = Math.log2((BASE.aperture / N) ** 2 * (t / BASE.shutter) * (iso / BASE.iso)) + comp;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(lens.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(lens.loc("uScene"), 0);
      gl.uniform1f(lens.loc("uFocus"), state.focusInv / INV_MAX);
      gl.uniform1f(lens.loc("uBlur"), blur);
      gl.uniform1f(lens.loc("uMaxR"), maxR);
      gl.uniform1f(lens.loc("uAspect"), size.w / size.h);
      gl.uniform1f(lens.loc("uPx"), 1 / size.w);
      gl.uniform1f(lens.loc("uGain"), 2 ** ev);
      gl.uniform1f(lens.loc("uNoise"), 0.006 * Math.sqrt(iso / BASE.iso));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      outputs.aperture.textContent = fmtAperture(N);
      outputs.shutter.textContent = fmtShutter(t);
      outputs.iso.textContent = fmtIso(iso);
      outputs.expComp.textContent = fmtExposureComp(comp);
      evLabel.textContent = fmtEv(ev);
      dofLabel.textContent = depthOfField(state.focusInv, N);
      const steps = Math.max(-9, Math.min(9, Math.round(ev * 3)));
      ticks.forEach((tick, i) => {
        const v = i - 9;
        tick.classList.toggle("on", steps !== 0 && (steps > 0 ? v > 0 && v <= steps : v < 0 && v >= steps));
      });
      meter.classList.toggle("over", ev > 3.01);
      meter.classList.toggle("under", ev < -3.01);
      canvas.classList.add("is-ready");
    };

    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        draw();
      });
    };

    const setFocus = (x: number, y: number) => {
      const mx = Math.min(maskCanvas.width - 1, Math.floor(x * maskCanvas.width));
      const my = Math.min(maskCanvas.height - 1, Math.floor(y * maskCanvas.height));
      const onTiger = maskData[(my * maskCanvas.width + mx) * 4]! > 127;
      const di = Math.min(DW - 1, Math.floor(x * DW)) + Math.min(DH - 1, Math.floor(y * DH)) * DW;
      state.focusInv = onTiger ? TIGER_INV : inv[di]!;
      state.focus = [x, y];
      afBox.style.left = `${x * 100}%`;
      afBox.style.top = `${y * 100}%`;
      afBox.classList.remove("is-locked");
      void afBox.offsetWidth;
      afBox.classList.add("is-locked");
      focusLabel.textContent = describe(x, y, state.focusInv, onTiger);
      schedule();
    };

    const sync = () => {
      state.aperture = +controls.aperture.value;
      state.shutter = +controls.shutter.value;
      state.iso = +controls.iso.value;
      state.expComp = +controls.expComp.value;
      schedule();
    };
    for (const input of Object.values(controls)) input.addEventListener("input", sync);

    const reset = () => {
      controls.aperture.value = String(defaults.aperture);
      controls.shutter.value = String(defaults.shutter);
      controls.iso.value = String(defaults.iso);
      controls.expComp.value = String(defaults.expComp);
      sync();
      setFocus(0.25, 0.81);
    };
    root.querySelector("[data-play-reset]")?.addEventListener("click", reset);

    for (const b of root.querySelectorAll<HTMLButtonElement>("[data-focus-at]")) {
      b.addEventListener("click", () => {
        const [x, y] = b.dataset.focusAt!.split(",").map(Number);
        setFocus(x!, y!);
      });
    }

    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      setFocus((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });

    new ResizeObserver(() => resize() && schedule()).observe(canvas);
    resize();
    reset();
  });
}
