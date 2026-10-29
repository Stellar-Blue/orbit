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

const INK = '#2a2622';
const PAPER = '#fdfbf7';
const GOLD = '#d8b25f';
const MOUTH = '#8d4a45';

export const AVATAR_BACKGROUNDS = {
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
  porcelain: '#f7dcc8',
  fair: '#f0c9a8',
  warm: '#e0a97f',
  olive: '#c98f63',
  tan: '#a8714c',
  deep: '#7c4b2e',
} as const;

export const AVATAR_HAIR_COLORS = {
  black: '#241d1a',
  espresso: '#3b2a22',
  chestnut: '#5c3a2a',
  auburn: '#7b3b27',
  honey: '#9b6a3c',
  blond: '#c9a05a',
  ash: '#8d8c88',
  silver: '#c9c8c4',
} as const;

export const AVATAR_SHIRTS = {
  navy: '#2f4a68',
  chalk: '#f4f3ef',
  charcoal: '#3a3d42',
  teal: '#2f6b66',
  plum: '#5b3a5e',
  sand: '#c9ab84',
  forest: '#355a3e',
  coral: '#c9695a',
} as const;

export const HAIR_STYLES = ['short', 'buzz', 'sidePart', 'wavy', 'bun', 'long', 'curly', 'bald'] as const;
export const EYE_STYLES = ['dot', 'round', 'happy', 'sleepy', 'wide', 'wink'] as const;
export const BROW_STYLES = ['soft', 'flat', 'arched', 'bold', 'raised', 'angled'] as const;
export const NOSE_STYLES = ['button', 'straight', 'round', 'wide'] as const;
export const MOUTH_STYLES = ['smile', 'grin', 'calm', 'smirk', 'open', 'small'] as const;
export const GLASSES_STYLES = ['none', 'round', 'square', 'sun', 'reading'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'goatee', 'full', 'moustache'] as const;
export const ACCESSORY_STYLES = ['none', 'earrings', 'headphones', 'cap', 'scarf'] as const;
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
  shirt: keyof typeof AVATAR_SHIRTS;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  background: 'sand',
  skin: 'warm',
  hairStyle: 'short',
  hairColor: 'espresso',
  eyes: 'dot',
  brows: 'soft',
  nose: 'button',
  mouth: 'smile',
  glasses: 'none',
  beard: 'none',
  accessory: 'none',
  details: 'none',
  shirt: 'navy',
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
  { key: 'shirt', label: 'Outfit', kind: 'color', palette: AVATAR_SHIRTS },
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
    shirt: swatch(AVATAR_SHIRTS, raw.shirt, DEFAULT_AVATAR.shirt),
  };
}

// ---------------------------------------------------------------------------
// The drawing itself
// ---------------------------------------------------------------------------

const FACE = { cx: 60, cy: 56, rx: 25, ry: 29 };
const EYE_Y = 56;
const EYE_OFFSET = 11;
const BROW_Y = 45;

function clothes(config: AvatarConfig): AvatarNode[] {
  const shirt = pick(AVATAR_SHIRTS, config.shirt, DEFAULT_AVATAR.shirt);
  return [
    // Neck first: the collar sits over it.
    rect(52, 76, 16, 16, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.12)),
    path('M11 120 C13 97 30 87 52 85 H68 C90 87 107 97 109 120 Z', shirt),
    line('M52 85 Q60 95 68 85', tone(shirt, 0.22), 1.6),
  ];
}

function hairBack(config: AvatarConfig): AvatarNode[] {
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  if (config.hairStyle === 'long') {
    return [
      path('M31 47 C26 68 28 92 33 108 H47 C40 88 39 66 42 51 Z', hair),
      path('M89 47 C94 68 92 92 87 108 H73 C80 88 81 66 78 51 Z', hair),
    ];
  }
  if (config.hairStyle === 'bun') return [circle(60, 19, 9, hair)];
  return [];
}

const DEFAULT_HAIR = () => DEFAULT_AVATAR.hairColor;

const HAIR_CAP = 'M33 52 C33 30 45 21 60 21 C75 21 87 30 87 52 C85 40 76 34 60 34 C44 34 35 40 33 52 Z';

function hairFront(config: AvatarConfig): AvatarNode[] {
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
      return [line('M37 51 Q36 58 38 62', hair, 2.4, { opacity: 0.55 }), line('M83 51 Q84 58 82 62', hair, 2.4, { opacity: 0.55 })];
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
      nodes.push(circle(cx, EYE_Y, 3.4, PAPER), circle(cx, EYE_Y + 0.5, 1.9, INK));
    } else if (style === 'happy') {
      nodes.push(line(`M${cx - 3.4} ${EYE_Y + 1} Q${cx} ${EYE_Y - 3.4} ${cx + 3.4} ${EYE_Y + 1}`, INK, 2));
    } else if (style === 'sleepy') {
      nodes.push(line(`M${cx - 3.4} ${EYE_Y - 0.4} Q${cx} ${EYE_Y + 3.4} ${cx + 3.4} ${EYE_Y - 0.4}`, INK, 2));
    } else if (style === 'wide') {
      nodes.push(ellipse(cx, EYE_Y, 3.9, 4.3, PAPER), circle(cx, EYE_Y + 0.4, 2, INK));
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
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  const brow = tone(hair, 0.12);
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
  const shade = tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.26);
  switch (config.nose) {
    case 'straight':
      return [line('M60 57.5 V65.4 Q60 67.2 58.4 67.2', shade, 1.8)];
    case 'round':
      return [circle(60, 65, 2.2, shade, { opacity: 0.75 })];
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
      return [ellipse(60, 75, 5, 4.2, MOUTH), ellipse(60, 77, 2.6, 1.8, '#b8605a')];
    case 'small':
      return [line('M56.5 73.5 Q60 76.5 63.5 73.5', INK, 2.2)];
    case 'smile':
    default:
      return [line('M52 72 Q60 79 68 72', INK, 2.2)];
  }
}

function beard(config: AvatarConfig): AvatarNode[] {
  const hair = pick(AVATAR_HAIR_COLORS, config.hairColor, DEFAULT_HAIR());
  switch (config.beard) {
    case 'stubble':
      return [
        path('M37 60 C39 77 49 86 60 86 C71 86 81 77 83 60 C79 74 71 79 60 79 C49 79 41 74 37 60 Z', hair, { opacity: 0.28 }),
      ];
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
  const frame = tone(INK, 0.1);
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
      rect(left - 8, EYE_Y - 5.5, 16, 12, tone(INK, 0.25), { rx: 3, opacity: 0.86 }),
      rect(right - 8, EYE_Y - 5.5, 16, 12, tone(INK, 0.25), { rx: 3, opacity: 0.86 }),
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
      return [circle(34.6, 65, 1.9, GOLD), circle(85.4, 65, 1.9, GOLD)];
    case 'headphones':
      return [
        line('M31 54 C31 28 44 17 60 17 C76 17 89 28 89 54', tone(INK, 0.2), 4.2),
        rect(26.5, 50, 9, 15, tone(INK, 0.25), { rx: 4.5 }),
        rect(84.5, 50, 9, 15, tone(INK, 0.25), { rx: 4.5 }),
      ];
    case 'cap': {
      const capColor = pick(AVATAR_SHIRTS, config.shirt, 'navy');
      return [
        path('M33 40 C33 23 46 15 60 15 C74 15 87 23 87 40 Z', tone(capColor, 0.1)),
        path('M29.5 40 Q60 35 90.5 40 Q60 46 29.5 40 Z', capColor),
        circle(60, 15, 2.2, tone(capColor, 0.1)),
      ];
    }
    case 'scarf':
      return [
        path('M47 82 Q60 90 73 82 L75 92 Q60 101 45 92 Z', pick(AVATAR_SHIRTS, 'coral', 'coral')),
        path('M66 90 L74 104 L66 106 L60 92 Z', pick(AVATAR_SHIRTS, 'coral', 'coral')),
      ];
    case 'none':
    default:
      return [];
  }
}

function details(config: AvatarConfig): AvatarNode[] {
  switch (config.details) {
    case 'freckles':
      return [
        circle(45, 64, 0.9, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
        circle(48.5, 66.4, 0.8, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
        circle(43, 68, 0.7, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
        circle(75, 64, 0.9, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
        circle(71.5, 66.4, 0.8, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
        circle(77, 68, 0.7, tone(pick(AVATAR_SKINS, config.skin, 'warm'), 0.35), { opacity: 0.8 }),
      ];
    case 'blush':
      return [
        ellipse(45, 66.5, 5.2, 3.1, '#e08a7a', { opacity: 0.32 }),
        ellipse(75, 66.5, 5.2, 3.1, '#e08a7a', { opacity: 0.32 }),
      ];
    case 'beautyMark':
      return [circle(71.5, 68.5, 1.1, INK, { opacity: 0.75 })];
    case 'none':
    default:
      return [];
  }
}

/** Every primitive of the portrait, back to front. */
export function avatarNodes(input: AvatarConfig | unknown): AvatarNode[] {
  const config = normalizeAvatar(input);
  const skin = pick(AVATAR_SKINS, config.skin, 'warm');
  return [
    circle(60, 60, 60, pick(AVATAR_BACKGROUNDS, config.background, 'sand')),
    ...hairBack(config),
    ...clothes(config),
    ellipse(FACE.cx - FACE.rx + 1, 58, 4.6, 6, skin),
    ellipse(FACE.cx + FACE.rx - 1, 58, 4.6, 6, skin),
    ellipse(FACE.cx, FACE.cy, FACE.rx, FACE.ry, skin),
    ellipse(FACE.cx, FACE.cy - 3, FACE.rx - 1, FACE.ry - 4, tone(skin, 0.05, 'white')),
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

const STYLE_FIELDS = ['hairStyle', 'eyes', 'brows', 'nose', 'mouth', 'glasses', 'beard', 'accessory', 'details'] as const;
const COLOR_FIELDS = ['background', 'skin', 'hairColor', 'shirt'] as const;

/**
 * A new face for the "shuffle" button: one or two choices change, so the result stays a person rather
 * than a jumble. `random` is injected so the caller decides where the numbers come from.
 */
export function shuffleAvatar(current: AvatarConfig, random: () => number = Math.random): AvatarConfig {
  const next = { ...current };
  const change = <T extends readonly string[]>(options: T): T[number] =>
    options[Math.floor(random() * options.length) % options.length];
  const colorKey = <T extends Record<string, string>>(palette: T): keyof T => {
    const keys = Object.keys(palette) as (keyof T)[];
    return keys[Math.floor(random() * keys.length) % keys.length];
  };

  const styleField = STYLE_FIELDS[Math.floor(random() * STYLE_FIELDS.length) % STYLE_FIELDS.length];
  if (styleField === 'hairStyle') next.hairStyle = change(HAIR_STYLES);
  if (styleField === 'eyes') next.eyes = change(EYE_STYLES);
  if (styleField === 'brows') next.brows = change(BROW_STYLES);
  if (styleField === 'nose') next.nose = change(NOSE_STYLES);
  if (styleField === 'mouth') next.mouth = change(MOUTH_STYLES);
  if (styleField === 'glasses') next.glasses = change(GLASSES_STYLES);
  if (styleField === 'beard') next.beard = change(BEARD_STYLES);
  if (styleField === 'accessory') next.accessory = change(ACCESSORY_STYLES);
  if (styleField === 'details') next.details = change(DETAIL_STYLES);

  const colorField = COLOR_FIELDS[Math.floor(random() * COLOR_FIELDS.length) % COLOR_FIELDS.length];
  if (colorField === 'background') next.background = colorKey(AVATAR_BACKGROUNDS);
  if (colorField === 'skin') next.skin = colorKey(AVATAR_SKINS);
  if (colorField === 'hairColor') next.hairColor = colorKey(AVATAR_HAIR_COLORS);
  if (colorField === 'shirt') next.shirt = colorKey(AVATAR_SHIRTS);

  return next;
}
