/* ============================================================================
   stage3d.js: Non and your files, as objects you can pick up.

   The architecture is the Pragma site's team3d.js (physics in stage pixels, springs for every
   gesture, grab and throw, a studio environment for the highlights, a frame budget, and a flight
   into the app window as the hero scrolls). The cast is NONON's own:
   - Non, revolved from the brand mark's own silhouette (brand-src/motion/non-idle.svg), with the
     orange ring, the sprout, and the arms and feet of the 3D poses.
   - Four of your files: a spreadsheet, meeting notes, a reading and a folder.
   On scroll the files fly into the app window and Non lands on the window's title mark.

   three.js is vendored and tree-shaken (public/vendor/three.min.js, from the Pragma site) and only
   fetched when this starts: the heaviest thing on the page, and nothing above the fold waits for it.
   ========================================================================== */

import { Spring, Tracker, clamp, dragPosition, onTick } from "./motion.js";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

/* Home spots are fractions of the stage. `wide` keeps clear of the headline on the left. */
const CAST = [
  { key: "non",    kind: "non",    size: 0.84, z:  0.0, wide: [0.775, 0.54], compact: [0.50, 0.53] },
  { key: "sheet",  kind: "sheet",  size: 0.40, z:  0.6, wide: [0.635, 0.24], compact: [0.15, 0.22] },
  { key: "notes",  kind: "notes",  size: 0.34, z: -1.0, wide: [0.925, 0.22], compact: [0.86, 0.20] },
  { key: "reading",kind: "reading",size: 0.38, z:  0.9, wide: [0.930, 0.78], compact: [0.86, 0.80] },
  { key: "folder", kind: "folder", size: 0.42, z:  0.4, wide: [0.630, 0.82], compact: [0.15, 0.80] },
];

const CAMZ = 30;
const FOV = 20;          // a long lens: little distortion near the edges
const BACK = -2.6;       // the shadow catcher, a sheet of paper behind everything
const TAN = Math.tan((FOV / 2) * Math.PI / 180);

const COL = {
  body: 0x2c2827,        // the clay charcoal of the 3D poses (brand ink #111 reads as a hole once lit)
  orange: 0xf47b32,
  white: 0xfbfaf8,
  cheek: 0xd98a80,
  paper: 0xfafafa,
  ink: 0x161616,
  line: 0xd6d6d6,
  soft: 0xffd9c2,
};

/* ── geometry helpers ─────────────────────────────────────────────────────── */

function cubic(p0, p1, p2, p3, n, out) {
  for (let s = 1; s <= n; s++) {
    const t = s / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/** Non's body profile, from the mark's path: M26 201 C34 148 48 98 76 68 C89 52 108 43 128 43,
 *  and the base Q128 235. As (radius, y) in SVG units, top pole first, bottom pole last. */
function nonProfile() {
  const left = [[26, 201]];
  cubic([26, 201], [34, 148], [48, 98], [76, 68], 16, left);
  cubic([76, 68], [89, 52], [108, 43], [128, 43], 12, left);
  const down = left.reverse().map(([x, y]) => [128 - x, y]);        // top (0,43) .. rim (102,201)
  // the base: half of Q (26,201)(128,235)(230,201), from the rim to the centre
  for (let s = 1; s <= 8; s++) {
    const t = s / 16, u = 1 - t;
    const x = u * u * 26 + 2 * u * t * 128 + t * t * 230, y = u * u * 201 + 2 * u * t * 235 + t * t * 201;
    down.push([Math.max(0, 128 - x), y]);
  }
  return down;
}

/** A lathe with one vertex at each pole, so the normals there come out round. */
function lathe(THREE, profile, seg, unit, cy, zs) {
  const P = [], I = [];
  const top = profile[0], bot = profile[profile.length - 1];
  P.push(0, -(top[1] - cy) * unit, 0);
  const rings = profile.slice(1, -1);
  for (const [r, y] of rings) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      P.push(Math.sin(a) * r * unit, -(y - cy) * unit, Math.cos(a) * r * unit * zs);
    }
  }
  const botIndex = 1 + rings.length * seg;
  P.push(0, -(bot[1] - cy) * unit, 0);
  for (let j = 0; j < seg; j++) I.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg);
      const c = a + seg, d = b + seg;
      I.push(a, c, b, b, c, d);
    }
  }
  const last = 1 + (rings.length - 1) * seg;
  for (let j = 0; j < seg; j++) I.push(last + j, botIndex, last + ((j + 1) % seg));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Radius of the profile at a given SVG y (linear between samples). */
function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) {
      const t = (y - a[1]) / ((b[1] - a[1]) || 1);
      return a[0] + (b[0] - a[0]) * t;
    }
  }
  return 0;
}

/** ExtrudeGeometry is unindexed, so its normals come out faceted. Welding coincident vertices first
 *  gives the smooth, pillowy bevel (from Pragma's team3d.js). */
function weld(THREE, geo) {
  const pos = geo.getAttribute("position");
  const seen = new Map(), P = [], index = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = seen.get(key);
    if (j === undefined) { j = P.length / 3; seen.set(key, j); P.push(x, y, z); }
    index.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setIndex(index);
  out.computeVertexNormals();
  return out;
}

function roundedRect(THREE, w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function slab(THREE, shape, depth, bevel) {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 6, steps: 1,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 8,
  });
  const g = weld(THREE, raw);
  raw.dispose();
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A studio to reflect: grey walls, a big softbox overhead, a strip either side. Clearcoat with
 *  nothing to reflect reads as plastic; this gives the edges their highlight. (Pragma, team3d.js) */
function studio(THREE, renderer) {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const panel = (v, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v * 0.97, v * 0.94) }));
    m.scale.set(sx, sy, sz); m.position.set(x, y, z); scene.add(m);
  };
  const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.54, 0.53, 0.52), side: THREE.BackSide }));
  room.scale.set(24, 16, 24);
  scene.add(room);
  panel(0.16, 24, 0.2, 24, 0, -7.9, 0);
  panel(7.5, 12, 0.2, 7, 0, 7.8, 2);
  panel(3.2, 0.2, 6, 9, -11.8, 1.5, 3);
  panel(1.6, 0.2, 5, 7, 11.8, 0.5, -1);
  panel(1.3, 8, 3, 0.2, 0, 2, 11.8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  box.dispose();
  return env;
}

const mat = (THREE, color, o = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, transparent: true, ...o,
});

/* ── Non ─────────────────────────────────────────────────────────────────── */
function buildNon(THREE) {
  const U = 1 / 244;           // one SVG unit; the ring's outer width is 1
  const CY = 140;              // the SVG y that sits at the origin
  const ZS = 0.9;              // a touch flatter front to back, like the poses
  const prof = nonProfile();
  const body = mat(THREE, COL.body, { roughness: 0.58, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const orange = mat(THREE, COL.orange, { roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const white = mat(THREE, COL.white, { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  const cheek = mat(THREE, COL.cheek, { roughness: 0.7, clearcoat: 0 });
  const mats = [body, orange, white, cheek];

  const pivot = new THREE.Group();
  const bodyMesh = new THREE.Mesh(lathe(THREE, prof, 56, U, CY, ZS), body);
  bodyMesh.castShadow = true;
  pivot.add(bodyMesh);

  // the ring around the base (the orange ellipse of the mark, seen as what it is)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(106 * U, 15 * U, 18, 72), orange);
  ring.rotation.x = Math.PI / 2 + 0.24;   // front edge dips: the mark's ellipse is this ring seen from a little above
  ring.scale.set(1, ZS + 0.05, 1);
  ring.position.y = -(202 - CY) * U;
  ring.castShadow = true;
  pivot.add(ring);

  // the sprout: the mark's ellipse at (156, 27), 16 x 33, turned 40 degrees
  const sprout = new THREE.Mesh(new THREE.CapsuleGeometry(16 * U, 34 * U, 8, 20), orange);
  sprout.position.set((150 - 128) * U, -(32 - CY) * U, 0);
  sprout.rotation.z = -40 * Math.PI / 180;
  sprout.scale.z = 0.55;
  sprout.castShadow = true;
  pivot.add(sprout);

  // feet and arms, from the 3D poses
  const footGeo = new THREE.CapsuleGeometry(17 * U, 12 * U, 6, 16);
  const feet = [-1, 1].map((s) => {
    const f = new THREE.Mesh(footGeo, body);
    f.rotation.z = Math.PI / 2;
    f.position.set(s * 40 * U, -(226 - CY) * U, 10 * U);
    f.scale.set(0.8, 1, 1.05);
    f.castShadow = true;
    pivot.add(f);
    return f;
  });
  const armGeo = new THREE.CapsuleGeometry(13 * U, 26 * U, 6, 16);
  armGeo.translate(0, -19 * U, 0);       // pivot at the shoulder
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 86 * U, -(158 - CY) * U, 8 * U);
    const a = new THREE.Mesh(armGeo, body);
    a.castShadow = true;
    shoulder.add(a);
    shoulder.rotation.z = s * 0.55;
    pivot.add(shoulder);
    return { shoulder, s, base: s * 0.55 };
  });

  // the face sits on the surface of the body
  const onSurface = (x, y, out = 0) => {
    const dx = (x - 128), r = radiusAt(prof, y);
    const z = Math.sqrt(Math.max(0, r * r - dx * dx)) * ZS;
    return { p: [dx * U, -(y - CY) * U, (z + out) * U], yaw: Math.atan2(dx, z || 1) };
  };
  const face = new THREE.Group();
  const openGeo = new THREE.CapsuleGeometry(11 * U, 22 * U, 6, 18);
  const shutGeo = new THREE.TorusGeometry(12 * U, 3.6 * U, 8, 18, Math.PI);
  const eyes = [93, 165].map((ex) => {
    const at = onSurface(ex, 139, 1);
    const g = new THREE.Group();
    g.position.set(...at.p);
    g.rotation.y = at.yaw * 0.9;
    const open = new THREE.Mesh(openGeo, white);
    open.scale.z = 0.38;
    const shut = new THREE.Mesh(shutGeo, white);
    shut.scale.z = 0.5;
    shut.position.y = -4 * U;
    shut.visible = false;
    g.add(open, shut);
    face.add(g);
    return { g, open, shut };
  });
  const smileAt = onSurface(128, 177, 1);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(10.5 * U, 3 * U, 8, 20, Math.PI), white);
  smile.position.set(...smileAt.p);
  smile.rotation.set(-0.28, 0, Math.PI);
  smile.scale.z = 0.6;
  face.add(smile);
  [62, 194].forEach((cx) => {
    const at = onSurface(cx, 168, 0.4);
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(9 * U, 6 * U, 4, 12), cheek);
    c.rotation.z = Math.PI / 2;
    c.position.set(...at.p);
    c.rotation.y = at.yaw;
    c.scale.set(1, 1, 0.25);
    face.add(c);
  });
  pivot.add(face);
  return { pivot, mats, eyes, faceGroup: face, arms, feet, picks: [bodyMesh, ring, sprout] };
}

/* ── your files ─────────────────────────────────────────────────────────── */
function buildFile(THREE, kind) {
  const pivot = new THREE.Group();
  const mats = [];
  const M = (c, o) => { const m = mat(THREE, c, o); mats.push(m); return m; };
  const W = 0.78, H = 1, D = 0.05, B = 0.035;
  const front = D / 2 + B + 0.004;
  const bar = (m, w, h, x, y) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), m);
    b.position.set(x, y, front);
    pivot.add(b);
    return b;
  };
  let picks = [];
  if (kind === "folder") {
    const s = new THREE.Shape();
    const w = 1.05, h = 0.8, r = 0.07, x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + w * 0.46, y + h); s.lineTo(x + w * 0.38, y + h + 0.12);
    s.lineTo(x + r, y + h + 0.12); s.quadraticCurveTo(x, y + h + 0.12, x, y + h + 0.12 - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const back = new THREE.Mesh(slab(THREE, s, D, B), M(COL.orange, { roughness: 0.4, clearcoat: 0.7 }));
    back.position.z = -0.05;
    const paper = new THREE.Mesh(slab(THREE, roundedRect(THREE, 0.86, 0.7, 0.05), 0.02, 0.012), M(COL.paper));
    paper.position.set(0.02, 0.1, 0.02);
    paper.rotation.z = -0.04;
    const lid = new THREE.Mesh(slab(THREE, roundedRect(THREE, 1.05, 0.66, 0.07), D, B), M(0xff9a5c, { roughness: 0.4, clearcoat: 0.7 }));
    lid.position.set(0, -0.08, 0.07);
    pivot.add(back, paper, lid);
    picks = [back, lid, paper];
    pivot.children.forEach((c) => { c.castShadow = true; });
    return { pivot, mats, picks };
  }
  const pageCol = kind === "reading" ? COL.ink : COL.paper;
  const page = new THREE.Mesh(slab(THREE, roundedRect(THREE, W, H, 0.07), D, B), M(pageCol, kind === "reading" ? { roughness: 0.5, clearcoat: 0.5 } : {}));
  page.castShadow = true;
  pivot.add(page);
  picks = [page];
  const orange = M(COL.orange, { roughness: 0.45 });
  const line = M(kind === "reading" ? 0x5a5a5a : COL.line, { roughness: 0.7, clearcoat: 0 });
  const ink = M(COL.ink, { roughness: 0.5 });
  if (kind === "sheet") {
    bar(orange, 0.6, 0.1, 0, 0.36);
    const cw = 0.17, ch = 0.075;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        const odd = r === 2 && c === 2;         // the row that does not match
        bar(odd ? orange : line, cw, ch, (c - 1) * (cw + 0.03), 0.2 - r * (ch + 0.04));
      }
    }
  } else if (kind === "notes") {
    bar(ink, 0.44, 0.08, -0.08, 0.36);
    [0.5, 0.56, 0.42, 0.52, 0.36].forEach((w, i) => {
      const y = 0.18 - i * 0.12;
      bar(orange, 0.05, 0.05, -0.27, y);
      bar(line, w, 0.045, -0.2 + w / 2, y);
    });
  } else {
    bar(orange, 0.5, 0.09, -0.04, 0.36);
    [0.56, 0.5, 0.56, 0.3].forEach((w, i) => bar(line, w, 0.045, -0.28 + w / 2, 0.18 - i * 0.1));
    bar(orange, 0.12, 0.12, -0.22, -0.3);
    bar(M(0x8a8a8a, { roughness: 0.7, clearcoat: 0 }), 0.3, 0.045, 0.02, -0.3);
  }
  return { pivot, mats, picks };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * @param stage    element the canvas fills
 * @param surface  element that receives the pointer (it can be bigger than the stage)
 * @param layout   'wide' | 'compact'
 * @param target   () => { files: Element, non: Element } the window parts a flight lands on
 * @param onReady  called once the first frame is drawn
 */
export async function startStage({ stage, surface = stage, layout = "wide", target = null, onReady = null }) {
  let THREE;
  try {
    THREE = await import("/vendor/three.min.js");
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "stage3d__gl";
  canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  stage.appendChild(canvas);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.environment = studio(THREE, renderer);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 80);
  camera.position.set(0, 0, CAMZ);

  const key = new THREE.DirectionalLight(0xfff6ee, 1.4);
  key.position.set(-3, 6, 20);
  key.target.position.set(0, 0, BACK);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 16;
  key.shadow.blurSamples = 20;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { near: 1, far: 60 });
  scene.add(key, key.target);

  const catcherMat = new THREE.ShadowMaterial({ color: 0x1a1210, opacity: 0.14, transparent: true });
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catcherMat);
  catcher.position.z = BACK;
  catcher.receiveShadow = true;
  scene.add(catcher);

  const cast = CAST.map((c, i) => {
    const built = c.kind === "non" ? buildNon(THREE) : buildFile(THREE, c.kind);
    const root = new THREE.Group();
    root.add(built.pivot);
    scene.add(root);
    for (const p of built.picks) p.userData.toy = c.key;
    return {
      ...c, ...built, i, root,
      p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, size0: c.size, size: 100, r: 40,
      home: { x: 0, y: 0 }, placed: false,
      held: false, grab: { x: 0, y: 0 }, tracker: new Tracker(8), downAt: 0, downPos: { x: 0, y: 0 },
      sinceRelease: 99,
      lookX: new Spring(0, { response: 0.5 }), lookY: new Spring(0, { response: 0.5 }),
      lid: new Spring(1, { response: 0.08 }),
      hop: new Spring(0, { response: 0.36, damping: 0.4 }),
      spin: new Spring(0, { response: 0.8, damping: 0.72 }),
      lift: new Spring(0, { response: 0.3 }),
      pop: new Spring(0, { response: 0.62, damping: 0.55 }),
      zs: new Spring(c.z, { response: 0.4 }),
      wave: new Spring(0, { response: 0.35, damping: 0.5 }), waveUntil: 0,
      face: "plain", faceWant: "plain", faceUntil: 0,
      nextBlink: performance.now() + 1200 + Math.random() * 2400, blinkPhase: 0,
      nextWhim: performance.now() + 5000 + Math.random() * 8000,
      phase: Math.random() * Math.PI * 2,
      tilt: (i % 2 ? -1 : 1) * (0.12 + i * 0.03),
      opacity: 1,
    };
  });
  const non = cast[0];
  const pickable = cast.flatMap((m) => m.picks);
  const byKey = Object.fromEntries(cast.map((m) => [m.key, m]));

  /* ── sizing ───────────────────────────────────────────────────────────── */
  let W = 1, H = 1, base = 100, lowered = false;
  const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const visH = (z) => 2 * (CAMZ - z) * TAN;
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    renderer.setPixelRatio(lowered ? 1 : Math.min(window.devicePixelRatio || 1, W < 700 ? 1.75 : 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const ch = visH(BACK) * 1.3;
    catcher.scale.set(ch * camera.aspect, ch, 1);
    const sc = key.shadow.camera;
    Object.assign(sc, { left: -ch * camera.aspect * 0.6, right: ch * camera.aspect * 0.6, top: ch * 0.6, bottom: -ch * 0.6 });
    sc.updateProjectionMatrix();
    base = layout === "wide" ? Math.min(W * 0.27, H * 0.5) : Math.min(W * 0.5, H * 0.56);
    const pad = 8;
    Object.assign(bounds, { minX: pad, maxX: W - pad, minY: layout === "wide" ? 76 : pad, maxY: H - pad });
    for (const m of cast) {
      m.size = base * m.size0;
      m.r = m.size * (m.kind === "non" ? 0.44 : 0.48);
      const [hx, hy] = m[layout];
      m.home.x = hx * W; m.home.y = hy * H;
      if (!m.placed) { m.p.x = m.home.x; m.p.y = m.home.y; m.placed = true; }
    }
  }
  resize();
  new ResizeObserver(resize).observe(stage);

  /* ── faces (Non only) ─────────────────────────────────────────────────── */
  function setFace(m, f, holdMs = 0) {
    if (m.kind !== "non") return;
    m.faceWant = f;
    m.faceUntil = holdMs ? performance.now() + holdMs : 0;
    // the swap hides inside a blink
    if (f !== m.face) { m.lid.set(0.05); m.blinkPhase = 2; m.nextBlink = performance.now() + 70; }
  }
  function applyFace(m) {
    m.face = m.faceWant;
    const happy = m.face === "happy";
    const big = m.face === "surprised" ? 1.25 : 1;
    for (const e of m.eyes) {
      e.open.visible = !happy;
      e.shut.visible = happy;
      e.open.scale.x = e.open.scale.y = big;
    }
  }
  function wave(m, ms = 1300) { if (m.kind === "non" && !REDUCED.matches) m.waveUntil = performance.now() + ms; }
  function boop(m, force = 1) {
    if (REDUCED.matches) return;
    m.hop.kick(-900 * force);
    m.spin.set(m.spin.target + Math.PI * 2);
    setFace(m, "happy", 1500);
    wave(m);
  }
  function startle(m, force) {
    if (REDUCED.matches || m.held) return;
    m.hop.kick(-Math.min(700, force * 0.5));
    setFace(m, "surprised", 900);
  }

  /* ── pointer ──────────────────────────────────────────────────────────── */
  const pointer = { x: -1, y: -1, known: false };
  let stageRect = stage.getBoundingClientRect();
  let fly = 0, hovered = null, dragging = null;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const local = (e) => ({ x: e.clientX - stageRect.left, y: e.clientY - stageRect.top });
  function pick(pt) {
    if (fly > 0.02) return null;
    ndc.set((pt.x / W) * 2 - 1, -(pt.y / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickable, false);
    return hits.length ? byKey[hits[0].object.userData.toy] : null;
  }
  addEventListener("pointermove", (e) => {
    const pt = local(e);
    pointer.x = pt.x; pointer.y = pt.y; pointer.known = true;
  }, { passive: true });

  surface.addEventListener("pointermove", (e) => {
    if (dragging) {
      const pt = local(e);
      const r = dragging.r * 0.9;
      const inner = { minX: bounds.minX + r, maxX: bounds.maxX - r, minY: bounds.minY + r, maxY: bounds.maxY - r };
      const at = dragPosition(pt, dragging.grab, inner, { w: W, h: H });
      dragging.p.x = at.x; dragging.p.y = at.y;
      dragging.tracker.push(e.clientX, e.clientY, e.timeStamp);
      return;
    }
    if (e.pointerType !== "mouse") return;
    const hit = pick(local(e));
    if (hit !== hovered) {
      hovered = hit;
      surface.classList.toggle("is-grabbable", Boolean(hit));
      if (hit && !REDUCED.matches) { hit.hop.kick(-420); setFace(hit, "happy", 900); if (hit === non) wave(non, 900); }
    }
  });
  surface.addEventListener("pointerdown", (e) => {
    // links and buttons in the copy win over anything floating behind them
    if (e.target.closest && e.target.closest("a, button, input, label, summary")) return;
    const pt = local(e);
    const m = pick(pt);
    if (!m) return;
    m.downAt = e.timeStamp; m.downPos = pt;
    // A finger on a phone is scrolling as often as it is reaching for a toy; touch gets a tap.
    if (e.pointerType === "touch") { m.tapCandidate = true; return; }
    e.preventDefault();
    if (surface.setPointerCapture) surface.setPointerCapture(e.pointerId);
    dragging = m;
    m.held = true;
    m.v.x = m.v.y = 0;
    m.grab = { x: pt.x - m.p.x, y: pt.y - m.p.y };
    m.tracker.reset();
    m.tracker.push(e.clientX, e.clientY, e.timeStamp);
    m.lift.set(1);
    m.zs.set(2.2);
    setFace(m, "happy");
    if (m !== non) setFace(non, "surprised", 700);
    document.documentElement.classList.add("is-grabbing");
  });
  const release = (e) => {
    for (const m of cast) {
      if (m.tapCandidate && e.type === "pointerup") {
        const pt = local(e);
        if (Math.hypot(pt.x - m.downPos.x, pt.y - m.downPos.y) < 10) boop(m, 1);
      }
      m.tapCandidate = false;
    }
    const m = dragging;
    if (!m) return;
    dragging = null;
    m.held = false;
    m.lift.set(0);
    m.zs.set(m.z);
    document.documentElement.classList.remove("is-grabbing");
    const pt = local(e);
    const moved = Math.hypot(pt.x - m.downPos.x, pt.y - m.downPos.y);
    if (moved < 6 && e.timeStamp - m.downAt < 320) { boop(m); m.sinceRelease = 0.6; return; }
    const v = REDUCED.matches ? { x: 0, y: 0 } : m.tracker.velocity();
    const speed = Math.hypot(v.x, v.y);
    const cap = Math.min(1, 3200 / (speed || 1));
    m.v.x = v.x * cap; m.v.y = v.y * cap;
    m.sinceRelease = 0;
    setFace(m, speed > 1400 ? "surprised" : "plain", speed > 1400 ? 1100 : 0);
  };
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);

  /* ── physics, in stage pixels (Pragma's constants) ────────────────────── */
  const K = (2 * Math.PI / 1.7) ** 2, C = 2 * 0.8 * (2 * Math.PI / 1.7);
  function physics(dt) {
    const steps = 2, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const m of cast) {
        if (m.held) continue;
        m.sinceRelease += h;
        // thrown things fly first and go home after, or it would feel like elastic
        const pull = REDUCED.matches ? 1 : clamp((m.sinceRelease - 0.9) / 1.4, 0, 1);
        const ax = pull * (K * (m.home.x - m.p.x) - C * m.v.x);
        const ay = pull * (K * (m.home.y - m.p.y) - C * m.v.y);
        const drag = Math.exp(-1.2 * h);
        m.v.x = (m.v.x + ax * h) * drag;
        m.v.y = (m.v.y + ay * h) * drag;
        m.p.x += m.v.x * h;
        m.p.y += m.v.y * h;
        const r = m.r * 0.9;
        if (m.p.x < bounds.minX + r) { m.p.x = bounds.minX + r; if (m.v.x < 0) { if (m.v.x < -500) startle(m, -m.v.x); m.v.x *= -0.55; } }
        if (m.p.x > bounds.maxX - r) { m.p.x = bounds.maxX - r; if (m.v.x > 0) { if (m.v.x > 500) startle(m, m.v.x); m.v.x *= -0.55; } }
        if (m.p.y < bounds.minY + r) { m.p.y = bounds.minY + r; if (m.v.y < 0) { if (m.v.y < -500) startle(m, -m.v.y); m.v.y *= -0.55; } }
        if (m.p.y > bounds.maxY - r) { m.p.y = bounds.maxY - r; if (m.v.y > 0) { if (m.v.y > 500) startle(m, m.v.y); m.v.y *= -0.55; } }
      }
      // round enough to be circles; a held one pushes and is never pushed
      for (let a = 0; a < cast.length; a++) {
        for (let b = a + 1; b < cast.length; b++) {
          const A = cast[a], B = cast[b];
          const dx = B.p.x - A.p.x, dy = B.p.y - A.p.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const min = A.r + B.r;
          if (d >= min) continue;
          const nx = dx / d, ny = dy / d, over = min - d;
          const wa = A.held ? 0 : B.held ? 1 : 0.5, wb = 1 - wa;
          A.p.x -= nx * over * wa; A.p.y -= ny * over * wa;
          B.p.x += nx * over * wb; B.p.y += ny * over * wb;
          const rv = (B.v.x - A.v.x) * nx + (B.v.y - A.v.y) * ny;
          if (rv < 0) {
            const j = -(1.6 * rv) / 2;
            if (!A.held) { A.v.x -= j * nx * (B.held ? 2 : 1); A.v.y -= j * ny * (B.held ? 2 : 1); }
            if (!B.held) { B.v.x += j * nx * (A.held ? 2 : 1); B.v.y += j * ny * (A.held ? 2 : 1); }
            if (-rv > 380) { startle(A, -rv); startle(B, -rv); A.sinceRelease = Math.min(A.sinceRelease, 0.3); B.sinceRelease = Math.min(B.sinceRelease, 0.3); }
          }
        }
      }
    }
  }

  /* ── frame ────────────────────────────────────────────────────────────── */
  let visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: "60px" }).observe(stage);
  }
  let started = 0, clearedAtFull = false, frames = 0, spent = 0, readySent = false;
  // Measured, not guessed: a machine that cannot hold ~40fps drops to 1x pixels and a coarser shadow.
  const budget = (dt) => {
    if (lowered || fly > 0.02) return;
    frames++; spent += dt;
    if (frames < 60) return;
    if (spent / frames > 1 / 40) {
      lowered = true;
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      key.shadow.mapSize.set(512, 512);
      if (key.shadow.map) key.shadow.map.dispose();
      key.shadow.map = null;
    }
    frames = 0; spent = 0;
  };
  const setOpacity = (m, o) => {
    if (Math.abs(m.opacity - o) < 0.001) return;
    m.opacity = o;
    for (const mt of m.mats) { mt.opacity = o; mt.depthWrite = o > 0.6; }
    m.root.visible = o > 0.01;
  };

  onTick((dt, now) => {
    if (!visible || !W) return;
    const seats = target ? target() : null;
    if (fly >= 1) {
      // Everything has landed; one clear frame, then nothing until a scroll brings them back.
      if (!clearedAtFull) {
        for (const m of cast) setOpacity(m, 0);
        if (seats && seats.non) seats.non.style.opacity = "1";
        renderer.render(scene, camera);
        clearedAtFull = true;
      }
      return;
    }
    clearedAtFull = false;
    if (!started) {
      started = now;
      cast.forEach((m, i) => {
        // Non takes over from the flat picture at full size in the very first frame, so there is never
        // a moment with no Non (or two); only the files pop in.
        if (REDUCED.matches || m === non) m.pop.jump(1);
        if (m === non && !REDUCED.matches) { setFace(non, "happy", 1400); wave(non, 1600); }
        if (REDUCED.matches || m === non) return;
        setTimeout(() => m.pop.set(1), 160 + i * 110);
      });
    }
    stageRect = stage.getBoundingClientRect();
    budget(dt);
    const t = now / 1000;
    if (fly < 0.02) physics(dt);

    let filesRect = null, nonRect = null;
    if (fly > 0 && seats) {
      if (seats.files) filesRect = seats.files.getBoundingClientRect();
      if (seats.non) nonRect = seats.non.getBoundingClientRect();
    }

    for (const m of cast) {
      if (m.kind === "non") {
        if (now > m.nextBlink) {
          if (m.blinkPhase === 0) { m.lid.set(0.05); m.blinkPhase = 1; m.nextBlink = now + 85; }
          else {
            if (m.faceWant !== m.face) applyFace(m);
            m.lid.set(1);
            m.blinkPhase = 0;
            m.nextBlink = now + (Math.random() < 0.2 ? 180 : 2200 + Math.random() * 4800);
          }
        }
        if (m.faceUntil && now > m.faceUntil && !m.held) { m.faceUntil = 0; setFace(m, "plain"); }
      }
      // now and then something moves on its own, so an idle hero still looks inhabited
      if (!REDUCED.matches && fly < 0.02 && now > m.nextWhim && !dragging) {
        m.nextWhim = now + 7000 + Math.random() * 9000;
        if (Math.random() < 0.5) boop(m, 0.6); else { m.hop.kick(-500); setFace(m, "happy", 1200); if (m === non) wave(non); }
      }

      const dx = pointer.known ? pointer.x - m.p.x : -W * 0.3;
      const dy = pointer.known ? pointer.y - m.p.y : -H * 0.05;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(dist / 420, 1);
      m.lookX.set((dx / dist) * reach);
      m.lookY.set((dy / dist) * reach);
      const lx = m.lookX.step(dt), ly = m.lookY.step(dt);

      // the flight: files into the window's content, Non onto the window's title mark
      const f = clamp((fly - m.i * 0.06) / 0.72, 0, 1);
      const e = ease(f);
      let x = m.p.x, y = m.p.y, size = m.size, landed = 0;
      const rect = m.kind === "non" ? nonRect : filesRect;
      if (f > 0 && rect) {
        const tx = rect.left - stageRect.left + rect.width / 2 + (m.kind === "non" ? 0 : (m.i - 2.5) * rect.width * 0.08);
        const ty = rect.top - stageRect.top + rect.height * (m.kind === "non" ? 0.5 : 0.42);
        const endSize = m.kind === "non" ? rect.height * 1.25 : size * 0.18;
        x += (tx - x) * e;
        y += (ty - y) * e - Math.sin(Math.PI * e) * H * 0.12;   // an arc, not a slide
        size += (endSize - size) * e;
        landed = clamp((f - 0.82) / 0.18, 0, 1);
      }
      if (m === non && seats && seats.non) seats.non.style.opacity = landed.toFixed(3);
      setOpacity(m, 1 - landed);
      if (m.opacity <= 0.01) continue;

      const pop = clamp(m.pop.step(dt), 0, 1.3);
      const hop = m.hop.step(dt);
      const lift = m.lift.step(dt);
      const idle = REDUCED.matches ? 0 : 1 - f;
      const bob = Math.sin(t * 1.35 + m.phase) * 7 * idle;
      const z = m.zs.step(dt) * (1 - e);
      const k = visH(z) / H;
      m.root.position.set((x - W / 2) * k, -(y + bob + hop * (1 - e) - H / 2) * k, z);
      m.root.scale.setScalar(Math.max(0.0001, size * k * pop * (1 + lift * 0.06)));

      const speed = Math.hypot(m.v.x, m.v.y);
      const lean = clamp(-m.v.x / 5000, -0.2, 0.2);
      const spin = m.spin.step(dt);
      const sway = Math.sin(t * 0.55 + m.phase) * 0.16 * idle;
      const isNon = m.kind === "non";
      m.pivot.rotation.set(
        (ly * (isNon ? 0.3 : 0.4) + Math.sin(t * 0.8 + m.phase) * 0.04 * idle) * (1 - e),
        (lx * (isNon ? 0.5 : 0.6) + sway) * (1 - e) + spin + Math.sin(Math.PI * e) * 0.9,
        (lean + (isNon ? 0 : m.tilt) + Math.sin(t * 0.7 + m.phase * 2) * 0.035 * idle) * (1 - e),
      );
      const sq = clamp(m.hop.vel / 5200, -0.12, 0.12) + clamp(speed / 30000, 0, 0.06);
      m.pivot.scale.set(1 + sq, 1 - sq, 1);

      if (isNon) {
        const lid = clamp(m.lid.step(dt), 0.05, 1);
        m.faceGroup.position.set(lx * 0.03 * (1 - e), -ly * 0.024 * (1 - e), 0);
        for (const eye of m.eyes) eye.g.scale.y = lid;
        // the right arm waves (Non's own "wave" pose); both arms lift a little when held
        const waving = now < m.waveUntil;
        m.wave.set(waving ? 1 : 0);
        const wv = m.wave.step(dt);
        const flap = waving ? Math.sin(t * 15) * 0.35 : 0;
        const right = m.arms[1], left = m.arms[0];
        right.shoulder.rotation.z = right.base + wv * (2.1 + flap) + lift * 0.4;
        left.shoulder.rotation.z = left.base - lift * 0.4 - Math.sin(t * 1.35 + m.phase) * 0.05 * idle;
      }
    }

    catcherMat.opacity = 0.14 * (1 - clamp(fly * 1.6, 0, 1));
    renderer.render(scene, camera);
    if (!readySent) { readySent = true; if (onReady) onReady(); }
  });

  return {
    /** 0 = everything in the playground, 1 = everything landed in the app window. */
    setFly(v) { fly = clamp(v, 0, 1); },
    /** a hop and a wave, for when the page wants Non's attention */
    greet() { boop(non, 0.7); },
  };
}
