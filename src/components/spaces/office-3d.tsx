"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { OfficeFloor, Space, SpaceSeat } from '@/lib/types';
import {
  clampRoomToFloor, clampSeatToRoom, resizeFromCorner, roomSize, snap, type RoomCorner,
} from '@/lib/office-layout';

/**
 * The office, in three.js.
 *
 * One canvas serves both audiences: employees orbit the floor and click a seat to book it, admins get
 * corner handles and draggable seats. Geometry is in metres; a room's group sits at its centre and its
 * shell is scaled, so dragging a corner resizes the walls while the seats inside stay put.
 */

const FLOOR_TOP = 0.11;
const SEAT_HEIGHT = 0.46;
const SEAT_RADIUS = 0.21;
const CLICK_TOLERANCE_PX = 5;

export type Office3DMode = 'viewer' | 'editor';

export interface Office3DProps {
  floor: OfficeFloor;
  rooms: Space[];
  seats: SpaceSeat[];
  /** Seat ids already taken on the day being shown. */
  takenSeatIds: string[];
  /** The viewer's own seat, highlighted green. */
  mySeatId?: string | null;
  selectedRoomId?: string | null;
  selectedSeatId?: string | null;
  mode: Office3DMode;
  colorForRoom: (room: Space) => string;
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
}

const COLORS = {
  free: '#2f6fa3',
  taken: '#94a3b8',
  mine: '#15803d',
  selected: '#f59e0b',
  floor: '#e7ebf0',
  slab: '#d7dde5',
  grid: '#c3ccd6',
};

/** A readable room name in 3D, without shipping a font loader. */
function labelSprite(text: string, color: string): THREE.Sprite {
  const scale = 4;
  const font = `${12 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (measure) measure.font = font;
  const pad = 14 * scale;
  const width = Math.ceil((measure?.measureText(text).width || 120) + pad * 2);
  const height = 34 * scale;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(148,163,184,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, width - 2, height - 2, 10 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 0.5;
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

/** Resize the room's shell in place while a corner is being dragged. */
function scaleShell(group: THREE.Group, width: number, depth: number): void {
  shellOf(group)?.children.forEach(child => {
    if (child.name === 'walls' || child.name === 'edges' || child.name === 'hit') {
      child.scale.set(width, child.scale.y, depth);
    } else if (child.name === 'patch') {
      child.scale.set(width, depth, 1);
    }
  });
  group.children.forEach(child => {
    if (!child.name.startsWith('handle:')) return;
    const corner = child.name.split(':')[1] as RoomCorner;
    child.position.set(
      (corner === 'nw' || corner === 'sw' ? -1 : 1) * width / 2,
      0.18,
      (corner === 'nw' || corner === 'ne' ? -1 : 1) * depth / 2
    );
  });
}

export const Office3D: React.FC<Office3DProps> = ({
  floor, rooms, seats, takenSeatIds, mySeatId, selectedRoomId, selectedSeatId, mode,
  colorForRoom, onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const dataRef = useRef({ rooms, seats, takenSeatIds, mySeatId, selectedRoomId, selectedSeatId, mode });
  const callbacksRef = useRef({ onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat });
  const colorRef = useRef(colorForRoom);
  const floorRef = useRef(floor);

  useEffect(() => {
    dataRef.current = { rooms, seats, takenSeatIds, mySeatId, selectedRoomId, selectedSeatId, mode };
    callbacksRef.current = { onSelectRoom, onSelectSeat, onMoveRoom, onResizeRoom, onMoveSeat };
    colorRef.current = colorForRoom;
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
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, mount.clientWidth / mount.clientHeight, 0.1, 400);
    camera.position.set(0, 17, 21);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 5;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI / 2.15;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dee6, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.55);
    sun.position.set(12, 22, 10);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-14, 10, -12);
    scene.add(fill);

    const content = new THREE.Group();
    scene.add(content);

    const state: SceneState = {
      renderer, scene, camera, controls, content,
      pickables: [], roomGroups: new Map(), drag: null, pointer: null,
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
        scaleShell(group, resized.room_width, resized.room_depth);
        return;
      }
      if (drag.kind === 'seat' && drag.seatId) {
        const seatGroup = group.children.find(child => child.name === `seat:${drag.seatId}`) as THREE.Group | undefined;
        if (!seatGroup) return;
        const local = clampSeatToRoom(room, snap(point.x - group.position.x), snap(point.z - group.position.z));
        seatGroup.position.set(local.x, SEAT_HEIGHT / 2, local.z);
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
        const walls = shellOf(group)?.children.find(child => child.name === 'walls') as THREE.Mesh | undefined;
        resizeRoom?.(
          room,
          snap(walls?.scale.x || room.room_width || 4),
          snap(walls?.scale.z || room.room_depth || 3.5),
          snap(group.position.x),
          snap(group.position.z)
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
    const fitDepth = (floor.depth * 0.72 + 1.5) / 2 / Math.tan(halfFov);
    const fitWidth = (floor.width + 1.5) / 2 / halfWidth;
    const distance = Math.max(fitDepth, fitWidth) * 1.12;
    camera.position.set(0, distance * 0.68, distance * 0.68);
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

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(floor.width, 0.22, floor.depth),
      new THREE.MeshLambertMaterial({ color: COLORS.slab })
    );
    state.content.add(slab);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(floor.width - 0.1, 1), Math.max(floor.depth - 0.1, 1)),
      new THREE.MeshLambertMaterial({ color: COLORS.floor })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = FLOOR_TOP;
    state.content.add(surface);

    const span = Math.max(floor.width, floor.depth);
    const grid = new THREE.GridHelper(span, Math.max(2, Math.round(span / 2)), COLORS.grid, COLORS.grid);
    grid.position.y = FLOOR_TOP + 0.002;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    state.content.add(grid);

    const taken = new Set(takenSeatIds);

    rooms.forEach(room => {
      const { width, depth } = roomSize(room);
      const height = Number(room.room_height) || 2.6;
      const color = colorRef.current(room);
      const group = new THREE.Group();
      group.position.set(Number(room.pos_x) || 0, FLOOR_TOP, Number(room.pos_z) || 0);

      const shell = new THREE.Group();
      shell.name = 'shell';

      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false })
      );
      walls.name = 'walls';
      walls.position.y = height / 2;
      walls.scale.set(width, height, depth);
      shell.add(walls);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color })
      );
      edges.name = 'edges';
      edges.position.y = height / 2;
      edges.scale.set(width, height, depth);
      shell.add(edges);

      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
      );
      patch.name = 'patch';
      patch.rotation.x = -Math.PI / 2;
      patch.position.y = 0.004;
      patch.scale.set(width, depth, 1);
      shell.add(patch);

      const label = labelSprite(room.name, color);
      label.position.y = height + 0.42;
      label.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(label);

      // Invisible volume that catches room drags and clicks.
      const hitBox = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitBox.name = 'hit';
      hitBox.position.y = height / 2;
      hitBox.scale.set(width, height, depth);
      hitBox.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(hitBox);

      group.add(shell);

      seats
        .filter(seat => seat.space_id === room.id && seat.active)
        .forEach((seat, index) => {
          const isMine = mySeatId === seat.id;
          const isTaken = taken.has(seat.id);
          const isSelected = selectedSeatId === seat.id;
          const seatColor = isSelected ? COLORS.selected : isMine ? COLORS.mine : isTaken ? COLORS.taken : COLORS.free;
          const seatGroup = new THREE.Group();
          seatGroup.name = `seat:${seat.id}`;
          seatGroup.position.set(Number(seat.x) || 0, SEAT_HEIGHT / 2, Number(seat.z) || 0);
          seatGroup.rotation.y = ((Number(seat.rotation) || 0) * Math.PI) / 180;
          const label = `${seat.label || `Seat ${index + 1}`} · ${room.name}${isMine ? ' (yours)' : isTaken ? ' (taken)' : ''}`;
          seatGroup.userData = { kind: 'seat', roomId: room.id, seatId: seat.id, label };

          const cushion = new THREE.Mesh(
            new THREE.CylinderGeometry(SEAT_RADIUS, SEAT_RADIUS, SEAT_HEIGHT, 18),
            new THREE.MeshLambertMaterial({ color: seatColor })
          );
          cushion.userData = seatGroup.userData;
          seatGroup.add(cushion);

          const back = new THREE.Mesh(
            new THREE.BoxGeometry(SEAT_RADIUS * 1.8, 0.34, 0.06),
            new THREE.MeshLambertMaterial({ color: seatColor })
          );
          back.position.set(0, 0.14, -SEAT_RADIUS * 0.86);
          back.userData = seatGroup.userData;
          seatGroup.add(back);

          group.add(seatGroup);
        });

      if (mode === 'editor' && selectedRoomId === room.id) {
        (['nw', 'ne', 'sw', 'se'] as RoomCorner[]).forEach(corner => {
          const handle = new THREE.Mesh(
            new THREE.SphereGeometry(0.17, 16, 16),
            new THREE.MeshLambertMaterial({ color: COLORS.selected })
          );
          handle.name = `handle:${corner}`;
          handle.position.set(
            (corner === 'nw' || corner === 'sw' ? -1 : 1) * width / 2,
            0.18,
            (corner === 'nw' || corner === 'ne' ? -1 : 1) * depth / 2
          );
          handle.userData = { kind: 'handle', roomId: room.id, corner, label: 'Drag to resize' };
          group.add(handle);
        });
      }

      state.content.add(group);
      state.roomGroups.set(room.id, group);
      state.pickables.push(group);
    });
  }, [ready, rooms, seats, takenSeatIds, mySeatId, selectedRoomId, selectedSeatId, mode, floor.width, floor.depth, floor.id]);

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
