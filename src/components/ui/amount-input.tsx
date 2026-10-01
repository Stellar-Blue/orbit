"use client";

import React, { useState } from 'react';
import { formatAmountInput, parseAmountInput } from '@/lib/currency';

interface AmountInputProps {
  value: number;
  onValueChange: (value: number) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Money field that accepts both separator conventions, in either direction.
 *
 * `type="number"` cannot hold `1.785,12` — the browser drops the comma and hands back `1.78512`, so
 * a pasted European amount saved as €1.79. This renders as text with `inputMode="decimal"` (numeric
 * keypad on touch), keeps the raw text verbatim while typing and reports only the parsed number
 * upward, then normalises the text to the app convention (`1.785,12`) on blur.
 *
 * `draft === null` means "not editing": the field then mirrors `value`, so an external change (the
 * modal switching rows, a computed prefill) shows through without an effect fighting the typist.
 * The parent owns commit semantics — this only ever reports the current number.
 */
export const AmountInput: React.FC<AmountInputProps> = ({ value, onValueChange, placeholder, className = '' }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const report = (raw: string) => onValueChange(parseAmountInput(raw) ?? 0);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={draft ?? formatAmountInput(value)}
      onFocus={e => e.currentTarget.select()}
      onChange={e => { setDraft(e.target.value); report(e.target.value); }}
      onBlur={e => { report(e.target.value); setDraft(null); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={className}
    />
  );
};
