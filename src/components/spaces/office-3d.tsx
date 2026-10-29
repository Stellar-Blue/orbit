"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OfficeFloor, Space, SpaceSeat } from '@/lib/types';
import {
  clampRoomToFloor, clampSeatToRoom, resizeFromCorner, roomSize, snap, type RoomCorner,
} from '@/lib/office-layout';

/**
 * The office, in three.js — a small isometric model of the floor.
 *
 * One canvas serves both audiences: employees orbit the model and click a chair to book it, admins
 * get corner handles and draggable chairs. Geometry is in metres; a room's group sits at its centre
 * and `layoutShell` re-places its four walls around that centre, so a corner drag reshapes the room
 * while the furniture inside stays put.
 *
 * The dollhouse look comes from three choices: an orthographic camera (no perspective distortion),
 * full-height white walls, and hiding the walls that face the camera so every room is cut open
 * towards the viewer, exactly like an architectural model.
 */

const FLOOR_TOP = 0.12;
const WALL_HEIGHT = 2.4;
const WALL_THICKNESS = 0.18;
/** The paper-thin platform each room stands on, so a room reads as its own place on the slab. */
const PLATFORM_HEIGHT = 0.05;
const SEAT_BASE = PLATFORM_HEIGHT;
const CHAIR_SEAT = 0.5;
const CLICK_TOLERANCE_PX = 5;
/** Camera direction of the default isometric view. */
const VIEW_DIRECTION = new THREE.Vector3(1, 1.12, 1).normalize();

export type Office3DMode = 'viewer' | 'editor';

export interface Office3DProps {
  floor: OfficeFloor;
  rooms: Space[];
  seats: SpaceSeat[];
  /** Seat ids already taken on the day being shown. */
  takenSeatIds: string[];
  /** The viewer's own chairs for the day, highlighted green. One per room at most. */
  mySeatIds?: string[];
  selectedRoomId?: string | null;
  selectedSeatId?: string | null;
  mode: Office3DMode;
  colorForRoom: (room: Space) => string;
  /** How the room is booked: a whole-day area gets a desk per chair. */
  kindForRoom?: (room: Space) => 'whole_day' | 'time_range' | null;
  onSelectRoom?: (room: Space | null) => void;
  onSelectSeat?: (seat: SpaceSeat, room: Space) => void;
  onMoveRoom?: (room: Space, x: number, z: number) => void;
  onResizeRoom?: (room: Space, width: number, depth: number, x: number, z: number) => void;
  onMoveSeat?: (seat: SpaceSeat, x: number, z: number) => void;
}

type PickedKind = 'room' | 'seat' | 'handle';

interface DragState {
  kind: 'room' | 'corner' | 'seat';
  roomId: string;
  seatId?: string;
  corner?: RoomCorner;
  start: THREE.Vector3;
  anchor: { x: number; z: number };
  moved: boolean;
  /** Latest size/position of a corner drag, committed when the pointer is released. */
  pending?: { width: number; depth: number; x: number; z: number };
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  content: THREE.Group;
  pickables: THREE.Object3D[];
  roomGroups: Map<string, THREE.Group>;
  drag: DragState | null;
  pointer: { x: number; y: number; at: number } | null;
  hoveredSeatId: string | null;
}

const COLORS = {
  // The whole model lives in warm neutrals; the only strong hues are the seat states.
  free: '#7fa8c9',
  taken: '#b3a898',
  mine: '#7cab8b',
  selected: '#d99a4e',
  floor: '#e9e1d3',
  slab: '#e4dccb',
  grid: '#ded5c4',
  wall: '#3a342d',
  wallTop: '#4d453c',
  wallInner: '#efeae1',
  leg: '#3f3931',
  desk: '#c9a97b',
  screen: '#2b2721',
  paper: '#fbf8f3',
};

/** A room floor: the type colour warmed into the palette instead of a pastel block. */
const WARM_FLOOR = new THREE.Color('#f8f3ea');

function roomFloor(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const tinted = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s * 0.5, 0.3), 0.94);
  return tinted.lerp(WARM_FLOOR, 0.5);
}

const material = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04, ...options });

/** Round every edge a little: the whole scene reads softer than raw boxes. */
const rounded = (width: number, height: number, depth: number, radius: number) =>
  new RoundedBoxGeometry(width, height, depth, 2, radius);

/** A desk with a monitor and a keyboard, sitting in front of its chair. */
function buildDesk(): THREE.Group {
  const desk = new THREE.Group();
  const z = -0.52;
  const metal = material(COLORS.leg, { metalness: 0.2, roughness: 0.5 });

  const top = new THREE.Mesh(rounded(1.12, 0.055, 0.62, 0.025), material(COLORS.desk, { roughness: 0.72 }));
  top.position.set(0, 0.74, z);
  top.castShadow = true;
  top.receiveShadow = true;
  desk.add(top);

  const legGeometry = new THREE.CylinderGeometry(0.019, 0.019, 0.72, 8);
  [-0.5, 0.5].forEach(x => {
    [-0.24, 0.24].forEach(offset => {
      const leg = new THREE.Mesh(legGeometry, metal);
      leg.position.set(x, 0.36, z + offset);
      leg.castShadow = true;
      desk.add(leg);
    });
  });

  const foot = new THREE.Mesh(rounded(0.26, 0.02, 0.16, 0.008), metal);
  foot.position.set(0, 0.78, z - 0.12);
  desk.add(foot);

  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), metal);
  stand.position.set(0, 0.88, z - 0.12);
  desk.add(stand);

  const screen = new THREE.Mesh(rounded(0.62, 0.36, 0.035, 0.014), material(COLORS.screen, { roughness: 0.45 }));
  screen.position.set(0, 1.14, z - 0.12);
  screen.castShadow = true;
  desk.add(screen);

  const keyboard = new THREE.Mesh(rounded(0.34, 0.014, 0.13, 0.008), material(COLORS.paper, { roughness: 0.6 }));
  keyboard.position.set(0, 0.78, z + 0.2);
  desk.add(keyboard);

  return desk;
}

/** A soft elliptical shadow, drawn by the shader so no texture has to be sampled. */
function softShadow(size: number, depth: number, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, depth),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: opacity },
        uColor: { value: new THREE.Color('#0f172a') },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uOpacity;
        uniform vec3 uColor;
        void main() {
          float d = length(vUv - vec2(0.5)) * 2.0;
          float alpha = pow(1.0 - smoothstep(0.0, 1.0, d), 1.5) * uOpacity;
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** A screen on a room's back wall, for the rooms people meet in. */
function buildWallScreen(width: number): THREE.Group {
  const frame = new THREE.Group();
  const bezel = new THREE.Mesh(rounded(width + 0.08, 0.94, 0.05, 0.02), material(COLORS.paper, { roughness: 0.7 }));
  frame.add(bezel);
  const panel = new THREE.Mesh(rounded(width, 0.86, 0.02, 0.012), material(COLORS.screen, { roughness: 0.3 }));
  panel.position.z = 0.03;
  frame.add(panel);
  return frame;
}

/** A room's name plate: a soft white pill with dark slate text, drawn without a font loader. */
function labelSprite(text: string, color: string): THREE.Sprite {
  const scale = 4;
  const font = `600 ${12 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (measure) measure.font = font;
  const pad = 16 * scale;
  const width = Math.ceil((measure?.measureText(text).width || 120) + pad * 2);
  const height = 34 * scale;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = font;
    ctx.shadowColor = 'rgba(23,35,54,0.18)';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.roundRect(2 * scale, 2 * scale, width - 4 * scale, height - 6 * scale, 8 * scale);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(14 * scale, height / 2 - scale, 3.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(14 * scale, height / 2 - scale, 3.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 24 * scale, height / 2 - scale);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMaterial);
  const worldHeight = 0.9;
  sprite.scale.set(worldHeight * (width / height), worldHeight, 1);
  return sprite;
}

/** Free GPU memory before rebuilding the scene graph. */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    materials.forEach(entry => {
      (entry as THREE.MeshBasicMaterial).map?.dispose();
      entry.dispose();
    });
  });
}

const shellOf = (group?: THREE.Group) => group?.children.find(child => child.name === 'shell') as THREE.Group | undefined;

const seatGroupOf = (state: SceneState, seatId: string): THREE.Group | undefined => {
  for (const group of state.roomGroups.values()) {
    const seat = group.children.find(child => child.name === `seat:${seatId}`);
    if (seat) return seat as THREE.Group;
  }
  return undefined;
};

/** Lift the chair under the pointer a little, so it is obvious what a click will book. */
function highlightSeat(state: SceneState, seatId: string | null): void {
  if (state.hoveredSeatId === seatId) return;
  if (state.hoveredSeatId) seatGroupOf(state, state.hoveredSeatId)?.scale.setScalar(1);
  state.hoveredSeatId = seatId;
  if (seatId) seatGroupOf(state, seatId)?.scale.setScalar(1.1);
}

/**
 * Place the four walls, the floor and the handles of a room inside its shell. Called when the room
 * is built and again on every corner drag, so the walls follow the corner without a scene rebuild.
 */
function layoutShell(group: THREE.Group, width: number, depth: number): void {
  const shell = shellOf(group);
  const halfW = width / 2;
  const halfD = depth / 2;
  const t = WALL_THICKNESS;
  const top = PLATFORM_HEIGHT;

  const walls: Record<string, { size: [number, number, number]; pos: [number, number, number] }> = {
    n: { size: [width, WALL_HEIGHT, t], pos: [0, top + WALL_HEIGHT / 2, -halfD + t / 2] },
    s: { size: [width, WALL_HEIGHT, t], pos: [0, top + WALL_HEIGHT / 2, halfD - t / 2] },
    w: { size: [t, WALL_HEIGHT, Math.max(depth - 2 * t, 0.05)], pos: [-halfW + t / 2, top + WALL_HEIGHT / 2, 0] },
    e: { size: [t, WALL_HEIGHT, Math.max(depth - 2 * t, 0.05)], pos: [halfW - t / 2, top + WALL_HEIGHT / 2, 0] },
  };

  shell?.children.forEach(child => {
    if (child.name.startsWith('wall:')) {
      const wall = walls[child.name.slice(5)];
      if (!wall) return;
      child.scale.set(...wall.size);
      child.position.set(...wall.pos);
      return;
    }
    if (child.name.startsWith('cap:')) {
      const wall = walls[child.name.slice(4)];
      if (!wall) return;
      // A hairline along the top of each wall: the cut edge of the model.
      child.scale.set(wall.size[0], 0.03, wall.size[2]);
      child.position.set(wall.pos[0], top + WALL_HEIGHT, wall.pos[2]);
      return;
    }
    if (child.name === 'platform') {
      child.scale.set(width, 1, depth);
      return;
    }
    if (child.name.startsWith('screen:')) {
      const side = child.name.slice(7);
      if (side === 'n') child.position.set(0, 1.5, -halfD + t + 0.03);
      else child.position.set(-halfW + t + 0.03, 1.5, 0);
      return;
    }
    if (child.name === 'label') {
      child.position.set(0, top + WALL_HEIGHT + 0.42, halfD * 0.1);
      return;
    }
    if (child.name === 'hit') {
      child.scale.set(width, WALL_HEIGHT, depth);
      child.position.y = WALL_HEIGHT / 2;
    }
  });

  group.children.forEach(child => {
    if (!child.name.startsWith('handle:')) return;
    const corner = child.name.split(':')[1] as RoomCorner;
    child.position.set(
      (corner === 'nw' || corner === 'sw' ? -1 : 1) * halfW,
      0.24,
      (corner === 'nw' || corner === 'ne' ? -1 : 1) * halfD
    );
  });
}

/** Hide the walls standing between the camera and a room, so every room is cut open to the viewer. */
function cutAwayWalls(state: SceneState): void {
  const { x: cameraX, z: cameraZ } = state.camera.position;
  state.roomGroups.forEach(group => {
    const shell = shellOf(group);
    if (!shell) return;
    const dx = cameraX - group.position.x;
    const dz = cameraZ - group.position.z;
    shell.children.forEach(child => {
      const index = child.name.indexOf(':');
      if (index < 0) return;
      const prefix = child.name.slice(0, index);
      if (prefix !== 'wall' && prefix !== 'cap' && prefix !== 'screen') return;
      const side = child.name.slice(index + 1);
      const facing = side === 'n' ? -dz : side === 's' ? dz : side === 'w' ? -dx : dx;
      child.visible = facing <= 0;
    });
  });
}

export const Office3D: React.FC<Office3DProps> = ({
  floor, rooms, seats, takenSeatIds, mySeatIds, selectedRoomId, selectedSeatId, mode,
  colorForRoom, kindForRoom, onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const dataRef = useRef({ rooms, seats, takenSeatIds, mySeatIds, selectedRoomId, selectedSeatId, mode });
  const callbacksRef = useRef({ onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat });
  const colorRef = useRef(colorForRoom);
  const kindRef = useRef(kindForRoom);
  const floorRef = useRef(floor);

  useEffect(() => {
    dataRef.current = { rooms, seats, takenSeatIds, mySeatIds, selectedRoomId, selectedSeatId, mode };
    callbacksRef.current = { onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat };
    colorRef.current = colorForRoom;
    kindRef.current = kindForRoom;
    floorRef.current = floor;
  });

  const groundPoint = useCallback((state: SceneState, clientX: number, clientY: number) => {
    const rect = state.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, state.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_TOP);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }, []);

  const pick = useCallback((state: SceneState, clientX: number, clientY: number) => {
    const rect = state.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, state.camera);
    const hits = raycaster.intersectObjects(state.pickables, true);
    // Seats and handles are small and sit inside the room volume, so they win over the room box.
    for (const kind of ['handle', 'seat', 'room'] as PickedKind[]) {
      const match = hits.find(hit => (hit.object.userData as { kind?: string }).kind === kind);
      if (match) {
        return {
          data: match.object.userData as {
            kind: PickedKind; roomId: string; seatId?: string; corner?: RoomCorner; label?: string;
          },
          point: match.point,
        };
      }
    }
    return null;
  }, []);

  // ---- scene lifecycle -----------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.2;

    // Orthographic: the model keeps its proportions wherever you stand, like a rendered plan.
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(90);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minZoom = 0.35;
    controls.maxZoom = 6;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d4e4, 0.3));
    scene.add(new THREE.AmbientLight(0xffffff, 0.06));
    // One big, soft key light is what gives the model its depth and its gentle shadows.
    const sun = new THREE.DirectionalLight(0xfff8ef, 2.6);
    sun.position.set(14, 24, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 2;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.008;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    // The ortho shadow camera keeps its old projection until it is told otherwise.
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.18);
    fill.position.set(-18, 14, -16);
    scene.add(fill);

    const content = new THREE.Group();
    scene.add(content);

    const state: SceneState = {
      renderer, scene, camera, controls, content,
      pickables: [], roomGroups: new Map(), drag: null, pointer: null, hoveredSeatId: null,
    };
    stateRef.current = state;

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      const aspect = mount.clientWidth / mount.clientHeight;
      const halfHeight = 10;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      cutAwayWalls(state);
      renderer.render(scene, camera);
    };
    animate();

    const canvas = renderer.domElement;

    const onPointerDown = (event: PointerEvent) => {
      const current = stateRef.current;
      if (!current) return;
      current.pointer = { x: event.clientX, y: event.clientY, at: Date.now() };
      const { mode: currentMode, selectedRoomId: selectedRoom } = dataRef.current;
      if (currentMode !== 'editor') return;

      const hit = pick(current, event.clientX, event.clientY);
      if (!hit) return;
      const room = dataRef.current.rooms.find(entry => entry.id === hit.data.roomId);
      if (!room) return;

      // Editing: claim the gesture, or OrbitControls would orbit the camera instead.
      setHover(null);
      event.stopPropagation();
      event.preventDefault();
      const point = groundPoint(current, event.clientX, event.clientY);
      if (!point) return;
      const anchor = { x: Number(room.pos_x) || 0, z: Number(room.pos_z) || 0 };

      if (hit.data.kind === 'handle' && hit.data.corner && room.id === selectedRoom) {
        current.drag = { kind: 'corner', roomId: room.id, corner: hit.data.corner, start: point, anchor, moved: false };
      } else if (hit.data.kind === 'seat' && hit.data.seatId) {
        current.drag = { kind: 'seat', roomId: room.id, seatId: hit.data.seatId, start: point, anchor, moved: false };
      } else {
        current.drag = { kind: 'room', roomId: room.id, start: point, anchor, moved: false };
      }
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = stateRef.current;
      if (!current) return;
      const drag = current.drag;

      if (!drag) {
        const hit = pick(current, event.clientX, event.clientY);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        const label = hit ? String(hit.data.label || '') : '';
        setHover(previous => (previous === (label || null) ? previous : (label || null)));
        highlightSeat(current, hit?.data.kind === 'seat' ? (hit.data.seatId ?? null) : null);
        return;
      }

      const point = groundPoint(current, event.clientX, event.clientY);
      if (!point) return;
      const dx = point.x - drag.start.x;
      const dz = point.z - drag.start.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.08) drag.moved = true;

      const room = dataRef.current.rooms.find(entry => entry.id === drag.roomId);
      const group = current.roomGroups.get(drag.roomId);
      if (!room || !group) return;

      if (drag.kind === 'room') {
        const next = clampRoomToFloor(room, floorRef.current, drag.anchor.x + dx, drag.anchor.z + dz);
        group.position.set(next.x, FLOOR_TOP, next.z);
        return;
      }
      if (drag.kind === 'corner' && drag.corner) {
        const plan = floorRef.current;
        const resized = resizeFromCorner(room, drag.anchor.x, drag.anchor.z, drag.corner, {
          x: Math.min(Math.max(drag.anchor.x + dx, -plan.width / 2), plan.width / 2),
          z: Math.min(Math.max(drag.anchor.z + dz, -plan.depth / 2), plan.depth / 2),
        });
        const next = clampRoomToFloor(
          { room_width: resized.room_width, room_depth: resized.room_depth },
          plan,
          resized.pos_x,
          resized.pos_z
        );
        group.position.set(next.x, FLOOR_TOP, next.z);
        layoutShell(group, resized.room_width, resized.room_depth);
        drag.pending = { width: resized.room_width, depth: resized.room_depth, x: next.x, z: next.z };
        return;
      }
      if (drag.kind === 'seat' && drag.seatId) {
        const seatGroup = group.children.find(child => child.name === `seat:${drag.seatId}`) as THREE.Group | undefined;
        if (!seatGroup) return;
        const local = clampSeatToRoom(room, snap(point.x - group.position.x), snap(point.z - group.position.z));
        seatGroup.position.set(local.x, SEAT_BASE, local.z);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = stateRef.current;
      if (!current) return;
      const drag = current.drag;
      const pointer = current.pointer;
      current.drag = null;
      current.pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

      const {
        onSelectRoom: selectRoom, onSelectSeat: selectSeat,
        onMoveRoom: moveRoom, onResizeRoom: resizeRoom, onMoveSeat: moveSeat,
      } = callbacksRef.current;
      const { rooms: currentRooms, seats: currentSeats } = dataRef.current;

      // A click (not a drag) selects — in the viewer that is how a seat gets booked.
      const isClick = pointer
        && Math.abs(event.clientX - pointer.x) <= CLICK_TOLERANCE_PX
        && Math.abs(event.clientY - pointer.y) <= CLICK_TOLERANCE_PX
        && Date.now() - pointer.at < 600;

      if (!drag) {
        if (!isClick) return;
        const hit = pick(current, event.clientX, event.clientY);
        if (!hit) {
          selectRoom?.(null);
          return;
        }
        const room = currentRooms.find(entry => entry.id === hit.data.roomId);
        if (!room) return;
        if (hit.data.kind === 'seat' && hit.data.seatId) {
          const seat = currentSeats.find(entry => entry.id === hit.data.seatId);
          if (seat) selectSeat?.(seat, room);
          return;
        }
        selectRoom?.(room);
        return;
      }

      const room = currentRooms.find(entry => entry.id === drag.roomId);
      const group = current.roomGroups.get(drag.roomId);
      if (!room || !group) return;

      if (!drag.moved) {
        if (drag.seatId) {
          const seat = currentSeats.find(entry => entry.id === drag.seatId);
          if (seat) selectSeat?.(seat, room);
          return;
        }
        selectRoom?.(room);
        return;
      }

      if (drag.kind === 'room') {
        moveRoom?.(room, snap(group.position.x), snap(group.position.z));
        return;
      }
      if (drag.kind === 'corner') {
        const pending = drag.pending;
        resizeRoom?.(
          room,
          snap(pending?.width ?? room.room_width ?? 4),
          snap(pending?.depth ?? room.room_depth ?? 3.5),
          snap(pending?.x ?? group.position.x),
          snap(pending?.z ?? group.position.z)
        );
        return;
      }
      if (drag.kind === 'seat' && drag.seatId) {
        const seat = currentSeats.find(entry => entry.id === drag.seatId);
        const seatGroup = group.children.find(child => child.name === `seat:${drag.seatId}`) as THREE.Group | undefined;
        if (seat && seatGroup) moveSeat?.(seat, snap(seatGroup.position.x), snap(seatGroup.position.z));
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    setReady(true);
    return () => {
      setReady(false);
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      disposeGroup(content);
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // Built once: data changes are applied by the rebuild effect below.
  }, [groundPoint, pick]);

  // Frame the model: measure how big the floor and its walls project, then set the zoom to fit.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { camera, controls } = state;
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(90);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const corners: THREE.Vector3[] = [];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      corners.push(new THREE.Vector3((sx * floor.width) / 2, 0, (sz * floor.depth) / 2));
      corners.push(new THREE.Vector3((sx * floor.width) / 2, WALL_HEIGHT + 0.9, (sz * floor.depth) / 2));
    });

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    corners.forEach(corner => {
      const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, view.x);
      maxX = Math.max(maxX, view.x);
      minY = Math.min(minY, view.y);
      maxY = Math.max(maxY, view.y);
    });

    // Recentre on what the model actually covers, then zoom so it fills the canvas.
    const rightAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const upAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const shift = rightAxis.multiplyScalar((minX + maxX) / 2).add(upAxis.multiplyScalar((minY + maxY) / 2));
    camera.position.add(shift);
    controls.target.copy(shift);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();

    const halfW = Math.max((maxX - minX) / 2, 0.001);
    const halfH = Math.max((maxY - minY) / 2, 0.001);
    camera.zoom = Math.min(camera.right / halfW, camera.top / halfH) * 0.98;
    camera.updateProjectionMatrix();
    controls.update();
  }, [floor.id, floor.width, floor.depth, ready]);

  // ---- content rebuild -----------------------------------------------------
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !ready) return;

    disposeGroup(state.content);
    state.content.clear();
    state.pickables = [];
    state.roomGroups.clear();
    state.drag = null;
    state.hoveredSeatId = null;

    const halfW = floor.width / 2;
    const halfD = floor.depth / 2;

    // The base plate: a white slab with a soft shadow under it, like a model on a table.
    const shadowPlate = softShadow(floor.width * 1.4, floor.depth * 1.55, 0.5);
    shadowPlate.position.y = FLOOR_TOP - 0.45;
    state.content.add(shadowPlate);

    const slab = new THREE.Mesh(
      rounded(floor.width, 0.3, floor.depth, 0.1),
      material(COLORS.slab, { roughness: 0.95 })
    );
    slab.position.y = FLOOR_TOP - 0.15;
    // The slab must not cast: its own surface sits millimetres above it and would shadow the lot.
    slab.castShadow = false;
    slab.receiveShadow = true;
    state.content.add(slab);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(floor.width - 0.1, 1), Math.max(floor.depth - 0.1, 1)),
      material(COLORS.floor, { roughness: 0.98 })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = FLOOR_TOP + 0.001;
    surface.receiveShadow = true;
    state.content.add(surface);

    // A one-metre grid, drawn to the slab's own size so it never spills past the edge.
    const gridPoints: number[] = [];
    for (let x = -halfW + 1; x < halfW - 0.05; x += 1) gridPoints.push(x, 0, -halfD, x, 0, halfD);
    for (let z = -halfD + 1; z < halfD - 0.05; z += 1) gridPoints.push(-halfW, 0, z, halfW, 0, z);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.9 })
    );
    grid.position.y = FLOOR_TOP + 0.002;
    state.content.add(grid);

    const taken = new Set(takenSeatIds);
    const mine = new Set(mySeatIds);

    rooms.forEach(room => {
      const { width, depth } = roomSize(room);
      const color = colorRef.current(room);
      const typeColor = new THREE.Color(color);
      const group = new THREE.Group();
      group.position.set(Number(room.pos_x) || 0, FLOOR_TOP, Number(room.pos_z) || 0);

      const shell = new THREE.Group();
      shell.name = 'shell';

      // The room's own floor: a soft pastel version of the type colour, with a tile grid on top.
      const platform = new THREE.Mesh(
        rounded(1, PLATFORM_HEIGHT, 1, 0.015),
        material(roomFloor(typeColor), { roughness: 0.96 })
      );
      platform.name = 'platform';
      platform.position.y = PLATFORM_HEIGHT / 2;
      platform.receiveShadow = true;
      shell.add(platform);

      // Charcoal walls outside, warm plaster inside — the dollhouse look of a floor plan.
      const outer = material(COLORS.wall, { roughness: 0.88 });
      const inner = material(COLORS.wallInner, { roughness: 0.95 });
      const top = material(COLORS.wallTop, { roughness: 0.85 });
      const wallMaterials: Record<'n' | 's' | 'w' | 'e', THREE.Material[]> = {
        n: [outer, outer, top, outer, inner, outer],
        s: [outer, outer, top, outer, outer, inner],
        w: [inner, outer, top, outer, outer, outer],
        e: [outer, inner, top, outer, outer, outer],
      };
      (['n', 's', 'w', 'e'] as const).forEach(side => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallMaterials[side]);
        wall.name = `wall:${side}`;
        wall.castShadow = true;
        wall.receiveShadow = true;
        shell.add(wall);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(COLORS.wallTop, { roughness: 0.8 }));
        cap.name = `cap:${side}`;
        shell.add(cap);
      });

      const label = labelSprite(room.name, color);
      label.name = 'label';
      label.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(label);

      // Invisible volume that catches room drags and clicks.
      const hitBox = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitBox.name = 'hit';
      hitBox.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(hitBox);

      group.add(shell);

      const kind = kindRef.current?.(room) ?? null;
      if (kind === 'time_range' && width >= 3.4) {
        const screen = buildWallScreen(Math.min(width * 0.45, 1.6));
        screen.name = 'screen:n';
        shell.add(screen);
      }

      const roomSeats = seats.filter(seat => seat.space_id === room.id && seat.active);
      const withDesks = kind === 'whole_day' && roomSeats.length > 2;

      roomSeats.forEach((seat, index) => {
        const isMine = mine.has(seat.id);
        const isTaken = taken.has(seat.id);
        const isSelected = selectedSeatId === seat.id;
        const seatColor = isSelected ? COLORS.selected : isMine ? COLORS.mine : isTaken ? COLORS.taken : COLORS.free;
        const seatGroup = new THREE.Group();
        seatGroup.name = `seat:${seat.id}`;
        seatGroup.position.set(Number(seat.x) || 0, SEAT_BASE, Number(seat.z) || 0);
        seatGroup.rotation.y = ((Number(seat.rotation) || 0) * Math.PI) / 180;
        const label = `${seat.label || `Seat ${index + 1}`} · ${room.name}${isMine ? ' (yours)' : isTaken ? ' (taken)' : ''}`;
        const data = { kind: 'seat', roomId: room.id, seatId: seat.id, label };

        // One chair: a soft square seat, a slim back and four thin legs — nothing else.
        const fabric = material(seatColor, { roughness: 0.6 });
        const frame = material(COLORS.leg, { roughness: 0.45, metalness: 0.25 });

        const cushion = new THREE.Mesh(rounded(CHAIR_SEAT, 0.1, CHAIR_SEAT * 0.94, 0.045), fabric);
        cushion.position.y = 0.45;
        cushion.castShadow = true;
        cushion.receiveShadow = true;
        seatGroup.add(cushion);

        const back = new THREE.Mesh(rounded(CHAIR_SEAT * 0.94, 0.3, 0.075, 0.04), fabric);
        back.position.set(0, 0.61, CHAIR_SEAT * 0.4);
        back.rotation.x = THREE.MathUtils.degToRad(9);
        back.castShadow = true;
        seatGroup.add(back);

        const legGeometry = new THREE.CylinderGeometry(0.016, 0.016, 0.41, 8);
        [-1, 1].forEach(sx => {
          [-1, 1].forEach(sz => {
            const leg = new THREE.Mesh(legGeometry, frame);
            leg.position.set(sx * CHAIR_SEAT * 0.36, 0.205, sz * CHAIR_SEAT * 0.34);
            leg.castShadow = true;
            seatGroup.add(leg);
          });
        });

        if (isSelected) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(CHAIR_SEAT * 0.64, CHAIR_SEAT * 0.78, 28),
            new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.004;
          seatGroup.add(ring);
        }

        const chairBlob = softShadow(1.3, 1.3, 0.8);
        chairBlob.position.set(-0.12, 0.004, -0.12);
        seatGroup.add(chairBlob);

        if (withDesks) {
          seatGroup.add(buildDesk());
          const deskBlob = softShadow(2.0, 1.45, 0.7);
          deskBlob.position.set(-0.15, 0.005, -0.62);
          seatGroup.add(deskBlob);
        }

        seatGroup.traverse(child => {
          child.userData = data;
        });

        group.add(seatGroup);
      });

      if (mode === 'editor' && selectedRoomId === room.id) {
        (['nw', 'ne', 'sw', 'se'] as RoomCorner[]).forEach(corner => {
          const handle = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 20, 20),
            material(COLORS.selected, { roughness: 0.35, metalness: 0.15 })
          );
          handle.name = `handle:${corner}`;
          handle.castShadow = true;
          handle.userData = { kind: 'handle', roomId: room.id, corner, label: 'Drag to resize' };
          group.add(handle);
        });
      }

      // Laid out last: the shell and the corner handles both need their final positions.
      layoutShell(group, width, depth);

      state.content.add(group);
      state.roomGroups.set(room.id, group);
      state.pickables.push(group);
    });

  }, [ready, rooms, seats, takenSeatIds, mySeatIds, selectedRoomId, selectedSeatId, mode, floor.width, floor.depth, floor.id]);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />
      {hover && (
        <div className="pointer-events-none absolute left-3 bottom-3 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white/95 px-2 py-1 text-[11px] font-medium text-[var(--ink-2)] shadow-sm">
          {hover}
        </div>
      )}
      <div className="pointer-events-none absolute right-3 top-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-white/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-4)]">
        Drag to orbit · scroll to zoom
      </div>
    </div>
  );
};
