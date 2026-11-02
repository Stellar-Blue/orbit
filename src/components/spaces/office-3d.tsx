"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ZoomOut } from 'lucide-react';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OfficeFloor, Space, SpaceDesk, SpaceSeat } from '@/lib/types';
import {
  clampDeskToRoom, clampRoomToFloor, clampSeatToRoom, isLShaped, resizeFromCorner, roomOutline, roomRects,
  roomSize, snap, type RoomCorner,
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
const CLICK_TOLERANCE_PX = 5;
/** Camera direction of the default isometric view. */
const VIEW_DIRECTION = new THREE.Vector3(1, 1.12, 1).normalize();

export type Office3DMode = 'viewer' | 'editor';

/** Who holds a chair, drawn above it as a round picture. */
export interface SeatPerson {
  seatId: string;
  name: string;
  photoUrl?: string | null;
}

/** One line of a meeting room's schedule board. */
export interface SessionBoardRow {
  id: string;
  /** `09:30 – 10:30`. */
  window: string;
  title?: string | null;
  seats: number;
  capacity: number;
  /** The session whose people are drawn in the room right now. */
  selected: boolean;
  /** The window is running at this moment. */
  live?: boolean;
  /** The window is behind us. */
  ended?: boolean;
}

/** The table standing beside a meeting room, listing the day's sessions. */
export interface SessionBoard {
  roomId: string;
  /** `Sessions · 02/11/2026`. */
  heading: string;
  rows: SessionBoardRow[];
}

export interface Office3DProps {
  floor: OfficeFloor;
  rooms: Space[];
  seats: SpaceSeat[];
  /** Furniture drawn in the rooms. Desks never take a booking. */
  desks?: SpaceDesk[];
  /** Seat ids already taken on the day being shown. */
  takenSeatIds: string[];
  /** The viewer's own chairs for the day, highlighted green. One per room at most. */
  mySeatIds?: string[];
  /** The people holding chairs, so their picture can float above the seat they took. */
  seatPeople?: SeatPerson[];
  selectedRoomId?: string | null;
  selectedSeatId?: string | null;
  selectedDeskId?: string | null;
  mode: Office3DMode;
  colorForRoom: (room: Space) => string;
  /** How the room is booked — meeting rooms get a screen on the wall and a schedule board beside it. */
  kindForRoom?: (room: Space) => 'whole_day' | 'time_range' | null;
  /** The day's sessions per meeting room, printed on the board and clickable. */
  sessionBoards?: SessionBoard[];
  /** A session was picked on a room's card — show that one in the room. */
  onSelectSession?: (room: Space, sessionId: string) => void;
  /** The card's header was clicked — open the room's sessions, the full dialog in the parent. */
  onOpenRoom?: (room: Space) => void;
  onSelectRoom?: (room: Space | null) => void;
  onSelectSeat?: (seat: SpaceSeat, room: Space) => void;
  onSelectDesk?: (desk: SpaceDesk, room: Space) => void;
  onMoveRoom?: (room: Space, x: number, z: number) => void;
  onResizeRoom?: (room: Space, width: number, depth: number, x: number, z: number) => void;
  onMoveSeat?: (seat: SpaceSeat, x: number, z: number) => void;
  onMoveDesk?: (desk: SpaceDesk, x: number, z: number) => void;
  onResizeDesk?: (desk: SpaceDesk, width: number, depth: number) => void;
}

type PickedKind = 'room' | 'seat' | 'desk' | 'handle' | 'desk-handle';

interface DragState {
  kind: 'room' | 'corner' | 'seat' | 'desk' | 'desk-corner';
  roomId: string;
  seatId?: string;
  deskId?: string;
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
  // The model lives in warm neutrals. A chair is upholstered in its own state colour — black when it
  // is free, slate when a colleague holds it, green when it is yours — so the state reads from the
  // furniture itself, and the disc on the floor repeats it for chairs tucked under a desk.
  chair: '#262a30',
  chairSoft: '#33383f',
  chairMetal: '#4a5057',
  caster: '#15181c',
  chairTaken: '#5f7183',
  chairTakenSoft: '#516270',
  chairMine: '#4f8566',
  chairMineSoft: '#427058',
  free: '#8bb4d4',
  taken: '#5f7183',
  mine: '#4f8566',
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

/** The upholstery of a chair, chosen by the state of its seat. */
interface ChairTone {
  shell: string;
  trim: string;
}

const CHAIR_TONES = {
  free: { shell: COLORS.chair, trim: COLORS.chairSoft },
  taken: { shell: COLORS.chairTaken, trim: COLORS.chairTakenSoft },
  mine: { shell: COLORS.chairMine, trim: COLORS.chairMineSoft },
} as const;

/**
 * A task chair: five-star base on casters, gas lift, padded seat, curved backrest and two armrests.
 * The upholstery carries the state of the seat; the disc on the floor repeats it.
 */
function buildChair(tone: ChairTone = CHAIR_TONES.free): THREE.Group {
  const chair = new THREE.Group();
  const upholstery = material(tone.shell, { roughness: 0.62 });
  const trim = material(tone.trim, { roughness: 0.55 });
  const metal = material(COLORS.chairMetal, { metalness: 0.45, roughness: 0.4 });
  const rubber = material(COLORS.caster, { roughness: 0.75 });

  // Five legs radiating from the centre, each ending in a caster.
  const base = new THREE.Group();
  base.name = 'chair-base';
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    const leg = new THREE.Mesh(rounded(0.3, 0.032, 0.055, 0.014), metal);
    leg.position.set(Math.cos(angle) * 0.15, 0.075, Math.sin(angle) * 0.15);
    leg.rotation.y = -angle;
    leg.castShadow = true;
    base.add(leg);

    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), rubber);
    wheel.position.set(Math.cos(angle) * 0.29, 0.038, Math.sin(angle) * 0.29);
    wheel.castShadow = true;
    base.add(wheel);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 14), metal);
  hub.position.y = 0.08;
  base.add(hub);
  chair.add(base);

  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.24, 12), metal);
  lift.position.y = 0.23;
  chair.add(lift);

  const seat = new THREE.Mesh(rounded(0.46, 0.085, 0.44, 0.035), upholstery);
  seat.position.y = 0.42;
  seat.castShadow = true;
  seat.receiveShadow = true;
  chair.add(seat);

  const back = new THREE.Mesh(rounded(0.42, 0.46, 0.075, 0.03), upholstery);
  back.position.set(0, 0.66, 0.2);
  back.rotation.x = THREE.MathUtils.degToRad(10);
  back.castShadow = true;
  chair.add(back);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.03), trim);
  spine.position.set(0, 0.44, 0.225);
  chair.add(spine);

  [-1, 1].forEach(side => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), trim);
    post.position.set(side * 0.225, 0.5, 0.02);
    post.castShadow = true;
    chair.add(post);

    const rest = new THREE.Mesh(rounded(0.07, 0.03, 0.24, 0.014), trim);
    rest.position.set(side * 0.225, 0.575, 0.03);
    chair.add(rest);
  });

  return chair;
}

/**
 * A desk with a screen and a keyboard. Built once at its unit size and scaled to the footprint it is
 * given, so a corner drag resizes it without rebuilding the scene.
 */
function buildDesk(): THREE.Group {
  const desk = new THREE.Group();
  const wood = material(COLORS.desk, { roughness: 0.72 });
  const metal = material(COLORS.leg, { metalness: 0.2, roughness: 0.5 });

  const top = new THREE.Mesh(rounded(1, 0.055, 1, 0.018), wood);
  top.name = 'desk-top';
  top.position.y = 0.74;
  top.castShadow = true;
  top.receiveShadow = true;
  desk.add(top);

  const frame = new THREE.Group();
  frame.name = 'desk-frame';
  desk.add(frame);

  [-1, 1].forEach(sx => {
    [-1, 1].forEach(sz => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.72, 8), metal);
      leg.position.set(sx, 0.36, sz);
      leg.castShadow = true;
      frame.add(leg);
    });
  });

  const screen = new THREE.Mesh(rounded(0.5, 0.3, 0.03, 0.012), material(COLORS.screen, { roughness: 0.45 }));
  screen.name = 'desk-screen';
  screen.position.set(0, 1.06, -0.3);
  screen.castShadow = true;
  desk.add(screen);

  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), metal);
  stand.name = 'desk-stand';
  stand.position.set(0, 0.85, -0.3);
  desk.add(stand);

  const keyboard = new THREE.Mesh(rounded(0.3, 0.012, 0.12, 0.006), material(COLORS.paper, { roughness: 0.6 }));
  keyboard.name = 'desk-keyboard';
  keyboard.position.set(0, 0.775, 0.02);
  desk.add(keyboard);

  return desk;
}

/** Shape a desk to its footprint: the top stretches, the legs move to the corners, the props follow. */
function shapeDesk(desk: THREE.Group, width: number, depth: number, hasMonitor = true): void {
  const w = Math.max(0.3, width);
  const d = Math.max(0.3, depth);
  const hasProps = hasMonitor && w >= 0.9;

  const top = desk.getObjectByName('desk-top');
  if (top) top.scale.set(w, 1, d);

  desk.getObjectByName('desk-frame')?.children.forEach(child => {
    child.position.x *= Math.max(w / 2 - 0.06, 0);
    child.position.z *= Math.max(d / 2 - 0.06, 0);
  });

  const screen = desk.getObjectByName('desk-screen');
  if (screen) {
    screen.visible = hasProps;
    screen.position.set(0, 1.05, -d / 2 + 0.16);
    screen.scale.set(THREE.MathUtils.clamp(w / 1.4, 0.8, 1.8), 1, 1);
  }
  const stand = desk.getObjectByName('desk-stand');
  if (stand) {
    stand.visible = hasProps;
    stand.position.set(0, 0.82, -d / 2 + 0.16);
  }
  const keyboard = desk.getObjectByName('desk-keyboard');
  if (keyboard) {
    keyboard.visible = hasProps;
    keyboard.position.set(0, 0.775, Math.min(0.1, d / 2 - 0.12));
  }
}

/** A soft elliptical shadow, drawn by the shader so no texture has to be sampled. */
const AVATAR_TEXTURES = new Map<string, THREE.Texture>();

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${(parts[0]?.[0] ?? '?')}${(parts[1]?.[0] ?? '')}`.toUpperCase();
};

/**
 * The bubble above a taken chair: a round paper disc with the holder's initials, and their picture
 * painted over it once it loads. Uploaded photos are cross-origin, so anything that cannot be drawn
 * into the canvas simply leaves the initials in place — the chair still says who holds it.
 */
function avatarTexture(person: { name: string; photoUrl?: string | null }): THREE.Texture {
  const initials = initialsOf(person.name);
  const key = `${person.photoUrl || ''}|${initials}`;
  const cached = AVATAR_TEXTURES.get(key);
  if (cached) return cached;

  const size = 160;
  const radius = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    ctx.fillStyle = '#3a352f';
    ctx.font = `600 ${Math.round(size * 0.36)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, radius, radius + size * 0.03);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  AVATAR_TEXTURES.set(key, texture);

  if (ctx && person.photoUrl) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        ctx.save();
        ctx.beginPath();
        ctx.arc(radius, radius, radius - 8, 0, Math.PI * 2);
        ctx.clip();
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        ctx.restore();
        // Ring after the picture, so the bubble keeps its edge.
        ctx.beginPath();
        ctx.arc(radius, radius, radius - 6, 0, Math.PI * 2);
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        texture.needsUpdate = true;
      } catch {
        // A tainted canvas (no CORS on the photo host) leaves the initials, which is still useful.
      }
    };
    image.src = person.photoUrl;
  }

  return texture;
}

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

/**
 * A room's name plate: a soft white plaque with dark slate text, drawn without a font loader.
 * It is a flat plane rather than a billboard, because it is mounted on a wall — see
 * `placeRoomLabel` — instead of hovering over the furniture in the middle of the room.
 */
function namePlate(text: string, color: string): THREE.Mesh {
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
    ctx.shadowColor = 'rgba(23,35,54,0.14)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.beginPath();
    ctx.roundRect(2 * scale, 2 * scale, width - 4 * scale, height - 4 * scale, 8 * scale);
    ctx.fill();
    ctx.shadowColor = 'transparent';
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
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
  plate.userData.plateAspect = width / height;
  return plate;
}

/**
 * Hang a room's name plate on the wall the camera can actually see.
 *
 * The walls between the camera and a room are cut away every frame, so the plate goes on the far
 * wall — the one left standing — where it reads like a sign hanging in the room instead of a label
 * floating over the chairs. It also clears the wall screen, which sits lower on the same wall.
 */
function placeRoomLabel(shell: THREE.Group, position: THREE.Vector3, camera: THREE.Vector3): void {
  const label = shell.children.find(child => child.name === 'label') as THREE.Mesh | undefined;
  const size = shell.userData.roomSize as { width: number; depth: number } | undefined;
  if (!label || !size) return;

  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  const inset = WALL_THICKNESS / 2 + 0.02;
  const aspect = Number(label.userData.plateAspect) || 3;
  const dx = camera.x - position.x;
  const dz = camera.z - position.z;
  const onZAxis = Math.abs(dz) >= Math.abs(dx);
  const side = onZAxis ? (dz > 0 ? 'n' : 's') : (dx > 0 ? 'w' : 'e');
  const wallLength = onZAxis ? size.width : size.depth;

  const wantedHeight = 0.44;
  const width = Math.min(wantedHeight * aspect, Math.max(wallLength - 0.5, 0.6));
  const height = Math.min(wantedHeight, width / aspect);
  label.scale.set(width, height, 1);

  // Just under the cut edge of the wall, above the screen that may hang on the same run.
  const y = PLATFORM_HEIGHT + WALL_HEIGHT - height / 2 - 0.06;
  if (side === 'n') {
    label.position.set(0, y, -halfD + inset);
    label.rotation.y = 0;
  } else if (side === 's') {
    label.position.set(0, y, halfD - inset);
    label.rotation.y = Math.PI;
  } else if (side === 'w') {
    label.position.set(-halfW + inset, y, 0);
    label.rotation.y = Math.PI / 2;
  } else {
    label.position.set(halfW - inset, y, 0);
    label.rotation.y = -Math.PI / 2;
  }
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

/** One straight run of wall, with the side it faces so the camera can cut it away. */
interface WallSegment {
  key: number;
  side: 'n' | 's' | 'w' | 'e';
  size: [number, number, number];
  pos: [number, number, number];
}

/** A run is either along X (a north or south wall) or along Z (east or west). */
const wallIsAlongX = (wall: WallSegment) => wall.size[0] > wall.size[2];

/**
 * The walls of a room as straight runs along its outline. A rectangle gives four, an L gives six; the
 * runs overlap slightly at the corners so no seam shows.
 */
function wallSegments(outline: Array<{ x: number; z: number }>): WallSegment[] {
  const t = WALL_THICKNESS;
  const centreY = PLATFORM_HEIGHT + WALL_HEIGHT / 2;
  return outline.map((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const alongX = Math.abs(end.z - start.z) < 1e-6;
    const length = alongX ? Math.abs(end.x - start.x) : Math.abs(end.z - start.z);
    const midX = (start.x + end.x) / 2;
    const midZ = (start.z + end.z) / 2;
    if (alongX) {
      // A run along X faces north when it sits on the lower Z edge.
      return {
        key: index,
        side: (start.z < 0 ? 'n' : 's') as 'n' | 's',
        size: [length + t, WALL_HEIGHT, t] as [number, number, number],
        pos: [midX, centreY, midZ] as [number, number, number],
      };
    }
    return {
      key: index,
      side: (start.x < 0 ? 'w' : 'e') as 'w' | 'e',
      size: [t, WALL_HEIGHT, length + t] as [number, number, number],
      pos: [midX, centreY, midZ] as [number, number, number],
    };
  });
}

/** A flat, filled polygon in the floor plane, used for the room's floor. */
function outlineShape(outline: Array<{ x: number; z: number }>): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  return shape;
}

/**
 * Place the walls, the floor and the handles of a room inside its shell. Called when the room is
 * built and again on every corner drag, so the walls follow the corner without a scene rebuild.
 *
 * A shaped room can change footprint while it is dragged, so its floor and hit volume are rebuilt
 * here — the walls are boxes that simply take new sizes.
 */
function layoutShell(group: THREE.Group, room: Space, width: number, depth: number): void {
  const shell = shellOf(group);
  const halfW = width / 2;
  const halfD = depth / 2;
  const t = WALL_THICKNESS;
  const top = PLATFORM_HEIGHT;
  const outline = roomOutline({ ...room, room_width: width, room_depth: depth });
  const walls = wallSegments(outline);
  const shaped = isLShaped(room) && roomRects({ ...room, room_width: width, room_depth: depth }).length > 1;

  shell?.children.forEach(child => {
    if (child.name.startsWith('wall:')) {
      const wall = walls[Number(child.name.slice(5))];
      if (!wall) return;
      child.scale.set(...wall.size);
      child.position.set(...wall.pos);
      child.userData.side = wall.side;
      const materials = (shell.userData.wallMaterials as Record<string, THREE.Material[]> | undefined)?.[wall.side];
      if (materials) (child as THREE.Mesh).material = materials;
      return;
    }
    if (child.name.startsWith('cap:')) {
      const wall = walls[Number(child.name.slice(4))];
      if (!wall) return;
      // A hairline along the top of each wall: the cut edge of the model.
      child.scale.set(wall.size[0], 0.03, wall.size[2]);
      child.position.set(wall.pos[0], top + WALL_HEIGHT, wall.pos[2]);
      child.userData.side = wall.side;
      return;
    }
    if (child.name === 'platform' || child.name === 'hit') {
      if (!shaped) {
        child.scale.set(width, 1, depth);
        if (child.name === 'hit') {
          child.scale.set(width, WALL_HEIGHT, depth);
          child.position.y = WALL_HEIGHT / 2;
        }
        return;
      }
      // A stepped footprint gets a fresh extrude from the outline.
      const mesh = child as THREE.Mesh;
      const height = child.name === 'hit' ? WALL_HEIGHT : PLATFORM_HEIGHT;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.ExtrudeGeometry(outlineShape(outline), { depth: height, bevelEnabled: false });
      mesh.scale.set(1, 1, 1);
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.position.y = child.name === 'hit' ? 0 : 0;
      return;
    }
    if (child.name === 'floor-line') {
      const line = child as THREE.Line;
      line.geometry.dispose();
      const points = outline.map((point: { x: number; z: number }) => new THREE.Vector3(point.x, top + 0.003, point.z));
      line.geometry = new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
      return;
    }
    if (child.name.startsWith('screen:')) {
      const side = child.name.slice(7) as 'n' | 's' | 'w' | 'e';
      // Hang it on the longest run of that wall: an L-shaped room has more than one.
      const candidates = walls.filter(wall => wall.side === side);
      const run = candidates.sort((a, b) => Math.max(b.size[0], b.size[2]) - Math.max(a.size[0], a.size[2]))[0];
      if (!run) return;
      const alongX = wallIsAlongX(run);
      const length = alongX ? run.size[0] : run.size[2];
      const inset = t / 2 + 0.03;
      if (alongX) {
        child.position.set(run.pos[0], 1.5, run.pos[2] + (side === 'n' ? inset : -inset));
        child.rotation.y = side === 'n' ? 0 : Math.PI;
      } else {
        child.position.set(run.pos[0] + (side === 'w' ? inset : -inset), 1.5, run.pos[2]);
        child.rotation.y = side === 'w' ? Math.PI / 2 : -Math.PI / 2;
      }
      child.scale.setScalar(Math.min(1, length / 3.2));
      return;
    }
  });

  if (shell) shell.userData.roomSize = { width, depth };

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
      // The side lives on each run: an L-shaped room has more runs than a rectangle has sides.
      const side = (child.userData as { side?: 'n' | 's' | 'w' | 'e' }).side
        || (child.name.slice(index + 1) as 'n' | 's' | 'w' | 'e');
      const facing = side === 'n' ? -dz : side === 's' ? dz : side === 'w' ? -dx : dx;
      child.visible = facing <= 0;
    });
    placeRoomLabel(shell, group.position, state.camera.position);
  });
}

export const Office3D: React.FC<Office3DProps> = ({
  floor, rooms, seats, desks = [], takenSeatIds, mySeatIds, seatPeople = [],
  selectedRoomId, selectedSeatId, selectedDeskId, mode,
  colorForRoom, kindForRoom, sessionBoards = [], onSelectSession, onOpenRoom,
  onSelectRoom, onSelectSeat, onSelectDesk,
  onMoveRoom, onResizeRoom, onMoveSeat, onMoveDesk, onResizeDesk,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** The room the camera has flown into, or null for the whole-floor overview. */
  const [focusedRoomId, setFocusedRoomId] = useState<string | null>(null);
  /** The focus that still has a room behind it — a deleted room simply stops being focused. */
  const activeFocusId = focusedRoomId && rooms.some(room => room.id === focusedRoomId) ? focusedRoomId : null;
  /** The HTML card that follows each meeting room around the canvas. */
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  /** The overview the camera returns to: set once the floor has been framed. */
  const overviewRef = useRef<{ target: THREE.Vector3; zoom: number } | null>(null);
  /** A running camera flight: from where, to where, and since when. */
  const flightRef = useRef<{
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
    fromZoom: number; toZoom: number; startedAt: number; duration: number;
  } | null>(null);
  const focusRoomRef = useRef<(room: Space | null) => void>(() => {});
  /** Mirrors the focused room for the render loop, which runs outside React's render cycle. */
  const focusIdRef = useRef<string | null>(null);

  const dataRef = useRef({
    rooms, seats, desks, takenSeatIds, mySeatIds, seatPeople, selectedRoomId, selectedSeatId, selectedDeskId, mode,
  });
  const callbacksRef = useRef({
    onSelectRoom, onSelectSeat, onSelectDesk, onSelectSession, onOpenRoom,
    onMoveRoom, onResizeRoom, onMoveSeat, onMoveDesk, onResizeDesk,
  });
  const colorRef = useRef(colorForRoom);
  const kindRef = useRef(kindForRoom);
  const floorRef = useRef(floor);

  useEffect(() => {
    dataRef.current = {
      rooms, seats, desks, takenSeatIds, mySeatIds, seatPeople, selectedRoomId, selectedSeatId, selectedDeskId, mode,
    };
    callbacksRef.current = {
      onSelectRoom, onSelectSeat, onSelectDesk, onSelectSession, onOpenRoom,
      onMoveRoom, onResizeRoom, onMoveSeat, onMoveDesk, onResizeDesk,
    };
    colorRef.current = colorForRoom;
    kindRef.current = kindForRoom;
    floorRef.current = floor;
    focusIdRef.current = focusedRoomId;
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
    const kindOf = (hit: THREE.Intersection) => (hit.object.userData as { kind?: PickedKind }).kind;

    // A room's hit box is as tall as its walls, so its near face is always in front of the furniture
    // inside it. Handles are likewise hit "through" the object they belong to. Both are therefore
    // resolved by priority; chairs and desks compete on plain distance, which is what a click means.
    const handle = hits.find(hit => kindOf(hit) === 'desk-handle') || hits.find(hit => kindOf(hit) === 'handle');
    const item = handle || hits.find(hit => kindOf(hit) === 'seat' || kindOf(hit) === 'desk');
    const match = item || hits.find(hit => kindOf(hit) === 'room');
    if (!match) return null;
    return {
      data: match.object.userData as {
        kind: PickedKind; roomId: string; seatId?: string; deskId?: string;
        corner?: RoomCorner; label?: string;
      },
      point: match.point,
    };
  }, []);

  /** Glides the camera to a target over half a second; the direction never changes. */
  const flyTo = useCallback((target: THREE.Vector3, zoom: number, duration = 520) => {
    const state = stateRef.current;
    if (!state) return;
    flightRef.current = {
      fromTarget: state.controls.target.clone(),
      toTarget: target.clone(),
      fromZoom: state.camera.zoom,
      toZoom: zoom,
      startedAt: performance.now(),
      duration,
    };
  }, []);

  /**
   * Flies into a room — the camera pans onto it and zooms until it fills the frame — or back out to
   * the whole floor. With an orthographic camera the "dolly in" is a zoom, so the isometric look of
   * the model never changes, and `controls.target` carries the pan.
   */
  const focusRoom = useCallback((room: Space | null) => {
    const state = stateRef.current;
    if (!state) return;
    if (!room) {
      setFocusedRoomId(null);
      const overview = overviewRef.current;
      if (overview) flyTo(overview.target, overview.zoom);
      return;
    }
    const { camera } = state;
    const { width, depth } = roomSize(room);
    const centreX = Number(room.pos_x) || 0;
    const centreZ = Number(room.pos_z) || 0;
    const centre = new THREE.Vector3(centreX, FLOOR_TOP, centreZ);
    const rightAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const upAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    // Measure the room along the camera's own axes, so the fit holds from whichever corner it orbits.
    let halfW = 0.001;
    let halfH = 0.001;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      [FLOOR_TOP, WALL_HEIGHT + 0.3].forEach(height => {
        const offset = new THREE.Vector3(
          centreX + (sx * width) / 2,
          height,
          centreZ + (sz * depth) / 2
        ).sub(centre);
        halfW = Math.max(halfW, Math.abs(offset.dot(rightAxis)));
        halfH = Math.max(halfH, Math.abs(offset.dot(upAxis)));
      });
    });
    const zoom = Math.min(camera.right / halfW, camera.top / halfH) * 0.72;
    setFocusedRoomId(room.id);
    flyTo(centre, zoom);
  }, [flyTo]);

  useEffect(() => {
    focusRoomRef.current = focusRoom;
  }, [focusRoom]);

  // Escape is the way out of a zoom, exactly like closing a dialog.
  useEffect(() => {
    if (!focusedRoomId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') focusRoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedRoomId, focusRoom]);

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

    /** Keep each meeting room's HTML card pinned to the room as the camera moves. */
    const positionCards = () => {
      if (cardRefs.current.size === 0) return;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      cardRefs.current.forEach((element, roomId) => {
        const room = dataRef.current.rooms.find(entry => entry.id === roomId);
        if (!room) {
          element.style.visibility = 'hidden';
          return;
        }
        const size = roomSize(room);
        // Overview: the card waits in the free space beside the room. Focused: it slides in close,
        // where it has grown and carries the full session list.
        const focused = focusIdRef.current === roomId;
        const outward = focused ? 0.22 : 2.1;
        const point = new THREE.Vector3(
          (Number(room.pos_x) || 0) + size.width / 2 + outward,
          FLOOR_TOP + 0.5,
          (Number(room.pos_z) || 0) + size.depth / 2 + 0.05
        ).project(camera);
        const left = ((point.x + 1) / 2) * width;
        const top = ((1 - point.y) / 2) * height;
        const cardWidth = element.offsetWidth;
        const cardHeight = element.offsetHeight;
        element.style.transform = `translate3d(${Math.round(
          Math.min(Math.max(left, 10), Math.max(width - cardWidth - 10, 10))
        )}px, ${Math.round(
          Math.min(Math.max(top, 10), Math.max(height - cardHeight - 10, 10))
        )}px, 0)`;
        element.style.visibility = 'visible';
      });
    };

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const flight = flightRef.current;
      if (flight) {
        const progress = Math.min(1, (performance.now() - flight.startedAt) / flight.duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
        camera.zoom = flight.fromZoom + (flight.toZoom - flight.fromZoom) * eased;
        camera.position.copy(controls.target).addScaledVector(VIEW_DIRECTION, 90);
        camera.updateProjectionMatrix();
        camera.lookAt(controls.target);
        if (progress >= 1) flightRef.current = null;
      }
      controls.update();
      cutAwayWalls(state);
      positionCards();
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
      if (hit.data.kind === 'desk' || hit.data.kind === 'desk-handle') canvas.style.cursor = 'move';
      event.stopPropagation();
      event.preventDefault();
      const point = groundPoint(current, event.clientX, event.clientY);
      if (!point) return;
      const anchor = { x: Number(room.pos_x) || 0, z: Number(room.pos_z) || 0 };

      const desk = hit.data.deskId ? dataRef.current.desks.find(entry => entry.id === hit.data.deskId) : undefined;
      if (hit.data.kind === 'desk-handle' && hit.data.corner && desk) {
        current.drag = {
          kind: 'desk-corner',
          roomId: room.id,
          deskId: desk.id,
          corner: hit.data.corner,
          start: point,
          anchor: { x: Number(desk.x) || 0, z: Number(desk.z) || 0 },
          moved: false,
          pending: { width: Number(desk.width) || 1.4, depth: Number(desk.depth) || 0.7, x: Number(desk.x) || 0, z: Number(desk.z) || 0 },
        };
      } else if (hit.data.kind === 'desk' && desk) {
        current.drag = {
          kind: 'desk',
          roomId: room.id,
          deskId: desk.id,
          start: point,
          anchor: { x: Number(desk.x) || 0, z: Number(desk.z) || 0 },
          moved: false,
        };
      } else if (hit.data.kind === 'handle' && hit.data.corner && room.id === selectedRoom) {
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
        // Hovering a chair in a meeting room points at the room, since that is what the click opens.
        const hitRoom = hit ? dataRef.current.rooms.find(entry => entry.id === hit.data.roomId) : undefined;
        const sessionChair = Boolean(
          hit && hitRoom && hit.data.kind === 'seat' && kindRef.current?.(hitRoom) === 'time_range'
        );
        const label = hit ? (sessionChair ? `${hitRoom!.name} · sessions` : String(hit.data.label || '')) : '';
        setHover(previous => (previous === (label || null) ? previous : (label || null)));
        highlightSeat(current, hit?.data.kind === 'seat' && !sessionChair ? (hit.data.seatId ?? null) : null);
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
        layoutShell(group, { ...room, room_width: resized.room_width, room_depth: resized.room_depth }, resized.room_width, resized.room_depth);
        drag.pending = { width: resized.room_width, depth: resized.room_depth, x: next.x, z: next.z };
        return;
      }
      if (drag.kind === 'desk' && drag.deskId) {
        const desk = dataRef.current.desks.find(entry => entry.id === drag.deskId);
        const deskGroup = group.children.find(child => child.name === `desk:${drag.deskId}`) as THREE.Group | undefined;
        if (!desk || !deskGroup) return;
        const next = clampDeskToRoom(room, desk, snap(drag.anchor.x + dx), snap(drag.anchor.z + dz));
        deskGroup.position.set(next.x, SEAT_BASE, next.z);
        return;
      }
      if (drag.kind === 'desk-corner' && drag.deskId && drag.corner) {
        const desk = dataRef.current.desks.find(entry => entry.id === drag.deskId);
        const deskGroup = group.children.find(child => child.name === `desk:${drag.deskId}`) as THREE.Group | undefined;
        if (!desk || !deskGroup) return;
        const resized = resizeFromCorner(
          { room_width: Number(desk.width) || 1.4, room_depth: Number(desk.depth) || 0.7 },
          drag.anchor.x,
          drag.anchor.z,
          drag.corner,
          { x: drag.anchor.x + dx, z: drag.anchor.z + dz },
          0.6
        );
        const placed = clampDeskToRoom(
          room,
          { width: resized.room_width, depth: resized.room_depth, rotation: Number(desk.rotation) || 0 },
          resized.pos_x,
          resized.pos_z
        );
        deskGroup.position.set(placed.x, SEAT_BASE, placed.z);
        shapeDesk(deskGroup, resized.room_width, resized.room_depth, desk.has_monitor !== false);
        drag.pending = {
          width: resized.room_width, depth: resized.room_depth, x: placed.x, z: placed.z,
        };
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
        onSelectRoom: selectRoom, onSelectSeat: selectSeat, onSelectDesk: selectDesk,
        onMoveRoom: moveRoom, onResizeRoom: resizeRoom, onMoveSeat: moveSeat,
        onMoveDesk: moveDesk, onResizeDesk: resizeDesk,
      } = callbacksRef.current;
      const { rooms: currentRooms, seats: currentSeats, desks: currentDesks } = dataRef.current;

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
          if (dataRef.current.mode !== 'editor') focusRoomRef.current(null);
          return;
        }
        const room = currentRooms.find(entry => entry.id === hit.data.roomId);
        if (!room) return;
        // A meeting room's chairs carry no booking of their own: the click belongs to the room and
        // opens its sessions instead of grabbing the chair under the pointer.
        if (hit.data.kind === 'seat' && hit.data.seatId && kindRef.current?.(room) !== 'time_range') {
          const seat = currentSeats.find(entry => entry.id === hit.data.seatId);
          if (seat) selectSeat?.(seat, room);
          return;
        }
        if ((hit.data.kind === 'desk' || hit.data.kind === 'desk-handle') && hit.data.deskId) {
          const desk = currentDesks.find(entry => entry.id === hit.data.deskId);
          if (desk) selectDesk?.(desk, room);
          return;
        }
        selectRoom?.(room);
        if (dataRef.current.mode !== 'editor') focusRoomRef.current(room);
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
        if (drag.deskId) {
          const desk = currentDesks.find(entry => entry.id === drag.deskId);
          if (desk) selectDesk?.(desk, room);
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
        return;
      }
      if (drag.kind === 'desk' && drag.deskId) {
        const desk = currentDesks.find(entry => entry.id === drag.deskId);
        const deskGroup = group.children.find(child => child.name === `desk:${drag.deskId}`) as THREE.Group | undefined;
        if (desk && deskGroup) moveDesk?.(desk, snap(deskGroup.position.x), snap(deskGroup.position.z));
        return;
      }
      if (drag.kind === 'desk-corner' && drag.deskId) {
        const desk = currentDesks.find(entry => entry.id === drag.deskId);
        const pending = drag.pending;
        if (desk && pending) resizeDesk?.(desk, snap(pending.width), snap(pending.depth));
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
    overviewRef.current = { target: controls.target.clone(), zoom: camera.zoom };
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
    const people = new Map(seatPeople.map(person => [person.seatId, person]));

    rooms.forEach(room => {
      const { width, depth } = roomSize(room);
      const color = colorRef.current(room);
      const typeColor = new THREE.Color(color);
      const group = new THREE.Group();
      group.position.set(Number(room.pos_x) || 0, FLOOR_TOP, Number(room.pos_z) || 0);

      const shell = new THREE.Group();
      shell.name = 'shell';

      // The room's own floor: a soft pastel version of the type colour, with a tile grid on top.
      const platform: THREE.Mesh = new THREE.Mesh(
        rounded(1, PLATFORM_HEIGHT, 1, 0.015),
        material(roomFloor(typeColor), { roughness: 0.96 })
      );
      platform.name = 'platform';
      platform.position.y = PLATFORM_HEIGHT / 2;
      platform.receiveShadow = true;
      shell.add(platform);

      // Invisible volume that catches room drags and clicks (reshaped for an L below).
      const hitBox: THREE.Mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitBox.name = 'hit';
      hitBox.userData = { kind: 'room', roomId: room.id, label: room.name };
      shell.add(hitBox);

      // Charcoal walls outside, warm plaster inside — the dollhouse look of a floor plan. A room with
      // a stepped footprint gets one run of wall per edge of its outline.
      const outer = material(COLORS.wall, { roughness: 0.88 });
      const inner = material(COLORS.wallInner, { roughness: 0.95 });
      const top = material(COLORS.wallTop, { roughness: 0.85 });
      const wallMaterials: Record<'n' | 's' | 'w' | 'e', THREE.Material[]> = {
        n: [outer, outer, top, outer, inner, outer],
        s: [outer, outer, top, outer, outer, inner],
        w: [inner, outer, top, outer, outer, outer],
        e: [outer, inner, top, outer, outer, outer],
      };
      shell.userData.wallMaterials = wallMaterials;
      const outline = roomOutline({ ...room, room_width: width, room_depth: depth });
      outline.forEach((_, index) => {
        // Each run gets its facing materials in layoutShell, once its side is known.
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallMaterials.n);
        wall.name = `wall:${index}`;
        wall.castShadow = true;
        wall.receiveShadow = true;
        shell.add(wall);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(COLORS.wallTop, { roughness: 0.8 }));
        cap.name = `cap:${index}`;
        shell.add(cap);
      });

      // A shaped room needs a shaped floor; the rectangle keeps its rounded corners.
      if (isLShaped(room) && roomRects(room).length > 1) {
        platform.geometry.dispose();
        platform.geometry = new THREE.ExtrudeGeometry(outlineShape(outline), { depth: PLATFORM_HEIGHT, bevelEnabled: false });
        platform.rotation.set(-Math.PI / 2, 0, 0);
        platform.position.y = 0;
        hitBox.geometry.dispose();
        hitBox.geometry = new THREE.ExtrudeGeometry(outlineShape(outline), { depth: WALL_HEIGHT, bevelEnabled: false });
        hitBox.rotation.set(-Math.PI / 2, 0, 0);

        // A hairline around the stepped edge, so the shape reads as drawn rather than cut off.
        const edgePoints = outline.map((point: { x: number; z: number }) => new THREE.Vector3(point.x, PLATFORM_HEIGHT + 0.003, point.z));
        const edge = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([...edgePoints, edgePoints[0]]),
          new THREE.LineBasicMaterial({ color: '#d9d0c2' })
        );
        edge.name = 'floor-line';
        shell.add(edge);
      }

      const label = namePlate(room.name, color);
      label.name = 'label';
      label.userData = { ...label.userData, kind: 'room', roomId: room.id, label: room.name };
      shell.add(label);
      // The per-frame wall mounting needs the room's size; a corner drag refreshes both.
      shell.userData.roomSize = { width, depth };

      group.add(shell);

      // A screen hangs on whichever wall the room points at, and only if one is chosen.
      const screenWall = room.screen_wall && room.screen_wall !== 'none' ? room.screen_wall : null;
      if (screenWall && width >= 3.4) {
        const screen = buildWallScreen(Math.min(width * 0.45, 1.6));
        screen.name = `screen:${screenWall}`;
        screen.userData = { ...screen.userData, side: screenWall };
        shell.add(screen);
      }

      const roomSeats = seats.filter(seat => seat.space_id === room.id && seat.active);
      // A meeting room's chairs belong to its sessions, not to a person, so they are not clickable.
      const seatsArePerSession = kindRef.current?.(room) === 'time_range';

      roomSeats.forEach((seat, index) => {
        const isMine = mine.has(seat.id);
        const isTaken = taken.has(seat.id);
        const isSelected = selectedSeatId === seat.id;
        const seatGroup = new THREE.Group();
        seatGroup.name = `seat:${seat.id}`;
        seatGroup.position.set(Number(seat.x) || 0, SEAT_BASE, Number(seat.z) || 0);
        seatGroup.rotation.y = ((Number(seat.rotation) || 0) * Math.PI) / 180;
        const label = `${seat.label || `Seat ${index + 1}`} · ${room.name}${isMine ? ' (yours)' : isTaken ? ' (taken)' : ''}`;
        const data = { kind: 'seat', roomId: room.id, seatId: seat.id, label };

        // A black task chair when free; slate when a colleague holds it, green when it is yours.
        seatGroup.add(buildChair(isMine ? CHAIR_TONES.mine : isTaken ? CHAIR_TONES.taken : CHAIR_TONES.free));

        if (isMine || isTaken) {
          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(0.34, 32),
            new THREE.MeshBasicMaterial({
              color: isMine ? COLORS.mine : COLORS.taken,
              transparent: true,
              opacity: isMine ? 0.6 : 0.42,
              depthWrite: false,
            })
          );
          disc.rotation.x = -Math.PI / 2;
          disc.position.y = 0.005;
          seatGroup.add(disc);
        }

        if (isSelected) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.36, 0.44, 32),
            new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.006;
          seatGroup.add(ring);
        } else if (!isMine && !isTaken && !seatsArePerSession) {
          // Free chairs keep a hairline marker, so an empty chair still reads as clickable.
          const marker = new THREE.Mesh(
            new THREE.RingGeometry(0.3, 0.34, 28),
            new THREE.MeshBasicMaterial({ color: COLORS.free, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
          );
          marker.rotation.x = -Math.PI / 2;
          marker.position.y = 0.005;
          seatGroup.add(marker);
        }

        const chairBlob = softShadow(1.25, 1.25, 0.7);
        chairBlob.position.set(-0.1, 0.003, -0.1);
        seatGroup.add(chairBlob);

        // Whoever holds the chair gets their face on a bubble above it, so the room reads at a glance.
        const holder = people.get(seat.id);
        if (holder) {
          const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
            map: avatarTexture(holder), transparent: true, depthWrite: false,
          }));
          bubble.name = 'avatar-bubble';
          bubble.scale.setScalar(0.56);
          bubble.position.set(0, 1.18, 0);
          bubble.renderOrder = 3;
          seatGroup.add(bubble);
        }

        seatGroup.traverse(child => {
          child.userData = data;
        });

        group.add(seatGroup);
      });

      // Desks: real furniture with their own footprint, placed and sized by an admin.
      desks
        .filter(desk => desk.space_id === room.id && desk.active)
        .forEach(desk => {
          const deskWidth = Math.max(Number(desk.width) || 1.4, 0.3);
          const deskDepth = Math.max(Number(desk.depth) || 0.7, 0.3);
          const isSelected = selectedDeskId === desk.id;
          const deskGroup = new THREE.Group();
          deskGroup.name = `desk:${desk.id}`;
          deskGroup.position.set(Number(desk.x) || 0, SEAT_BASE, Number(desk.z) || 0);
          deskGroup.rotation.y = ((Number(desk.rotation) || 0) * Math.PI) / 180;
          const data = { kind: 'desk', roomId: room.id, deskId: desk.id, label: desk.label || 'Desk' };

          deskGroup.add(buildDesk());
          shapeDesk(deskGroup, deskWidth, deskDepth, desk.has_monitor !== false);

          const deskBlob = softShadow(deskWidth * 1.28, deskDepth * 1.9, 0.62);
          deskBlob.position.set(-0.06, 0.004, -0.06);
          deskGroup.add(deskBlob);

          if (isSelected) {
            const outline = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(deskWidth, 0.06, deskDepth)),
              new THREE.LineBasicMaterial({ color: COLORS.selected })
            );
            outline.position.y = 0.76;
            deskGroup.add(outline);
          }

          deskGroup.traverse(child => {
            child.userData = data;
          });
          group.add(deskGroup);

          if (mode === 'editor' && isSelected) {
            (['nw', 'ne', 'sw', 'se'] as RoomCorner[]).forEach(corner => {
              const handle = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 16, 16),
                material(COLORS.selected, { roughness: 0.35, metalness: 0.15 })
              );
              handle.name = `desk-handle:${corner}`;
              handle.position.set(
                (corner === 'nw' || corner === 'sw' ? -1 : 1) * deskWidth / 2,
                0.78,
                (corner === 'nw' || corner === 'ne' ? -1 : 1) * deskDepth / 2
              );
              handle.castShadow = true;
              handle.userData = {
                kind: 'desk-handle', roomId: room.id, deskId: desk.id, corner, label: 'Drag to resize the desk',
              };
              deskGroup.add(handle);
            });
          }
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
      layoutShell(group, room, width, depth);

      state.content.add(group);
      state.roomGroups.set(room.id, group);
      state.pickables.push(group);

    });

  }, [ready, rooms, seats, desks, takenSeatIds, mySeatIds, seatPeople, selectedRoomId, selectedSeatId, selectedDeskId, mode, floor.width, floor.depth, floor.id]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />

      {/* A virtual card beside each meeting room: the day's sessions, readable at a glance. It is
          HTML pinned to the room's projected position, so it stays crisp while the camera moves. */}
      {sessionBoards.map(board => {
        const room = rooms.find(entry => entry.id === board.roomId);
        if (!room) return null;
        if (activeFocusId && activeFocusId !== room.id) return null;
        const focused = activeFocusId === room.id;
        const shown = board.rows.find(row => row.selected) ?? board.rows[0];
        return (
          <div
            key={board.roomId}
            ref={element => {
              if (element) cardRefs.current.set(board.roomId, element);
              else cardRefs.current.delete(board.roomId);
            }}
            className={`pointer-events-auto absolute left-0 top-0 z-10 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[var(--shadow-pop)] transition-[width,box-shadow] duration-200 ${
              focused ? 'w-[286px] ring-2 ring-[var(--accent)]' : 'w-[194px]'
            }`}
            style={{ visibility: 'hidden' }}
          >
            {focused ? (
              <>
                <button
                  type="button"
                  onClick={() => callbacksRef.current.onOpenRoom?.(room)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2 text-left hover:bg-[var(--surface-sunken)]"
                  title={`Open ${room.name}'s sessions`}
                >
                  <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--ink)]">{room.name}</span>
                  <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-4)]">
                    {room.capacity} seats
                  </span>
                </button>
                {board.rows.length === 0 ? (
                  <p className="px-2.5 py-2.5 text-[11px] text-[var(--ink-4)]">No sessions on this day.</p>
                ) : (
                  <ul className="max-h-[196px] space-y-0.5 overflow-y-auto p-1.5">
                    {board.rows.map(row => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => callbacksRef.current.onSelectSession?.(room, row.id)}
                          className={`flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${
                            row.selected
                              ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]'
                              : 'hover:bg-[var(--surface-muted)]'
                          } ${row.ended && !row.selected ? 'opacity-55' : ''}`}
                          title={`Show ${row.window}${row.title ? ` · ${row.title}` : ''} in the room`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.live ? 'bg-emerald-500' : 'bg-[var(--line-strong)]'}`}
                            title={row.live ? 'Happening now' : undefined}
                          />
                          <span className="shrink-0 font-mono text-[10.5px] font-semibold text-[var(--ink-2)]">{row.window}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--ink)]">
                            {row.title?.trim() || 'Open session'}
                          </span>
                          <span className={`shrink-0 text-[9.5px] font-semibold ${row.seats >= row.capacity ? 'text-rose-600' : 'text-[var(--ink-4)]'}`}>
                            {row.seats}/{row.capacity}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="border-t border-[var(--line)] px-2.5 py-1 text-[9.5px] text-[var(--ink-4)]">
                  Pick a session to see its people · Esc zooms out
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => focusRoom(room)}
                className="flex w-full cursor-pointer flex-col gap-1 px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]"
                title={`Zoom into ${room.name}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10.5px] font-semibold text-[var(--ink)]">{room.name}</span>
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.05em] text-[var(--ink-4)]">
                    {board.rows.length || 'no'} session{board.rows.length === 1 ? '' : 's'}
                  </span>
                </span>
                {shown ? (
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${shown.live ? 'bg-emerald-500' : 'bg-[var(--line-strong)]'}`} />
                    <span className="shrink-0 font-mono text-[9.5px] font-semibold text-[var(--ink-2)]">{shown.window}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[var(--ink)]">
                      {shown.title?.trim() || 'Open session'}
                    </span>
                  </span>
                ) : (
                  <span className="text-[9.5px] text-[var(--ink-4)]">No sessions on this day</span>
                )}
                <span className="text-[9px] font-semibold text-[var(--accent-ink)]">Click to zoom in</span>
              </button>
            )}
          </div>
        );
      })}

      {hover && (
        <div className="pointer-events-none absolute left-3 bottom-3 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white/95 px-2 py-1 text-[11px] font-medium text-[var(--ink-2)] shadow-sm">
          {hover}
        </div>
      )}
      {activeFocusId ? (
        <button
          type="button"
          onClick={() => focusRoom(null)}
          className="pointer-events-auto absolute right-3 top-3 z-20 inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white/95 px-2 py-1 text-[11px] font-semibold text-[var(--ink-2)] shadow-sm hover:bg-white"
          title="Zoom back out to the whole floor (Esc)"
        >
          <ZoomOut className="h-3 w-3" /> Overview
        </button>
      ) : (
        <div className="pointer-events-none absolute right-3 top-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-white/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-4)]">
          Click a room to zoom in · drag to orbit
        </div>
      )}
    </div>
  );
};
