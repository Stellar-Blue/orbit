"use client";

import React, { useMemo, useState } from 'react';
import { Check, Dices, Loader2, RotateCcw } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';
import { AvatarArt } from '@/components/ui/avatar-art';
import {
  AVATAR_FIELDS, DEFAULT_AVATAR, normalizeAvatar, shuffleAvatar,
  type AvatarConfig, type AvatarFieldKey,
} from '@/lib/avatar';

export interface AvatarMakerProps {
  /** The saved design, if the person made one before. */
  value?: AvatarConfig | null;
  personName: string;
  onClose: () => void;
  /** Persists the design; resolves false when the save failed and the dialog should stay open. */
  onSave: (config: AvatarConfig) => Promise<boolean>;
}

/**
 * The avatar maker: pick a background, a face, hair, eyes and the rest, watch it change in the
 * preview, then save. Every tile is drawn with the same renderer as the big preview and the stored
 * picture, so a choice looks exactly like what ends up on the profile.
 */
export function AvatarMaker({ value, personName, onClose, onSave }: AvatarMakerProps) {
  const [config, setConfig] = useState<AvatarConfig>(() => normalizeAvatar(value));
  const [field, setField] = useState<AvatarFieldKey>(value ? 'hairStyle' : 'skin');
  const [saving, setSaving] = useState(false);

  const active = useMemo(
    () => AVATAR_FIELDS.find(entry => entry.key === field) ?? AVATAR_FIELDS[0],
    [field]
  );

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
    <Modal isOpen onClose={onClose} title="Design your avatar" eyebrow={`My profile · ${personName}`} size="xl">
      <div className="grid gap-5 px-5 py-4 md:grid-cols-[190px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-[var(--surface-muted)] p-1.5 ring-1 ring-[var(--line)]">
            <AvatarArt config={config} size={152} className="rounded-full" title={`${personName}'s avatar`} />
          </div>
          <div className="flex w-full gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => setConfig(previous => shuffleAvatar(previous))}
              title="Try another look"
            >
              <Dices className="w-3.5 h-3.5" /> Shuffle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfig(DEFAULT_AVATAR)}
              title="Start over from the default face"
              aria-label="Reset the avatar"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Button size="sm" variant="primary" className="w-full" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Use this avatar'}
          </Button>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Avatar parts">
            {AVATAR_FIELDS.map(entry => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={field === entry.key}
                onClick={() => setField(entry.key)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                  field === entry.key
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--line)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {active.kind === 'color' ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(active.palette).map(([key, color]) => {
                const selected = (config[active.key] as string) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOption(active.key, key)}
                    title={key}
                    aria-label={`${active.label}: ${key}`}
                    aria-pressed={selected}
                    className={`h-8 w-8 cursor-pointer rounded-full ring-offset-2 transition-shadow ${
                      selected ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--line-strong)] hover:ring-[var(--ink-4)]'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid max-h-[320px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {active.options.map(option => {
                const preview = { ...config, [active.key]: option } as AvatarConfig;
                const selected = (config[active.key] as string) === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setOption(active.key, option)}
                    aria-pressed={selected}
                    className={`flex cursor-pointer flex-col items-center gap-1 rounded-[var(--radius-control)] border px-1 py-1.5 transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--line)] bg-white hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <AvatarArt config={preview} size={46} className="rounded-full" title="" />
                    <span className="w-full truncate text-center text-[10.5px] font-medium capitalize text-[var(--ink-3)]">
                      {option === 'none' ? 'None' : option.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-[var(--ink-4)]">
            Your avatar is drawn from these choices and used wherever your photo appears — upload a
            picture instead any time from the profile card.
          </p>
        </div>
      </div>
    </Modal>
  );
}
