/**
 * The made-to-measure avatar: a small vector person assembled from a handful of choices.
 *
 * The design is data first — `avatarNodes()` turns a config into a list of SVG primitives — so the
 * same picture can be drawn by React (`<AvatarArt>`) and serialised into a standalone SVG (which is
 * what gets stored as the profile picture). Nothing here is random: the same config always draws the
 * same face, and every option in the catalogues below has art behind it.
 */

export type AvatarNode = {
  tag: 'circle' | 'ellipse' | 'path' | 'rect';
  attrs: Record<string, string | number>;
};

// Drawn like a pen sketch: black ink outlines over white or grey fills, no colour in the face itself.
const INK = '#1a1a1a';
const PAPER = '#ffffff';
const OUTLINE = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: 'round' };

export const AVATAR_BACKGROUNDS = {
  white: '#ffffff',
  sand: '#efe7d8',
  cream: '#f7f1e6',
  sky: '#dbe9f4',
  mint: '#dcece0',
  rose: '#f6e2e2',
  lilac: '#e6e1f2',
  slate: '#dfe4e8',
  peach: '#f8e6d6',
} as const;

export const AVATAR_SKINS = {
  porcelain: '#faf9f7',
  fair: '#e6e6e2',
  warm: '#cfcfca',
  olive: '#b0b0aa',
  tan: '#8f8f89',
  deep: '#6e6e68',
} as const;

export const AVATAR_HAIR_COLORS = {
  black: '#1a1a1a',
  grey: '#737373',
  silver: '#bdbdbd',
  white: '#fefefe',
} as const;

export const HAIR_STYLES = [
  'short', 'buzz', 'taper', 'sidePart', 'combOver', 'quiff', 'undercut', 'mohawk', 'spiky',
  'wavy', 'curly', 'fringe', 'shag', 'afro', 'receding', 'bald', 'topKnot',
  'bob', 'long', 'layers', 'curlyLong', 'ponytail', 'braids', 'pigtails', 'spaceBuns', 'bun',
] as const;
export const EYE_STYLES = ['dot', 'round', 'happy', 'sleepy', 'wide', 'wink'] as const;
export const BROW_STYLES = ['soft', 'flat', 'arched', 'bold', 'raised', 'angled'] as const;
export const NOSE_STYLES = ['button', 'straight', 'round', 'wide'] as const;
export const MOUTH_STYLES = ['smile', 'grin', 'calm', 'smirk', 'open', 'small'] as const;
export const GLASSES_STYLES = ['none', 'round', 'square', 'sun', 'reading'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'goatee', 'full', 'moustache'] as const;
export const ACCESSORY_STYLES = ['none', 'earrings', 'headphones', 'cap', 'pencil'] as const;
export const DETAIL_STYLES = ['none', 'freckles', 'blush', 'beautyMark'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type EyeStyle = (typeof EYE_STYLES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type NoseStyle = (typeof NOSE_STYLES)[number];
export type MouthStyle = (typeof MOUTH_STYLES)[number];
export type GlassesStyle = (typeof GLASSES_STYLES)[number];
export type BeardStyle = (typeof BEARD_STYLES)[number];
export type AccessoryStyle = (typeof ACCESSORY_STYLES)[number];
export type DetailStyle = (typeof DETAIL_STYLES)[number];

export interface AvatarConfig {
  background: keyof typeof AVATAR_BACKGROUNDS;
  skin: keyof typeof AVATAR_SKINS;
  hairStyle: HairStyle;
  hairColor: keyof typeof AVATAR_HAIR_COLORS;
  eyes: EyeStyle;
  brows: BrowStyle;
  nose: NoseStyle;
  mouth: MouthStyle;
  glasses: GlassesStyle;
  beard: BeardStyle;
  accessory: AccessoryStyle;
  details: DetailStyle;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  background: 'white',
  skin: 'porcelain',
  hairStyle: 'short',
  hairColor: 'black',
  eyes: 'dot',
  brows: 'soft',
  nose: 'button',
  mouth: 'smile',
  glasses: 'none',
  beard: 'none',
  accessory: 'none',
  details: 'none',
};

/** Which of the three kinds of choice each field offers, so the editor can lay itself out. */
export const AVATAR_FIELDS = [
  { key: 'background', label: 'Background', kind: 'color', palette: AVATAR_BACKGROUNDS },
  { key: 'skin', label: 'Skin', kind: 'color', palette: AVATAR_SKINS },
  { key: 'hairStyle', label: 'Hair', kind: 'style', options: HAIR_STYLES },
  { key: 'hairColor', label: 'Hair colour', kind: 'color', palette: AVATAR_HAIR_COLORS },
  { key: 'eyes', label: 'Eyes', kind: 'style', options: EYE_STYLES },
  { key: 'brows', label: 'Eyebrows', kind: 'style', options: BROW_STYLES },
  { key: 'nose', label: 'Nose', kind: 'style', options: NOSE_STYLES },
  { key: 'mouth', label: 'Mouth', kind: 'style', options: MOUTH_STYLES },
  { key: 'glasses', label: 'Glasses', kind: 'style', options: GLASSES_STYLES },
  { key: 'beard', label: 'Beard', kind: 'style', options: BEARD_STYLES },
  { key: 'accessory', label: 'Extras', kind: 'style', options: ACCESSORY_STYLES },
  { key: 'details', label: 'Details', kind: 'style', options: DETAIL_STYLES },
] as const;

export type AvatarFieldKey = (typeof AVATAR_FIELDS)[number]['key'];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const circle = (cx: number, cy: number, r: number, fill: string, extra: Record<string, string | number> = {}): AvatarNode => ({
  tag: 'circle', attrs: { cx, cy, r, fill, ...extra },
});

const ellipse = (
  cx: number, cy: number, rx: number, ry: number, fill: string, extra: Record<string, string | number> = {}
): AvatarNode => ({ tag: 'ellipse', attrs: { cx, cy, rx, ry, fill, ...extra } });

const path = (d: string, fill: string, extra: Record<string, string | number> = {}): AvatarNode => ({
  tag: 'path', attrs: { d, fill, ...extra },
});

const line = (d: string, stroke: string, width: number, extra: Record<string, string | number> = {}): AvatarNode => ({
  tag: 'path',
  attrs: { d, fill: 'none', stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra },
});

const rect = (
  x: number, y: number, width: number, height: number, fill: string, extra: Record<string, string | number> = {}
): AvatarNode => ({ tag: 'rect', attrs: { x, y, width, height, fill, ...extra } });

/** `#rgb`/`#rrggbb` mixed towards black or white — used for shading rather than a second palette. */
export function tone(hex: string, amount: number, target: 'black' | 'white' = 'black'): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
  const end = target === 'black' ? 0 : 255;
  const channel = (index: number) => {
    const part = parseInt(full.slice(index * 2, index * 2 + 2), 16);
    return Math.round(part + (end - part) * amount).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const pick = <T extends Record<string, string>, K extends keyof T>(palette: T, key: K, fallback: K): string =>
  palette[key] ?? palette[fallback];

/** Unknown or half-written configs (old rows, hand-written JSON) settle on the defaults. */
export function normalizeAvatar(input: unknown): AvatarConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof AvatarConfig, unknown>>;
  const of = <T extends readonly string[]>(options: T, value: unknown, fallback: T[number]): T[number] =>
    (options as readonly string[]).includes(String(value)) ? (String(value) as T[number]) : fallback;
  const swatch = <T extends Record<string, string>>(palette: T, value: unknown, fallback: keyof T): keyof T =>
    (value && Object.prototype.hasOwnProperty.call(palette, String(value)) ? value : fallback) as keyof T;

  return {
    background: swatch(AVATAR_BACKGROUNDS, raw.background, DEFAULT_AVATAR.background),
    skin: swatch(AVATAR_SKINS, raw.skin, DEFAULT_AVATAR.skin),
    hairStyle: of(HAIR_STYLES, raw.hairStyle, DEFAULT_AVATAR.hairStyle),
    hairColor: swatch(AVATAR_HAIR_COLORS, raw.hairColor, DEFAULT_AVATAR.hairColor),
    eyes: of(EYE_STYLES, raw.eyes, DEFAULT_AVATAR.eyes),
    brows: of(BROW_STYLES, raw.brows, DEFAULT_AVATAR.brows),
    nose: of(NOSE_STYLES, raw.nose, DEFAULT_AVATAR.nose),
    mouth: of(MOUTH_STYLES, raw.mouth, DEFAULT_AVATAR.mouth),
    glasses: of(GLASSES_STYLES, raw.glasses, DEFAULT_AVATAR.glasses),
    beard: of(BEARD_STYLES, raw.beard, DEFAULT_AVATAR.beard),
    accessory: of(ACCESSORY_STYLES, raw.accessory, DEFAULT_AVATAR.accessory),
    details: of(DETAIL_STYLES, raw.details, DEFAULT_AVATAR.details),
  };
}

// ---------------------------------------------------------------------------
// The drawing itself
// ---------------------------------------------------------------------------

const FACE = { cx: 60, cy: 56, rx: 25, ry: 29 };
const EYE_Y = 56;
const EYE_OFFSET = 11;
const BROW_Y = 45;

function face(config: AvatarConfig): AvatarNode[] {
  const skin = pick(AVATAR_SKINS, config.skin, 'warm');
  return [
    ellipse(FACE.cx - FACE.rx + 1, 58, 4.6, 6, skin, OUTLINE),
    ellipse(FACE.cx + FACE.rx - 1, 58, 4.6, 6, skin, OUTLINE),
    ellipse(FACE.cx, FACE.cy, FACE.rx, FACE.ry, skin, OUTLINE),
  ];
}

/** Every filled shape gets the ink outline, so hair reads as a drawing in any colour, white included. */
const inked = (nodes: AvatarNode[]): AvatarNode[] =>
  nodes.map(node => (node.attrs.fill !== 'none' && !node.attrs.stroke
    ? { ...node, attrs: { ...node.attrs, ...OUTLINE } }
    : node));

function hairBack(config: AvatarConfig): AvatarNode[] {
  return inked(hairBackShapes(config));
}

function hairBackShapes(config: AvatarConfig): AvatarNode[] {
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  switch (config.hairStyle) {
    case 'long':
      return [
        path('M31 47 C26 68 28 92 33 108 H47 C40 88 39 66 42 51 Z', hair),
        path('M89 47 C94 68 92 92 87 108 H73 C80 88 81 66 78 51 Z', hair),
      ];
    case 'bob':
      return [
        path('M31 48 C27 60 27 72 30 82 H45 C39 72 38 58 41 50 Z', hair),
        path('M89 48 C93 60 93 72 90 82 H75 C81 72 82 58 79 50 Z', hair),
      ];
    case 'bun':
      return [circle(60, 19, 9, hair)];
    case 'ponytail':
      return [
        path('M83 42 C96 48 100 64 94 80 C91 88 83 88 80 81 C88 69 89 53 78 45 Z', hair),
        ellipse(82.5, 44, 3.6, 3, tone(hair, 0.3)),
      ];
    case 'afro':
      return [
        circle(60, 31, 21, hair),
        circle(40, 42, 13, hair),
        circle(80, 42, 13, hair),
        circle(44, 26, 11, hair),
        circle(76, 26, 11, hair),
        circle(60, 22, 14, hair),
      ];
    case 'receding':
      return [path('M33 54 C34 36 45 27 60 27 C75 27 86 36 87 54 C85 45 79 39 71 37 C63 35 57 35 49 37 C41 39 35 45 33 54 Z', hair)];
    case 'pigtails':
      return [
        path('M30 48 C22 56 21 72 26 82 C29 88 37 86 37 79 C32 70 32 57 36 50 Z', hair),
        path('M90 48 C98 56 99 72 94 82 C91 88 83 86 83 79 C88 70 88 57 84 50 Z', hair),
      ];
    case 'spaceBuns':
      return [circle(41, 25, 8.5, hair), circle(79, 25, 8.5, hair)];
    case 'topKnot':
      return [circle(60, 15, 7.5, hair), ellipse(60, 23, 5, 2.2, tone(hair, 0.3))];
    case 'layers':
      return [
        path('M30 48 C25 66 26 86 30 98 H44 C38 84 37 64 40 50 Z', hair),
        path('M90 48 C95 66 94 86 90 98 H76 C82 84 83 64 80 50 Z', hair),
      ];
    case 'curlyLong':
      return [
        circle(33, 50, 9, hair),
        circle(31, 64, 9, hair),
        circle(32, 78, 8.5, hair),
        circle(87, 50, 9, hair),
        circle(89, 64, 9, hair),
        circle(88, 78, 8.5, hair),
      ];
    default:
      return [];
  }
}

const DEFAULT_HAIR = () => DEFAULT_AVATAR.hairColor;

const HAIR_CAP = 'M33 52 C33 30 45 21 60 21 C75 21 87 30 87 52 C85 40 76 34 60 34 C44 34 35 40 33 52 Z';

function hairFront(config: AvatarConfig): AvatarNode[] {
  return inked(hairFrontShapes(config));
}

function hairFrontShapes(config: AvatarConfig): AvatarNode[] {
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  switch (config.hairStyle) {
    case 'buzz':
      return [path('M35 49 C35 32 46 25 60 25 C74 25 85 32 85 49 C82 38 73 33 60 33 C47 33 38 38 35 49 Z', hair)];
    case 'sidePart':
      return [
        path(HAIR_CAP, hair),
        path('M36 47 C40 32 52 25 68 25 C56 30 46 38 42 52 Z', hair),
        line('M63 25 C74 27 82 34 85 45', tone(hair, 0.18, 'white'), 1.4, { opacity: 0.5 }),
      ];
    case 'wavy':
      return [
        path(HAIR_CAP, hair),
        path('M34 48 C40 44 46 49 52 44 C58 39 64 44 70 39 C76 34 82 40 86 46 C80 37 70 33 60 33 C50 33 40 37 34 48 Z', hair),
      ];
    case 'bun':
      return [path(HAIR_CAP, hair), line('M44 24 C52 21 68 21 76 24', tone(hair, 0.2, 'white'), 1.4, { opacity: 0.45 })];
    case 'long':
      return [path(HAIR_CAP, hair), path('M34 49 C36 40 44 34 60 34 C76 34 84 40 86 49 C82 41 72 37 60 37 C48 37 38 41 34 49 Z', hair)];
    case 'curly':
      return [
        path(HAIR_CAP, hair),
        circle(40, 33, 6.4, hair),
        circle(50, 27, 6.8, hair),
        circle(61, 25, 7, hair),
        circle(72, 27, 6.6, hair),
        circle(81, 35, 6, hair),
      ];
    case 'bald':
      return [line('M37 51 Q36 58 38 62', INK, 2.4, { opacity: 0.55 }), line('M83 51 Q84 58 82 62', INK, 2.4, { opacity: 0.55 })];
    case 'fringe':
      return [path('M35 43 C35 30 46 23 60 23 C74 23 85 30 85 43 C78 45 69 46 60 46 C51 46 42 45 35 43 Z', hair)];
    case 'bob':
      return [path('M34 44 C34 30 46 23 60 23 C74 23 86 30 86 44 Z', hair)];
    case 'spiky':
      return [
        path(HAIR_CAP, hair),
        path('M38 34 L44 20 L52 32 Z', hair),
        path('M48 31 L57 15 L66 30 Z', hair),
        path('M62 30 L71 17 L79 33 Z', hair),
        path('M74 33 L82 23 L85 38 Z', hair),
      ];
    case 'braids':
      return [
        path(HAIR_CAP, hair),
        ...[58, 68, 78, 88].flatMap(y => [
          circle(36, y, 4, hair),
          circle(84, y, 4, hair),
        ]),
        circle(36, 48, 4.4, tone(hair, 0.25)),
        circle(84, 48, 4.4, tone(hair, 0.25)),
      ];
    case 'ponytail':
      return [path(HAIR_CAP, hair), path('M36 47 C38 36 46 31 60 31 C74 31 82 36 84 47 C80 40 72 36 60 36 C48 36 40 40 36 47 Z', hair)];
    case 'afro':
      return [path('M40 41 C46 34 53 32 60 32 C67 32 74 34 80 41 C74 37 67 35 60 35 C53 35 46 37 40 41 Z', hair)];
    case 'receding':
      return [
        path('M33 54 C34 45 36 40 40 37 C39 45 39 50 40 55 Z', hair),
        path('M87 54 C86 45 84 40 80 37 C81 45 81 50 80 55 Z', hair),
      ];
    case 'taper':
      return [
        path('M36 43 C38 31 48 25 60 25 C72 25 82 31 84 43 C82 35 72 31 60 31 C48 31 38 35 36 43 Z', hair),
        line('M36 48 Q35 53 36 57', INK, 2.6, { opacity: 0.35 }),
        line('M84 48 Q85 53 84 57', INK, 2.6, { opacity: 0.35 }),
      ];
    case 'combOver':
      return [
        path('M34 46 C34 28 48 21 62 22 C75 23 85 29 86 45 C81 34 71 29 58 31 C47 33 39 39 34 46 Z', hair),
        line('M58 24 C68 26 78 32 83 41', tone(hair, 0.3, 'white'), 1.4, { opacity: 0.45 }),
      ];
    case 'quiff':
      return [
        path(HAIR_CAP, hair),
        path('M40 32 C42 21 54 15 66 18 C76 21 82 27 82 34 C73 25 57 25 48 32 Z', hair),
      ];
    case 'undercut':
      return [
        path('M36 46 C34 26 48 19 63 20 C77 21 87 29 87 42 C80 32 68 29 57 32 C47 35 40 39 36 46 Z', hair),
        line('M35 49 Q34 56 35 61', INK, 2.4, { opacity: 0.3 }),
        line('M85 49 Q86 56 85 61', INK, 2.4, { opacity: 0.3 }),
      ];
    case 'mohawk':
      return [
        path('M49 27 C52 17 56 12 60 12 C64 12 68 17 71 27 C75 36 73 44 69 48 C66 41 63 37 60 37 C57 37 54 41 51 48 C47 44 45 36 49 27 Z', hair),
        line('M36 49 Q35 56 36 61', INK, 2.4, { opacity: 0.3 }),
        line('M84 49 Q85 56 84 61', INK, 2.4, { opacity: 0.3 }),
      ];
    case 'shag':
      return [
        path(HAIR_CAP, hair),
        path('M34 44 C32 52 34 58 36 62 C37 55 37 48 39 44 Z', hair),
        path('M86 44 C88 52 86 58 84 62 C83 55 83 48 81 44 Z', hair),
        path('M36 46 C38 36 46 31 60 31 C74 31 82 36 84 46 C76 40 68 38 60 38 C52 38 44 40 36 46 Z', hair),
      ];
    case 'topKnot':
      return [
        path('M35 47 C36 31 46 24 60 24 C74 24 84 31 85 47 C80 36 70 31 60 31 C50 31 40 36 35 47 Z', hair),
        line('M44 27 C50 23 70 23 76 27', tone(hair, 0.3, 'white'), 1.3, { opacity: 0.4 }),
      ];
    case 'layers':
      return [
        path('M60 26 C45 26 35 34 33 50 C36 40 44 34 56 33 C58 33 59 33 60 33 Z', hair),
        path('M60 26 C75 26 85 34 87 50 C84 40 76 34 64 33 Z', hair),
      ];
    case 'curlyLong':
      return [
        path(HAIR_CAP, hair),
        circle(40, 32, 6.2, hair),
        circle(50, 27, 6.6, hair),
        circle(61, 25, 6.8, hair),
        circle(72, 27, 6.4, hair),
        circle(80, 34, 6, hair),
      ];
    case 'short':
    default:
      return [path(HAIR_CAP, hair)];
  }
}

function eyes(config: AvatarConfig): AvatarNode[] {
  const nodes: AvatarNode[] = [];
  [-1, 1].forEach(side => {
    const cx = FACE.cx + side * EYE_OFFSET;
    const style = config.eyes;
    if (style === 'round') {
      nodes.push(circle(cx, EYE_Y, 3.6, PAPER, { stroke: INK, strokeWidth: 1.5 }), circle(cx, EYE_Y + 0.5, 1.9, INK));
    } else if (style === 'happy') {
      nodes.push(line(`M${cx - 3.4} ${EYE_Y + 1} Q${cx} ${EYE_Y - 3.4} ${cx + 3.4} ${EYE_Y + 1}`, INK, 2));
    } else if (style === 'sleepy') {
      nodes.push(line(`M${cx - 3.4} ${EYE_Y - 0.4} Q${cx} ${EYE_Y + 3.4} ${cx + 3.4} ${EYE_Y - 0.4}`, INK, 2));
    } else if (style === 'wide') {
      nodes.push(ellipse(cx, EYE_Y, 4, 4.4, PAPER, { stroke: INK, strokeWidth: 1.5 }), circle(cx, EYE_Y + 0.4, 2, INK));
    } else if (style === 'wink') {
      nodes.push(side < 0
        ? line(`M${cx - 3.4} ${EYE_Y + 1} Q${cx} ${EYE_Y - 3.4} ${cx + 3.4} ${EYE_Y + 1}`, INK, 2)
        : circle(cx, EYE_Y, 2.2, INK));
    } else {
      nodes.push(circle(cx, EYE_Y, 2.2, INK));
    }
  });
  return nodes;
}

function eyebrows(config: AvatarConfig): AvatarNode[] {
  const brow = INK;
  return [-1, 1].flatMap(side => {
    const cx = FACE.cx + side * EYE_OFFSET;
    switch (config.brows) {
      case 'flat':
        return [line(`M${cx - 4} ${BROW_Y} H${cx + 4}`, brow, 2.2)];
      case 'arched':
        return [line(`M${cx - 4.5} ${BROW_Y + 1.5} Q${cx} ${BROW_Y - 3.6} ${cx + 4.5} ${BROW_Y + 1}`, brow, 2.2)];
      case 'bold':
        return [line(`M${cx - 4.5} ${BROW_Y + 0.5} Q${cx} ${BROW_Y - 2.4} ${cx + 4.5} ${BROW_Y + 0.5}`, brow, 3.4)];
      case 'raised':
        return [line(`M${cx - 4} ${BROW_Y - 1.6} Q${cx} ${BROW_Y - 4.4} ${cx + 4} ${BROW_Y - 1.8}`, brow, 2.2)];
      case 'angled':
        return [line(`M${FACE.cx + side * 6.5} ${BROW_Y + 1.4} L${FACE.cx + side * 15.5} ${BROW_Y - 1.6}`, brow, 2.4)];
      case 'soft':
      default:
        return [line(`M${cx - 4} ${BROW_Y + 1} Q${cx} ${BROW_Y - 1.6} ${cx + 4} ${BROW_Y + 0.2}`, brow, 2.2)];
    }
  });
}

function nose(config: AvatarConfig): AvatarNode[] {
  const shade = INK;
  switch (config.nose) {
    case 'straight':
      return [line('M60 57.5 V65.4 Q60 67.2 58.4 67.2', shade, 1.8)];
    case 'round':
      return [circle(60, 64.4, 2.6, 'none', { stroke: shade, strokeWidth: 1.8 })];
    case 'wide':
      return [line('M56.6 64 Q60 67.6 63.4 64', shade, 1.8)];
    case 'button':
    default:
      return [line('M57.4 63.4 Q60 65.6 62.6 63.4', shade, 1.8)];
  }
}

function mouth(config: AvatarConfig): AvatarNode[] {
  switch (config.mouth) {
    case 'grin':
      return [
        path('M52 72 Q60 81 68 72 Z', PAPER, { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' }),
        line('M52 72 H68', INK, 1.6),
      ];
    case 'calm':
      return [line('M53 74.5 H67', INK, 2.2)];
    case 'smirk':
      return [line('M53 74 Q59 77.6 67 72.4', INK, 2.2)];
    case 'open':
      return [ellipse(60, 75, 5, 4.2, INK), ellipse(60, 77, 2.6, 1.6, '#8a8a8a')];
    case 'small':
      return [line('M56.5 73.5 Q60 76.5 63.5 73.5', INK, 2.2)];
    case 'smile':
    default:
      return [line('M52 72 Q60 79 68 72', INK, 2.2)];
  }
}

function beard(config: AvatarConfig): AvatarNode[] {
  return config.beard === 'stubble' ? beardShapes(config) : inked(beardShapes(config));
}

function beardShapes(config: AvatarConfig): AvatarNode[] {
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  switch (config.beard) {
    case 'stubble':
      // A scatter of pen dots along the jaw.
      return Array.from({ length: 19 }, (_, index) => {
        const angle = Math.PI * (0.12 + 0.76 * (index / 18));
        const inset = index % 2 ? 0.86 : 1;
        return circle(60 - Math.cos(angle) * 21 * inset, 66 + Math.sin(angle) * 17 * inset, 0.75, INK);
      });
    case 'goatee':
      return [
        path('M51 76 Q55 88 60 88 Q65 88 69 76 Q64 80 60 80 Q56 80 51 76 Z', hair),
        line('M53 69.5 Q56.5 67 60 69.5 Q63.5 67 67 69.5 Q63.5 71.5 60 71 Q56.5 71.5 53 69.5 Z', hair, 1.4),
      ];
    case 'full':
      return [
        path(
          'M35 56 C37 78 48 90 60 90 C72 90 83 78 85 56 C82 70 74 73 62 73 '
          + 'C58 73 56 75 60 77 C56 79 52 77 50 73 C42 71 38 66 35 56 Z',
          hair
        ),
        path('M52 69.5 Q56 66.6 60 69.2 Q64 66.6 68 69.5 Q64 72.2 60 71.6 Q56 72.2 52 69.5 Z', hair),
      ];
    case 'moustache':
      return [path('M52 69.5 Q56 66.4 60 69.2 Q64 66.4 68 69.5 Q64 72 60 71.4 Q56 72 52 69.5 Z', hair)];
    case 'none':
    default:
      return [];
  }
}

function glasses(config: AvatarConfig): AvatarNode[] {
  if (config.glasses === 'none') return [];
  const frame = INK;
  const left = FACE.cx - EYE_OFFSET;
  const right = FACE.cx + EYE_OFFSET;
  if (config.glasses === 'round') {
    return [
      circle(left, EYE_Y, 7, 'none', { stroke: frame, strokeWidth: 1.8 }),
      circle(right, EYE_Y, 7, 'none', { stroke: frame, strokeWidth: 1.8 }),
      line(`M${left + 7} ${EYE_Y - 1} H${right - 7}`, frame, 1.6),
      line(`M${left - 7} ${EYE_Y - 2} H36`, frame, 1.6),
      line(`M${right + 7} ${EYE_Y - 2} H84`, frame, 1.6),
    ];
  }
  if (config.glasses === 'square') {
    return [
      rect(left - 7.5, EYE_Y - 5, 15, 12, 'none', { rx: 3, stroke: frame, strokeWidth: 1.8 }),
      rect(right - 7.5, EYE_Y - 5, 15, 12, 'none', { rx: 3, stroke: frame, strokeWidth: 1.8 }),
      line(`M${left + 7.5} ${EYE_Y - 1} H${right - 7.5}`, frame, 1.6),
    ];
  }
  if (config.glasses === 'sun') {
    return [
      rect(left - 8, EYE_Y - 5.5, 16, 12, INK, { rx: 3 }),
      rect(right - 8, EYE_Y - 5.5, 16, 12, INK, { rx: 3 }),
      line(`M${left + 8} ${EYE_Y - 1.5} H${right - 8}`, frame, 2),
    ];
  }
  // Reading glasses: half-moon lenses sitting low on the nose.
  return [
    path(`M${left - 7} ${EYE_Y - 2} H${left + 7} Q${left} ${EYE_Y + 8} ${left - 7} ${EYE_Y - 2} Z`, 'none', { stroke: frame, strokeWidth: 1.8 }),
    path(`M${right - 7} ${EYE_Y - 2} H${right + 7} Q${right} ${EYE_Y + 8} ${right - 7} ${EYE_Y - 2} Z`, 'none', { stroke: frame, strokeWidth: 1.8 }),
    line(`M${left + 7} ${EYE_Y - 1} H${right - 7}`, frame, 1.6),
  ];
}

function accessory(config: AvatarConfig): AvatarNode[] {
  switch (config.accessory) {
    case 'earrings':
      return [circle(34.6, 66, 2.2, PAPER, OUTLINE), circle(85.4, 66, 2.2, PAPER, OUTLINE)];
    case 'headphones':
      return [
        line('M31 54 C31 28 44 17 60 17 C76 17 89 28 89 54', INK, 4.2),
        rect(26.5, 50, 9, 15, INK, { rx: 4.5 }),
        rect(84.5, 50, 9, 15, INK, { rx: 4.5 }),
      ];
    case 'cap':
      return [
        path('M33 40 C33 23 46 15 60 15 C74 15 87 23 87 40 Z', PAPER, OUTLINE),
        line('M60 16 V39', INK, 1.4),
        path('M29.5 40 Q60 35 90.5 40 Q60 46 29.5 40 Z', INK, OUTLINE),
        circle(60, 15, 2.2, INK),
      ];
    case 'pencil':
      // Tucked behind the right ear.
      return [
        path('M78 52 L95 31 L99.5 34.5 L82.5 55.5 Z', PAPER, OUTLINE),
        path('M95 31 L99.5 34.5 L101 25.5 Z', PAPER, OUTLINE),
        path('M99.6 29.4 L101 25.5 L97.9 28.1 Z', INK),
        line('M80.5 50.5 L85 54.2', INK, 1.4),
      ];
    case 'none':
    default:
      return [];
  }
}

function details(config: AvatarConfig): AvatarNode[] {
  switch (config.details) {
    case 'freckles':
      return [[45, 64, 0.9], [48.5, 66.4, 0.8], [43, 68, 0.7], [75, 64, 0.9], [71.5, 66.4, 0.8], [77, 68, 0.7]]
        .map(([cx, cy, r]) => circle(cx, cy, r, INK, { opacity: 0.8 }));
    case 'blush':
      // Hatched cheeks, the way a pen shades.
      return [41, 45, 49, 71, 75, 79].map(x => line(`M${x} 68.5 L${x + 2.4} 64.5`, INK, 1.2, { opacity: 0.7 }));
    case 'beautyMark':
      return [circle(71.5, 68.5, 1.1, INK)];
    case 'none':
    default:
      return [];
  }
}

/** Every primitive of the portrait, back to front. */
export function avatarNodes(input: AvatarConfig | unknown): AvatarNode[] {
  const config = normalizeAvatar(input);
  return [
    circle(60, 60, 60, pick(AVATAR_BACKGROUNDS, config.background, 'white')),
    ...hairBack(config),
    ...face(config),
    ...hairFront(config),
    ...eyebrows(config),
    ...eyes(config),
    ...nose(config),
    ...beard(config),
    ...mouth(config),
    ...details(config),
    ...glasses(config),
    ...accessory(config),
  ];
}

/** One part on its own — what the editor's option tiles show. */
export function avatarPartNodes(input: AvatarConfig | unknown, part: AvatarFieldKey): AvatarNode[] {
  const config = normalizeAvatar(input);
  switch (part) {
    case 'background': return [circle(60, 60, 60, pick(AVATAR_BACKGROUNDS, config.background, 'white'), { stroke: '#e2e2e2', strokeWidth: 1 })];
    case 'skin': return face(config);
    case 'hairStyle':
    case 'hairColor': return [...hairBack(config), ...face(config), ...hairFront(config)];
    case 'eyes': return eyes(config);
    case 'brows': return eyebrows(config);
    case 'nose': return nose(config);
    case 'mouth': return mouth(config);
    case 'glasses': return glasses(config);
    case 'beard': return beard(config);
    case 'accessory': return accessory(config);
    case 'details': return [...face(config), ...details(config)];
  }
}

const ATTR_NAMES: Record<string, string> = {
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
};

const escapeAttr = (value: string | number) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One self-contained SVG document — the picture that gets stored and shown. */
export function avatarSvg(input: AvatarConfig | unknown): string {
  const body = avatarNodes(input)
    .map(node => {
      const attrs = Object.entries(node.attrs)
        .map(([key, value]) => `${ATTR_NAMES[key] || key}="${escapeAttr(value)}"`)
        .join(' ');
      return `<${node.tag} ${attrs}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img">${body}</svg>`;
}

/** The same picture as a data URL, so it can live in `profiles.photo_url` like an uploaded photo. */
export function avatarDataUrl(input: AvatarConfig | unknown): string {
  return `data:image/svg+xml,${encodeURIComponent(avatarSvg(input))}`;
}

/** True when a profile picture is one of these made avatars rather than an upload. */
export function isAvatarDataUrl(url?: string | null): boolean {
  return typeof url === 'string' && url.startsWith('data:image/svg+xml');
}

/** A random choice for one field; optional extras come up bare half the time, so faces stay uncluttered. */
export function randomOption(field: AvatarFieldKey, random: () => number = Math.random): string {
  const entry = AVATAR_FIELDS.find(candidate => candidate.key === field) ?? AVATAR_FIELDS[0];
  const options: readonly string[] = entry.kind === 'color' ? Object.keys(entry.palette) : entry.options;
  if (options.includes('none') && random() < 0.5) return 'none';
  return options[Math.floor(random() * options.length) % options.length];
}

/** A whole new face for the "shuffle" button. `random` is injected so the caller decides where the numbers come from. */
export function shuffleAvatar(random: () => number = Math.random): AvatarConfig {
  return normalizeAvatar(Object.fromEntries(AVATAR_FIELDS.map(entry => [entry.key, randomOption(entry.key, random)])));
}
