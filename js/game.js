(() => {
'use strict';
const $ = id => document.getElementById(id);
const app = $('app'), canvas = $('c');
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.add(isTouch ? 'touch' : 'desk');

/* ---------- world data ---------- */
const W = 192, D = 192, H = 40, SEA = 12, FLAT = 14, CS = 16, NCX = W / CS, NCZ = D / CS, SEED = 7;
const world = new Uint16Array(W * H * D);
const I = (x, y, z) => (y * D + z) * W + x;
const inB = (x, y, z) => x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D;
const get = (x, y, z) => inB(x, y, z) ? world[I(x, y, z)] : 0;
const GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, PLANKS = 7, COBBLE = 8, GLASS = 9, BEDROCK = 10;
const opaque = b => b !== 0 && b !== LEAVES && b !== GLASS;
/* atlas tile of [top, side, bottom] per block */
const tb = (t, s, b) => [s, s, t, b, s, s];   /* tiles per face: +x -x +y -y +z -z */
const BT = [null, tb(0,1,2), tb(2,2,2), tb(3,3,3), tb(4,4,4), tb(6,5,6), tb(7,7,7), tb(8,8,8), tb(9,9,9), tb(10,10,10), tb(11,11,11)];
const NAMEOF = { 1: 'Grass', 2: 'Dirt', 3: 'Stone', 4: 'Sand', 5: 'Log', 6: 'Leaves', 7: 'Planks', 8: 'Cobblestone', 9: 'Glass' }, FB = {};
(window.EXTRA_BLOCKS || []).forEach((e, i) => { const id = 11 + i; BT[id] = e.t; NAMEOF[id] = e.n; if (e.f) FB[id] = 1; });
const P2 = window.PACK2 || { rows: 6, blocks: [] }, ROWS = P2.rows;
P2.blocks.forEach((e, i) => { const id = 11 + (window.EXTRA_BLOCKS || []).length + i; BT[id] = e.t; NAMEOF[id] = e.n; });
const PLACEABLE = Object.keys(NAMEOF).map(Number);
let hot = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/* ---------- texture atlas (4x4 tiles of 16px, drawn in code) ---------- */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const atlasCv = document.createElement('canvas'); atlasCv.width = 256; atlasCv.height = ROWS * 16;
(function paintAtlas() {
  const ctx = atlasCv.getContext('2d'), rng = mulberry(99);
  const tile = (i, fn) => {
    const img = ctx.createImageData(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = fn(x, y), o = (y * 16 + x) * 4;
      img.data[o] = c[0]; img.data[o+1] = c[1]; img.data[o+2] = c[2]; img.data[o+3] = c.length > 3 ? c[3] : 255;
    }
    ctx.putImageData(img, (i % 16) * 16, Math.floor(i / 16) * 16);
  };
  const n = (c, a) => { const d = (rng() - .5) * 2 * a; return [c[0] + d, c[1] + d, c[2] + d]; };
  const dirt = [134, 96, 67];
  tile(0, () => n([96, 160, 56], 16));
  tile(1, (x, y) => (y < 3 || (y === 3 && rng() < .5)) ? n([96, 160, 56], 16) : n(dirt, 14));
  tile(2, () => n(dirt, 14));
  tile(3, () => n([125, 125, 125], 14));
  tile(4, () => n([219, 207, 153], 8));
  tile(5, (x) => n([102, 81, 50], 8).map(v => v + ((x * 7) % 5 === 0 ? -18 : 0)));
  tile(6, (x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 ? n([102, 81, 50], 8) : n(Math.floor(d) % 2 ? [186, 149, 96] : [166, 129, 80], 6); });
  tile(7, () => rng() < .18 ? [0, 0, 0, 0] : n([58, 125, 43], 24));
  tile(8, (x, y) => n([176, 136, 80], 8).map(v => v + (y % 4 === 3 ? -28 : 0)));
  tile(9, (x, y) => { const b = 120 + (((x >> 2) * 13 + (y >> 2) * 29) % 5) * 9 - 18; const m = (x % 5 === 0 || y % 5 === 0) ? -26 : 0; return n([b + m, b + m, b + m], 8); });
  tile(10, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15) ? [200, 230, 240] : ((x === y || x === y + 1) && x > 2 && x < 7 ? [255, 255, 255] : [0, 0, 0, 0]));
  tile(11, () => n([50, 50, 50], 25));
})();
const atlas = new THREE.CanvasTexture(atlasCv);
atlas.magFilter = atlas.minFilter = THREE.NearestFilter; atlas.generateMipmaps = false;

/* ---------- terrain + village generation ---------- */
function hash(x, z) { let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + SEED * 144665 | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); t += a; a *= .5; f *= 2; } return s / t; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function heightAt(x, z) {
  const e = 4 + fbm(x / 26, z / 26) * 28;
  const d = Math.hypot((x - W / 2) / (W / 2), (z - D / 2) / (D / 2));
  let h = 5 + (e - 5) * sstep(1.0, 0.55, d);
  h += (FLAT - h) * sstep(34, 22, Math.hypot(x - VX, z - VZ));
  return Math.max(2, Math.min(30, Math.round(h)));
}
const VX = W / 2, VZ = D / 2;
function box(x0, y0, z0, x1, y1, z1, b) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (inB(x, y, z)) world[I(x, y, z)] = b; }
function house(x0, z0, w, d, door) {
  const y0 = FLAT, x1 = x0 + w - 1, z1 = z0 + d - 1;
  box(x0, y0, z0, x1, y0, z1, COBBLE);
  box(x0, y0 + 1, z0, x1, y0 + 4, z1, PLANKS);
  box(x0 + 1, y0 + 1, z0 + 1, x1 - 1, y0 + 4, z1 - 1, 0);
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(cx, y0 + 1, cz, cx, y0 + 4, cz, LOG);
  const mx = x0 + (w >> 1), mz = z0 + (d >> 1);
  const dc = door === 'S' ? [mx, z1] : door === 'N' ? [mx, z0] : door === 'W' ? [x0, mz] : [x1, mz];
  const win = [[x0, mz], [x1, mz], [x0 + 2, z0], [x1 - 2, z0], [x0 + 2, z1], [x1 - 2, z1]];
  for (const [wx, wz] of win) if (!(wx === dc[0] && wz === dc[1]) && !(Math.abs(wx - dc[0]) < 2 && wz === dc[1])) box(wx, y0 + 2, wz, wx, y0 + 2, wz, GLASS);
  box(dc[0], y0 + 1, dc[1], dc[0], y0 + 2, dc[1], 0);
  for (let k = 0; ; k++) { const xa = x0 - 1 + k, xb = x1 + 1 - k, za = z0 - 1 + k, zb = z1 + 1 - k; if (xa > xb || za > zb) break; box(xa, y0 + 5 + k, za, xb, y0 + 5 + k, zb, PLANKS); }
}
function path(x1, z1, x2, z2) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) box(x, FLAT, z1, x, FLAT, z1, DIRT);
  for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) box(x2, FLAT, z, x2, FLAT, z, DIRT);
}
function generate() {
  world.fill(0);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = heightAt(x, z), sandy = h <= SEA + 1, rocky = h >= 24;
    for (let y = 0; y <= h; y++) {
      let b = STONE;
      if (y === 0) b = BEDROCK;
      else if (y === h) b = rocky ? STONE : sandy ? SAND : GRASS;
      else if (y >= h - 3 && !rocky) b = sandy ? SAND : DIRT;
      world[I(x, y, z)] = b;
    }
  }
  const rnd = mulberry(SEED * 31);
  for (let i = 0; i < 320 * (W * D) / (96 * 96); i++) {
    const x = 3 + Math.floor(rnd() * (W - 6)), z = 3 + Math.floor(rnd() * (D - 6));
    let top = H - 1; while (top > 0 && !world[I(x, top, z)]) top--;
    if (Math.hypot(x - VX, z - VZ) < 25 || world[I(x, top, z)] !== GRASS) continue;
    const th = 4 + Math.floor(rnd() * 2);
    for (let t = 1; t <= th; t++) world[I(x, top + t, z)] = LOG;
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy <= th ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || rnd() < .5)) continue;
        if (inB(x + dx, top + dy, z + dz) && !world[I(x + dx, top + dy, z + dz)]) world[I(x + dx, top + dy, z + dz)] = LEAVES;
      }
    }
  }
  path(VX - 9, VZ - 7, VX, VZ); path(VX + 5, VZ - 9, VX, VZ); path(VX - 9, VZ + 6, VX, VZ); path(VX + 5, VZ + 9, VX, VZ);
  house(VX - 12, VZ - 13, 7, 6, 'S'); house(VX + 6, VZ - 12, 6, 7, 'W'); house(VX - 11, VZ + 7, 6, 6, 'N'); house(VX + 6, VZ + 6, 8, 6, 'W');
  box(VX - 1, FLAT, VZ - 1, VX + 1, FLAT + 2, VZ + 1, COBBLE);
  box(VX, FLAT - 3, VZ, VX, FLAT + 2, VZ, 0); box(VX, FLAT - 3, VZ, VX, FLAT - 3, VZ, SAND);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(VX + dx, FLAT + 3, VZ + dz, VX + dx, FLAT + 4, VZ + dz, LOG);
  box(VX - 1, FLAT + 5, VZ - 1, VX + 1, FLAT + 5, VZ + 1, PLANKS);
}

/* ---------- saved edits ---------- */
const KEY = 'opencraft.v2', edits = new Map();
function loadEdits() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); for (const [i, b] of a) edits.set(i, b); } catch (e) {} }
let saveT = 0;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(Array.from(edits))); } catch (e) {} }, 700); }
function applyEdits() { edits.forEach((b, i) => { if (i < world.length) world[i] = b; }); }

/* ---------- renderer / scene ---------- */
const SKY = 0x8ec9ff, WATER_FOG = 0x2a5fa8;
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
catch (e) { const er = $('err'); er.style.display = 'block'; er.textContent = 'Your browser cannot run 3D graphics (WebGL). Please try another browser.'; $('btnStart').disabled = true; return; }
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 40, 110);
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 220);
camera.rotation.order = 'YXZ';
const QL = [Math.min(window.devicePixelRatio || 1, 1.5), 1, .75, .6].filter((v, i, a) => i === 0 || v < a[i - 1]);
let q = 0;
function resize() { const w = app.clientWidth || innerWidth, h = app.clientHeight || innerHeight; renderer.setPixelRatio(QL[q]); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 250)); try { new ResizeObserver(resize).observe(app); } catch (e) {} resize();

const mat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
const water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ color: 0x3a78c9, transparent: true, opacity: 0.62, depthWrite: false }));
water.rotation.x = -Math.PI / 2; water.position.set(W / 2, SEA + 0.9, D / 2); scene.add(water);
const clouds = [], cmat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
{ const r = mulberry(5); for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(12 + r() * 16, 2, 8 + r() * 8), cmat); m.position.set(-40 + r() * (W + 80), 48 + r() * 5, -40 + r() * (D + 80)); scene.add(m); clouds.push(m); } }
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000 }));
hl.visible = false; scene.add(hl);
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.012, 1.012, 1.012), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false }));
crack.visible = false; scene.add(crack);

/* ---------- chunk meshing (hidden faces skipped, cheap vertex shading) ---------- */
const FACES = [
  { n: [1,0,0],  c: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], k: 1, sh: .82 },
  { n: [-1,0,0], c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], k: 1, sh: .82 },
  { n: [0,1,0],  c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], k: 0, sh: 1 },
  { n: [0,-1,0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], k: 2, sh: .5 },
  { n: [0,0,1],  c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], k: 1, sh: .68 },
  { n: [0,0,-1], c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], k: 1, sh: .68 },
];
FACES.forEach(f => {
  const ax = f.n[0] ? 0 : f.n[1] ? 1 : 2, o = [0, 1, 2].filter(a => a !== ax);
  f.ao = f.c.map(cc => {
    const s1 = cc[o[0]] ? 1 : -1, s2 = cc[o[1]] ? 1 : -1, a = f.n.slice(), b = f.n.slice(), c = f.n.slice();
    a[o[0]] += s1; b[o[1]] += s2; c[o[0]] += s1; c[o[1]] += s2; return [a, b, c];
  });
});
const AOL = [.55, .72, .86, 1], chunks = [], dirty = new Set();
function buildGeometry(cx, cz) {
  const pos = [], col = [], uv = [], idx = [], x0 = cx * CS, z0 = cz * CS; let vc = 0;
  for (let y = 0; y < H; y++) for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
    const b = world[I(x, y, z)]; if (!b) continue;
    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi], nb = get(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (opaque(nb) || (nb === b && (b === GLASS || b === LEAVES))) continue;
      const t = BT[b][fi], u0 = (t % 16) / 16 + .0005, v0 = 1 - (Math.floor(t / 16) + 1) / ROWS + .0005, s = 1 / 16 - .001, sv = 1 / ROWS - .001;
      const ao = [];
      for (let c = 0; c < 4; c++) {
        const [a, bb, cc] = f.ao[c], s1 = opaque(get(x + a[0], y + a[1], z + a[2])) ? 1 : 0, s2 = opaque(get(x + bb[0], y + bb[1], z + bb[2])) ? 1 : 0, cr = opaque(get(x + cc[0], y + cc[1], z + cc[2])) ? 1 : 0;
        ao.push(s1 && s2 ? 0 : 3 - (s1 + s2 + cr));
      }
      const uvs = [[0,0],[1,0],[1,1],[0,1]];
      for (let c = 0; c < 4; c++) {
        pos.push(x + f.c[c][0], y + f.c[c][1], z + f.c[c][2]);
        const sh = FB[b] ? 1 : f.sh * AOL[ao[c]]; col.push(sh, sh, sh);
        uv.push(u0 + uvs[c][0] * s, v0 + uvs[c][1] * sv);
      }
      if (ao[0] + ao[2] < ao[1] + ao[3]) idx.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc); else idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new THREE.BufferAttribute(vc > 65000 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere(); return g;
}
function rebuild(cx, cz) {
  const k = cz * NCX + cx; let m = chunks[k];
  if (!m) { m = chunks[k] = new THREE.Mesh(new THREE.BufferGeometry(), mat); scene.add(m); }
  m.geometry.dispose(); m.geometry = buildGeometry(cx, cz);
}
function rebuildAll() { for (let cz = 0; cz < NCZ; cz++) for (let cx = 0; cx < NCX; cx++) rebuild(cx, cz); dirty.clear(); }
function setBlock(x, y, z, b) {
  world[I(x, y, z)] = b; edits.set(I(x, y, z), b); saveSoon();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const cx = Math.floor((x + dx) / CS), cz = Math.floor((z + dz) / CS); if (cx >= 0 && cx < NCX && cz >= 0 && cz < NCZ) dirty.add(cz * NCX + cx); }
}

/* ---------- player ---------- */
const PW = .3, PH = 1.8, EYE = 1.62;
const P = { x: W / 2 + .5, y: 20, z: D / 2 - 3.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -.12, ground: false, fly: false };
const solidAt = (x, y, z) => y < 0 || x < 0 || x >= W || z < 0 || z >= D ? true : y >= H ? false : world[I(x, y, z)] !== 0;
function collides(px, py, pz) {
  const x0 = Math.floor(px - PW), x1 = Math.floor(px + PW), y0 = Math.floor(py), y1 = Math.floor(py + PH - .001), z0 = Math.floor(pz - PW), z1 = Math.floor(pz + PW);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (solidAt(x, y, z)) return true;
  return false;
}
let carMesh = null; const car = { on: false, x: 0, y: 0, z: 0, h: 0, v: 0, p: 0 };
function placeCar() {
  if (!window.makeCar) return; if (!carMesh) { carMesh = window.makeCar(THREE, 6); carMesh.rotation.order = 'YXZ'; scene.add(carMesh); }
  car.on = false; car.v = 0; car.h = 0; carMesh.rotation.set(0, 0, 0);
  const x = VX + 19, z = VZ; let y = H - 1; while (y > 0 && !world[I(x, y, z)]) y--; carMesh.position.set(x + .5, y + 1, z + .5); car.x = x + .5; car.y = y + 1; car.z = z + .5; car.p = 0;
}
function spawn() {
  let y = H - 1; while (y > 0 && !world[I(VX, y, VZ - 4)]) y--;
  Object.assign(P, { x: VX + .5, y: y + 1.01, z: VZ - 3.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -.12, fly: false });
  syncFly();
}

/* ---------- input ---------- */
const keys = {}, joyV = { f: 0, s: 0 };
let jumpHeld = false, downHeld = false, sel = 0, playing = false;
const LP = 250, BREAK_MS = 450;
function syncFly() { $('btnFly').classList.toggle('on', P.fly); $('btnDown').hidden = !P.fly; }
addEventListener('keydown', e => {
  if (!playing) return; keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR') toggleDrive();
  if (e.code === 'KeyF' && !car.on) { P.fly = !P.fly; P.vy = 0; syncFly(); }
  if (e.code === 'KeyE') openBag();
  if (/^Digit[1-9]$/.test(e.code)) selectSlot(+e.code.slice(5) - 1);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('wheel', e => { if (playing) selectSlot((sel + (e.deltaY > 0 ? 1 : 8)) % 9); }, { passive: true });
document.addEventListener('mousemove', e => { if (playing && document.pointerLockElement === canvas) { P.yaw -= e.movementX * .0022; P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - e.movementY * .0022)); } });
let hold = null;
canvas.addEventListener('mousedown', e => {
  if (!playing || isTouch) return;
  if (document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (x) {} return; }
  const k = e.button === 2 ? 'place' : 'break'; act(k); hold = { k, next: performance.now() + 320 };
});
addEventListener('mouseup', () => { hold = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (!isTouch && playing && document.pointerLockElement !== canvas) pause(); });

/* touch: left half = joystick, right half = look / tap to act */
const zone = $('zone'), joyBase = $('joyBase'), joyKnob = $('joyKnob'); let joy = null, look = null;
zone.addEventListener('pointerdown', e => {
  if (!playing) return; try { zone.setPointerCapture(e.pointerId); } catch (x) {}
  if (e.clientX < innerWidth * .45 && !joy) { joy = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; joyBase.style.display = 'block'; joyBase.style.left = e.clientX + 'px'; joyBase.style.top = e.clientY + 'px'; joyKnob.style.transform = ''; }
  else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, broke: false, key: null, bs: 0 };
});
zone.addEventListener('pointermove', e => {
  if (joy && e.pointerId === joy.id) {
    const R = 48; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    if (l > 10) joy.moved = true; joyKnob.style.transform = `translate(${dx}px,${dy}px)`; joyV.s = dx / R; joyV.f = -dy / R;
  } else if (look && e.pointerId === look.id) {
    P.yaw -= (e.clientX - look.x) * .0055; P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - (e.clientY - look.y) * .0055));
    look.x = e.clientX; look.y = e.clientY; if (Math.hypot(e.clientX - look.sx, e.clientY - look.sy) > 10) look.moved = true;
  }
});
const endPtr = e => {
  if (joy && e.pointerId === joy.id) { const tap = !joy.moved && e.type === 'pointerup' && performance.now() - joy.t < LP, jx = joy.x, jy = joy.y; joy = null; joyV.f = joyV.s = 0; joyBase.style.display = 'none'; if (tap) { const th = targetAt(jx, jy); if (th) act('place', th); } }
  else if (look && e.pointerId === look.id) { if (!look.moved && !look.broke && e.type === 'pointerup' && performance.now() - look.t < LP) { const th = targetAt(look.x, look.y); if (th) act('place', th); } crack.visible = false; look = null; }
};
zone.addEventListener('pointerup', endPtr); zone.addEventListener('pointercancel', endPtr);
const holdBtn = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); on(); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, off)); };
holdBtn('btnJump', () => jumpHeld = true, () => jumpHeld = false);
holdBtn('btnDown', () => downHeld = true, () => downHeld = false);
$('btnBag').addEventListener('click', openBag); $('bagClose').addEventListener('click', closeBag);
$('btnFs').addEventListener('click', () => { try { const d = document.documentElement, r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d); if (r && r.catch) r.catch(() => {}); } catch (e) {} });
$('btnFly').addEventListener('click', () => { if (car.on) return; P.fly = !P.fly; P.vy = 0; syncFly(); });
$('btnMenu').addEventListener('click', pause);

/* hotbar + bag */
const hotbar = $('hotbar'), slots = [], nameEl = $('blockname'), bag = $('bag'), bagGrid = $('bagGrid'); let nameT = 0, atlasURL = '', bagOpen = false;
function icon(el, b) { const t = BT[b][4]; el.style.backgroundImage = `url(${atlasURL})`; el.style.backgroundSize = `1600% ${ROWS * 100}%`; el.style.backgroundPosition = `${(t % 16) / 15 * 100}% ${Math.floor(t / 16) / (ROWS - 1) * 100}%`; }
function saveHot() { try { localStorage.setItem(KEY + '.hot', JSON.stringify(hot)); } catch (e) {} }
function buildHotbar() {
  try { const h = JSON.parse(localStorage.getItem(KEY + '.hot') || 'null'); if (Array.isArray(h) && h.length === 9 && h.every(b => NAMEOF[b])) hot = h; } catch (e) {}
  hot.forEach((b, i) => {
    const s = document.createElement('div'); s.className = 'slot'; s.setAttribute('role', 'button'); const ic = document.createElement('div'); ic.className = 'ico'; icon(ic, b);
    s.appendChild(ic); s.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); selectSlot(i); }); hotbar.appendChild(s); slots.push(s);
  });
}
function buildBag() {
  PLACEABLE.forEach(b => {
    const d = document.createElement('button'); d.className = 'bagitem'; d.setAttribute('aria-label', NAMEOF[b]);
    const ic = document.createElement('div'); ic.className = 'ico'; icon(ic, b); const l = document.createElement('span'); l.textContent = NAMEOF[b]; d.append(ic, l);
    d.addEventListener('click', () => { hot[sel] = b; icon(slots[sel].firstChild, b); saveHot(); selectSlot(sel); closeBag(); }); bagGrid.appendChild(d);
  });
}
function openBag() { if (bagOpen) return; bagOpen = true; playing = false; hold = null; jumpHeld = downHeld = false; joy = look = null; joyV.f = joyV.s = 0; joyBase.style.display = 'none'; crack.visible = false; bag.hidden = false; try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
function closeBag() { bagOpen = false; bag.hidden = true; resume(); }
function selectSlot(i) { sel = i; slots.forEach((s, k) => s.classList.toggle('sel', k === i)); nameEl.textContent = NAMEOF[hot[i]]; nameEl.classList.add('on'); clearTimeout(nameT); nameT = setTimeout(() => nameEl.classList.remove('on'), 1400); }

/* ---------- ray picking + block actions ---------- */
function raycast(ox, oy, oz, dx, dy, dz, max) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity, ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity, tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity, t = 0, n = [0, 0, 0];
  while (t <= max) {
    if (inB(x, y, z) && world[I(x, y, z)]) return n[0] || n[1] || n[2] ? { x, y, z, n } : null;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; n = [-sx, 0, 0]; } else if (ty < tz) { y += sy; t = ty; ty += tdy; n = [0, -sy, 0]; } else { z += sz; t = tz; tz += tdz; n = [0, 0, -sz]; }
  }
  return null;
}
function target() {
  const cp = Math.cos(P.pitch); return raycast(P.x, P.y + EYE, P.z, -Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp, 6);
}
const _v = new THREE.Vector3();
function targetAt(px, py) {
  const r = app.getBoundingClientRect(); camera.updateMatrixWorld();
  _v.set(((px - r.left) / r.width) * 2 - 1, -(((py - r.top) / r.height) * 2 - 1), .5).unproject(camera).sub(camera.position).normalize();
  return raycast(camera.position.x, camera.position.y, camera.position.z, _v.x, _v.y, _v.z, 6);
}
function act(kind, h) {
  if (car.on) return;
  h = h || target(); if (!h) return;
  if (kind === 'break') { if (h.y > 0) setBlock(h.x, h.y, h.z, 0); return; }
  const x = h.x + h.n[0], y = h.y + h.n[1], z = h.z + h.n[2];
  if (!inB(x, y, z) || y < 1 || world[I(x, y, z)]) return;
  if (x + 1 > P.x - PW && x < P.x + PW && z + 1 > P.z - PW && z < P.z + PW && y + 1 > P.y && y < P.y + PH) return;
  setBlock(x, y, z, hot[sel]);
}


/* ---------- driving ---------- */
const drvBtn = $('btnDrive');
function colTop(x, z, fromY) {
  if (x < 0 || z < 0 || x >= W || z >= D) return 99;
  const xi = Math.floor(x), zi = Math.floor(z); let y = Math.min(H - 1, Math.floor(fromY));
  while (y >= 0 && !world[I(xi, y, zi)]) y--;
  return y + 1;
}
const carPts = [[0, 0], [0, -2.6], [0, 2.6], [.9, -2.6], [-.9, -2.6], [.9, 2.6], [-.9, 2.6]];
function carPt(x, z, h, a, b) { return [x + a * Math.cos(h) + b * Math.sin(h), z - a * Math.sin(h) + b * Math.cos(h)]; }
function carFree(x, z, h, y) {
  for (const [a, b] of carPts) { const [px, pz] = carPt(x, z, h, a, b), top = colTop(px, pz, y + 2.5); if (top > y + 1.05 || top < SEA + 1.2) return false; }
  return true;
}
function driveStep(dt) {
  const f = Math.max(-1, Math.min(1, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + joyV.f)), s = Math.max(-1, Math.min(1, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joyV.s));
  if (f > .05) car.v += f * (car.v < 0 ? 26 : 11) * dt; else if (f < -.05) car.v += f * (car.v > 0 ? 24 : 9) * dt; else car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 5 * dt);
  if (jumpHeld || keys.Space) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 30 * dt);
  car.v = Math.max(-5, Math.min(16, car.v));
  const nh = car.h - s * Math.min(1, Math.abs(car.v) / 5) * 1.8 * (car.v >= 0 ? 1 : -1) * dt;
  if (carFree(car.x, car.z, nh, car.y)) car.h = nh;
  const dx = -Math.sin(car.h) * car.v * dt, dz = -Math.cos(car.h) * car.v * dt;
  if (carFree(car.x + dx, car.z + dz, car.h, car.y)) { car.x += dx; car.z += dz; }
  else if (carFree(car.x + dx, car.z, car.h, car.y)) { car.x += dx; car.v *= .6; }
  else if (carFree(car.x, car.z + dz, car.h, car.y)) { car.z += dz; car.v *= .6; }
  else car.v = 0;
  const [fx, fz] = carPt(car.x, car.z, car.h, 0, -2.4), [rx, rz] = carPt(car.x, car.z, car.h, 0, 2.4);
  const ft = colTop(fx, fz, car.y + 2.5), rt = colTop(rx, rz, car.y + 2.5), ct = colTop(car.x, car.z, car.y + 2.5);
  const ty = Math.max(ct, Math.min(ft, rt) + .1), k = Math.min(1, 12 * dt);
  car.y += (ty - car.y) * k; car.p += (Math.atan2(Math.max(-1, Math.min(1, ft - rt)), 4.8) - car.p) * k;
  carMesh.position.set(car.x, car.y, car.z); carMesh.rotation.set(car.p, car.h, 0);
  P.x = car.x; P.y = car.y; P.z = car.z; P.vx = P.vy = P.vz = 0;
}
function chaseCam() {
  const d = 8 + Math.abs(car.v) * .12; let cx = car.x + Math.sin(car.h) * d, cz = car.z + Math.cos(car.h) * d;
  const cy = Math.max(car.y + 4.2, colTop(cx, cz, car.y + 12) + 1.3);
  camera.position.set(cx, cy, cz); camera.rotation.set(-.3, car.h, 0);
}
function toggleDrive() {
  if (!carMesh || !playing) return;
  if (!car.on) {
    if (Math.hypot(P.x - car.x, P.z - car.z) > 5) return;
    car.on = true; car.v = 0; P.fly = false; syncFly(); hold = null;
  } else {
    car.on = false; car.v = 0;
    for (const sd of [2.8, -2.8, 3.8, -3.8]) {
      const [px, pz] = carPt(car.x, car.z, car.h, sd, 0), y = colTop(px, pz, car.y + 4);
      if (!collides(px, y + .01, pz)) { Object.assign(P, { x: px, y: y + .01, z: pz, yaw: car.h }); return; }
    }
    Object.assign(P, { x: car.x, y: car.y + 3.5, z: car.z, yaw: car.h });
  }
}
drvBtn.addEventListener('click', toggleDrive);

/* ---------- physics ---------- */
function physics(dt) {
  const f = Math.max(-1, Math.min(1, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + joyV.f)), s = Math.max(-1, Math.min(1, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joyV.s));
  let wx = -Math.sin(P.yaw) * f + Math.cos(P.yaw) * s, wz = -Math.cos(P.yaw) * f - Math.sin(P.yaw) * s; const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
  const inWater = !P.fly && P.y + .5 < SEA + .9, jump = jumpHeld || keys.Space, down = downHeld || keys.ShiftLeft || keys.ShiftRight;
  const sp = P.fly ? 10 : inWater ? 2.6 : 4.4; P.vx = wx * sp; P.vz = wz * sp;
  if (P.fly) P.vy = (jump ? 7 : 0) - (down ? 7 : 0);
  else if (inWater) { P.vy -= 9 * dt; if (jump) P.vy += 26 * dt; P.vy = Math.max(-3.5, Math.min(3.5, P.vy)); }
  else { P.vy = Math.max(-40, P.vy - 26 * dt); if (jump && P.ground) P.vy = 8.4; }
  const wasGround = P.ground; P.ground = false;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(P.vx), Math.abs(P.vy), Math.abs(P.vz)) * dt / .3)), h = dt / n; let hitH = false;
  for (let i = 0; i < n; i++) {
    let nx = P.x + P.vx * h; if (collides(nx, P.y, P.z)) { hitH = true; nx = P.vx > 0 ? Math.floor(nx + PW) - PW - 1e-4 : Math.floor(nx - PW) + 1 + PW + 1e-4; } P.x = nx;
    let nz = P.z + P.vz * h; if (collides(P.x, P.y, nz)) { hitH = true; nz = P.vz > 0 ? Math.floor(nz + PW) - PW - 1e-4 : Math.floor(nz - PW) + 1 + PW + 1e-4; } P.z = nz;
    let ny = P.y + P.vy * h;
    if (collides(P.x, ny, P.z)) { if (P.vy < 0) { ny = Math.floor(ny) + 1 + 1e-4; P.ground = true; } else ny = Math.floor(ny + PH) - PH - 1e-4; P.vy = 0; }
    P.y = ny;
  }
  if (hitH && wasGround && !P.fly && wl > .1 && !collides(P.x + wx * .35, P.y + 1.05, P.z + wz * .35)) P.vy = 7.8;
  if (P.y < -20) spawn();
}

/* ---------- menu / lifecycle ---------- */
const overlay = $('overlay');
function resume() {
  playing = true; overlay.hidden = true; $('btnStart').textContent = 'Resume';
  try { if (!isTouch) { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } } catch (e) {}
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
}
function pause() { playing = false; hold = null; jumpHeld = downHeld = false; joy = look = null; joyV.f = joyV.s = 0; joyBase.style.display = 'none'; overlay.hidden = false; try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
$('btnStart').addEventListener('click', resume);
(function buildCredits() {
  const list = $('creditList'), cr = $('credits');
  (window.CREDITS || []).forEach(c => {
    const d = document.createElement('div'); d.className = 'citem';
    const b = document.createElement('b'); b.textContent = c.title; const sp = document.createElement('span'); sp.textContent = c.by + ' \u2022 ' + c.license;
    const ln = document.createElement('div');
    c.links.forEach(l => { const a = document.createElement('a'); a.href = l.url; a.textContent = l.label; a.target = '_blank'; a.rel = 'noopener'; ln.appendChild(a); });
    d.append(b, sp, ln); list.appendChild(d);
  });
  $('btnCredits').addEventListener('click', () => { cr.hidden = false; cr.scrollTop = 0; });
  $('creditsClose').addEventListener('click', () => { cr.hidden = true; });
})();
let resetArm = 0;
$('btnReset').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!resetArm) { b.textContent = 'Sure? Tap again to erase'; resetArm = setTimeout(() => { resetArm = 0; b.textContent = 'New World'; }, 3500); return; }
  clearTimeout(resetArm); resetArm = 0; b.textContent = 'New World';
  edits.clear(); try { localStorage.removeItem(KEY); } catch (x) {} generate(); rebuildAll(); spawn(); placeCar();
});

/* ---------- main loop ---------- */
let last = performance.now(), fN = 0, fT = 0, lowRuns = 0, warm = 3, uw = false;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
  if (playing) { if (car.on) driveStep(dt); else physics(dt); if (hold && now > hold.next) { act(hold.k); hold.next = now + 180; } }
  if (car.on) chaseCam(); else { camera.position.set(P.x, P.y + EYE, P.z); camera.rotation.set(P.pitch, P.yaw, 0); }
  { const near = !!carMesh && Math.hypot(P.x - car.x, P.z - car.z) < 5 && Math.abs(P.y - car.y) < 4, show = playing && (car.on || near); if (drvBtn.hidden === show) drvBtn.hidden = !show; const lb = car.on ? 'Exit' : 'Drive'; if (drvBtn.dataset.l !== lb) { drvBtn.dataset.l = lb; drvBtn.textContent = lb; } }
  if (dirty.size) { dirty.forEach(k => rebuild(k % NCX, Math.floor(k / NCX))); dirty.clear(); }
  const h = playing && !isTouch && !car.on ? target() : null; hl.visible = !!h; if (h) hl.position.set(h.x + .5, h.y + .5, h.z + .5);
  if (playing && look && !look.moved && now - look.t > LP) {
    const tg = targetAt(look.x, look.y);
    if (tg && tg.y > 0) {
      const key = tg.x + ',' + tg.y + ',' + tg.z; if (look.key !== key) { look.key = key; look.bs = now; }
      const pr = Math.min(1, (now - look.bs) / BREAK_MS);
      crack.visible = true; crack.position.set(tg.x + .5, tg.y + .5, tg.z + .5); crack.material.opacity = .1 + .6 * pr;
      if (pr >= 1) { act('break', tg); look.broke = true; look.key = null; try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }
    } else { crack.visible = false; look.key = null; }
  } else crack.visible = false;
  for (const c of clouds) { c.position.x += dt * .9; if (c.position.x > W + 50) c.position.x = -50; }
  const under = P.y + EYE < SEA + .9;
  if (under !== uw) { uw = under; const c = under ? WATER_FOG : SKY; scene.background.set(c); scene.fog.color.set(c); scene.fog.near = under ? 1 : 40; scene.fog.far = under ? 26 : 110; }
  renderer.render(scene, camera);
  fN++; fT += raw; warm -= raw;
  if (fT >= .5) {
    const fps = fN / fT; $('fps').textContent = Math.round(fps) + ' fps'; fN = 0; fT = 0;
    lowRuns = (playing && warm <= 0 && fps < 32) ? lowRuns + 1 : 0;
    if (lowRuns >= 4 && q < QL.length - 1) { q++; resize(); lowRuns = 0; warm = 3; }
  }
}

function start() {
  atlas.needsUpdate = true;
  atlasCv.toBlob(bl => { atlasURL = URL.createObjectURL(bl); begin(); });
}
function begin() {
  buildHotbar(); buildBag(); loadEdits(); generate(); applyEdits(); rebuildAll(); spawn(); placeCar(); selectSlot(0); nameEl.classList.remove('on');
  requestAnimationFrame(frame);
}
const loadImg = (src, y, next) => { if (!src) return next(); const im = new Image(); im.onload = () => { atlasCv.getContext('2d').drawImage(im, 0, y); next(); }; im.onerror = next; im.src = src; };
loadImg(window.EXTRA_TILES, 16, () => loadImg(P2.tiles, 96, start));
})();
