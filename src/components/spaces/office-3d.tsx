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
 * The office, in three.js.
 *
 * One canvas serves both audiences: employees orbit the floor and click a chair to book it, admins
 * get corner handles and draggable chairs. Geometry is in metres; a room's group sits at its centre
 * and `layoutShell` re-places its four walls around that centre, so a corner drag reshapes the room
 * while the chairs inside stay put. Walls are deliberately knee-high: the plan is read from above.
 */

const FLOOR_TOP = 0.09;
/** Knee-high walls: a room reads as a room without hiding the chairs behind it. */
const WALL_HEIGHT = 0.95;
const WALL_THICKNESS = 0.075;
/** The slight platform every room stands on, so rooms read as separate places on the slab. */
const PLATFORM_HEIGHT = 0.05;
const SEAT_BASE = PLATFORM_HEIGHT;
const CHAIR_SEAT = 0.48;
const CLICK_TOLERANCE_PX = 5;

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
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  pickables: THREE.Object3D[];
  roomGroups: Map<string, THREE.Group>;
  drag: DragState | null;
  pointer: { x: number; y: number; at: number } | null;
  hoveredSeatId: string | null;
}

const COLORS = {
  free: '#2f6fa3',
  taken: '#9ca8b8',
  mine: '#15803d',
  selected: '#e08a00',
  floor: '#e4e9f1',
  slab: '#b7c2d1',
  grid: '#c8d0dc',
  wall: '#ffffff',
  leg: '#8d98a8',
  wood: '#e0c39a',
};

const material = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04, ...options });

/** Round every edge a little: the whole scene reads softer than raw boxes. */
const rounded = (width: number, height: number, depth: number, radius: number) =>
  new RoundedBoxGeometry(width, height, depth, 2, radius);

/** A desk in front of a chair in a whole-day area: warm top, four slim legs. */
function buildDesk(): THREE.Group {
  const desk = new THREE.Group();
  const depth = -0.48;
  const top = new THREE.Mesh(
    rounded(1.0, 0.045, 0.56, 0.02),
    material(COLORS.wood, { roughness: 0.7 })
  );
  top.position.set(0, 0.72, depth);
  top.castShadow = true;
  top.receiveShadow = true;
  desk.add(top);

  const legGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8);
  const legMaterial = material(COLORS.leg, { metalness: 0.5, roughness: 0.4 });
  [-0.45, 0.45].forEach(x => {
    [-0.24, 0.24].forEach(offset => {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(x, 0.35, depth + offset);
      leg.castShadow = true;
      desk.add(leg);
    });
  });

  return desk;
}

/** A room's name plate, drawn on a canvas so no font file has to be downloaded. */
function labelSprite(text: string, color: string): THREE.Sprite {
  const scale = 4;
  const font = `600 ${13 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (measure) measure.font = font;
  const pad = 18 * scale;
  const width = Math.ceil((measure?.measureText(text).width || 120) + pad * 2);
  const height = 38 * scale;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = font;
    ctx.shadowColor = 'rgba(15,23,42,0.16)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.beginPath();
    ctx.roundRect(2 * scale, 2 * scale, width - 4 * scale, height - 6 * scale, 9 * scale);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 - scale);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 0.72;
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
 * Place the four walls, their rims and the floor patch of a room inside its shell. Called when the
 * room is built and again on every corner drag, so the walls follow the corner without rebuilding
 * the scene.
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
    if (child.name.startsWith('rim:')) {
      const wall = walls[child.name.slice(4)];
      if (!wall) return;
      // The rim is the coloured line on top of the wall — the room's only strong colour.
      child.scale.set(wall.size[0] + 0.02, 0.035, wall.size[2] + 0.02);
      child.position.set(wall.pos[0], top + WALL_HEIGHT + 0.016, wall.pos[2]);
      return;
    }
    if (child.name === 'platform') {
      child.scale.set(width, 1, depth);
      return;
    }
    if (child.name.startsWith('skirt:')) {
      const side = child.name.slice(6);
      const inner = WALL_THICKNESS + 0.01;
      const band = 0.045;
      if (side === 'n' || side === 's') {
        child.scale.set(width - inner * 2, band, 0.012);
        child.position.set(0, PLATFORM_HEIGHT + band / 2, (side === 'n' ? -1 : 1) * (halfD - inner) - (side === 'n' ? band / 2 : -band / 2));
      } else {
        child.scale.set(0.012, band, depth - inner * 2);
        child.position.set((side === 'w' ? -1 : 1) * (halfW - inner) - (side === 'w' ? band / 2 : -band / 2), PLATFORM_HEIGHT + band / 2, 0);
      }
      return;
    }
    if (child.name === 'label') {
      child.position.set(0, top + WALL_HEIGHT + 0.45, -halfD);
      return;
    }
    if (child.name === 'hit') {
      child.scale.set(width, 2.4, depth);
    }
  });

  group.children.forEach(child => {
    if (!child.name.startsWith('handle:')) return;
    const corner = child.name.split(':')[1] as RoomCorner;
    child.position.set(
      (corner === 'nw' || corner === 'sw' ? -1 : 1) * halfW,
      0.22,
      (corner === 'nw' || corner === 'ne' ? -1 : 1) * halfD
    );
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
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(36, mount.clientWidth / mount.clientHeight, 0.1, 400);
    camera.position.set(0, 17, 21);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 5;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI / 2.15;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc2cddd, 0.45));
    scene.add(new THREE.AmbientLight(0xffffff, 0.06));
    // One shadow-casting key light, framed on the floor, is what gives the model its depth.
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
    sun.position.set(14, 24, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdce8ff, 0.32);
    fill.position.set(-16, 12, -14);
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
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
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

  // Frame the camera on the floor: close enough that the chairs read, wide enough that nothing clips.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { camera } = state;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfWidth = Math.tan(halfFov) * Math.max(camera.aspect, 0.2);
    // A 45° view foreshortens depth, so the slab needs less room than its real size suggests.
    const fitDepth = (floor.depth * 0.68 + 1) / 2 / Math.tan(halfFov);
    const fitWidth = (floor.width + 1.5) / 2 / halfWidth;
    const distance = Math.max(fitDepth, fitWidth) * 1.08;
    camera.position.set(0, distance * 0.78, distance * 0.63);
    state.controls.target.set(0, 0, 0);
    state.controls.update();
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

    // The slab: a soft-edged base plate with the plan's walking surface on top.
    const slab = new THREE.Mesh(
      rounded(floor.width, 0.26, floor.depth, 0.12),
      material(COLORS.slab, { roughness: 0.95 })
    );
    slab.position.y = FLOOR_TOP - 0.13;
    slab.receiveShadow = true;
    state.content.add(slab);

    // A soft blob under the slab, so the plan sits on the card instead of floating in it.
    const contact = document.createElement('canvas');
    contact.width = 256;
    contact.height = 256;
    const contactCtx = contact.getContext('2d');
    if (contactCtx) {
      const gradient = contactCtx.createRadialGradient(128, 128, 40, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(23,35,54,0.22)');
      gradient.addColorStop(0.62, 'rgba(23,35,54,0.10)');
      gradient.addColorStop(1, 'rgba(23,35,54,0)');
      contactCtx.fillStyle = gradient;
      contactCtx.fillRect(0, 0, 256, 256);
    }
    const contactTexture = new THREE.CanvasTexture(contact);
    contactTexture.colorSpace = THREE.SRGBColorSpace;
    const shadowPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(floor.width * 1.22, floor.depth * 1.3),
      new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false })
    );
    shadowPlate.rotation.x = -Math.PI / 2;
    shadowPlate.position.y = FLOOR_TOP - 0.3;
    state.content.add(shadowPlate);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(floor.width - 0.12, 1), Math.max(floor.depth - 0.12, 1)),
      material(COLORS.floor, { roughness: 0.98 })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = FLOOR_TOP + 0.001;
    surface.receiveShadow = true;
    state.content.add(surface);

    // A one-metre grid drawn to the slab's own size, so it never spills past the edge.
    const gridPoints: number[] = [];
    for (let x = -halfW + 1; x < halfW - 0.05; x += 1) gridPoints.push(x, 0, -halfD, x, 0, halfD);
    for (let z = -halfD + 1; z < halfD - 0.05; z += 1) gridPoints.push(-halfW, 0, z, halfW, 0, z);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.5 })
    );
    grid.position.y = FLOOR_TOP + 0.003;
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

      // Platform and tinted floor: the room's footprint on the slab.
      const platform = new THREE.Mesh(
        rounded(1, PLATFORM_HEIGHT, 1, 0.02),
        material(typeColor.clone().lerp(new THREE.Color('#ffffff'), 0.94), { roughness: 0.96 })
      );
      platform.name = 'platform';
      platform.position.y = PLATFORM_HEIGHT / 2;
      platform.receiveShadow = true;
      shell.add(platform);

      // A painted band along the inside of the walls: colour without fogging the floor.
      (['n', 's', 'w', 'e'] as const).forEach(side => {
        const skirt = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: typeColor, transparent: true, opacity: 0.55 })
        );
        skirt.name = `skirt:${side}`;
        shell.add(skirt);
      });

      // Four low walls, each capped with the room type's colour.
      (['n', 's', 'w', 'e'] as const).forEach(side => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(COLORS.wall, { roughness: 0.9 }));
        wall.name = `wall:${side}`;
        wall.castShadow = true;
        wall.receiveShadow = true;
        shell.add(wall);

        const rim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(typeColor, { roughness: 0.55 }));
        rim.name = `rim:${side}`;
        shell.add(rim);
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
      hitBox.position.y = 1.2;
      hitBox.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(hitBox);

      group.add(shell);

      const roomSeats = seats.filter(seat => seat.space_id === room.id && seat.active);
      const withDesks = kindRef.current?.(room) === 'whole_day' && roomSeats.length > 2;

      roomSeats
        .forEach((seat, index) => {
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

          const fabric = material(seatColor, { roughness: 0.5 });
          const cushion = new THREE.Mesh(rounded(CHAIR_SEAT, 0.12, CHAIR_SEAT * 0.96, 0.05), fabric);
          cushion.position.y = 0.42;
          cushion.castShadow = true;
          cushion.receiveShadow = true;
          seatGroup.add(cushion);

          const back = new THREE.Mesh(rounded(CHAIR_SEAT * 0.96, 0.26, 0.09, 0.045), fabric);
          back.position.set(0, 0.57, CHAIR_SEAT * 0.42);
          back.rotation.x = THREE.MathUtils.degToRad(-10);
          back.castShadow = true;
          seatGroup.add(back);

          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.038, 0.36, 12),
            material(COLORS.leg, { metalness: 0.55, roughness: 0.35 })
          );
          post.position.y = 0.19;
          seatGroup.add(post);

          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.13, 0.15, 0.03, 24),
            material(COLORS.leg, { metalness: 0.5, roughness: 0.4 })
          );
          base.position.y = 0.015;
          base.castShadow = true;
          seatGroup.add(base);

          if (isSelected) {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(CHAIR_SEAT * 0.62, CHAIR_SEAT * 0.74, 28),
              new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.004;
            seatGroup.add(ring);
          }

          if (withDesks) seatGroup.add(buildDesk());

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
