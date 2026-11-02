// The 3D site: buildings, every pane coloured by its strike risk (or by its treatment),
// trees, and a sample of simulated flights. Drag to turn it, scroll or pinch to zoom,
// arrow keys when it has focus, and click a pane to inspect it.

import * as THREE from 'three';
import type { Summary } from './client.js';

const STOPS: [number, [number, number, number]][] = [
  [0, [0.85, 0.93, 0.96]],
  [0.45, [0.95, 0.76, 0.31]],
  [0.75, [0.89, 0.34, 0.18]],
  [1, [0.56, 0.11, 0.13]],
];

/** Risk colour from pale glass (none) through amber to deep red (the worst pane). */
export function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i] as [number, [number, number, number]];
    const [t0, c0] = STOPS[i - 1] as [number, [number, number, number]];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1]?.[1] ?? [1, 0, 0];
}

export function heatCss(t: number): string {
  const [r, g, b] = heat(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Risk per square metre for each pane, scaled to the worst pane (0..1, square-rooted for contrast). */
export function densities(s: Summary): number[] {
  const d = s.panes.map((p) => (s.risk[p.id]?.strikes ?? 0) / p.area);
  const max = Math.max(1e-12, ...d);
  return d.map((v) => Math.sqrt(v / max));
}

export interface ShowOptions {
  treated?: Map<number, 'interior' | 'exterior'>;
  flights?: boolean;
  selected?: number;
}

const TREATED = { exterior: new THREE.Color(0x0e6f78), interior: new THREE.Color(0x7cc3c6) };

export class SiteView {
  readonly mode: 'webgl' | 'flat';
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  private readonly group = new THREE.Group();
  private paneMesh?: THREE.InstancedMesh;
  private paneIds: number[] = [];
  private target = new THREE.Vector3();
  private radius = 120;
  private theta = -0.9;
  private phi = 1.0;
  private dirty = true;
  private spin: boolean;
  private pickHandler?: (pane: number) => void;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly host: HTMLElement, opts: { spin?: boolean } = {}) {
    this.spin = !!opts.spin && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) throw new Error('no WebGL');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, context: gl as WebGLRenderingContext });
      this.mode = 'webgl';
    } catch {
      this.mode = 'flat';
    }
    host.dataset.mode = this.mode;
    if (!this.renderer) {
      const p = document.createElement('p');
      p.className = 'view-fallback';
      p.textContent = 'The 3D view needs WebGL, which this browser has switched off. The tables on this page show the same results.';
      host.append(p);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setClearColor(0xeaf3f6);
    r.domElement.setAttribute('aria-hidden', 'true');
    host.append(r.domElement);
    host.tabIndex = 0;
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xf4fbff, 0x9aa48a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-60, -80, 120);
    this.scene.add(sun);
    this.camera.up.set(0, 0, 1);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      if (this.spin && document.visibilityState === 'visible') {
        this.theta += 0.0016;
        this.dirty = true;
      }
      if (this.dirty) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  onPick(f: (pane: number) => void): void {
    this.pickHandler = f;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private draw(): void {
    this.dirty = false;
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.cos(this.theta),
      this.target.y + this.radius * sp * Math.sin(this.theta),
      this.target.z + this.radius * Math.cos(this.phi),
    );
    this.camera.lookAt(this.target);
    this.renderer?.render(this.scene, this.camera);
  }

  private bind(): void {
    const el = this.host;
    let down: { x: number; y: number; moved: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = { x: e.clientX, y: e.clientY, moved: 0 };
      this.spin = false;
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev || !down) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom(pinch / d);
        pinch = d;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      down.moved += Math.abs(dx) + Math.abs(dy);
      this.theta -= dx * 0.006;
      this.phi = Math.min(1.45, Math.max(0.15, this.phi - dy * 0.006));
      this.dirty = true;
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (down && down.moved < 6 && pointers.size === 0) this.pick(e);
      if (pointers.size === 0) down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
    el.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') this.theta += 0.1;
      else if (k === 'ArrowRight') this.theta -= 0.1;
      else if (k === 'ArrowUp') this.phi = Math.max(0.15, this.phi - 0.08);
      else if (k === 'ArrowDown') this.phi = Math.min(1.45, this.phi + 0.08);
      else if (k === '+' || k === '=') this.zoom(0.9);
      else if (k === '-') this.zoom(1.1);
      else return;
      e.preventDefault();
      this.spin = false;
      this.dirty = true;
    });
  }

  private zoom(f: number): void {
    this.radius = Math.min(600, Math.max(15, this.radius * f));
    this.dirty = true;
  }

  private pick(e: PointerEvent): void {
    if (!this.paneMesh || !this.pickHandler || !this.renderer) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObject(this.paneMesh)[0];
    if (hit && hit.instanceId !== undefined) this.pickHandler(this.paneIds[hit.instanceId] as number);
  }

  /** Draws a site; keeps the camera if the same site is shown again. */
  show(s: Summary, opts: ShowOptions = {}): void {
    if (!this.renderer) return;
    const fresh = this.group.userData.name !== s.scene.name;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    this.group.userData.name = s.scene.name;
    const W = s.scene.width;
    const D = s.scene.depth;
    if (fresh) {
      const tallest = Math.max(...s.scene.buildings.map((b) => b.floors * b.floorHeight), ...s.scene.trees.map((t) => t.height));
      this.target.set(W / 2, D / 2, tallest * 0.3);
      this.radius = Math.max(W, D, tallest * 1.6) * 1.2;
    }

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xc9d6b8 }));
    ground.position.set(W / 2, D / 2, 0);
    this.group.add(ground);

    const wall = new THREE.MeshLambertMaterial({ color: 0xe9e4da });
    for (const b of s.scene.buildings) {
      const h = b.floors * b.floorHeight;
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.width - 0.04, b.depth - 0.04, h), wall);
      m.position.set(b.x + b.width / 2, b.y + b.depth / 2, h / 2);
      this.group.add(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x8a8378 }));
      edges.position.copy(m.position);
      this.group.add(edges);
    }

    const plane = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(plane, mat, Math.max(1, s.panes.length));
    const dens = densities(s);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    s.panes.forEach((p, i) => {
      const n = new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]);
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(p.u[0], p.u[1], p.u[2]), new THREE.Vector3(0, 0, 1), n));
      m4.compose(new THREE.Vector3(p.center[0] + n.x * 0.03, p.center[1] + n.y * 0.03, p.center[2]), q, new THREE.Vector3(p.halfW * 2 - 0.12, p.halfH * 2, 1));
      mesh.setMatrixAt(i, m4);
      const t = opts.treated?.get(p.id);
      if (t) color.copy(TREATED[t]);
      else if (opts.treated) color.setRGB(0.86, 0.92, 0.94);
      else color.setRGB(...heat(dens[i] ?? 0));
      if (opts.selected === p.id) color.setRGB(0.1, 0.13, 0.24);
      mesh.setColorAt(i, color);
    });
    this.paneIds = s.panes.map((p) => p.id);
    this.paneMesh = mesh;
    this.group.add(mesh);

    const trunk = new THREE.MeshLambertMaterial({ color: 0x7a5a3c });
    const leaf = new THREE.MeshLambertMaterial({ color: 0x4f8a4b, flatShading: true });
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    for (const t of s.scene.trees) {
      const trunkH = Math.max(0.5, t.height - 2 * t.crown);
      const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, trunkH + t.crown * 0.5, 6), trunk);
      tm.rotation.x = Math.PI / 2;
      tm.position.set(t.x, t.y, (trunkH + t.crown * 0.5) / 2);
      this.group.add(tm);
      const cm = new THREE.Mesh(crownGeo, leaf);
      cm.scale.setScalar(t.crown);
      cm.position.set(t.x, t.y, t.height - t.crown);
      this.group.add(cm);
    }

    if (opts.flights) {
      const struck: number[] = [];
      const safe: number[] = [];
      for (const f of s.sample) {
        const arr = f.pane >= 0 ? struck : safe;
        arr.push(f.from[0], f.from[1], f.from[2], f.end[0], f.end[1], f.end[2]);
      }
      const lines = (pts: number[], c: number, o: number) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o }));
      };
      this.group.add(lines(safe, 0x5d7d99, 0.35), lines(struck, 0xd8452b, 0.9));
    }
    this.dirty = true;
  }
}
