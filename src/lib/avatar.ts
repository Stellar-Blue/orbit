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
  butter: '#f7efcf',
  sage: '#e3ead8',
  stone: '#e7e5e1',
  sunny: '#ffd86b',
  coral: '#ff9f8a',
  ocean: '#94c4e6',
  leaf: '#aad7a3',
  violet: '#c3b3ef',
  night: '#2d2f36',
} as const;

export const AVATAR_SKINS = {
  porcelain: '#faf9f7',
  light: '#f0f0ed',
  fair: '#e6e6e2',
  warm: '#cfcfca',
  olive: '#b0b0aa',
  tan: '#8f8f89',
  deep: '#6e6e68',
  dark: '#55554f',
} as const;

export const AVATAR_OUTFIT_COLORS = {
  white: '#fefefe',
  silver: '#d4d4d2',
  ash: '#b0b0ac',
  grey: '#8c8c88',
  charcoal: '#4a4a47',
  black: '#1c1c1c',
} as const;

export const AVATAR_HAIR_COLORS = {
  black: '#1a1a1a',
  charcoal: '#3f3f3f',
  grey: '#737373',
  ash: '#9c9c9c',
  silver: '#bdbdbd',
  white: '#fefefe',
} as const;

export const HAIR_STYLES = [
  'short', 'buzz', 'taper', 'sidePart', 'combOver', 'quiff', 'undercut', 'mohawk', 'spiky',
  'wavy', 'curly', 'fringe', 'shag', 'afro', 'receding', 'bald', 'topKnot',
  'slickBack', 'centerPart', 'pompadour', 'flatTop', 'messy', 'pixie', 'bowl', 'coils', 'cornrows',
  'bob', 'long', 'layers', 'curlyLong', 'ponytail', 'braids', 'pigtails', 'spaceBuns', 'bun',
  'mullet', 'dreadlocks', 'wavyLong', 'sideSwept', 'halfUp', 'sideBraid', 'lob',
  'headscarf', 'turban', 'beanie',
] as const;
export const EYE_STYLES = [
  'dot', 'round', 'happy', 'sleepy', 'wide', 'wink', 'lashes', 'almond', 'droopy', 'sparkle', 'closed',
  'angry', 'tired', 'side', 'squint', 'big',
] as const;
export const BROW_STYLES = [
  'soft', 'flat', 'arched', 'bold', 'raised', 'angled', 'thin', 'thick', 'worried', 'unibrow', 'short',
  'curved', 'furrowed', 'bushy',
] as const;
export const NOSE_STYLES = [
  'button', 'straight', 'round', 'wide', 'pointed', 'hook', 'nostrils', 'long', 'tiny', 'snub', 'bridge', 'side',
] as const;
export const MOUTH_STYLES = [
  'smile', 'grin', 'calm', 'smirk', 'open', 'small', 'laugh', 'tongue', 'frown', 'pout', 'teeth', 'oh',
  'wavy', 'lips', 'bigSmile', 'bucktooth',
] as const;
export const GLASSES_STYLES = [
  'none', 'round', 'square', 'sun', 'reading', 'cateye', 'aviator', 'oval', 'monocle', 'heart', 'goggles',
] as const;
export const BEARD_STYLES = [
  'none', 'stubble', 'goatee', 'full', 'moustache', 'chinstrap', 'handlebar', 'soulPatch', 'mutton', 'short',
  'long', 'pencil', 'vandyke',
] as const;
export const ACCESSORY_STYLES = [
  'none', 'earrings', 'headphones', 'cap', 'pencil', 'flower', 'bow', 'headband', 'crown', 'beret', 'earbuds',
  'noseRing', 'catEars', 'mask',
] as const;
export const DETAIL_STYLES = [
  'none', 'freckles', 'blush', 'beautyMark', 'dimples', 'wrinkles', 'scar', 'tear', 'bandaid', 'crowsFeet', 'sweat',
] as const;
export const OUTFIT_STYLES = [
  'tee', 'vneck', 'collar', 'hoodie', 'turtleneck', 'blazer', 'overalls', 'stripes', 'tank', 'tie', 'bowtie',
  'cardigan', 'puffer', 'scarf', 'necklace', 'polo',
] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];

/** How the editor groups hair styles, like the length filter on a salon menu. */
export const HAIR_LENGTH: Record<HairStyle, 'short' | 'long' | 'covered'> = {
  short: 'short', buzz: 'short', taper: 'short', sidePart: 'short', combOver: 'short', quiff: 'short',
  undercut: 'short', mohawk: 'short', spiky: 'short', wavy: 'short', curly: 'short', fringe: 'short',
  shag: 'short', afro: 'short', receding: 'short', bald: 'short', topKnot: 'short',
  slickBack: 'short', centerPart: 'short', pompadour: 'short', flatTop: 'short', messy: 'short',
  pixie: 'short', bowl: 'short', coils: 'short', cornrows: 'short',
  bob: 'long', long: 'long', layers: 'long', curlyLong: 'long', ponytail: 'long', braids: 'long',
  pigtails: 'long', spaceBuns: 'long', bun: 'long', mullet: 'long', dreadlocks: 'long', wavyLong: 'long',
  sideSwept: 'long', halfUp: 'long', sideBraid: 'long', lob: 'long',
  headscarf: 'covered', turban: 'covered', beanie: 'covered',
};
export type EyeStyle = (typeof EYE_STYLES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type NoseStyle = (typeof NOSE_STYLES)[number];
export type MouthStyle = (typeof MOUTH_STYLES)[number];
export type GlassesStyle = (typeof GLASSES_STYLES)[number];
export type BeardStyle = (typeof BEARD_STYLES)[number];
export type AccessoryStyle = (typeof ACCESSORY_STYLES)[number];
export type DetailStyle = (typeof DETAIL_STYLES)[number];
export type OutfitStyle = (typeof OUTFIT_STYLES)[number];

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
  outfit: OutfitStyle;
  outfitColor: keyof typeof AVATAR_OUTFIT_COLORS;
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
  outfit: 'tee',
  outfitColor: 'silver',
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
  { key: 'outfit', label: 'Outfit', kind: 'style', options: OUTFIT_STYLES },
  { key: 'outfitColor', label: 'Outfit colour', kind: 'color', palette: AVATAR_OUTFIT_COLORS },
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
    outfit: of(OUTFIT_STYLES, raw.outfit, DEFAULT_AVATAR.outfit),
    outfitColor: swatch(AVATAR_OUTFIT_COLORS, raw.outfitColor, DEFAULT_AVATAR.outfitColor),
  };
}

// ---------------------------------------------------------------------------
// The drawing itself
// ---------------------------------------------------------------------------

const FACE = { cx: 60, cy: 56, rx: 25, ry: 29 };
const EYE_Y = 56;
const EYE_OFFSET = 11;
const BROW_Y = 45;

// Shoulders end on the edge of the background disc, so the picture stays round even where it is shown square.
const SHOULDERS = 'M18 102.8 C22 95 34 90 52 88 H68 C86 90 98 95 102 102.8';
const TORSO = `${SHOULDERS} A60 60 0 0 1 18 102.8 Z`;

/** Neck and upper body, drawn under the face. */
function body(config: AvatarConfig): AvatarNode[] {
  const skin = pick(AVATAR_SKINS, config.skin, 'warm');
  const cloth = pick(AVATAR_OUTFIT_COLORS, config.outfitColor, 'white');
  const fine = strandOn(cloth);
  // Details sit on the cloth, so they take its contrasting shade rather than plain ink.
  const edge = { ...OUTLINE, stroke: fine };
  // A second garment (cardigan's tee, a scarf) in a shade that stands apart from the first.
  const contrast = parseInt(cloth.slice(1, 3), 16) < 128 ? PAPER : '#8c8c88';
  const collar = [
    path('M52.5 87 L49 97 L59 94 Z', cloth, edge),
    path('M67.5 87 L71 97 L61 94 Z', cloth, edge),
  ];
  const open = config.outfit === 'vneck' || config.outfit === 'blazer';
  const neck = path(open ? 'M53 74 V88 L60 101 L67 88 V74 Z' : 'M53 74 V88 Q60 95 67 88 V74 Z', skin, OUTLINE);
  const torso = [path(TORSO, cloth), line(SHOULDERS, INK, 2.2)];

  switch (config.outfit) {
    case 'vneck':
      return [...torso, neck];
    case 'collar':
      return [
        ...torso, neck,
        line('M60 94 V117', fine, 1.4),
        circle(63, 101, 1.1, fine), circle(63, 109, 1.1, fine),
        ...collar,
      ];
    case 'hoodie':
      return [
        ...torso,
        path('M38 95 C40 86 49 82 60 84 C71 82 80 86 82 95 C74 91 67 90 60 92 C53 90 46 91 38 95 Z', cloth, edge),
        neck,
        line('M55 94 V107', fine, 1.4),
        line('M65 94 V107', fine, 1.4),
        line('M44 113 Q60 106 76 113', fine, 1.4),
      ];
    case 'turtleneck':
      return [
        ...torso, neck,
        rect(51, 79, 18, 14, cloth, { rx: 4, ...edge }),
        ...[55, 60, 65].map(x => line(`M${x} 82 V90`, fine, 1.1)),
      ];
    case 'blazer':
      return [
        path(TORSO, cloth), neck,
        path('M52 88 L60 101 L68 88 L64 119 H56 Z', PAPER),
        path('M52 88 L47 96 L52 99 L49 104 L60 120', cloth, edge),
        path('M68 88 L73 96 L68 99 L71 104 L60 120', cloth, edge),
        line(SHOULDERS, INK, 2.2),
        circle(60, 112, 1.4, fine),
      ];
    case 'overalls':
      return [
        ...torso, neck,
        path('M45 104 H75 V117 H45 Z', cloth, edge),
        line('M47 104 L42 91', fine, 3.2),
        line('M73 104 L78 91', fine, 3.2),
        circle(47, 106.5, 1.4, fine),
        circle(73, 106.5, 1.4, fine),
      ];
    case 'stripes':
      return [
        ...torso,
        ...[98, 106, 114].map(y => {
          const half = Math.min(34, Math.sqrt(3600 - (y - 60) ** 2) - 2);
          return line(`M${60 - half} ${y} H${60 + half}`, fine, 2.6);
        }),
        neck,
      ];
    case 'tank':
      return [
        path(TORSO, skin), line(SHOULDERS, INK, 2.2), neck,
        path('M40 93 Q60 104 80 93 L88 109 Q60 128 32 109 Z', cloth, edge),
        path('M41 94 L44.5 88.6 L48.4 88.2 L46 96.6 Z', cloth, edge),
        path('M79 94 L75.5 88.6 L71.6 88.2 L74 96.6 Z', cloth, edge),
      ];
    case 'tie':
      return [
        ...torso, neck,
        path('M57.6 92.4 H62.4 L61.6 96 H58.4 Z', fine),
        path('M58.4 96 H61.6 L63 110 L60 114 L57 110 Z', fine),
        ...collar,
      ];
    case 'bowtie':
      return [
        ...torso, neck, ...collar,
        path('M60 93.4 L53.4 89.8 V97 Z', fine),
        path('M60 93.4 L66.6 89.8 V97 Z', fine),
        circle(60, 93.4, 1.8, fine),
      ];
    case 'cardigan':
      return [
        ...torso,
        path('M52 88 L50 118 H70 L68 88 Z', contrast),
        neck,
        line('M52 88 L50 118', fine, 1.6),
        line('M68 88 L70 118', fine, 1.6),
        circle(52.6, 100, 1.1, fine), circle(52, 109, 1.1, fine),
      ];
    case 'puffer':
      return [
        ...torso,
        ...[100, 108, 116].map(y => {
          const half = Math.min(36, Math.sqrt(3600 - (y - 60) ** 2) - 2);
          return line(`M${60 - half} ${y} Q60 ${y + 2.4} ${60 + half} ${y}`, fine, 1.2);
        }),
        neck,
        rect(49.5, 80, 21, 11, cloth, { rx: 3.5, ...edge }),
        line('M60 91 V118', fine, 1.2),
      ];
    case 'scarf':
      return [
        ...torso, neck,
        path('M47 84 Q60 94 73 84 L75 92 Q60 102 45 92 Z', contrast, edge),
        path('M64 94 L70 112 L63 113 L59 97 Z', contrast, edge),
      ];
    case 'necklace':
      return [
        ...torso, neck,
        line('M52 88 Q60 101 68 88', fine, 1),
        circle(60, 95.6, 1.9, PAPER, { stroke: fine, strokeWidth: 1 }),
      ];
    case 'polo':
      return [
        ...torso, neck,
        line('M60 94 V103', fine, 1.4),
        circle(61.8, 97, 0.9, fine), circle(61.8, 100.6, 0.9, fine),
        path('M52.5 87 Q49 94 51 97 L59 94 Z', cloth, edge),
        path('M67.5 87 Q71 94 69 97 L61 94 Z', cloth, edge),
      ];
    case 'tee':
    default:
      return [...torso, neck];
  }
}

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
    case 'mullet':
      return [
        path('M33 52 C31 64 32 76 29 87 C35 89 42 87 45 82 C40 74 38 64 38 54 Z', hair),
        path('M87 52 C89 64 88 76 91 87 C85 89 78 87 75 82 C80 74 82 64 82 54 Z', hair),
      ];
    case 'dreadlocks':
      return [26, 32.5, 81.5, 88].map((x, index) =>
        rect(x, 40 + (index % 2) * 4, 6, index % 3 ? 58 : 50, hair, { rx: 3 }));
    case 'wavyLong':
      return [
        path('M32 46 C26 56 32 64 27 74 C23 84 30 92 28 104 H44 C40 94 44 86 40 76 C37 66 42 58 40 50 Z', hair),
        path('M88 46 C94 56 88 64 93 74 C97 84 90 92 92 104 H76 C80 94 76 86 80 76 C83 66 78 58 80 50 Z', hair),
      ];
    case 'sideSwept':
      return [
        path('M31 47 C26 66 28 88 33 102 H47 C40 84 39 64 42 51 Z', hair),
        path('M89 47 C95 66 93 90 88 106 H72 C80 88 81 66 78 51 Z', hair),
      ];
    case 'halfUp':
      return [
        circle(60, 17, 7, hair),
        path('M31 47 C26 68 28 92 33 108 H47 C40 88 39 66 42 51 Z', hair),
        path('M89 47 C94 68 92 92 87 108 H73 C80 88 81 66 78 51 Z', hair),
      ];
    case 'sideBraid':
      return [
        ...[[86, 60], [88, 68], [88, 76], [87, 84], [85, 92]].map(([cx, cy]) => circle(cx, cy, 4.6, hair)),
        ellipse(84.5, 98, 2.6, 2, tone(hair, 0.3)),
      ];
    case 'lob':
      return [
        path('M31 48 C28 62 28 76 29 90 H46 C40 78 39 62 41 50 Z', hair),
        path('M89 48 C92 62 92 76 91 90 H74 C80 78 81 62 79 50 Z', hair),
      ];
    case 'headscarf':
      return [path('M28 56 C26 30 42 14 60 14 C78 14 94 30 92 56 C92 80 84 98 60 104 C36 98 28 80 28 56 Z', hair)];
    default:
      return [];
  }
}

const DEFAULT_HAIR = () => DEFAULT_AVATAR.hairColor;

/** Fine strands drawn in a lighter shade on dark hair and in ink on light hair, so they always show. */
const strandOn = (hair: string) => (parseInt(hair.slice(1, 3), 16) < 128 ? tone(hair, 0.45, 'white') : INK);

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
    case 'slickBack':
      return [
        path('M33 50 C32 28 45 19 60 19 C75 19 88 28 87 50 C84 38 75 32 60 32 C45 32 36 38 33 50 Z', hair),
        ...['M44 32 C48 25 57 21 68 21', 'M53 31 C58 26 66 23 76 25', 'M64 32 C69 28 76 28 82 34'].map(d =>
          line(d, strandOn(hair), 1.3)),
      ];
    case 'centerPart':
      return [
        path(HAIR_CAP, hair),
        path('M60 25 C50 27 40 35 36 54 C40 46 46 40 58 36 Z', hair),
        path('M60 25 C70 27 80 35 84 54 C80 46 74 40 62 36 Z', hair),
      ];
    case 'pompadour':
      return [
        path(HAIR_CAP, hair),
        path('M36 44 C32 26 42 10 60 11 C78 12 88 24 85 44 C80 32 70 28 58 30 C48 31 40 36 36 44 Z', hair),
        line('M46 22 C54 16 66 15 76 20', strandOn(hair), 1.3),
      ];
    case 'flatTop':
      return [path('M34 50 V24 Q34 18 40 18 H80 Q86 18 86 24 V50 C83 40 75 35 60 35 C45 35 37 40 34 50 Z', hair)];
    case 'messy':
      return [
        path('M33 50 C30 40 34 30 40 26 L38 18 L46 23 L50 14 L56 21 L62 12 L66 21 L74 15 L75 24 L84 22 L82 30 '
          + 'C87 36 88 44 87 50 C84 40 76 35 60 35 C46 35 36 40 33 50 Z', hair),
        path('M42 33 L46 43 L50 34 Z', hair),
        path('M58 34 L61 42 L65 34 Z', hair),
        path('M70 34 L76 41 L77 33 Z', hair),
      ];
    case 'pixie':
      return [
        path(HAIR_CAP, hair),
        path('M38 38 C46 30 62 28 78 33 C72 36 62 40 52 46 C48 42 42 40 38 42 Z', hair),
        path('M34 48 L35 60 L38.5 50 Z', hair),
        path('M86 48 L85 60 L81.5 50 Z', hair),
      ];
    case 'bowl':
      return [path('M32 54 C31 29 45 19 60 19 C75 19 89 29 88 54 C86 47 83 43 78 43 H42 C37 43 34 47 32 54 Z', hair)];
    case 'coils':
      return [
        path(HAIR_CAP, hair),
        ...[
          [37, 44], [40, 36], [46, 29], [53, 25], [60, 23], [67, 25], [74, 29], [80, 36], [83, 44],
          [42, 27], [51, 20], [60, 17], [69, 20], [78, 27], [47, 36], [55, 31], [65, 31], [73, 36],
        ].map(([cx, cy]) => circle(cx, cy, 4.4, hair)),
      ];
    case 'cornrows':
      return [
        path('M35 49 C35 31 46 24 60 24 C74 24 85 31 85 49 C82 38 73 33 60 33 C47 33 38 38 35 49 Z', hair),
        ...['M42 37 Q40 30 46 25.5', 'M50 34 Q49 28 53 25', 'M60 33 V24.5', 'M70 34 Q71 28 67 25', 'M78 37 Q80 30 74 25.5']
          .map(d => line(d, strandOn(hair), 1.3)),
      ];
    case 'mullet':
      return [path(HAIR_CAP, hair), path('M36 46 L40 38 L46 42 L52 35 L58 40 L64 34 L70 40 L76 36 L80 43 L84 46 C80 38 72 34 60 34 C48 34 40 38 36 46 Z', hair)];
    case 'dreadlocks':
      return [
        path(HAIR_CAP, hair),
        rect(37, 32, 6, 22, hair, { rx: 3 }),
        rect(77, 32, 6, 22, hair, { rx: 3 }),
        ...['M45 33 V24', 'M53 32 V22', 'M60 32 V21', 'M67 32 V22', 'M75 33 V24'].map(d => line(d, strandOn(hair), 1.2)),
      ];
    case 'wavyLong':
      return [path(HAIR_CAP, hair), line('M60 22 V33', strandOn(hair), 1.3)];
    case 'sideSwept':
      return [
        path(HAIR_CAP, hair),
        path('M40 36 C52 30 72 30 84 40 C86 46 85 50 83 54 C80 47 74 43 66 41 C58 39 48 39 40 36 Z', hair),
      ];
    case 'halfUp':
      return [path(HAIR_CAP, hair), line('M48 23 C54 20 66 20 72 23', strandOn(hair), 1.3)];
    case 'sideBraid':
      return [
        path(HAIR_CAP, hair),
        path('M36 46 C40 34 54 28 70 30 C80 32 86 40 87 52 C82 44 74 38 62 37 C52 37 42 40 36 46 Z', hair),
      ];
    case 'lob':
      return [
        path(HAIR_CAP, hair),
        path('M60 25 C52 27 42 34 37 50 C42 43 50 38 58 36 Z', hair),
        path('M60 25 C68 27 78 34 83 50 C78 43 70 38 62 36 Z', hair),
      ];
    case 'headscarf':
      return [
        path('M60 18 C42 18 30 32 31 56 C32 70 36 80 42 86 C38 74 36 62 37 52 C38 40 47 32 60 32 '
          + 'C73 32 82 40 83 52 C84 62 82 74 78 86 C84 80 88 70 89 56 C90 32 78 18 60 18 Z', hair),
        line('M44 22 C52 28 56 30 60 32', strandOn(hair), 1.2),
      ];
    case 'turban':
      return [
        path('M32 46 C28 26 42 10 60 10 C78 10 92 26 88 46 C80 38 70 35 60 35 C50 35 40 38 32 46 Z', hair),
        line('M36 40 C48 26 66 20 84 30', strandOn(hair), 1.3),
        line('M40 28 C54 20 70 24 80 40', strandOn(hair), 1.3),
      ];
    case 'beanie':
      return [
        path('M32 38 C32 20 45 11 60 11 C75 11 88 20 88 38 Z', hair),
        rect(30, 31, 60, 10, hair, { rx: 4 }),
        ...[38, 46, 54, 62, 70, 78].map(x => line(`M${x + 1} 33.5 V38.5`, strandOn(hair), 1.2)),
        circle(60, 8.5, 5, hair),
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
    } else if (style === 'lashes') {
      nodes.push(
        circle(cx, EYE_Y, 2.2, INK),
        line(`M${cx + side * 1.8} ${EYE_Y - 1.6} L${cx + side * 4.2} ${EYE_Y - 3.6}`, INK, 1.3),
        line(`M${cx + side * 0.4} ${EYE_Y - 2.3} L${cx + side * 1.4} ${EYE_Y - 4.9}`, INK, 1.3),
      );
    } else if (style === 'almond') {
      nodes.push(
        path(`M${cx - 4.6} ${EYE_Y} Q${cx} ${EYE_Y - 4.4} ${cx + 4.6} ${EYE_Y} Q${cx} ${EYE_Y + 3.6} ${cx - 4.6} ${EYE_Y} Z`, PAPER, { stroke: INK, strokeWidth: 1.5 }),
        circle(cx, EYE_Y, 1.8, INK),
      );
    } else if (style === 'droopy') {
      nodes.push(circle(cx, EYE_Y + 0.8, 2, INK), line(`M${cx - 3.6} ${EYE_Y - 0.4} H${cx + 3.6}`, INK, 1.8));
    } else if (style === 'sparkle') {
      nodes.push(circle(cx, EYE_Y, 3, INK), circle(cx + 1, EYE_Y - 1, 1, PAPER));
    } else if (style === 'closed') {
      nodes.push(line(`M${cx - 3.4} ${EYE_Y} H${cx + 3.4}`, INK, 2));
    } else if (style === 'angry') {
      nodes.push(
        circle(cx, EYE_Y + 0.6, 2, INK),
        line(`M${cx + side * 3.6} ${EYE_Y - 3.4} L${cx - side * 3.6} ${EYE_Y - 1}`, INK, 1.8),
      );
    } else if (style === 'tired') {
      nodes.push(
        circle(cx, EYE_Y, 2.1, INK),
        line(`M${cx - 3} ${EYE_Y + 3.6} Q${cx} ${EYE_Y + 5.2} ${cx + 3} ${EYE_Y + 3.6}`, INK, 1.1, { opacity: 0.6 }),
      );
    } else if (style === 'side') {
      nodes.push(circle(cx, EYE_Y, 3.6, PAPER, { stroke: INK, strokeWidth: 1.5 }), circle(cx + 1.8, EYE_Y + 0.3, 1.7, INK));
    } else if (style === 'squint') {
      nodes.push(line(`M${cx + side * 2.6} ${EYE_Y - 2.6} L${cx - side * 2.4} ${EYE_Y} L${cx + side * 2.6} ${EYE_Y + 2.6}`, INK, 1.8));
    } else if (style === 'big') {
      nodes.push(
        ellipse(cx, EYE_Y, 3, 3.6, INK),
        circle(cx + 1.1, EYE_Y - 1.3, 1.1, PAPER),
        circle(cx - 1, EYE_Y + 1.4, 0.5, PAPER),
      );
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
      case 'thin':
        return [line(`M${cx - 4.5} ${BROW_Y + 1} Q${cx} ${BROW_Y - 2.4} ${cx + 4.5} ${BROW_Y + 0.6}`, brow, 1.2)];
      case 'thick':
        return [path(`M${cx - 5} ${BROW_Y + 1.6} Q${cx} ${BROW_Y - 5.6} ${cx + 5} ${BROW_Y + 0.8} Q${cx} ${BROW_Y - 0.6} ${cx - 5} ${BROW_Y + 1.6} Z`, brow, { stroke: brow, strokeWidth: 1, strokeLinejoin: 'round' })];
      case 'worried':
        return [line(`M${cx + side * 4.5} ${BROW_Y + 1} L${cx - side * 4} ${BROW_Y - 2.4}`, brow, 2.2)];
      case 'unibrow':
        return side < 0
          ? [line(`M${FACE.cx - 15.5} ${BROW_Y + 0.6} Q${FACE.cx - 11} ${BROW_Y - 2.4} ${FACE.cx} ${BROW_Y} Q${FACE.cx + 11} ${BROW_Y - 2.4} ${FACE.cx + 15.5} ${BROW_Y + 0.6}`, brow, 2.4)]
          : [];
      case 'short':
        return [line(`M${cx - 2} ${BROW_Y} H${cx + 2}`, brow, 2.6)];
      case 'curved':
        return [line(`M${cx - 4.4} ${BROW_Y + 2} Q${cx} ${BROW_Y - 5} ${cx + 4.4} ${BROW_Y + 2}`, brow, 2)];
      case 'furrowed':
        return [
          line(`M${cx + side * 4.5} ${BROW_Y - 2} L${cx - side * 4.5} ${BROW_Y + 1.8}`, brow, 2.8),
          ...(side < 0 ? [line(`M${FACE.cx} ${BROW_Y - 1} V${BROW_Y + 3}`, brow, 1)] : []),
        ];
      case 'bushy':
        return [-3.5, 0, 3.5].map(dx => line(`M${cx + dx - 1.4} ${BROW_Y + 1.2} L${cx + dx + 1.4} ${BROW_Y - 1.2}`, brow, 2));
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
    case 'pointed':
      return [line('M60 56 L63.6 65.6 L59.6 66.4', shade, 1.8)];
    case 'hook':
      return [line('M59 56 Q64.4 60 62.6 66 Q61 67.4 58.6 66.4', shade, 1.8)];
    case 'nostrils':
      return [circle(57.8, 65, 0.95, shade), circle(62.2, 65, 0.95, shade)];
    case 'long':
      return [line('M60 53 V66 Q60 68 57.6 67.6', shade, 1.8)];
    case 'tiny':
      return [circle(60, 65, 1.1, shade)];
    case 'snub':
      return [line('M57.6 66 Q60 62.8 62.4 66', shade, 1.8)];
    case 'bridge':
      return [line('M57.6 55 Q59 61 57.4 65.6 Q60 67.6 62.6 65.6', shade, 1.6)];
    case 'side':
      return [line('M61 57 L57 65.6 H61.6', shade, 1.8)];
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
    case 'laugh':
      return [path('M51 71 Q60 85 69 71 Z', INK, { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' }), ellipse(60, 77.2, 3.6, 1.7, '#8a8a8a')];
    case 'tongue':
      return [
        path('M57.4 74.6 Q57.6 80.6 60 80.6 Q62.4 80.6 62.6 74.6 Z', PAPER, { stroke: INK, strokeWidth: 1.3 }),
        line('M60 75.4 V78', INK, 1),
        line('M52 72 Q60 78.6 68 72', INK, 2.2),
      ];
    case 'frown':
      return [line('M53 77 Q60 71 67 77', INK, 2.2)];
    case 'pout':
      return [ellipse(60, 74.5, 2.6, 2, INK)];
    case 'teeth':
      return [
        path('M52 71 H68 Q68 79 60 79 Q52 79 52 71 Z', PAPER, { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' }),
        line('M52.4 74.4 H67.6', INK, 1.1),
      ];
    case 'oh':
      return [ellipse(60, 75, 3, 4, 'none', { stroke: INK, strokeWidth: 2 })];
    case 'wavy':
      return [line('M52 74 Q55 71.6 58 74 T64 74 T68 73.4', INK, 2)];
    case 'lips':
      return [path('M52 73.5 Q56 70.6 60 72.4 Q64 70.6 68 73.5 Q60 79 52 73.5 Z', INK)];
    case 'bigSmile':
      return [line('M48.5 70 Q60 84 71.5 70', INK, 2.2)];
    case 'bucktooth':
      return [
        rect(58, 73.6, 4, 3.2, PAPER, { stroke: INK, strokeWidth: 1, rx: 0.6 }),
        line('M52 72 Q60 77.6 68 72', INK, 2.2),
      ];
    case 'smile':
    default:
      return [line('M52 72 Q60 79 68 72', INK, 2.2)];
  }
}

const MOUSTACHE = 'M52 69.5 Q56 66.4 60 69.2 Q64 66.4 68 69.5 Q64 72 60 71.4 Q56 72 52 69.5 Z';

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
      return [path(MOUSTACHE, hair)];
    case 'chinstrap':
      return [path('M36 58 C38 78 48 88 60 88 C72 88 82 78 84 58 C82 74 72 83 60 83 C48 83 38 74 36 58 Z', hair)];
    case 'handlebar':
      return [path(
        'M52 69.5 Q56 67 60 69.4 Q64 67 68 69.5 Q72 70 73 66.6 Q74.6 70.6 70 72 Q65 71.6 60 71 '
          + 'Q55 71.6 50 72 Q45.4 70.6 47 66.6 Q48 70 52 69.5 Z',
        hair
      )];
    case 'soulPatch':
      return [path('M58 79.5 L62 79.5 L60 83.5 Z', hair)];
    case 'mutton':
      return [
        path('M35 52 C35 64 38 72 46 76 C50 73 50 70 45 66 C41 62 40 57 40 52 Z', hair),
        path('M85 52 C85 64 82 72 74 76 C70 73 70 70 75 66 C79 62 80 57 80 52 Z', hair),
      ];
    case 'short':
      return [
        path('M36 60 C37 78 47 88 60 88 C73 88 83 78 84 60 C80 72 72 76 64 76 Q60 74 56 76 C48 76 40 72 36 60 Z', hair),
        path(MOUSTACHE, hair),
      ];
    case 'long':
      return [
        path('M36 58 C37 80 46 102 60 108 C74 102 83 80 84 58 C80 72 72 75 64 75 Q60 73 56 75 C48 75 40 72 36 58 Z', hair),
        path(MOUSTACHE, hair),
      ];
    case 'pencil':
      return [line('M53 70.2 Q60 68.4 67 70.2', INK, 1.4)];
    case 'vandyke':
      return [path('M54 80 Q60 93 66 80 Q60 83 54 80 Z', hair), path(MOUSTACHE, hair)];
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
  const lenses = (draw: (x: number, side: number) => AvatarNode[]) => [left, right].flatMap((x, index) => draw(x, index ? 1 : -1));
  const bridge = line(`M${left + 7} ${EYE_Y - 1} H${right - 7}`, frame, 1.6);
  const rim = { stroke: frame, strokeWidth: 1.8 };
  if (config.glasses === 'cateye') {
    return [
      ...lenses((x, side) => [path(
        `M${x - side * 6.5} ${EYE_Y - 4} L${x + side * 9} ${EYE_Y - 7} Q${x + side * 7} ${EYE_Y + 6} ${x} ${EYE_Y + 5.5} `
          + `Q${x - side * 6.5} ${EYE_Y + 5} ${x - side * 6.5} ${EYE_Y - 4} Z`,
        'none', rim
      )]),
      bridge,
    ];
  }
  if (config.glasses === 'aviator') {
    return [
      ...lenses(x => [path(
        `M${x - 7.5} ${EYE_Y - 5} H${x + 7.5} Q${x + 8} ${EYE_Y + 7} ${x} ${EYE_Y + 7} Q${x - 8} ${EYE_Y + 7} ${x - 7.5} ${EYE_Y - 5} Z`,
        INK, { ...rim, fillOpacity: 0.28 }
      )]),
      line(`M${left + 7.5} ${EYE_Y - 4.6} H${right - 7.5}`, frame, 1.4),
      line(`M${left + 6} ${EYE_Y - 1} Q${FACE.cx} ${EYE_Y - 3} ${right - 6} ${EYE_Y - 1}`, frame, 1.4),
    ];
  }
  if (config.glasses === 'oval') {
    return [...lenses(x => [ellipse(x, EYE_Y, 8, 5.4, 'none', rim)]), line(`M${left + 8} ${EYE_Y - 1} H${right - 8}`, frame, 1.6)];
  }
  if (config.glasses === 'monocle') {
    return [circle(right, EYE_Y, 7, 'none', rim), line(`M${right + 6} ${EYE_Y + 4} Q${right + 11} ${EYE_Y + 16} ${right + 4} ${EYE_Y + 28}`, frame, 1)];
  }
  if (config.glasses === 'heart') {
    return [
      ...lenses(x => [path(
        `M${x} ${EYE_Y + 6} C${x - 9} ${EYE_Y} ${x - 7} ${EYE_Y - 7.5} ${x} ${EYE_Y - 3} C${x + 7} ${EYE_Y - 7.5} ${x + 9} ${EYE_Y} ${x} ${EYE_Y + 6} Z`,
        INK
      )]),
      line(`M${left + 6} ${EYE_Y - 2} H${right - 6}`, frame, 1.6),
    ];
  }
  if (config.glasses === 'goggles') {
    return [
      line('M34 55 H86', frame, 3.2),
      ...lenses(x => [circle(x, EYE_Y, 8, PAPER, { stroke: frame, strokeWidth: 2.4, fillOpacity: 0.35 })]),
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
    case 'flower':
      return [
        ...[0, 1, 2, 3, 4].map(index => {
          const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
          return circle(39 + Math.cos(angle) * 4.2, 30 + Math.sin(angle) * 4.2, 3.2, PAPER, OUTLINE);
        }),
        circle(39, 30, 2, INK),
      ];
    case 'bow':
      return [
        path('M78 26 L70 19.5 L70.6 32.4 Z', PAPER, OUTLINE),
        path('M78 26 L86 19.5 L85.4 32.4 Z', PAPER, OUTLINE),
        circle(78, 26, 2.4, INK),
      ];
    case 'headband':
      return [path('M34 46 C34 28 46 22 60 22 C74 22 86 28 86 46 C84 33 74 27.5 60 27.5 C46 27.5 36 33 34 46 Z', PAPER, OUTLINE)];
    case 'crown':
      return [
        path('M44 25 L45 12 L52.5 19 L60 9 L67.5 19 L75 12 L76 25 Z', PAPER, OUTLINE),
        circle(60, 9, 1.8, INK), circle(45, 12, 1.4, INK), circle(75, 12, 1.4, INK),
      ];
    case 'beret':
      return [
        path('M31 35 C29 22 44 14 60 15 C79 16 91 24 87 33 C78 30 64 30 50 32 C42 33 36 34.4 31 35 Z', INK),
        line('M60 15 L61.4 11', INK, 2),
      ];
    case 'earbuds':
      return [
        circle(34.4, 60, 2.4, PAPER, OUTLINE), line('M34.4 62.6 V68', INK, 1.6),
        circle(85.6, 60, 2.4, PAPER, OUTLINE), line('M85.6 62.6 V68', INK, 1.6),
      ];
    case 'noseRing':
      return [circle(62.6, 66.6, 1.7, 'none', { stroke: INK, strokeWidth: 1.2 })];
    case 'catEars':
      return [
        path('M37 32 L39 13 L53 24 Z', INK, OUTLINE),
        path('M83 32 L81 13 L67 24 Z', INK, OUTLINE),
        path('M40.6 27 L41.4 18.6 L47.6 23.6 Z', PAPER),
        path('M79.4 27 L78.6 18.6 L72.4 23.6 Z', PAPER),
      ];
    case 'mask':
      return [
        line('M41 66 L35.6 60', INK, 1.2),
        line('M79 66 L84.4 60', INK, 1.2),
        path('M40 64 Q60 60 80 64 L78 79 Q60 89 42 79 Z', PAPER, OUTLINE),
        line('M46 70 H74', INK, 1),
        line('M46.6 75 H73.4', INK, 1),
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
    case 'dimples':
      return [line('M49.6 71 Q48.9 73 50.4 74.2', INK, 1.2), line('M70.4 71 Q71.1 73 69.6 74.2', INK, 1.2)];
    case 'wrinkles':
      return [
        line('M50 37.6 Q60 35.9 70 37.6', INK, 1.1, { opacity: 0.85 }),
        line('M52 40.6 Q60 39.2 68 40.6', INK, 1.1, { opacity: 0.85 }),
      ];
    case 'scar':
      return [line('M73 60.6 L78 69', INK, 1.2), line('M74 64.6 L76.6 63.2', INK, 1.1), line('M75.6 67.4 L78.2 66', INK, 1.1)];
    case 'tear':
      return [path('M73 60.5 Q71.2 63.8 73 64.8 Q74.8 63.8 73 60.5 Z', PAPER, { stroke: INK, strokeWidth: 1 })];
    case 'bandaid':
      return [
        rect(40.5, 60.4, 10, 4.2, PAPER, { rx: 1.8, stroke: INK, strokeWidth: 1.2, transform: 'rotate(-20 45.5 62.5)' }),
        circle(44.6, 62.8, 0.45, INK), circle(46.4, 62.2, 0.45, INK),
      ];
    case 'crowsFeet':
      return [-1, 1].flatMap(side => [
        line(`M${60 + side * 18} 54 L${60 + side * 21} 52.4`, INK, 1),
        line(`M${60 + side * 18.4} 56.4 L${60 + side * 21.6} 56.4`, INK, 1),
        line(`M${60 + side * 18} 58.8 L${60 + side * 21} 60.4`, INK, 1),
      ]);
    case 'sweat':
      return [path('M78 37 Q75.4 41.8 78 43.2 Q80.6 41.8 78 37 Z', PAPER, { stroke: INK, strokeWidth: 1.1 })];
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
    ...body(config),
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
    case 'beard': return [...face(config), ...beard(config)];
    case 'accessory': return [...face(config), ...accessory(config)];
    case 'details': return [...face(config), ...details(config)];
    case 'outfit':
    case 'outfitColor': return body(config);
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
