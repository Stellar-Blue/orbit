"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Pin, X } from 'lucide-react';
import type { CounterpartyTierState } from '@/lib/types';

interface TierOverrideFormProps {
  counterpartyId: string;
  tierCount: number;
  currentOverride: CounterpartyTierState;
}

export const TierOverrideForm: React.FC<TierOverrideFormProps> = ({ counterpartyId, tierCount, currentOverride }) => {
  const { setTierOverride } = useAuth();
  const [pinning, setPinning] = useState(false);
  const [tierIndex, setTierIndex] = useState<number>(currentOverride.override_tier_index ?? 0);
  const [reason, setReason] = useState(currentOverride.override_reason || '');
  const [expiresOn, setExpiresOn] = useState(currentOverride.override_expires_on || '');

  const handlePin = async () => {
    if (!reason.trim()) {
      alert('A reason is mandatory for tier overrides.');
      return;
    }
    setPinning(true);
    await setTierOverride(counterpartyId, 'client', tierIndex, reason, expiresOn || undefined);
    setPinning(false);
  };

  const handleClear = async () => {
    setPinning(true);
    await setTierOverride(counterpartyId, 'client', null, 'Override cleared');
    setPinning(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {currentOverride.overridden ? (
        <>
          <span className="text-[11px] font-bold text-amber-700">Pinned Tier {currentOverride.override_tier_index !== null ? (currentOverride.override_tier_index ?? 0) + 1 : ''}</span>
          <button
            type="button"
            onClick={handleClear}
            disabled={pinning}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 bg-rose-50 hover:bg-rose-100 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-3 h-3" /> Clear Override
          </button>
        </>
      ) : (
        <>
          <select
            value={tierIndex}
            onChange={e => setTierIndex(parseInt(e.target.value))}
            className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-800 cursor-pointer"
          >
            {Array.from({ length: tierCount }, (_, i) => (
              <option key={i} value={i}>Tier {i + 1}</option>
            ))}
            <option value={-1}>Unrated</option>
          </select>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Override reason (mandatory)..."
            className="w-44 bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-indigo-500"
          />
          <input
            type="date"
            value={expiresOn}
            onChange={e => setExpiresOn(e.target.value)}
            title="Optional expiry date"
            className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handlePin}
            disabled={pinning}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            <Pin className="w-3 h-3" /> Pin Tier
          </button>
        </>
      )}
    </div>
  );
};
