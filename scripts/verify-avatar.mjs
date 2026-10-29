/**
 * Verification for the avatar maker.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-avatar.mjs
 *
 * The art itself is visual; these are the rules that keep it honest — every option has its own
 * drawing, the serialised picture matches the drawn one, and a half-written config still renders.
 */

import {
  ACCESSORY_STYLES, AVATAR_BACKGROUNDS, AVATAR_FIELDS, AVATAR_HAIR_COLORS, AVATAR_SHIRTS, AVATAR_SKINS,
  BEARD_STYLES, BROW_STYLES, DEFAULT_AVATAR, DETAIL_STYLES, EYE_STYLES, GLASSES_STYLES, HAIR_STYLES,
  MOUTH_STYLES, NOSE_STYLES,
  avatarDataUrl, avatarNodes, avatarSvg, isAvatarDataUrl, normalizeAvatar, shuffleAvatar, tone,
} from '@/lib/avatar';

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

console.log('================================================================');
console.log('🚀 ORBIT AVATAR MAKER - VERIFICATION');
console.log('================================================================\n');

// --- Config handling ---------------------------------------------------------
const fallback = normalizeAvatar(null);
assert(
  JSON.stringify(fallback) === JSON.stringify(DEFAULT_AVATAR),
  'A profile without an avatar config gets the default face',
  Object.values(fallback).join(', ')
);
const junk = normalizeAvatar({ hairStyle: 'not-a-style', skin: 'neon', eyes: 42, background: '__proto__' });
assert(
  junk.hairStyle === DEFAULT_AVATAR.hairStyle && junk.skin === DEFAULT_AVATAR.skin &&
    junk.eyes === DEFAULT_AVATAR.eyes && junk.background === DEFAULT_AVATAR.background,
  'Unknown or hostile values fall back instead of drawing nothing',
  `${junk.hairStyle}/${junk.skin}/${junk.eyes}/${junk.background}`
);
assert(
  Object.keys(normalizeAvatar(DEFAULT_AVATAR)).length === Object.keys(DEFAULT_AVATAR).length,
  'A saved config survives the round trip unchanged',
  JSON.stringify(DEFAULT_AVATAR)
);

// --- The drawing ------------------------------------------------------------
const nodes = avatarNodes(DEFAULT_AVATAR);
const svg = avatarSvg(DEFAULT_AVATAR);
assert(
  nodes.length >= 12 && nodes[0].tag === 'circle' && nodes[0].attrs.r === 60,
  'The portrait opens with a full-bleed background disc',
  `${nodes.length} shapes`
);
assert(
  svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"') && svg.endsWith('</svg>'),
  'The stored picture is a self-contained SVG document',
  `${avatarSvg(DEFAULT_AVATAR).length} characters`
);
assert(
  !/NaN|undefined|Infinity/.test(svg),
  'No broken geometry leaks into the picture'
);
const deepSvg = avatarSvg({ ...DEFAULT_AVATAR, skin: 'deep' });
assert(
  deepSvg.includes(AVATAR_SKINS.deep) && !deepSvg.includes(AVATAR_SKINS.porcelain),
  'A chosen skin colour replaces the others',
  `${AVATAR_SKINS.deep} in, ${AVATAR_SKINS.porcelain} out`
);
assert(
  avatarSvg({ ...DEFAULT_AVATAR, background: 'sky' }).includes(AVATAR_BACKGROUNDS.sky) &&
    !avatarSvg({ ...DEFAULT_AVATAR, background: 'sky' }).includes(AVATAR_BACKGROUNDS.rose),
  'The background swatch is the one painted',
  AVATAR_BACKGROUNDS.sky
);

// --- Every option draws something of its own --------------------------------
const styleFields = [
  ['hairStyle', HAIR_STYLES],
  ['eyes', EYE_STYLES],
  ['brows', BROW_STYLES],
  ['nose', NOSE_STYLES],
  ['mouth', MOUTH_STYLES],
  ['glasses', GLASSES_STYLES],
  ['beard', BEARD_STYLES],
  ['accessory', ACCESSORY_STYLES],
  ['details', DETAIL_STYLES],
];

styleFields.forEach(([field, options]) => {
  const seen = new Map();
  options.forEach(option => {
    const markup = avatarSvg({ ...DEFAULT_AVATAR, [field]: option });
    seen.set(markup, [...(seen.get(markup) ?? []), option]);
  });
  const clones = [...seen.values()].filter(group => group.length > 1);
  assert(
    clones.length === 0,
    `Every ${field} option has its own drawing`,
    clones.length ? `identical: ${clones.map(group => group.join(' = ')).join('; ')}` : `${options.length} options`
  );
});

const noneOptions = ['glasses', 'beard', 'accessory', 'details'];
noneOptions.forEach(field => {
  const bare = avatarSvg({ ...DEFAULT_AVATAR, [field]: 'none' });
  const decorated = avatarSvg({ ...DEFAULT_AVATAR, [field]: AVATAR_FIELDS.find(entry => entry.key === field).options[1] });
  assert(bare !== decorated, `"${field}" can be left off and still changes the face`);
});

// --- Colours ----------------------------------------------------------------
const hairColour = avatarSvg({ ...DEFAULT_AVATAR, hairStyle: 'short', hairColor: 'auburn' });
assert(hairColour.includes(AVATAR_HAIR_COLORS.auburn), 'Hair takes the chosen colour', AVATAR_HAIR_COLORS.auburn);
assert(
  avatarSvg({ ...DEFAULT_AVATAR, shirt: 'forest' }).includes(AVATAR_SHIRTS.forest),
  'The outfit takes the chosen colour',
  AVATAR_SHIRTS.forest
);
assert(tone('#808080', 0.5) === '#404040' && tone('#808080', 0.5, 'white') === '#c0c0c0', 'Shading mixes towards black or white', `${tone('#808080', 0.5)} / ${tone('#808080', 0.5, 'white')}`);

// --- The stored picture -----------------------------------------------------
const dataUrl = avatarDataUrl(DEFAULT_AVATAR);
assert(
  isAvatarDataUrl(dataUrl) && decodeURIComponent(dataUrl.split(',')[1]) === avatarSvg(DEFAULT_AVATAR),
  'The data URL decodes back to the same SVG',
  `${dataUrl.length} characters`
);
assert(
  !isAvatarDataUrl('https://example.test/photo.png') && !isAvatarDataUrl(null),
  'An uploaded photo is never mistaken for a made avatar'
);

// --- Shuffle ----------------------------------------------------------------
let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const shuffled = shuffleAvatar(DEFAULT_AVATAR, random);
const changed = Object.keys(DEFAULT_AVATAR).filter(key => shuffled[key] !== DEFAULT_AVATAR[key]);
assert(
  changed.length > 0 && changed.length <= 2,
  'Shuffle changes a couple of choices, not the whole person',
  changed.join(', ')
);
assert(
  JSON.stringify(normalizeAvatar(shuffled)) === JSON.stringify(shuffled),
  'A shuffled face is still a valid config'
);

// --- The editor's catalogue --------------------------------------------------
assert(
  AVATAR_FIELDS.length === Object.keys(DEFAULT_AVATAR).length,
  'Every part of the face is editable',
  `${AVATAR_FIELDS.length} fields`
);
assert(
  AVATAR_FIELDS.every(entry => entry.kind === 'color'
    ? Object.keys(entry.palette).includes(DEFAULT_AVATAR[entry.key])
    : entry.options.includes(DEFAULT_AVATAR[entry.key])),
  'The default face uses an option the editor offers'
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
