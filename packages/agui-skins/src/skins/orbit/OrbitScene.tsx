/// <reference path="../../types/troika-three-text.d.ts" />
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { Text } from "troika-three-text";
import { createStarfield } from "./Starfield";
import {
  TONE_COLOR,
  TUNNEL,
  hashUnit,
  visualUnits,
  type SceneAction,
  type SceneModel,
  type SceneNode,
  type SceneSegment,
  type Tone,
} from "./sceneModel";
import { TunnelCamera, clamp } from "./tunnelCamera";

/* ─────────────────────────────────────────────────────────────────────
   OrbitScene — everything the user can read lives in this WebGL scene.
   It is loaded lazily (three + troika stay out of the main entry) and it
   owns exactly one renderer, one rAF loop and one set of input listeners.

   Surfaces:
     • stations  — troika-three-text paragraph meshes along the tunnel;
     • tools     — wireframe icosahedra with 3D labels;
     • approvals — camera-facing panels; buttons are raycast-picked and
                   mirrored by real DOM proxies in the page layer;
     • HUD       — camera-anchored 3D text (brand/status/tokens);
     • sky       — createStarfield() (one draw call) + tunnel rings.
   ───────────────────────────────────────────────────────────────────── */

export interface OrbitHud {
  title: string;
  line: string;
  status: string;
  tokens: string;
  statusTone: Tone;
}

export interface OrbitSceneProps {
  model: SceneModel;
  reduced: boolean;
  accent: string;
  proxyRoot: RefObject<HTMLElement | null>;
  hud: OrbitHud;
  onReady: () => void;
  onFail: (reason: string) => void;
  onAction: (action: SceneAction) => void;
}

const FOV = 56;
const MATERIALIZE_MS = 400;
const SYNC_THROTTLE_MS = 80;
const HUD_DISTANCE = 4;

const TONE_CACHE = new Map<string, THREE.Color>();
function toneColor(tone: Tone): THREE.Color {
  let color = TONE_CACHE.get(tone);
  if (!color) {
    color = new THREE.Color(TONE_COLOR[tone]);
    TONE_CACHE.set(tone, color);
  }
  return color;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/** Pre-wrap to the model's width estimate. Troika's line breaker only breaks
    at whitespace, so a space-free Chinese paragraph would run past its
    `maxWidth`; inserting newlines here keeps the mesh inside its chamber and
    makes the rendered height match the model's height estimate. */
function wrapForMesh(text: string, maxWidth: number, fontSize: number): string {
  const perLine = Math.max(4, maxWidth / Math.max(0.05, fontSize));
  const lines: string[] = [];
  for (const hardLine of text.split("\n")) {
    const tokens: string[] = [];
    let buffer = "";
    for (const char of Array.from(hardLine)) {
      if (isCjk(char)) {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(char);
      } else if (char === " ") {
        tokens.push(`${buffer} `);
        buffer = "";
      } else {
        buffer += char;
      }
    }
    if (buffer) tokens.push(buffer);

    let line = "";
    let units = 0;
    for (const token of tokens) {
      const tokenUnits = visualUnits(token);
      if (line && units + tokenUnits > perLine) {
        lines.push(line.trimEnd());
        line = "";
        units = 0;
        if (!token.trim()) continue;
      }
      if (tokenUnits > perLine && !line) {
        // a monster token (URL/code): hard-split it
        for (const char of Array.from(token)) {
          if (units >= perLine) {
            lines.push(line);
            line = "";
            units = 0;
          }
          line += char;
          units += visualUnits(char);
        }
        continue;
      }
      line += token;
      units += tokenUnits;
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}

interface SegmentView {
  segment: SceneSegment;
  text: Text;
  content: string;
  bornAt: number;
  pulseAt: number;
  /** x offset inside the station (tool labels sit beside the polyhedron) */
  offsetX: number;
}

interface ActionView {
  action: SceneAction;
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  border: THREE.LineBasicMaterial;
  label: Text;
  pickables: THREE.Object3D[];
  baseScale: number;
}

interface NodeView {
  node: SceneNode;
  group: THREE.Group;
  segments: Map<string, SegmentView>;
  actions: ActionView[];
  signature: string;
  bornAt: number;
  panelBorder: THREE.LineBasicMaterial | null;
  spinner: THREE.Object3D | null;
}

interface SharedGeometry {
  plane: THREE.PlaneGeometry;
  planeEdges: THREE.EdgesGeometry;
  icosa: THREE.IcosahedronGeometry;
  icosaWire: THREE.WireframeGeometry;
  circle: THREE.CircleGeometry;
}

const SHARED_KEYS = new WeakSet<object>();

function isSharedGeometry(geometry: THREE.BufferGeometry): boolean {
  return SHARED_KEYS.has(geometry);
}

function disposeText(text: Text): void {
  text.dispose();
  const material = text.material;
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else if (material) {
    material.dispose();
  }
}

function disposeNodeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof Text) {
      disposeText(object);
      return;
    }
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    const mesh = object;
    if (mesh.geometry && !isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

function nodeSignature(node: SceneNode): string {
  return [
    node.kind,
    node.status ?? "",
    node.tone,
    node.mesh,
    node.actions.map((action) => action.id).join(","),
  ].join("|");
}

function makeText(
  segment: SceneSegment,
  color: string,
  offsetX: number,
  bornAt: number,
  onSynced?: () => void
): SegmentView {
  const text = new Text();
  text.text = wrapForMesh(segment.text, segment.maxWidth, segment.size);
  text.fontSize = segment.size;
  text.maxWidth = segment.maxWidth;
  text.anchorX = segment.anchorX;
  text.anchorY = "top";
  text.textAlign = segment.align;
  text.lineHeight = 1.36;
  text.color = color;
  text.fillOpacity = 0;
  text.outlineWidth = segment.size * 0.016;
  text.outlineColor = "#05060a";
  text.outlineOpacity = 0.75;
  text.material.transparent = true;
  text.material.depthWrite = false;
  text.material.fog = true;
  text.renderOrder = 2;
  text.position.set(offsetX, -segment.offsetY, segment.depthJitter);
  text.rotation.y = (hashUnit(segment.id) - 0.5) * 0.06; // ≤ ~3.4°
  text.frustumCulled = false;
  text.sync(onSynced);
  return {
    segment,
    text,
    content: segment.text,
    bornAt,
    pulseAt: bornAt,
    offsetX,
  };
}

function panelAnchorX(node: SceneNode): number {
  if (node.kind === "interrupt" || node.kind === "error") return 0;
  return node.width / 2;
}

export default function OrbitScene(props: OrbitSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const modelRef = useRef(props.model);
  const hudRef = useRef(props.hud);
  const accentRef = useRef(props.accent);
  const proxyRootRef = useRef(props.proxyRoot);
  const onReadyRef = useRef(props.onReady);
  const onFailRef = useRef(props.onFail);
  const onActionRef = useRef(props.onAction);
  modelRef.current = props.model;
  hudRef.current = props.hud;
  accentRef.current = props.accent;
  proxyRootRef.current = props.proxyRoot;
  onReadyRef.current = props.onReady;
  onFailRef.current = props.onFail;
  onActionRef.current = props.onAction;

  // Scene runtime is created once per mount; `reduced` is fixed for the
  // lifetime of the mount (the page remounts this component when the media
  // query flips, resetting the loading state until the new canvas is ready).
  const reduced = props.reduced;

  const runtimeRef = useRef<{
    reconcile: (model: SceneModel) => void;
    updateHud: (hud: OrbitHud, accent: string) => void;
    dispose: () => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (
      typeof WebGLRenderingContext === "undefined" &&
      typeof WebGL2RenderingContext === "undefined"
    ) {
      onFailRef.current("webgl-unavailable");
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      if (!renderer.getContext()) throw new Error("no WebGL context");
    } catch {
      onFailRef.current("renderer-failed");
      return;
    }

    const canvas = renderer.domElement;
    canvas.className = "or-scene-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);

    // Runtime state is declared before any setup call: reduced-motion setup
    // can synchronously request a render (resize/reconcile), and a later
    // `let disposed` would be a temporal-dead-zone crash.
    let frame = 0;
    let disposed = false;
    let renderQueued = false;
    const clock = new THREE.Clock();
    let lastNow = performance.now();
    const focusSmooth = new THREE.Vector3(0, -0.5, modelRef.current.bounds.minZ - TUNNEL.followGap);
    let readingZ = modelRef.current.bounds.minZ - TUNNEL.followGap;
    let focusId: string | null = null;
    let lastWheelAt = 0;

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060a, 0.009);

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2400);
    camera.position.set(0, -0.55, modelRef.current.bounds.minZ);
    // the HUD and suggestion buttons are camera children — the camera must
    // be part of the scene graph for three to render them
    scene.add(camera);

    // ── shared geometry ────────────────────────────────────────────────
    const shared: SharedGeometry = {
      plane: new THREE.PlaneGeometry(1, 1),
      planeEdges: new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      icosa: new THREE.IcosahedronGeometry(0.42, 0),
      icosaWire: new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.42, 0)),
      circle: new THREE.CircleGeometry(1, 24),
    };
    for (const geometry of Object.values(shared)) SHARED_KEYS.add(geometry);

    // ── deep space backdrop ───────────────────────────────────────────
    const starfield = createStarfield();
    scene.add(starfield.group);

    // Tunnel rings: one InstancedMesh, one draw call.
    const ringGeometry = new THREE.TorusGeometry(7.2, 0.014, 4, 72);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x9d8cff,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const RINGS = 72;
    const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, RINGS);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let index = 0; index < RINGS; index += 1) {
      const depth = index / (RINGS - 1);
      position.set(0, 0, 6 - depth * 1240);
      const size = 1 + (hashUnit(`ring-${index}`) - 0.5) * 0.34 + depth * 0.55;
      scale.set(size, size, 1);
      matrix.compose(position, quaternion, scale);
      rings.setMatrixAt(index, matrix);
    }
    rings.instanceMatrix.needsUpdate = true;
    rings.frustumCulled = false;
    scene.add(rings);

    // Four long rails on the tunnel wall: one LineSegments draw call.
    const railPositions: number[] = [];
    for (const [x, y] of [
      [-10, 7],
      [10, 7],
      [-10, -7],
      [10, -7],
    ] as const) {
      railPositions.push(x, y, 10, x, y, -1240);
    }
    const railGeometry = new THREE.BufferGeometry();
    railGeometry.setAttribute("position", new THREE.Float32BufferAttribute(railPositions, 3));
    const railMaterial = new THREE.LineBasicMaterial({
      color: 0x5d6f9f,
      transparent: true,
      opacity: 0.28,
      fog: true,
    });
    const rails = new THREE.LineSegments(railGeometry, railMaterial);
    rails.frustumCulled = false;
    scene.add(rails);

    // ── camera + follow model ─────────────────────────────────────────
    const cameraCtl = new TunnelCamera(modelRef.current.bounds, { followGap: TUNNEL.followGap });

    // ── HUD (camera child, 3D text) ───────────────────────────────────
    const hudGroup = new THREE.Group();
    camera.add(hudGroup);

    const hudTitle = new Text();
    hudTitle.fontSize = 0.2;
    hudTitle.maxWidth = 20;
    hudTitle.anchorX = "left";
    hudTitle.anchorY = "top";
    hudTitle.color = TONE_COLOR.text;
    hudTitle.fillOpacity = 1;
    hudTitle.outlineWidth = 0.004;
    hudTitle.outlineColor = "#05060a";
    hudTitle.outlineOpacity = 0.9;
    hudTitle.material.depthTest = false;
    hudTitle.material.depthWrite = false;
    hudTitle.material.fog = false;
    hudTitle.renderOrder = 999;
    hudTitle.frustumCulled = false;
    hudGroup.add(hudTitle);

    const hudStatus = new Text();
    hudStatus.fontSize = 0.13;
    hudStatus.maxWidth = 20;
    hudStatus.anchorX = "left";
    hudStatus.anchorY = "top";
    hudStatus.color = TONE_COLOR.cyan;
    hudStatus.fillOpacity = 1;
    hudStatus.material.depthTest = false;
    hudStatus.material.depthWrite = false;
    hudStatus.material.fog = false;
    hudStatus.renderOrder = 999;
    hudStatus.frustumCulled = false;
    hudGroup.add(hudStatus);

    const hudLine = new Text();
    hudLine.fontSize = 0.105;
    hudLine.maxWidth = 20;
    hudLine.anchorX = "left";
    hudLine.anchorY = "top";
    hudLine.color = TONE_COLOR.faint;
    hudLine.fillOpacity = 1;
    hudLine.material.depthTest = false;
    hudLine.material.depthWrite = false;
    hudLine.material.fog = false;
    hudLine.renderOrder = 999;
    hudLine.frustumCulled = false;
    hudGroup.add(hudLine);

    const hudDot = new THREE.Mesh(
      shared.circle,
      new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.95 })
    );
    hudDot.scale.setScalar(0.045);
    hudDot.position.set(0, -0.53, 0);
    hudDot.renderOrder = 1000;
    hudGroup.add(hudDot);

    function applyHud(hud: OrbitHud): void {
      const onSynced = () => {
        if (reduced) requestRender();
      };
      if (hudTitle.text !== hud.title) {
        hudTitle.text = hud.title;
        hudTitle.sync(onSynced);
      }
      const statusLine = `${hud.status} · ${hud.tokens}`;
      if (hudStatus.text !== statusLine) {
        hudStatus.text = statusLine;
        hudStatus.sync(onSynced);
      }
      hudStatus.color = TONE_COLOR[hud.statusTone];
      if (hudLine.text !== hud.line) {
        hudLine.text = hud.line;
        hudLine.sync(onSynced);
      }
      (hudDot.material as THREE.MeshBasicMaterial).color.copy(toneColor(hud.statusTone));
    }
    applyHud(hudRef.current);

    // ── scene graph state ─────────────────────────────────────────────
    const nodeViews = new Map<string, NodeView>();
    const actionViews = new Map<string, ActionView>();
    let suggestionGroup: THREE.Group | null = null;
    let suggestionSignature = "";
    const pickables: THREE.Object3D[] = [];
    const dirty = new Set<Text>();
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    function markDirty(text: Text): void {
      const onSynced = () => {
        if (reduced) requestRender();
      };
      if (reduced) {
        try {
          text.sync(onSynced);
        } catch {
          /* worker/font failure leaves the previous glyphs */
        }
        return;
      }
      dirty.add(text);
      if (syncTimer) return;
      syncTimer = setTimeout(() => {
        syncTimer = null;
        const batch = Array.from(dirty);
        dirty.clear();
        for (const item of batch) {
          try {
            item.sync(onSynced);
          } catch {
            /* keep rendering the rest */
          }
        }
      }, SYNC_THROTTLE_MS);
    }

    function removeActionViews(views: ActionView[]): void {
      for (const view of views) {
        for (const object of view.pickables) {
          const index = pickables.indexOf(object);
          if (index >= 0) pickables.splice(index, 1);
        }
        view.group.removeFromParent();
        disposeNodeObject(view.group);
        actionViews.delete(view.action.id);
      }
    }

    function removeNodeView(view: NodeView): void {
      removeActionViews(view.actions);
      nodeViews.delete(view.node.id);
      view.group.removeFromParent();
      disposeNodeObject(view.group);
    }

    function makeButton(action: SceneAction, tone: Tone): ActionView {
      const group = new THREE.Group();
      group.position.set(action.x, action.y, action.z);
      group.userData.actionId = action.id;

      const approve = action.kind === "approve";
      const fill = new THREE.MeshBasicMaterial({
        color: toneColor(tone),
        transparent: true,
        opacity: approve ? 0.9 : 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(shared.plane, fill);
      plane.scale.set(action.width, action.height, 1);
      plane.userData.actionId = action.id;
      group.add(plane);

      const border = new THREE.LineBasicMaterial({
        color: toneColor(tone),
        transparent: true,
        opacity: 0.85,
      });
      const edges = new THREE.LineSegments(shared.planeEdges, border);
      edges.scale.set(action.width, action.height, 1);
      group.add(edges);

      const label = new Text();
      label.text = action.label;
      label.fontSize = Math.min(0.26, action.height * 0.42);
      label.maxWidth = action.width * 0.88;
      label.anchorX = "center";
      label.anchorY = "middle";
      label.textAlign = "center";
      label.color = approve ? "#05060a" : TONE_COLOR[tone];
      label.fillOpacity = 1;
      label.outlineWidth = 0.002;
      label.outlineColor = "#05060a";
      label.outlineOpacity = 0.5;
      label.position.set(0, 0, 0.02);
      label.material.depthWrite = false;
      label.renderOrder = 4;
      label.frustumCulled = false;
      label.userData.actionId = action.id;
      label.sync(() => {
        if (reduced) requestRender();
      });
      group.add(label);

      pickables.push(plane, label);
      const view: ActionView = {
        action,
        group,
        fill,
        border,
        label,
        pickables: [plane, label],
        baseScale: 1,
      };
      actionViews.set(action.id, view);
      return view;
    }

    function buildNode(node: SceneNode, now: number): NodeView {
      const group = new THREE.Group();
      group.position.set(node.x, node.y, node.z);
      group.rotation.y = (hashUnit(node.id) - 0.5) * 0.04;
      group.userData.nodeId = node.id;

      let panelBorder: THREE.LineBasicMaterial | null = null;
      let spinner: THREE.Object3D | null = null;

      if (node.mesh === "panel" || node.mesh === "errorpanel") {
        const height = node.height + 0.45;
        const width = node.width;
        const anchorX = panelAnchorX(node);
        const panel = new THREE.Group();
        panel.position.set(anchorX, -height / 2, -0.06);
        const fillColor = toneColor(node.tone);
        const fill = new THREE.MeshBasicMaterial({
          color: fillColor,
          transparent: true,
          opacity: node.mesh === "errorpanel" ? 0.12 : node.kind === "interrupt" ? 0.1 : 0.055,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(shared.plane, fill);
        plane.scale.set(width, height, 1);
        panel.add(plane);

        panelBorder = new THREE.LineBasicMaterial({
          color: fillColor,
          transparent: true,
          opacity: node.kind === "interrupt" && node.status === "pending" ? 0.7 : 0.42,
        });
        const border = new THREE.LineSegments(shared.planeEdges, panelBorder);
        border.scale.set(width, height, 1);
        panel.add(border);
        group.add(panel);
      }

      if (node.mesh === "icosa") {
        const coreMaterial = new THREE.MeshBasicMaterial({
          color: toneColor(node.tone),
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        });
        const core = new THREE.Mesh(shared.icosa, coreMaterial);
        core.position.set(0.45, -0.7, 0);
        group.add(core);

        const wireMaterial = new THREE.LineBasicMaterial({
          color: toneColor(node.tone),
          transparent: true,
          opacity: 0.9,
        });
        const wire = new THREE.LineSegments(shared.icosaWire, wireMaterial);
        wire.position.copy(core.position);
        group.add(wire);
        spinner = wire;
      }

      const segments = new Map<string, SegmentView>();
      for (const segment of node.segments) {
        const offsetX = node.mesh === "icosa" ? 1.15 : 0;
        const view = makeText(segment, TONE_COLOR[segment.tone], offsetX, now, () => {
          if (reduced) requestRender();
        });
        segments.set(segment.id, view);
        group.add(view.text);
      }

      const actions: ActionView[] = [];
      for (const action of node.actions) {
        const view = makeButton(action, action.kind === "approve" ? "amber" : "red");
        group.add(view.group);
        actions.push(view);
      }

      return {
        node,
        group,
        segments,
        actions,
        signature: nodeSignature(node),
        bornAt: now,
        panelBorder,
        spinner,
      };
    }

    function updateNode(view: NodeView, node: SceneNode, now: number): void {
      view.node = node;
      view.group.position.set(node.x, node.y, node.z);
      view.group.rotation.y = (hashUnit(node.id) - 0.5) * 0.04;

      const seen = new Set<string>();
      const offsetX = node.mesh === "icosa" ? 1.15 : 0;
      for (const segment of node.segments) {
        seen.add(segment.id);
        const existing = view.segments.get(segment.id);
        if (!existing) {
          const created = makeText(segment, TONE_COLOR[segment.tone], offsetX, now, () => {
            if (reduced) requestRender();
          });
          view.segments.set(segment.id, created);
          view.group.add(created.text);
          continue;
        }
        existing.segment = segment;
        existing.offsetX = offsetX;
        existing.text.fontSize = segment.size;
        existing.text.maxWidth = segment.maxWidth;
        existing.text.anchorX = segment.anchorX;
        existing.text.textAlign = segment.align;
        existing.text.color = TONE_COLOR[segment.tone];
        existing.text.position.set(offsetX, -segment.offsetY, segment.depthJitter);
        if (existing.content !== segment.text) {
          existing.content = segment.text;
          existing.text.text = wrapForMesh(segment.text, segment.maxWidth, segment.size);
          existing.pulseAt = now;
          markDirty(existing.text);
        }
      }
      for (const [id, segmentView] of view.segments) {
        if (seen.has(id)) continue;
        view.segments.delete(id);
        segmentView.text.removeFromParent();
        segmentView.text.dispose();
      }

      // Panels grow when a streamed paragraph adds lines; text stations need
      // no mesh resize, and approvals are rebuilt on state changes.
    }

    function reconcile(model: SceneModel): void {
      const now = performance.now();
      const seen = new Set<string>();
      for (const node of model.nodes) {
        seen.add(node.id);
        const existing = nodeViews.get(node.id);
        if (!existing) {
          const view = buildNode(node, now);
          nodeViews.set(node.id, view);
          scene.add(view.group);
        } else if (existing.signature !== nodeSignature(node)) {
          removeNodeView(existing);
          const view = buildNode(node, now);
          view.bornAt = existing.bornAt;
          nodeViews.set(node.id, view);
          scene.add(view.group);
        } else {
          updateNode(existing, node, now);
        }
      }
      for (const [id, view] of Array.from(nodeViews)) {
        if (!seen.has(id)) removeNodeView(view);
      }
      cameraCtl.updateBounds(model.bounds);
      rebuildSuggestions(model.cameraActions, now);
      collectProxies();
      if (reduced) {
        cameraCtl.snap();
        requestRender();
      }
    }

    function rebuildSuggestions(actions: SceneAction[], now: number): void {
      const signature = actions.map((action) => `${action.id}:${action.label}`).join("|");
      if (signature === suggestionSignature) return;
      suggestionSignature = signature;
      if (suggestionGroup) {
        for (const view of Array.from(actionViews.values())) {
          if (view.action.space === "camera") removeActionViews([view]);
        }
        suggestionGroup.removeFromParent();
        disposeNodeObject(suggestionGroup);
        suggestionGroup = null;
      }
      if (!actions.length) return;
      suggestionGroup = new THREE.Group();
      for (const action of actions) {
        const view = makeButton(action, "mint");
        view.fill.opacity = 0.12;
        view.border.opacity = 0.55;
        view.label.color = TONE_COLOR.mint;
        view.label.fontSize = 0.15;
        view.group.position.set(action.x, action.y, action.z);
        suggestionGroup.add(view.group);
      }
      suggestionGroup.userData.bornAt = now;
      camera.add(suggestionGroup);
    }

    // ── DOM proxies ───────────────────────────────────────────────────
    interface ProxyEntry {
      element: HTMLElement;
      action: SceneAction;
    }
    let proxies: ProxyEntry[] = [];
    let highlightId: string | null = null;

    function collectProxies(): void {
      const root = proxyRootRef.current.current;
      if (!root) {
        proxies = [];
        return;
      }
      const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-scene-action]"));
      const actions = new Map<string, SceneAction>();
      for (const view of actionViews.values()) actions.set(view.action.id, view.action);
      proxies = elements
        .map((element) => {
          const action = actions.get(element.dataset.sceneAction ?? "");
          return action ? { element, action } : null;
        })
        .filter((entry): entry is ProxyEntry => entry !== null);
    }

    const projection = new THREE.Vector3();
    const cameraSpace = new THREE.Vector3();

    function layoutProxies(): void {
      if (!proxies.length) return;
      const width = renderer.domElement.clientWidth || host?.clientWidth || 1;
      const height = renderer.domElement.clientHeight || host?.clientHeight || 1;
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      for (const { element, action } of proxies) {
        // A control on a non-focused station is not on screen; hide it so it
        // also leaves the tab order (display:none).
        if (action.space === "node" && action.nodeId !== focusId) {
          element.style.display = "none";
          continue;
        }
        let scaleFactor = 1;
        if (action.space === "node" && action.nodeId) {
          const view = nodeViews.get(action.nodeId);
          if (!view) {
            element.style.display = "none";
            continue;
          }
          projection.set(action.x, action.y, action.z);
          view.group.localToWorld(projection);
          scaleFactor = view.group.scale.x;
        } else {
          projection.set(action.x, action.y, action.z);
          camera.localToWorld(projection);
        }
        cameraSpace.copy(projection).applyMatrix4(camera.matrixWorldInverse);
        const distance = -cameraSpace.z;
        if (distance <= 0.25) {
          element.style.display = "none";
          continue;
        }
        projection.project(camera);
        const px = (projection.x * 0.5 + 0.5) * width;
        const py = (-projection.y * 0.5 + 0.5) * height;
        const pxPerUnit = height / (2 * distance * tan);
        const boxWidth = action.width * pxPerUnit * scaleFactor;
        const boxHeight = action.height * pxPerUnit * scaleFactor;
        element.style.display = "block";
        element.style.width = `${Math.max(24, boxWidth)}px`;
        element.style.height = `${Math.max(20, boxHeight)}px`;
        element.style.transform = `translate(${px - Math.max(24, boxWidth) / 2}px, ${py - Math.max(20, boxHeight) / 2}px)`;
      }
    }

    // ── interaction ───────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;

    function toNdc(event: PointerEvent): THREE.Vector2 {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      return pointer;
    }

    function pickAction(event: PointerEvent): SceneAction | null {
      raycaster.setFromCamera(toNdc(event), camera);
      const hits = raycaster.intersectObjects(pickables, false);
      for (const hit of hits) {
        let object: THREE.Object3D | null = hit.object;
        while (object) {
          const id = object.userData.actionId as string | undefined;
          const view = id ? actionViews.get(id) : undefined;
          if (view) {
            // ignore controls on stations that are not currently framed
            if (view.action.space === "node" && view.action.nodeId !== focusId) break;
            return view.action;
          }
          object = object.parent;
        }
      }
      return null;
    }

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return;
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      pointerDown = null;
      if (moved > 8) return;
      const action = pickAction(event);
      if (action) onActionRef.current(action);
    };
    const onPointerMoveCanvas = (event: PointerEvent) => {
      canvas.style.cursor = pickAction(event) ? "pointer" : "grab";
    };

    let parallaxX = 0;
    let parallaxY = 0;
    let targetX = 0;
    let targetY = 0;
    const onPointerMoveWindow = (event: PointerEvent) => {
      targetX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      targetY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };

    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      // the composer is the one DOM surface; let it scroll/edit normally
      if (target?.closest(".or-dock")) return;
      event.preventDefault();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      lastWheelAt = performance.now();
      cameraCtl.wheel(event.deltaY * multiplier);
      if (reduced) requestRender();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      onFailRef.current("context-lost");
    };

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame && !disposed) {
        clock.getDelta();
        loop();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMoveCanvas, { passive: true });
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    document.addEventListener("wheel", onWheel, { passive: false });
    if (!reduced) window.addEventListener("pointermove", onPointerMoveWindow, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    const proxyRoot = proxyRootRef.current.current;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const id = target?.dataset?.sceneAction ?? null;
      highlightId = id;
      if (reduced) requestRender();
    };
    const onFocusOut = () => {
      highlightId = null;
      if (reduced) requestRender();
    };
    proxyRoot?.addEventListener("focusin", onFocusIn);
    proxyRoot?.addEventListener("focusout", onFocusOut);

    // ── resize ────────────────────────────────────────────────────────
    let viewportWidth = 1;
    let viewportHeight = 1;
    const resize = () => {
      viewportWidth = Math.max(1, host.clientWidth || window.innerWidth || 1);
      viewportHeight = Math.max(1, host.clientHeight || window.innerHeight || 1);
      renderer.setSize(viewportWidth, viewportHeight, false);
      camera.aspect = viewportWidth / viewportHeight;
      camera.updateProjectionMatrix();
      if (reduced) requestRender();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    window.addEventListener("resize", resize);
    resize();

    // ── animation ─────────────────────────────────────────────────────

    function updateAnimations(now: number): void {
      const delta = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      for (const view of nodeViews.values()) {
        const isFocus = view.node.id === focusId;
        // One readable chamber at a time: a faint near-station at 3–8 units
        // would still cover the HUD and the focused text.
        const focusFactor = isFocus ? 1 : 0;
        const progress = reduced ? 1 : clamp((now - view.bornAt) / MATERIALIZE_MS, 0, 1);
        const eased = easeOutCubic(progress);
        view.group.scale.setScalar(0.6 + 0.4 * eased);
        view.group.position.z = view.node.z - 2.5 * (1 - eased);
        view.group.visible = focusFactor > 0.02;
        const baseOpacity = clamped01(eased);
        for (const segment of view.segments.values()) {
          const own = reduced ? 1 : clamp((now - segment.bornAt) / MATERIALIZE_MS, 0, 1);
          const opacity = baseOpacity * clamped01(easeOutCubic(own)) * focusFactor;
          segment.text.fillOpacity = opacity;
          const pulse = reduced ? 0 : 1 - clamp((now - segment.pulseAt) / MATERIALIZE_MS, 0, 1);
          if (pulse > 0) {
            segment.text.outlineColor = TONE_COLOR[segment.segment.tone];
            segment.text.outlineWidth = segment.segment.size * (0.016 + 0.06 * pulse);
            segment.text.outlineOpacity = 0.2 + 0.75 * pulse;
          } else {
            segment.text.outlineColor = "#05060a";
            segment.text.outlineWidth = segment.segment.size * 0.016;
            segment.text.outlineOpacity = 0.75;
          }
        }
        if (view.panelBorder && view.node.kind === "interrupt" && view.node.status === "pending" && !reduced) {
          view.panelBorder.opacity = 0.5 + 0.24 * Math.sin(now / 360);
        }
        if (view.spinner && !reduced) {
          view.spinner.rotation.x += delta * 0.7;
          view.spinner.rotation.y += delta * 0.9;
        }
        for (const action of view.actions) {
          const focused = highlightId === action.action.id;
          const pulse = focused ? 1.08 + Math.sin(now / 160) * 0.03 : 1;
          action.group.scale.setScalar(pulse);
          action.border.color.set(focused ? 0xffffff : TONE_COLOR[action.action.kind === "approve" ? "amber" : "red"]);
        }
      }
      for (const action of actionViews.values()) {
        if (action.action.space !== "camera") continue;
        const focused = highlightId === action.action.id;
        action.group.scale.setScalar(focused ? 1.08 : 1);
        action.border.color.set(focused ? 0xffffff : accentRef.current);
      }
      if (!reduced) {
        rings.rotation.z += delta * 0.02;
        starfield.group.rotation.y += delta * 0.008;
      }
    }

    function placeHud(): void {
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * HUD_DISTANCE;
      const halfWidth = halfHeight * camera.aspect;
      hudGroup.position.set(-halfWidth + 0.32, halfHeight - 0.24, -HUD_DISTANCE);
      const maxWidth = Math.max(3, halfWidth * 2 - 0.64);
      hudTitle.maxWidth = maxWidth;
      hudStatus.maxWidth = maxWidth;
      hudLine.maxWidth = maxWidth;
      hudStatus.position.set(0, -0.38, 0);
      hudLine.position.set(0, -0.64, 0);
      hudDot.position.set(-0.07, -0.445, 0);
    }

    function renderFrame(): void {
      const now = performance.now();
      const camZ = reduced ? cameraCtl.snap() : cameraCtl.tick(clock.getDelta());
      if (!reduced) {
        parallaxX += (targetX * 0.42 - parallaxX) * 0.06;
        parallaxY += (targetY * 0.3 - parallaxY) * 0.06;
      } else {
        parallaxX = 0;
        parallaxY = 0;
      }
      camera.position.set(parallaxX, -0.3 + parallaxY, camZ);

      // Frame the nearest station that is at least the reading distance
      // ahead. Choosing the nearest station to the reading plane (without
      // the "ahead" constraint) would sometimes select one only 4 units away
      // when the camera sits between two chambers — huge, tilted text.
      let focusNode: SceneNode | null = null;
      readingZ = camZ - TUNNEL.followGap;
      let fallback: SceneNode | null = null;
      for (const view of nodeViews.values()) {
        if (!fallback || view.node.z > fallback.z) fallback = view.node;
        if (view.node.z <= readingZ + 0.001 && (!focusNode || view.node.z > focusNode.z)) {
          focusNode = view.node;
        }
      }
      if (!focusNode) focusNode = fallback;
      focusId = focusNode?.id ?? null;

      // Magnetic chamber snap: once the wheel has been idle for a beat,
      // settle the camera at the focused station's comfortable reading
      // distance. Without it a scroll can stop halfway between chambers and
      // frame the next station from 30+ units (tiny text).
      if (!reduced && !cameraCtl.following && focusNode && now - lastWheelAt > 240) {
        const desired = focusNode.z + Math.max(TUNNEL.followGap, focusNode.height * 0.95 + 3);
        cameraCtl.targetZ = clamp(desired, cameraCtl.minZ, cameraCtl.maxZ);
        if (cameraCtl.targetZ <= cameraCtl.minZ + 0.01) {
          cameraCtl.following = true;
          cameraCtl.targetZ = cameraCtl.minZ;
        }
      }
      if (focusNode) {
        const anchor = focusNode.segments[0]?.anchorX ?? "center";
        const centerX =
          focusNode.x +
          (anchor === "left" ? focusNode.width / 2 : anchor === "right" ? -focusNode.width / 2 : 0);
        focusSmooth.x += (centerX - focusSmooth.x) * 0.09;
        focusSmooth.y += (focusNode.y - focusNode.height / 2 - focusSmooth.y) * 0.09;
      }
      // Always look at the reading depth ahead of the lens. Smoothing the
      // target's Z would let the camera overtake it during a fast dolly and
      // look backwards (mirrored text).
      camera.lookAt(focusSmooth.x, focusSmooth.y, focusNode ? focusNode.z : camZ - TUNNEL.followGap);

      starfield.group.position.set(parallaxX * 0.5, parallaxY * 0.5, camZ);
      placeHud();
      updateAnimations(now);
      layoutProxies();
      renderer.render(scene, camera);
    }

    function loop(): void {
      frame = 0;
      if (disposed || document.hidden) return;
      frame = requestAnimationFrame(loop);
      renderFrame();
    }

    function requestRender(): void {
      if (!reduced || disposed || renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        if (disposed) return;
        renderFrame();
      });
    }

    // ── kick off ──────────────────────────────────────────────────────
    runtimeRef.current = {
      reconcile,
      updateHud: (hud, accent) => {
        accentRef.current = accent;
        applyHud(hud);
        if (reduced) requestRender();
      },
      dispose: () => {
        disposed = true;
        if (frame) cancelAnimationFrame(frame);
        if (syncTimer) clearTimeout(syncTimer);
        observer?.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointerMoveWindow);
        document.removeEventListener("visibilitychange", onVisibility);
        proxyRoot?.removeEventListener("focusin", onFocusIn);
        proxyRoot?.removeEventListener("focusout", onFocusOut);
        document.removeEventListener("wheel", onWheel);
        proxyRoot?.removeEventListener("focusin", onFocusIn);
        proxyRoot?.removeEventListener("focusout", onFocusOut);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointermove", onPointerMoveCanvas);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        for (const view of Array.from(nodeViews.values())) removeNodeView(view);
        if (suggestionGroup) {
          suggestionGroup.removeFromParent();
          disposeNodeObject(suggestionGroup);
          suggestionGroup = null;
        }
        for (const text of dirty) text.dispose();
        dirty.clear();
        disposeText(hudTitle);
        disposeText(hudStatus);
        disposeText(hudLine);
        (hudDot.material as THREE.MeshBasicMaterial).dispose();
        starfield.dispose();
        rings.dispose();
        ringGeometry.dispose();
        ringMaterial.dispose();
        railGeometry.dispose();
        railMaterial.dispose();
        for (const geometry of Object.values(shared)) geometry.dispose();
        renderer.dispose();
        try {
          renderer.forceContextLoss();
        } catch {
          /* context already gone */
        }
        canvas.remove();
        runtimeRef.current = null;
      },
    };

    reconcile(modelRef.current);
    placeHud();
    renderFrame();
    onReadyRef.current();
    if (!reduced) loop();

    return () => {
      runtimeRef.current?.dispose();
    };
  }, [reduced]);

  // ── model + HUD updates (no remount) ───────────────────────────────
  useEffect(() => {
    runtimeRef.current?.reconcile(props.model);
  }, [props.model]);

  useEffect(() => {
    runtimeRef.current?.updateHud(props.hud, props.accent);
  }, [props.hud, props.accent]);

  return <div ref={hostRef} className="or-scene-host absolute inset-0" aria-hidden="true" />;
}

function clamped01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
