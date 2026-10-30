"use client";

import React, { useState } from 'react';
import {
  Brush, Check, Shirt, CircleDot, Eye, Glasses, Loader2, PaintBucket, RotateCcw, Scissors, Shuffle, Slash,
  Smile, Sparkle, Sparkles, Spline, type LucideIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/primitives';
import { AvatarArt } from '@/components/ui/avatar-art';
import {
  AVATAR_FIELDS, AVATAR_HAIR_COLORS, AVATAR_OUTFIT_COLORS, DEFAULT_AVATAR, HAIR_LENGTH, normalizeAvatar, randomOption, shuffleAvatar,
  type AvatarConfig, type AvatarFieldKey, type HairStyle,
} from '@/lib/avatar';

const HAIR_FILTERS = ['short', 'long', 'covered'] as const;

export interface AvatarMakerProps {
  /** The saved design, if the person made one before. */
  value?: AvatarConfig | null;
  personName: string;
  onClose: () => void;
  /** Persists the design; resolves false when the save failed and the dialog should stay open. */
  onSave: (config: AvatarConfig) => Promise<boolean>;
}

/** The sidebar: one entry per part, each framing its tiles around where that part sits on the face. */
/** Colour circles shown above a part's tiles. */
const SWATCHES: Partial<Record<AvatarFieldKey, { field: 'hairColor' | 'outfitColor'; label: string; palette: Record<string, string> }>> = {
  hairStyle: { field: 'hairColor', label: 'Hair colour', palette: AVATAR_HAIR_COLORS },
  outfit: { field: 'outfitColor', label: 'Outfit colour', palette: AVATAR_OUTFIT_COLORS },
};

const CATEGORIES: { field: AvatarFieldKey; label: string; icon: LucideIcon; frame?: string }[] = [
  { field: 'skin', label: 'Skin tone', icon: CircleDot, frame: '26 22 68 72' },
  { field: 'eyes', label: 'Eyes', icon: Eye, frame: '34 41 52 30' },
  { field: 'brows', label: 'Brows', icon: Spline, frame: '34 31 52 30' },
  { field: 'glasses', label: 'Eyewear', icon: Glasses, frame: '24 36 72 50' },
  { field: 'nose', label: 'Nose', icon: Slash, frame: '44 48 32 28' },
  { field: 'mouth', label: 'Mouth', icon: Smile, frame: '40 59 40 30' },
  { field: 'hairStyle', label: 'Hair', icon: Scissors, frame: '10 6 100 106' },
  { field: 'beard', label: 'Beard', icon: Brush, frame: '22 44 76 68' },
  { field: 'accessory', label: 'Accessories', icon: Sparkles, frame: '18 8 88 88' },
  { field: 'details', label: 'Details', icon: Sparkle, frame: '26 22 68 72' },
  { field: 'outfit', label: 'Outfit', icon: Shirt, frame: '20 66 80 56' },
  { field: 'background', label: 'Background', icon: PaintBucket },
];

const optionsOf = (field: AvatarFieldKey): readonly string[] => {
  const entry = AVATAR_FIELDS.find(candidate => candidate.key === field) ?? AVATAR_FIELDS[0];
  return entry.kind === 'color' ? Object.keys(entry.palette) : entry.options;
};

const labelOf = (option: string) => option.replace(/([A-Z])/g, ' $1').toLowerCase();

/**
 * The avatar maker, laid out like a sketchbook: parts down the left, the drawings for the chosen part
 * in the middle, the portrait on the right. Tiles show the part on its own, drawn by the same renderer
 * as the portrait and the stored picture, so a choice looks exactly like what ends up on the profile.
 */
export function AvatarMaker({ value, personName, onClose, onSave }: AvatarMakerProps) {
  const [config, setConfig] = useState<AvatarConfig>(() => normalizeAvatar(value));
  const [field, setField] = useState<AvatarFieldKey>(value ? 'hairStyle' : 'skin');
  const [saving, setSaving] = useState(false);
  const [hairFilter, setHairFilter] = useState<(typeof HAIR_FILTERS)[number] | null>(null);

  const category = CATEGORIES.find(entry => entry.field === field) ?? CATEGORIES[0];
  const swatches = SWATCHES[field];

  const setOption = (key: AvatarFieldKey, option: string) => {
    setConfig(previous => ({ ...previous, [key]: option }) as AvatarConfig);
  };

  const save = async () => {
    setSaving(true);
    const ok = await onSave(config);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Design your avatar" eyebrow={`My profile · ${personName}`} size="5xl">
      <div className="-m-5 grid md:h-[560px] md:grid-cols-[176px_minmax(0,300px)_1fr]">
        <nav
          aria-label="Avatar parts"
          className="flex gap-0.5 overflow-x-auto border-b border-[var(--line)] p-2 md:flex-col md:justify-center md:border-b-0 md:border-r"
        >
          {CATEGORIES.map(entry => {
            const Icon = entry.icon;
            const current = entry.field === field;
            return (
              <button
                key={entry.field}
                type="button"
                onClick={() => setField(entry.field)}
                aria-current={current}
                className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                  current ? 'bg-[var(--surface-sunken)] font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2.2} />
                {entry.label}
              </button>
            );
          })}
        </nav>

        <section aria-label={category.label} className="flex min-h-0 flex-col border-b border-[var(--line)] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <h4 className="text-[13px] text-[var(--ink-3)]">{category.label}</h4>
            <button
              type="button"
              onClick={() => setOption(field, randomOption(field))}
              title={`Random ${category.label.toLowerCase()}`}
              aria-label={`Pick a random ${category.label.toLowerCase()}`}
              className="cursor-pointer rounded-md p-1.5 text-[var(--ink-3)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
          </div>

          {swatches && (
            <div className="flex gap-2 px-3 py-2" role="group" aria-label={swatches.label}>
              {Object.entries(swatches.palette).map(([key, color]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOption(swatches.field, key)}
                  title={key}
                  aria-label={`${swatches.label}: ${key}`}
                  aria-pressed={config[swatches.field] === key}
                  className={`h-6 w-6 cursor-pointer rounded-full border border-[#1a1a1a] ring-offset-2 ${
                    config[swatches.field] === key ? 'ring-2 ring-[var(--accent)]' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}

          {field === 'hairStyle' && (
            <div className="flex gap-1.5 px-3 pb-2" role="group" aria-label="Filter hair styles">
              {HAIR_FILTERS.map(filter => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setHairFilter(current => (current === filter ? null : filter))}
                  aria-pressed={hairFilter === filter}
                  className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] capitalize transition-colors ${
                    hairFilter === filter
                      ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--canvas)]'
                      : 'border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--surface-muted)]'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}

          <div className="grid max-h-[300px] content-start grid-cols-3 gap-2 overflow-y-auto p-3 pt-1 md:max-h-none md:flex-1">
            {optionsOf(field)
              .filter(option => field !== 'hairStyle' || !hairFilter || HAIR_LENGTH[option as HairStyle] === hairFilter)
              .map(option => {
                const selected = (config[field] as string) === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setOption(field, option)}
                    aria-pressed={selected}
                    aria-label={option === 'none' ? `No ${category.label.toLowerCase()}` : labelOf(option)}
                    title={option === 'none' ? 'None' : labelOf(option)}
                    className={`group flex aspect-square cursor-pointer items-center justify-center rounded-lg border bg-white transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                      selected ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    {option === 'none' ? (
                      <span className="text-[11px] text-[var(--ink-4)]">None</span>
                    ) : (
                      <AvatarArt
                        config={{ ...config, [field]: option }}
                        part={field}
                        viewBox={category.frame}
                        size={64}
                        title=""
                        className={`transition-opacity ${selected ? '' : 'opacity-40 group-hover:opacity-100'}`}
                      />
                    )}
                  </button>
                );
              })}
          </div>
        </section>

        <div className="order-first flex flex-col items-center justify-center gap-5 bg-[var(--surface-sunken)] px-5 py-6 md:order-none">
          <div className="rounded-full shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
            <AvatarArt config={config} size={220} className="h-40 w-40 rounded-full md:h-[260px] md:w-[260px]" title={`${personName}'s avatar`} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfig(DEFAULT_AVATAR)}
              title="Start over from the default face"
              aria-label="Reset the avatar"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white text-[var(--ink-3)] shadow-sm hover:text-[var(--ink)]"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfig(shuffleAvatar())}
              title="Draw a whole new face"
              aria-label="Shuffle the whole face"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white text-[var(--accent)] shadow-sm hover:bg-[var(--surface-muted)]"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[13px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Use this avatar'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
