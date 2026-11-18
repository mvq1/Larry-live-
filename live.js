import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Life-size world: one tile is 6 m, so a 1.8 m person is 0.3 tiles tall.
const METERS_PER_TILE = 6;
const HUMAN_SCALE = 1 / METERS_PER_TILE; // world units per meter for people and animals
const LARRY_GLB_URL = new URL("larry.glb", import.meta.url).href;

const canvas = document.getElementById("view");
const $ = (id) => document.getElementById(id);

const TERRAIN_H = { w: 0.1, n: 0.24, s: 0.3, p: 0.42, f: 0.5, c: 0.78, r: 0.4, t: 0.42, k: 0.32 };
const TERRAIN_COLOR = { w: 0x2a6f8f, n: 0x4ec3c9, s: 0xc9b57a, p: 0x9db36a, f: 0x3d6b3a, c: 0x6b5b4a, r: 0x8a8070, t: 0x7f9466, k: 0x8a6a44 };
const BIOME_COLOR = {
  h: 0x3b8aa3, d: 0x1a4a66, m: 0xa8c46e, c: 0xc9b57a,
  w: 0x2f5530, g: 0x4a7a3e, a: 0xb3b86a, i: 0x8a8a62, n: 0x4ec3c9,
};
const NAMED = {
  black: 0x1e1c1c, white: 0xece8e0, gray: 0x807c78, grey: 0x807c78,
  brown: 0x5c3a24, tan: 0xc49c6e, beige: 0xd2be96, red: 0xaa322e,
  orange: 0xc86e32, rust: 0xb45c30, yellow: 0xdcbe46, gold: 0xc8a03c,
  green: 0x326e37, olive: 0x5a6e32, teal: 0x287878, blue: 0x325096,
  navy: 0x1e2850, purple: 0x5a3278, pink: 0xc8788c, cream: 0xecdcbd,
  auburn: 0x6e321e, blonde: 0xd2b46e, blond: 0xd2b46e, chestnut: 0x483020,
  silver: 0xb4b8bc, "dark brown": 0x322016,
};

function parseColor(value, fallback) {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value) && value.length >= 3) return (value[0] << 16) | (value[1] << 8) | value[2];
  if (typeof value === "number") return value;
  const s = String(value).trim().toLowerCase();
  if (NAMED[s] != null) return NAMED[s];
  let hex = s.startsWith("#") ? s.slice(1) : s;
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16);
  return fallback;
}
function hash01(x, y, salt = 0) {
  let n = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  n = Math.sin(n) * 43758.5453;
  return n - Math.floor(n);
}
const tileHeight = (code) => TERRAIN_H[code] ?? 0.42;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8fb4c8, 0.018);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.02, 220);
camera.position.set(4, 8, 16);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 52;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minPolarAngle = 0.18;
controls.enablePan = false;
controls.target.set(20, 1, 20);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a2a18, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 3;
sun.shadow.blurSamples = 12;
scene.add(sun);
scene.add(sun.target);

const skyUniforms = {
  topColor: { value: new THREE.Color(0x87b5d8) },
  horizonColor: { value: new THREE.Color(0xd7e6f2) },
  bottomColor: { value: new THREE.Color(0x9ec0d6) },
  sunColor: { value: new THREE.Color(0xfff0d0) },
  sunDir: { value: new THREE.Vector3(0.2, 1, 0.2).normalize() },
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: skyUniforms,
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    uniform vec3 sunColor;
    uniform vec3 sunDir;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
      col = mix(bottomColor, col, smoothstep(-0.15, 0.08, h));
      float sun = pow(max(0.0, dot(d, normalize(sunDir))), 24.0);
      col += sunColor * sun * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), skyMat);
scene.add(skyDome);
const moon = new THREE.DirectionalLight(0x9bb4d8, 0);
scene.add(moon);
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(ambient);

const starsGeo = new THREE.BufferGeometry();
{
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.7);
    const r = 75;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) + 6;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starsGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
}
const stars = new THREE.Points(
  starsGeo,
  new THREE.PointsMaterial({ color: 0xf4f1e8, size: 0.18, transparent: true, opacity: 0, depthWrite: false })
);
scene.add(stars);

const worldGroup = new THREE.Group();
scene.add(worldGroup);
const faunaGroup = new THREE.Group();
scene.add(faunaGroup);

let mapState = null;
let fireLights = [];
let rain = null;
let follow = true;
let lastMapHash = null;
let snap = null;
let tickAt = performance.now();
let secondsPerHour = 6;

const larryState = { x: 20, z: 20, y: 0.5, tx: 20, tz: 20, pose: "stand", facing: 0, tfacing: 0 };
let larryRig = null;

function heightAt(x, z) {
  if (!mapState) return 0.42;
  const ix = clamp(Math.floor(x), 0, mapState.width - 1);
  const iz = clamp(Math.floor(z), 0, mapState.height - 1);
  return tileHeight((mapState.terrain[iz] || "")[ix] || "p");
}

function clearGroup(g) {
  const keep = g;
  g.traverse((obj) => {
    if (obj === keep) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
  while (g.children.length) g.remove(g.children[0]);
}

function colorFor(x, z, tcode, bcode) {
  let base = TERRAIN_COLOR[tcode] || 0x9db36a;
  if (tcode === "w" || tcode === "n" || BIOME_COLOR[bcode]) {
    if (tcode === "w" || tcode === "n") base = BIOME_COLOR[bcode] || TERRAIN_COLOR[tcode];
    else if (bcode && BIOME_COLOR[bcode] && tcode !== "s" && tcode !== "c") base = BIOME_COLOR[bcode];
  }
  const c = new THREE.Color(base);
  c.offsetHSL(0, 0, (hash01(x, z, 7) - 0.5) * 0.08);
  return c;
}

function buildMap(map) {
  clearGroup(worldGroup);
  fireLights = [];
  mapState = map;
  const w = map.width, h = map.height;
  const landIdx = [], waterIdx = [];
  for (let z = 0; z < h; z++) {
    const row = map.terrain[z] || "";
    for (let x = 0; x < w; x++) {
      const t = row[x] || "p";
      (t === "w" || t === "n" ? waterIdx : landIdx).push([x, z, t]);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const land = new THREE.InstancedMesh(
    box,
    new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0.02 }),
    Math.max(landIdx.length, 1)
  );
  land.castShadow = true;
  land.receiveShadow = true;
  landIdx.forEach(([x, z, t], i) => {
    const b = (map.biome[z] || "")[x] || ".";
    const ht = tileHeight(t);
    dummy.position.set(x + 0.5, ht / 2, z + 0.5);
    dummy.scale.set(1.01, ht, 1.01);
    dummy.updateMatrix();
    land.setMatrixAt(i, dummy.matrix);
    land.setColorAt(i, colorFor(x, z, t, b));
  });
  land.instanceMatrix.needsUpdate = true;
  if (land.instanceColor) land.instanceColor.needsUpdate = true;
  worldGroup.add(land);

  const water = new THREE.InstancedMesh(
    box,
    new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.22, transparent: true, opacity: 0.88 }),
    Math.max(waterIdx.length, 1)
  );
  water.receiveShadow = true;
  waterIdx.forEach(([x, z, t], i) => {
    const b = (map.biome[z] || "")[x] || "d";
    const ht = tileHeight(t);
    dummy.position.set(x + 0.5, ht / 2, z + 0.5);
    dummy.scale.set(1.01, ht, 1.01);
    dummy.updateMatrix();
    water.setMatrixAt(i, dummy.matrix);
    water.setColorAt(i, colorFor(x, z, t, b));
  });
  water.instanceMatrix.needsUpdate = true;
  if (water.instanceColor) water.instanceColor.needsUpdate = true;
  worldGroup.add(water);

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(w + 48, 0.4, h + 48),
    new THREE.MeshStandardMaterial({ color: 0x0d2a38, roughness: 1 })
  );
  bed.position.set(w / 2, -0.3, h / 2);
  bed.receiveShadow = true;
  worldGroup.add(bed);

  buildTrees(map);
  buildBushes(map);
  buildRocks(map);
  buildStructures(map);
  lastMapHash = map.hash;
}

function buildTrees(map) {
  const trees = map.trees || [];
  if (!trees.length) return;
  const items = [];
  for (const [x, z, wood] of trees) {
    const n = wood >= 6 ? 3 : wood >= 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const ox = (hash01(x, z, 11 + i) - 0.5) * 0.7;
      const oz = (hash01(x, z, 29 + i) - 0.5) * 0.7;
      const s = 0.75 + hash01(x, z, 41 + i) * 0.55;
      items.push({ x: x + 0.5 + ox, z: z + 0.5 + oz, s, y: heightAt(x + 0.5 + ox, z + 0.5 + oz) });
    }
  }
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }),
    items.length
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.42, 1.15, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.85 }),
    items.length
  );
  trunks.castShadow = leaves.castShadow = true;
  trunks.receiveShadow = leaves.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const leafColor = new THREE.Color();
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y + 0.35 * it.s, it.z);
    dummy.scale.setScalar(it.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = it.y + 1.2 * it.s;
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    leafColor.setHSL(0.28 + hash01(it.x, it.z, 3) * 0.06, 0.45, 0.28 + hash01(it.x, it.z, 5) * 0.1);
    leaves.setColorAt(i, leafColor);
  });
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  worldGroup.add(trunks, leaves);
}

function buildBushes(map) {
  const berries = map.berries || [];
  if (!berries.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    berries.length * 2
  );
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let i = 0;
  for (const [x, z, amt] of berries) {
    const y = heightAt(x + 0.5, z + 0.5);
    for (let k = 0; k < 2; k++, i++) {
      dummy.position.set(
        x + 0.3 + k * 0.4 + (hash01(x, z, k) - 0.5) * 0.15,
        y + 0.16,
        z + 0.35 + (hash01(x, z, k + 4) - 0.5) * 0.3
      );
      dummy.scale.setScalar(0.7 + hash01(x, z, 20 + k) * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.set(k === 1 && amt >= 2 ? 0xb03a4e : amt >= 2 ? 0x8a2a4a : 0x3d6a34);
      mesh.setColorAt(i, col);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  worldGroup.add(mesh);
}

function buildRocks(map) {
  const stones = map.stones || [];
  if (!stones.length) return;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.95 }),
    stones.length
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  stones.forEach(([x, z, amt], i) => {
    dummy.position.set(
      x + 0.3 + hash01(x, z, 1) * 0.4,
      heightAt(x + 0.5, z + 0.5) + 0.1,
      z + 0.3 + hash01(x, z, 2) * 0.4
    );
    const s = 0.7 + Math.min(amt, 4) * 0.15;
    dummy.scale.set(s, s * 0.7, s * 0.8);
    dummy.rotation.set(hash01(x, z, 3), hash01(x, z, 4) * 6, 0.2);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  worldGroup.add(mesh);
}

function boxMesh(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildStructures(map) {
  for (const s of map.structures || []) {
    const y = heightAt(s.x + 0.5, s.y + 0.5);
    const g = new THREE.Group();
    g.position.set(s.x + 0.5, y, s.y + 0.5);
    const kind = s.kind;
    if (kind === "path") {
      g.add(boxMesh(0.95, 0.06, 0.95, 0xb09a72, 0, 0.04, 0));
    } else if (kind === "hut" || kind === "improved_hut") {
      const improved = kind === "improved_hut";
      const wall = improved ? 0x6b3a1a : 0x8b5a2b;
      const roofC = improved ? 0x4a2812 : 0x6b3a1a;
      const bw = improved ? 0.86 : 0.72;
      const bh = improved ? 0.62 : 0.5;
      g.add(boxMesh(bw, bh, bw, wall, 0, bh / 2, 0));
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(bw * 0.82, improved ? 0.48 : 0.4, 4),
        new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.9 })
      );
      roof.position.y = bh + (improved ? 0.22 : 0.18);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      g.add(boxMesh(0.17, 0.36, 0.04, 0x2a1a10, 0, 0.18, bw / 2 + 0.005));
      if (improved) g.add(boxMesh(0.1, 0.28, 0.1, 0x4a2812, bw * 0.25, bh + 0.28, -bw * 0.15));
    } else if (kind === "storage") {
      g.add(boxMesh(0.55, 0.42, 0.42, 0x5a4632, 0, 0.22, 0));
      g.add(boxMesh(0.6, 0.06, 0.46, 0x3d2e20, 0, 0.45, 0));
    } else if (kind === "garden") {
      g.add(boxMesh(0.9, 0.08, 0.9, 0x5a3d22, 0, 0.04, 0));
      const ready = s.garden_ready;
      for (let i = 0; i < 3; i++) {
        g.add(boxMesh(0.7, ready ? 0.16 : 0.08, 0.08, ready ? 0x4a8a3a : 0x3d6a34, 0, ready ? 0.14 : 0.1, -0.25 + i * 0.25));
      }
    } else if (kind === "lookout") {
      for (const [ox, oz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
        g.add(boxMesh(0.07, 1.15, 0.07, 0x6a5340, ox, 0.57, oz));
      }
      g.add(boxMesh(0.55, 0.07, 0.55, 0x7a6a58, 0, 1.15, 0));
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 0.28, 4),
        new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 })
      );
      cap.position.y = 1.35;
      cap.rotation.y = Math.PI / 4;
      cap.castShadow = true;
      g.add(cap);
    } else if (TOWN_BUILDINGS[kind]) {
      const [wall, roofC, bw, bh] = TOWN_BUILDINGS[kind];
      const wc = kind === "house" ? HOUSE_COLORS[(s.x * 7 + s.y * 3) % HOUSE_COLORS.length] : wall;
      const bhL = bh * 1.55; // walls 5-9 m at 6 m per tile
      g.add(boxMesh(bw, bhL, bw * 0.9, wc, 0, bhL / 2, 0));
      for (const wx of [-bw * 0.28, bw * 0.28]) {
        for (const wy of [bhL * 0.38, bhL * 0.75]) g.add(boxMesh(0.17, 0.2, 0.02, 0x9fb4c4, wx, wy, bw * 0.45 + 0.01));
      }
      const roof = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, bw * 0.62, bw * 0.95, 3, 1),
        new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.9 })
      );
      roof.rotation.z = Math.PI / 2;
      roof.rotation.x = Math.PI / 6;
      roof.scale.set(1, 1, 0.55);
      roof.position.y = bhL + 0.12;
      roof.castShadow = true;
      g.add(roof);
      g.add(boxMesh(0.17, 0.36, 0.03, 0x2a2420, 0, 0.18, bw * 0.45 + 0.01)); // ~1 x 2.1 m door
      if (kind === "chapel") g.add(boxMesh(0.2, 0.9, 0.2, wc, -bw * 0.3, bhL + 0.35, 0));
      if (kind === "market" || kind === "cafe") g.add(boxMesh(bw, 0.03, 0.3, 0xeeeee6, 0, 0.5, bw * 0.45 + 0.15));
    } else if (kind === "smoke_rack") {
      g.add(boxMesh(0.06, 0.7, 0.06, 0x4a3a2a, -0.25, 0.35, 0));
      g.add(boxMesh(0.06, 0.7, 0.06, 0x4a3a2a, 0.25, 0.35, 0));
      g.add(boxMesh(0.6, 0.04, 0.04, 0x3a2a1c, 0, 0.68, 0));
      g.add(boxMesh(0.04, 0.04, 0.4, 0x3a2a1c, -0.15, 0.58, 0));
      g.add(boxMesh(0.04, 0.04, 0.4, 0x3a2a1c, 0.15, 0.58, 0));
    }
    worldGroup.add(g);
  }
  updateFires(map.fires || []);
}

function makeFlame() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.28, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.95 })
  );
  core.position.y = 0.2;
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.38, 6),
    new THREE.MeshBasicMaterial({ color: 0xe25a20, transparent: true, opacity: 0.7 })
  );
  outer.position.y = 0.24;
  g.add(outer, core);
  const light = new THREE.PointLight(0xff8a3a, 1.6, 7, 2);
  light.position.y = 0.4;
  g.add(light);
  fireLights.push(light);
  g.userData.animateFlame = { core, outer };
  return g;
}

function updateFires(list) {
  const remove = worldGroup.children.filter((ch) => ch.userData && ch.userData.flamePit);
  remove.forEach((ch) => worldGroup.remove(ch));
  fireLights = [];
  for (const f of list || []) {
    const pit = new THREE.Group();
    pit.userData.flamePit = true;
    pit.position.set(f.x + 0.5, heightAt(f.x + 0.5, f.y + 0.5), f.y + 0.5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      pit.add(boxMesh(0.1, 0.07, 0.08, 0x6a6460, Math.cos(a) * 0.2, 0.04, Math.sin(a) * 0.2));
    }
    pit.add(makeFlame());
    worldGroup.add(pit);
  }
}

function mat(color, rough = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

function skinMat(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.48, metalness: 0.0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffc8a0),
  });
}
function clothMat(color, rough = 0.82) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0 });
}
function addShadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function capsule(r, len, cap, rad, mat) {
  return addShadow(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, cap, rad), mat));
}

function makeLarry(palette) {
  const g = new THREE.Group();
  const skin = parseColor(palette?.skin, 0xd2a882);
  const hair = parseColor(palette?.hair, 0x483020);
  const shirt = parseColor(palette?.shirt, 0xb45c30);
  const pants = parseColor(palette?.pants, 0x3e3a46);
  const bootsC = parseColor(palette?.boots, 0x32261c);
  const skinM = skinMat(skin);
  const shirtM = clothMat(shirt, 0.78);
  const pantsM = clothMat(pants, 0.88);
  const bootM = clothMat(bootsC, 0.7);
  const hairM = clothMat(hair, 0.9);
  const leatherM = clothMat(0x5a4630, 0.85);

  const hips = new THREE.Group();
  hips.position.y = 0.96;
  g.add(hips);

  const pelvis = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), pantsM));
  pelvis.scale.set(1.05, 0.72, 0.9);
  hips.add(pelvis);

  const torso = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), shirtM));
  torso.scale.set(1.05, 1.35, 0.85);
  torso.position.y = 0.28;
  hips.add(torso);

  const collar = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), clothMat(shirt, 0.85)));
  collar.scale.set(1.0, 0.45, 0.85);
  collar.position.set(0, 0.54, 0.02);
  hips.add(collar);

  const neck = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), skinM));
  neck.position.y = 0.58;
  hips.add(neck);

  const headG = new THREE.Group();
  headG.position.y = 0.74;
  hips.add(headG);
  const head = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 20), skinM));
  headG.add(head);

  // Hair: closed crown cap + back, matching the still renderer
  const hairCap = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), hairM));
  hairCap.scale.set(1.02, 0.52, 1.0);
  hairCap.position.set(0, 0.08, -0.01);
  headG.add(hairCap);
  const hairFront = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), hairM));
  hairFront.scale.set(1.05, 0.35, 0.7);
  hairFront.position.set(0, 0.06, 0.06);
  headG.add(hairFront);
  const hairBack = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), hairM));
  hairBack.scale.set(1.05, 1.0, 0.7);
  hairBack.position.set(0, -0.01, -0.08);
  headG.add(hairBack);

  // Face
  const eyeWhiteM = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.22, metalness: 0.0 });
  const irisM = new THREE.MeshStandardMaterial({ color: new THREE.Color(hair).multiplyScalar(0.55), roughness: 0.2 });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x100e0c, roughness: 0.15 });
  for (const ex of [-0.04, 0.04]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skinM);
    socket.scale.set(1, 0.7, 0.55);
    socket.position.set(ex, 0.02, 0.12);
    headG.add(socket);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), eyeWhiteM);
    white.scale.set(1, 0.8, 0.7);
    white.position.set(ex, 0.02, 0.128);
    headG.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), irisM);
    iris.position.set(ex, 0.02, 0.14);
    headG.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), pupilM);
    pupil.position.set(ex, 0.02, 0.147);
    headG.add(pupil);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hl.position.set(ex + 0.004, 0.024, 0.151);
    headG.add(hl);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), hairM);
    brow.scale.set(1.2, 0.28, 0.4);
    brow.position.set(ex, 0.045, 0.125);
    headG.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), skinM);
  nose.scale.set(0.7, 1.0, 0.85);
  nose.position.set(0, -0.005, 0.145);
  headG.add(nose);
  const lipM = new THREE.MeshStandardMaterial({ color: 0xb87072, roughness: 0.45 });
  const lipU = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 6), lipM);
  lipU.scale.set(1.15, 0.35, 0.5);
  lipU.position.set(0, -0.05, 0.13);
  const lipL = lipU.clone();
  lipL.position.y = -0.062;
  lipL.scale.set(1.05, 0.32, 0.45);
  headG.add(lipU, lipL);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), skinM);
    ear.scale.set(0.45, 1, 0.7);
    ear.position.set(sx * 0.14, 0.0, 0.0);
    headG.add(ear);
  }

  function makeArm(sign) {
    const wrap = new THREE.Group();
    const upper = capsule(0.045, 0.2, 4, 10, shirtM);
    upper.position.y = -0.14;
    const lower = capsule(0.032, 0.16, 4, 10, skinM);
    lower.position.y = -0.36;
    const hand = new THREE.Group();
    hand.position.y = -0.50;
    const palm = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), skinM));
    palm.scale.set(0.9, 0.7, 0.55);
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = addShadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.04, 2, 5), skinM));
      f.position.set((i - 1.5) * 0.016, -0.04, 0.01);
      hand.add(f);
    }
    wrap.add(upper, lower, hand);
    wrap.position.set(sign * 0.23, 0.48, 0);
    return wrap;
  }
  function makeLeg(sign) {
    const wrap = new THREE.Group();
    const thigh = capsule(0.065, 0.28, 4, 10, pantsM);
    thigh.position.y = -0.2;
    const calf = capsule(0.048, 0.26, 4, 10, pantsM);
    calf.position.y = -0.52;
    const boot = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bootM));
    boot.scale.set(1.0, 0.7, 1.35);
    boot.position.set(0, -0.72, 0.03);
    wrap.add(thigh, calf, boot);
    wrap.position.set(sign * 0.1, 0, 0);
    wrap.userData.boot = boot;
    return wrap;
  }
  const lArm = makeArm(-1);
  const rArm = makeArm(1);
  const lLeg = makeLeg(-1);
  const rLeg = makeLeg(1);
  hips.add(lArm, rArm, lLeg, rLeg);

  const pack = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), leatherM));
  pack.scale.set(1.0, 1.15, 0.7);
  pack.position.set(0, 0.22, -0.18);
  hips.add(pack);
  const axe = new THREE.Group();
  const handle = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.55, 8), clothMat(0x78552d, 0.8)));
  handle.rotation.x = 0.4;
  const headAxe = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.03), new THREE.MeshStandardMaterial({ color: 0xb0b0b4, roughness: 0.35, metalness: 0.55 })));
  headAxe.position.set(0, 0.22, -0.04);
  headAxe.rotation.x = 0.4;
  axe.add(handle, headAxe);
  axe.position.set(0.16, 0.2, -0.16);
  hips.add(axe);

  // Boots also referenced on the root for the existing walk animation.
  const lBoot = lLeg.userData.boot;
  const rBoot = rLeg.userData.boot;

  g.userData = { hips, torso, head: headG, lArm, rArm, lLeg, rLeg, lBoot, rBoot, pack, axe };
  return g;
}

function ensureLarry(appearance) {
  const key = JSON.stringify(appearance || { chosen: false });
  if (larryRig && larryRig.userData.appearanceKey === key) return;
  if (larryRig) { scene.remove(larryRig); clearGroup(larryRig); }
  larryRig = makeLarry(appearance && appearance.chosen ? appearance : null);
  larryRig.userData.appearanceKey = key;
  larryRig.scale.setScalar(HUMAN_SCALE * (1.8 / 1.75)); // primitive rig is ~1.75 units tall
  scene.add(larryRig);
  attachHumanModel(larryRig);
}

// The real 3D Larry (MakeHuman CC0 base, exported by render_human.py in his current colors).
let humanGltf = null;
let humanGltfPromise = null;
function loadHuman() {
  if (!humanGltfPromise) {
    humanGltfPromise = new Promise((resolve) => {
      new GLTFLoader().load(LARRY_GLB_URL, (gltf) => { humanGltf = gltf; resolve(gltf); }, undefined, () => resolve(null));
    });
  }
  return humanGltfPromise;
}

function attachHumanModel(rig) {
  loadHuman().then((gltf) => {
    if (!gltf || rig !== larryRig) return;
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    const wrap = new THREE.Group();
    wrap.scale.setScalar(1.75 / 1.8); // meters -> primitive-rig units (rig itself is scaled to life size)
    wrap.add(model);
    rig.add(wrap);
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/[^A-Za-z0-9]/g, "").toLowerCase()] = { bone: o, rest: o.quaternion.clone() };
    });
    rig.userData.human = { wrap, bones };
    rig.userData.hips.visible = false; // hide the primitive body (pack/axe/hands go with it)
    rig.userData.hipsBaseY = 0.96;
  });
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _ax = new THREE.Vector3();
function boneTurn(h, name, axis, angle, axis2, angle2) {
  const b = h.bones[name];
  if (!b) return;
  b.bone.quaternion.copy(b.rest);
  if (!angle && !angle2) return;
  // rotate about rig-space axes, expressed in the parent's frame
  b.bone.parent.updateWorldMatrix(true, false);
  b.bone.parent.getWorldQuaternion(_qp);
  larryRig.getWorldQuaternion(_qr);
  _qp.premultiply(_qr.invert());
  const inv = _qp.clone().invert();
  _qa.identity();
  if (angle2) _qa.multiply(_qb.setFromAxisAngle(_ax.copy(axis2).applyQuaternion(inv).normalize(), angle2));
  if (angle) _qa.premultiply(_qb.setFromAxisAngle(_ax.copy(axis).applyQuaternion(inv).normalize(), angle));
  b.bone.quaternion.premultiply(_qa);
}

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
function poseHuman() {
  const u = larryRig && larryRig.userData;
  const h = u && u.human;
  if (!h) return;
  h.wrap.position.y = (u.hips.position.y - (u.hipsBaseY || 0.96));
  boneTurn(h, "spine03", AX_X, u.hips.rotation.x * 0.6);
  boneTurn(h, "spine01", AX_X, u.hips.rotation.x * 0.4);
  // A-pose -> arms down, then the primitive's swing about the left-right axis
  boneTurn(h, "upperarm01l", AX_X, u.lArm.rotation.x, AX_Z, -0.95 + (u.lArm.rotation.z || 0));
  boneTurn(h, "upperarm01r", AX_X, u.rArm.rotation.x, AX_Z, 0.95 + (u.rArm.rotation.z || 0));
  boneTurn(h, "lowerarm01l", AX_X, -0.25);
  boneTurn(h, "lowerarm01r", AX_X, -0.25);
  boneTurn(h, "upperleg01l", AX_X, u.lLeg.rotation.x);
  boneTurn(h, "upperleg01r", AX_X, u.rLeg.rotation.x);
  const kneeL = u.lLeg.rotation.x < -0.5 ? -u.lLeg.rotation.x : Math.max(0, u.lLeg.rotation.x) * 0.6;
  const kneeR = u.rLeg.rotation.x < -0.5 ? -u.rLeg.rotation.x : Math.max(0, u.rLeg.rotation.x) * 0.6;
  boneTurn(h, "lowerleg01l", AX_X, kneeL);
  boneTurn(h, "lowerleg01r", AX_X, kneeR);
}

// Real-time feed: never play a walk loop unless he is actually moving; asleep/stale => still.
function feedIsStale() {
  if (!snap) return true;
  if (snap.sim && snap.sim.running === false) return true;
  const upd = Number(snap.updated || 0);
  return upd > 0 && (Date.now() / 1000 - upd) > 300;
}
function effectivePose() {
  const sp = larryState.serverPose || larryState.pose || "stand";
  if (snap && snap.realtime && snap.realtime.asleep) return "sleep";
  const dist = Math.hypot(larryState.tx - larryState.x, larryState.tz - larryState.z);
  const moving = dist > 0.02 && !feedIsStale();
  if (sp === "walk" || sp === "carry") return moving ? sp : "stand";
  if (feedIsStale() && sp !== "sleep") return "stand";
  return sp;
}

// Asleep at home: show him inside the boathouse, walls see-through, a bed under him, lamp low.
let sleepProps = null;
function updateSleepScene() {
  const asleep = !!(snap && snap.realtime && snap.realtime.asleep);
  const home = larryState.home;
  if (!sleepProps) {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.95 * HUMAN_SCALE, 0.45 * HUMAN_SCALE, 2.1 * HUMAN_SCALE),
      new THREE.MeshStandardMaterial({ color: 0x6d5a48, roughness: 0.9 }));
    bed.position.y = 0.22 * HUMAN_SCALE;
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.98 * HUMAN_SCALE, 0.12 * HUMAN_SCALE, 1.4 * HUMAN_SCALE),
      new THREE.MeshStandardMaterial({ color: 0x3e5a78, roughness: 1 }));
    blanket.position.set(0, 0.5 * HUMAN_SCALE, 0.3 * HUMAN_SCALE);
    const lamp = new THREE.PointLight(0xffb060, 0.35, 1.2, 2);
    lamp.position.set(0.6 * HUMAN_SCALE, 1.4 * HUMAN_SCALE, -0.6 * HUMAN_SCALE);
    g.add(bed, blanket, lamp);
    g.visible = false;
    scene.add(g);
    sleepProps = { g, faded: null };
  }
  const atHome = asleep && Array.isArray(home) && Math.abs(larryState.tx - (home[0] + 0.5)) < 0.6 && Math.abs(larryState.tz - (home[1] + 0.5)) < 0.6;
  sleepProps.g.visible = asleep;
  if (asleep) {
    sleepProps.g.position.set(larryState.x, heightAt(larryState.x, larryState.z), larryState.z);
    sleepProps.g.rotation.y = larryState.facing;
  }
  // fade the home hut's walls while he sleeps inside
  const want = atHome ? home.join(",") : null;
  if (sleepProps.faded !== want) {
    worldGroup.children.forEach((ch) => {
      if (!ch.isGroup) return;
      const key = `${Math.floor(ch.position.x)},${Math.floor(ch.position.z)}`;
      const isHome = want && key === want;
      ch.traverse((m) => {
        if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
        if (isHome) {
          if (m.userData.origOpacity === undefined) m.userData.origOpacity = m.material.opacity;
          m.material.transparent = true;
          m.material.opacity = 0.28;
          m.material.depthWrite = false;
        } else if (m.userData.origOpacity !== undefined) {
          m.material.opacity = m.userData.origOpacity;
          m.material.transparent = m.userData.origOpacity < 1;
          m.material.depthWrite = true;
          delete m.userData.origOpacity;
        }
      });
    });
    sleepProps.faded = want;
  }
}

function animateLarry(dt, t) {
  if (!larryRig) return;
  const u = larryRig.userData;
  const pose = (larryState.pose = effectivePose());
  const hips = u.hips;
  const walk = pose === "walk" || pose === "carry";
  const speed = walk ? 8 : 0;
  const swing = Math.sin(t * speed) * (walk ? 0.7 : 0);

  hips.rotation.set(0, 0, 0);
  hips.position.y = 0.96;
  u.lArm.rotation.set(0, 0, 0.08);
  u.rArm.rotation.set(0, 0, -0.08);
  u.lLeg.rotation.set(0, 0, 0);
  u.rLeg.rotation.set(0, 0, 0);
  u.lBoot.visible = u.rBoot.visible = true;
  u.lBoot.position.set(0, -0.72, 0.03);
  u.rBoot.position.set(0, -0.72, 0.03);
  larryRig.rotation.x = 0;

  if (pose === "sleep") {
    larryRig.rotation.x = -Math.PI / 2;
    hips.position.y = 0.36;
    u.lBoot.visible = u.rBoot.visible = true;
    u.lArm.rotation.z = 0.4;
    u.rArm.rotation.z = -0.2;
    u.lLeg.rotation.x = 0.15;
  } else if (pose === "sit") {
    hips.position.y = 0.62;
    u.lLeg.rotation.x = -1.2;
    u.rLeg.rotation.x = -1.2;
    u.lArm.rotation.x = -0.5;
    u.rArm.rotation.x = -0.35;
    u.lBoot.position.set(0, -0.72, 0.03);
    u.rBoot.position.set(0, -0.72, 0.03);
  } else if (walk) {
    u.lLeg.rotation.x = swing;
    u.rLeg.rotation.x = -swing;
    u.lArm.rotation.x = -swing * 0.8;
    u.rArm.rotation.x = swing * 0.8;
    hips.position.y = 0.96 + Math.abs(Math.sin(t * speed)) * 0.04;
    u.lBoot.position.set(0, -0.72, 0.03);
    u.rBoot.position.set(0, -0.72, 0.03);
  } else if (pose === "gather") {
    hips.rotation.x = 0.55 + Math.sin(t * 4) * 0.08;
    u.lArm.rotation.x = 0.6;
    u.rArm.rotation.x = 0.9 + Math.sin(t * 4) * 0.3;
  } else if (pose === "chop" || pose === "build") {
    u.rArm.rotation.x = -1.2 + Math.sin(t * 5) * 0.7;
    u.lArm.rotation.x = 0.3;
    hips.rotation.y = -0.15;
  } else if (pose === "fish") {
    u.rArm.rotation.x = -1.5 + Math.sin(t * 1.4) * 0.15;
    u.rArm.rotation.z = -0.2;
  } else if (pose === "drink") {
    u.rArm.rotation.x = -2.1;
    u.rArm.rotation.z = -0.3;
  } else if (pose === "fire") {
    hips.position.y = 0.7;
    u.lLeg.rotation.x = -0.8;
    u.rLeg.rotation.x = -0.8;
    u.lArm.rotation.x = -0.6;
    u.rArm.rotation.x = -0.5;
  } else if (pose === "scare") {
    u.lArm.rotation.x = -2.4;
    u.rArm.rotation.x = -2.4;
  } else if (pose === "desk") {
    hips.position.y = 0.74;
    u.lLeg.rotation.x = -1.1;
    u.rLeg.rotation.x = -1.1;
    u.lArm.rotation.x = -0.9;
    u.rArm.rotation.x = -0.7 + Math.sin(t * 3) * 0.2;
  } else {
    hips.position.y = 0.96 + Math.sin(t * 1.6) * 0.015;
  }

  if (larryState.moveDuration && larryState.moveStart != null) {
    const mu = clamp((performance.now() - larryState.moveStart) / larryState.moveDuration, 0, 1);
    larryState.x = lerp(larryState.fromX, larryState.tx, mu);
    larryState.z = lerp(larryState.fromZ, larryState.tz, mu);
  } else {
    const k = 1 - Math.pow(0.08, dt * (walk ? 5 : 8));
    larryState.x = lerp(larryState.x, larryState.tx, k);
    larryState.z = lerp(larryState.z, larryState.tz, k);
  }
  const dx = larryState.tx - larryState.x;
  const dz = larryState.tz - larryState.z;
  if (Math.hypot(dx, dz) > 0.04) larryState.tfacing = Math.atan2(dx, dz);
  let a = larryState.tfacing - larryState.facing;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  larryState.facing += a * (1 - Math.pow(0.08, dt * 8));
  larryState.y = heightAt(larryState.x, larryState.z);
  larryRig.position.set(larryState.x, larryState.y, larryState.z);
  larryRig.rotation.y = larryState.facing;
  poseHuman();
}

function addBox(g, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

const TOWN_BUILDINGS = {
  market: [0xb04034, 0x3c3a3c, 0.86, 0.6], cafe: [0xdec478, 0x464a52, 0.8, 0.62],
  harbor_office: [0x46688c, 0x343438, 0.76, 0.72], boatyard: [0x785c40, 0x544e48, 0.9, 0.8],
  general_store: [0x96322c, 0x3e3c3e, 0.84, 0.66], bakery: [0xe8d6aa, 0x603c2e, 0.72, 0.58],
  library: [0xd6d2c4, 0x404c5a, 0.86, 0.8], post_office: [0xc4a03c, 0x3c3c40, 0.72, 0.6],
  inn: [0x6e8262, 0x363234, 0.9, 0.95], chapel: [0xecEae2, 0x484850, 0.8, 0.82], house: [0xa03a30, 0x363438, 0.7, 0.56],
};
const HOUSE_COLORS = [0xa03a30, 0xd6b660, 0xe4e2d6, 0x56708c, 0x788c6c, 0xb07846];

function makeAnimal(kind) {
  const outer = new THREE.Group();
  const g = makeAnimalInner(kind);
  // primitives were ~0.75 units for a person; 1.8 m = 0.3 units at 6 m per tile
  g.scale.setScalar(kind === "person" ? 0.4 : 0.45);
  outer.add(g);
  outer.userData = g.userData;
  return outer;
}

function makeAnimalInner(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
  if (kind === "person") {
    const coat = [0x283c60, 0x962824, 0x3c5a3c, 0xc8aa3c, 0x5a5a60, 0x784628][Math.floor(Math.random() * 6)];
    addBox(g, 0.05, 0.3, 0.05, 0x323034, -0.05, 0.15, 0);
    addBox(g, 0.05, 0.3, 0.05, 0x323034, 0.05, 0.15, 0);
    addBox(g, 0.2, 0.3, 0.12, coat, 0, 0.45, 0);
    addBox(g, 0.12, 0.12, 0.12, 0xd8b896, 0, 0.67, 0);
    addBox(g, 0.13, 0.04, 0.13, 0x3a2a20, 0, 0.74, 0);
  } else if (kind === "deer") {
    addBox(g, 0.22, 0.16, 0.42, 0x8a5a32, 0, 0.28, 0);
    addBox(g, 0.12, 0.12, 0.16, 0x8a5a32, 0, 0.4, 0.22);
    addBox(g, 0.02, 0.16, 0.02, 0x5a3a22, -0.04, 0.52, 0.18);
    addBox(g, 0.02, 0.16, 0.02, 0x5a3a22, 0.04, 0.52, 0.18);
    [[-0.08, 0.1, 0.12], [0.08, 0.1, 0.12], [-0.08, 0.1, -0.12], [0.08, 0.1, -0.12]].forEach(([x, y, z]) => {
      addBox(g, 0.04, 0.2, 0.04, 0x5a3a22, x, y, z);
    });
  } else if (kind === "hare") {
    addBox(g, 0.16, 0.1, 0.22, 0xc8b896, 0, 0.16, 0);
    addBox(g, 0.1, 0.1, 0.1, 0xc8b896, 0, 0.24, 0.1);
    addBox(g, 0.03, 0.14, 0.04, 0xd0c0a0, -0.03, 0.34, 0.1);
    addBox(g, 0.03, 0.14, 0.04, 0xd0c0a0, 0.03, 0.34, 0.1);
  } else if (kind === "gull") {
    addBox(g, 0.08, 0.06, 0.18, 0xf2f0ea, 0, 0, 0);
    addBox(g, 0.28, 0.02, 0.08, 0xe8e4da, 0, 0.01, 0);
    addBox(g, 0.05, 0.05, 0.07, 0xf2f0ea, 0, 0.03, 0.1);
    g.userData.flies = true;
  } else if (kind === "crab") {
    addBox(g, 0.16, 0.06, 0.12, 0xb84a32, 0, 0.06, 0);
    addBox(g, 0.04, 0.03, 0.1, 0xb84a32, -0.1, 0.05, 0.04);
    addBox(g, 0.04, 0.03, 0.1, 0xb84a32, 0.1, 0.05, 0.04);
  } else if (kind === "boar") {
    addBox(g, 0.28, 0.2, 0.4, 0x4a3a2e, 0, 0.24, 0);
    addBox(g, 0.16, 0.14, 0.16, 0x4a3a2e, 0, 0.28, 0.22);
    addBox(g, 0.04, 0.06, 0.04, 0xe8e0d0, -0.05, 0.22, 0.3);
    addBox(g, 0.04, 0.06, 0.04, 0xe8e0d0, 0.05, 0.22, 0.3);
    [[-0.1, 0.1, 0.12], [0.1, 0.1, 0.12], [-0.1, 0.1, -0.12], [0.1, 0.1, -0.12]].forEach(([x, y, z]) => {
      addBox(g, 0.06, 0.2, 0.06, 0x3a2c24, x, y, z);
    });
  } else {
    addBox(g, 0.16, 0.16, 0.22, 0x88775a, 0, 0.16, 0);
  }
  return g;
}

function updateFauna(list) {
  const wanted = (list || []).map((f, i) => ({ ...f, key: f.id ? `p-${f.id}` : `${f.kind}-${i}-${f.x}-${f.y}` }));
  const have = new Map(faunaGroup.children.map((c) => [c.userData.key, c]));
  const keep = new Set();
  for (const f of wanted) {
    keep.add(f.key);
    let obj = have.get(f.key);
    if (!obj) {
      obj = makeAnimal(f.kind || "hare");
      obj.userData.key = f.key;
      obj.userData.tx = f.x + 0.5;
      obj.userData.tz = f.y + 0.5;
      obj.position.set(obj.userData.tx, heightAt(obj.userData.tx, obj.userData.tz), obj.userData.tz);
      faunaGroup.add(obj);
    } else {
      obj.userData.tx = f.x + 0.5;
      obj.userData.tz = f.y + 0.5;
    }
    obj.userData.kind = f.kind;
  }
  faunaGroup.children.slice().forEach((c) => {
    if (!keep.has(c.userData.key)) faunaGroup.remove(c);
  });
}

function animateFauna(dt, t) {
  faunaGroup.children.forEach((c, i) => {
    const k = 1 - Math.pow(0.5, dt / 14);
    c.position.x = lerp(c.position.x, c.userData.tx, k);
    c.position.z = lerp(c.position.z, c.userData.tz, k);
    const fly = c.userData.flies;
    const baseY = heightAt(c.position.x, c.position.z) + (fly ? 1.1 + Math.sin(t * 1.5 + i) * 0.25 : 0);
    c.position.y = baseY;
    if (fly) c.rotation.y = t * 0.6 + i;
    else {
      const dx = c.userData.tx - c.position.x;
      const dz = c.userData.tz - c.position.z;
      if (Math.hypot(dx, dz) > 0.02) c.rotation.y = Math.atan2(dx, dz);
    }
  });
}

function ensureRain(on) {
  if (on && !rain) {
    const n = 1200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 30 - 15;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = Math.random() * 30 - 15;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xb8c8d8, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false,
    }));
    scene.add(rain);
  }
  if (!on && rain) {
    scene.remove(rain);
    rain.geometry.dispose();
    rain.material.dispose();
    rain = null;
  }
}

function animateRain(dt) {
  if (!rain) return;
  const pos = rain.geometry.attributes.position.array;
  const origin = controls.target;
  rain.position.set(origin.x, 0, origin.z);
  const speed = (snap?.clock?.weather === "storm" ? 14 : 9);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] -= dt * speed;
    pos[i] += dt * 1.4;
    if (pos[i + 1] < 0) {
      pos[i] = Math.random() * 30 - 15;
      pos[i + 1] = 10 + Math.random() * 4;
      pos[i + 2] = Math.random() * 30 - 15;
    }
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

let lightningUntil = 0;
function setLighting(fracHour, weather, cold) {
  const hour = ((fracHour % 24) + 24) % 24;
  const isNight = hour < 5.5 || hour >= 20;
  const dawn = hour >= 5.5 && hour < 7.5;
  const dusk = hour >= 17.5 && hour < 20;
  let sunH = 0;
  if (hour >= 6 && hour <= 19) sunH = Math.sin(((hour - 6) / 13) * Math.PI);
  else sunH = 0;
  const az = ((hour - 6) / 24) * Math.PI * 2;
  const cx = mapState ? mapState.width / 2 : 20;
  const cz = mapState ? mapState.height / 2 : 20;
  sun.position.set(cx + Math.cos(az) * 40, 6 + sunH * 46, cz + Math.sin(az) * 20);
  sun.target.position.set(cx, 0, cz);
  moon.position.set(cx - 20, 28, cz - 16);

  let sky = new THREE.Color(0x87b5d8);
  let fog = new THREE.Color(0x9ec0d6);
  let sunCol = new THREE.Color(0xfff0d0);
  let sunInt = 0.15 + sunH * 1.15;
  let hemiInt = 0.25 + sunH * 0.5;
  let expo = 0.85 + sunH * 0.3;
  stars.material.opacity = isNight ? 0.85 : dawn || dusk ? 0.25 : 0;

  if (dawn) {
    sky.set(0xf0b07a); fog.set(0xe8b894); sunCol.set(0xffb070); expo = 0.95;
  } else if (dusk) {
    sky.set(0xd07a62); fog.set(0xc4846a); sunCol.set(0xff8a4a); expo = 0.9;
  } else if (isNight) {
    sky.set(0x0b1220); fog.set(0x101826); sunInt = 0.04; hemiInt = 0.12; expo = 0.7;
    hemi.color.set(0x6a7a9a); hemi.groundColor.set(0x1a1410);
  } else {
    hemi.color.set(0xcfe8ff); hemi.groundColor.set(0x3a2a18);
  }

  if (weather === "cloudy" || weather === "fog") {
    sky.lerp(new THREE.Color(0x8a97a3), 0.45);
    fog.lerp(new THREE.Color(0x8a97a3), 0.6);
    sunInt *= 0.55; expo *= 0.92;
  }
  if (weather === "rain") {
    sky.lerp(new THREE.Color(0x5c6a76), 0.55);
    fog.set(0x6a7884);
    sunInt *= 0.4;
  }
  if (weather === "storm") {
    sky.set(isNight ? 0x0a0d12 : 0x3a4550);
    fog.set(0x3a4450);
    sunInt *= 0.25;
    if (Math.random() < 0.004) lightningUntil = performance.now() + 120;
  }
  if (weather === "heat" && !isNight) {
    sky.lerp(new THREE.Color(0xf0d08a), 0.25);
    sunCol.set(0xffe08a);
    expo += 0.08;
  }
  if (weather === "cold" || cold) {
    sky.lerp(new THREE.Color(0xc5d4e4), 0.35);
    fog.lerp(new THREE.Color(0xd0dbe6), 0.4);
    sunCol.lerp(new THREE.Color(0xdde6f2), 0.3);
  }
  if (performance.now() < lightningUntil) {
    sky.set(0xdde6f2);
    sunInt = 2.2;
  }

  scene.background = sky;
  if (typeof skyUniforms !== "undefined") {
    skyUniforms.topColor.value.copy(sky);
    skyUniforms.horizonColor.value.copy(fog);
    skyUniforms.bottomColor.value.copy(fog).lerp(sky, 0.25);
    skyUniforms.sunColor.value.copy(sunCol);
    skyUniforms.sunDir.value.copy(sun.position).normalize();
  }
  scene.fog.color.copy(fog);
  scene.fog.density = weather === "fog" ? 0.045 : weather === "rain" || weather === "storm" ? 0.028 : isNight ? 0.022 : 0.016;
  sun.color.copy(sunCol);
  sun.intensity = sunInt;
  moon.intensity = isNight ? 0.35 : 0;
  hemi.intensity = hemiInt;
  ambient.intensity = isNight ? 0.08 : 0.16;
  renderer.toneMappingExposure = expo;
  ensureRain(weather === "rain" || weather === "storm");
}

function etNowParts() {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
}
function fractionalHour() {
  if (!snap || !snap.clock) return 12;
  if (snap.realtime) {
    const p = etNowParts(); // in-game hour = real ET hour
    return p.h + p.m / 60 + p.s / 3600;
  }
  const elapsed = (performance.now() - tickAt) / 1000;
  return snap.clock.hour + Math.min(elapsed / (secondsPerHour || 6), 0.85);
}
function etClockText() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date()) + " ET";
}
function renderClock() {
  if (!snap) return;
  const C = snap.clock || {};
  const R = snap.realtime;
  const weather = C.weather ? C.weather.replace("_", " ") : "—";
  const season = C.season ? C.season[0].toUpperCase() + C.season.slice(1) : "";
  const L = snap.larry || {};
  const alive = L.alive === false ? " · not alive this life" : "";
  const stale = feedIsStale() ? " · feed paused" : "";
  let status = "";
  let time = `${String(C.hour ?? 0).padStart(2, "0")}:00`;
  if (R) {
    time = etClockText();
    status = R.asleep ? ` · <b>asleep</b> 💤 next wake ${R.next_wake || "7:00 AM ET"}` : ` · <b>awake</b>${R.next_bed ? " · bed at " + R.next_bed : ""}`;
  }
  $("clock").innerHTML = `<strong>Day ${C.day ?? "—"}</strong> · ${time} · ${season} · ${weather}${C.cold_snap ? " · cold snap" : ""}${status}${alive}${stale}`;
}
setInterval(renderClock, 1000);

const defaultOffset = new THREE.Vector3(-1.25, 0.85, -1.25); // ~11 m back: Larry at life size in his town

function updateCamera() {
  if (!follow || !larryRig) { controls.update(); return; }
  const look = new THREE.Vector3(larryState.x, larryState.y + 1.35 * HUMAN_SCALE, larryState.z);
  const delta = look.clone().sub(controls.target);
  controls.target.copy(look);
  camera.position.add(delta);
  controls.update();
}

function resetChase() {
  if (!larryRig) return;
  const look = new THREE.Vector3(larryState.x, larryState.y + 1.35 * HUMAN_SCALE, larryState.z);
  controls.target.copy(look);
  camera.position.copy(look).add(defaultOffset);
  follow = true;
  $("btn-follow").classList.add("active");
  $("btn-follow").textContent = "Following";
  controls.enablePan = false;
}

function setMeter(id, value) {
  const v = clamp(Number(value) || 0, 0, 100);
  const bar = $("m-" + id);
  const label = $("v-" + id);
  bar.style.width = v + "%";
  bar.className = v < 28 ? "bad" : v < 50 ? "warn" : "";
  label.textContent = String(Math.round(v));
}

function renderHud(data) {
  const L = data.larry || {};
  const C = data.clock || {};
  const name = data.name || L.name || "Larry";
  $("title").textContent = `${name} (AI) — live`;
  const hour = String(C.hour ?? 0).padStart(2, "0");
  const weather = C.weather ? C.weather.replace("_", " ") : "—";
  const season = C.season ? C.season[0].toUpperCase() + C.season.slice(1) : "";
  const alive = L.alive === false ? " · not alive this life" : "";
  const sim = data.sim && data.sim.running === false ? " · sim paused" : "";
  renderClock();
  const thought = (L.thought || "").trim();
  const el = $("thought");
  if (thought) {
    el.textContent = thought;
    el.classList.remove("empty");
  } else {
    el.textContent = "Waiting for Larry’s next thought…";
    el.classList.add("empty");
  }
  $("doing").innerHTML = `Doing: <b>${L.action || "—"}</b>`;
  setMeter("health", L.health);
  setMeter("hunger", L.hunger);
  setMeter("thirst", L.thirst);
  setMeter("energy", L.energy);

  const list = $("thoughts");
  const rows = (data.thoughts || []).slice().reverse();
  list.innerHTML = rows.map((t) => {
    const clock = t.at ? String(t.at).slice(11, 16) + " ET" : `${String(t.hour).padStart(2, "0")}:00`;
    const when = `Day ${t.day}, ${clock}${t.action ? " · " + t.action : ""}${t.model ? " · " + t.model : ""}`;
    const esc = (x) => String(x || "").replace(/</g, "&lt;");
    const text = esc(t.thought);
    const extra = t.search ? `<small>looked up: ${esc(t.search)}</small>` : "";
    return `<li><time>${when}</time><p>${text}</p>${extra}</li>`;
  }).join("");
}

function applyPayload(data) {
  if (!data || !data.ok) return;
  snap = data;
  tickAt = performance.now();
  secondsPerHour = data.seconds_per_hour || 6;
  $("live-dot").classList.remove("off");
  if (data.map && data.map.hash !== lastMapHash) buildMap(data.map);
  else if (data.fires && mapState) updateFires(data.fires);
  const L = data.larry || {};
  if (typeof L.x === "number" && typeof L.y === "number") {
    const first = !larryRig;
    ensureLarry(data.appearance);
    const nx = L.x + 0.5;
    const nz = L.y + 0.5;
    larryState.pose = L.pose || "stand";
    larryState.serverPose = larryState.pose;
    larryState.home = L.home;
    if (first) {
      larryState.fromX = nx;
      larryState.fromZ = nz;
      larryState.tx = nx;
      larryState.tz = nz;
      larryState.x = nx;
      larryState.z = nz;
      larryState.y = heightAt(nx, nz);
      larryState.moveStart = null;
      larryState.moveDuration = 0;
      resetChase();
    } else {
      larryState.fromX = larryState.x;
      larryState.fromZ = larryState.z;
      larryState.tx = nx;
      larryState.tz = nz;
      const dist = Math.hypot(nx - larryState.fromX, nz - larryState.fromZ);
      larryState.moveStart = performance.now();
      // Real time: he walks one tile per ~30-45 s, so spread the trip over that pace
      // (constant speed, no sprint-then-freeze, no walking in place).
      const perTile = ((data.realtime && data.realtime.move_seconds) || 30) * 1000;
      larryState.moveDuration = dist < 0.02 ? 0 : clamp(dist * perTile, 1500, 120000);
    }
  }
  updateFauna(data.fauna || []);
  renderHud(data);
}

const STATE_SOURCES = [
  new URL("state.json", window.location.href).href,
  "https://raw.githubusercontent.com/mvq1/Larry-live-/main/state.json",
];
const POLL_MS = 20000;
let pollTimer = null;
let lastStateStamp = null;
let lastFetchOk = 0;

function withBust(url) {
  const u = new URL(url, window.location.href);
  u.searchParams.set("t", String(Date.now()));
  return u.toString();
}

async function fetchState() {
  let lastErr = null;
  for (const src of STATE_SOURCES) {
    try {
      const r = await fetch(withBust(src), { cache: "no-store", mode: "cors" });
      if (!r.ok) { lastErr = new Error("http " + r.status); continue; }
      const data = await r.json();
      if (data && data.ok) return data;
      lastErr = new Error("bad payload");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("state unavailable");
}

function pollSnapshot() {
  fetchState()
    .then((data) => {
      const stamp = String(data.updated || data.saved_at || "");
      lastFetchOk = performance.now();
      $("live-dot").classList.remove("off");
      if (stamp && stamp === lastStateStamp) return;
      lastStateStamp = stamp;
      applyPayload(data);
    })
    .catch(() => {
      if (!lastFetchOk || performance.now() - lastFetchOk > 8000) {
        $("live-dot").classList.add("off");
      }
    });
}

function connect() {
  if (pollTimer) clearInterval(pollTimer);
  pollSnapshot();
  pollTimer = setInterval(pollSnapshot, POLL_MS);
}

$("btn-follow").addEventListener("click", () => {
  if (follow) {
    follow = false;
    $("btn-follow").classList.remove("active");
    $("btn-follow").textContent = "Follow Larry";
    controls.enablePan = true;
  } else {
    resetChase();
  }
});
controls.addEventListener("start", () => {
  // orbiting still follows Larry as the target; panning only in free look
});
$("feed-toggle").addEventListener("click", () => {
  $("feed").classList.toggle("open");
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const loopClock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(loopClock.getDelta(), 0.05);
  const t = loopClock.elapsedTime;
  animateLarry(dt, t);
  try { updateSleepScene(); } catch (e) {}
  animateFauna(dt, t);
  animateRain(dt);
  worldGroup.children.forEach((ch) => {
    if (ch.userData && ch.userData.flamePit) {
      ch.children.forEach((c) => {
        if (c.userData && c.userData.animateFlame) {
          const s = 0.9 + Math.sin(t * 11 + ch.position.x) * 0.15;
          c.scale.set(s, 0.85 + Math.sin(t * 17) * 0.2, s);
        }
      });
    }
  });
  if (snap) setLighting(fractionalHour(), snap.clock?.weather, snap.clock?.cold_snap);
  updateCamera();
  renderer.render(scene, camera);
}

connect();
loop();
