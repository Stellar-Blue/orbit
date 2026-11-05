"use client";

import React, { useMemo, useState } from 'react';
import { Mail, MessageSquare, Plus, Users, X } from 'lucide-react';
import { parseInviteEmails, resolveInviteTargets } from '@/lib/spaces';
import type { Profile } from '@/lib/types';

type DirectoryPerson = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'work_email' | 'status'>;

export interface SessionInviteFieldsProps {
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  includeOutlook: boolean;
  onIncludeOutlookChange: (include: boolean) => void;
  /** The directory, used to tell an Orbit colleague (Slack) from an external guest (email). */
  people: DirectoryPerson[];
  disabled?: boolean;
}

const displayName = (person: DirectoryPerson): string =>
  [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || person.work_email;

/**
 * The invitee picker of the session dialog: freetext addresses become chips, and every chip says
 * which channel will actually reach that person. Colleagues matched in the directory are invited on
 * Slack; anything else can only be reached by the Outlook meeting invite.
 */
export function SessionInviteFields({
  emails, onEmailsChange, includeOutlook, onIncludeOutlookChange, people, disabled,
}: SessionInviteFieldsProps) {
  const [query, setQuery] = useState('');

  const targets = useMemo(() => resolveInviteTargets(emails, people), [emails, people]);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return people
      .filter(person => person.status !== 'departed' && person.work_email)
      .filter(person => !emails.includes(person.work_email.trim().toLowerCase()))
      .filter(person => `${displayName(person)} ${person.work_email}`.toLowerCase().includes(needle))
      .slice(0, 4);
  }, [query, people, emails]);

  const add = (raw: string) => {
    const added = parseInviteEmails(raw).filter(email => !emails.includes(email));
    if (added.length > 0) onEmailsChange([...emails, ...added]);
    setQuery('');
  };

  const remove = (email: string) => onEmailsChange(emails.filter(entry => entry !== email));

  return (
    <div className="space-y-2">
      <label className="ui-label block">Invite people</label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-4)]" />
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={event => {
              const value = event.target.value;
              // A typed comma or semicolon commits the address instead of staying in the box.
              if (/[,;]$/.test(value)) add(value);
              else setQuery(value);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add(query);
              }
              if (event.key === 'Backspace' && !query && emails.length > 0) remove(emails[emails.length - 1]);
            }}
            onBlur={() => { if (query.trim()) add(query); }}
            placeholder="name@company.com — press Enter to add"
            className="ui-input w-full pl-8"
            aria-label="Email addresses to invite"
          />
        </div>
        <button
          type="button"
          disabled={disabled || !query.trim()}
          onMouseDown={event => event.preventDefault()}
          onClick={() => add(query)}
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line-strong)] px-2 py-1.5 text-[11px] font-semibold text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <ul className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-muted)]">
          {suggestions.map(person => (
            <li key={person.id}>
              <button
                type="button"
                disabled={disabled}
                onMouseDown={event => event.preventDefault()}
                onClick={() => add(person.work_email)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11.5px] hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <span className="truncate font-medium text-[var(--ink)]">{displayName(person)}</span>
                <span className="shrink-0 truncate text-[10.5px] text-[var(--ink-4)]">{person.work_email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {targets.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {targets.map(target => (
            <li
              key={target.email}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--surface-muted)] py-0.5 pl-2 pr-1 text-[11px]"
            >
              {target.profile ? (
                <MessageSquare className="h-3 w-3 text-[var(--accent)]" aria-hidden />
              ) : (
                <Mail className="h-3 w-3 text-[var(--ink-4)]" aria-hidden />
              )}
              <span className="max-w-[13rem] truncate font-medium text-[var(--ink)]">
                {target.profile ? displayName(target.profile) : target.email}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-[var(--ink-4)]">
                {target.profile ? 'Slack' : 'Email'}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(target.email)}
                className="cursor-pointer rounded-full p-0.5 text-[var(--ink-4)] transition-colors hover:bg-white hover:text-rose-600 disabled:opacity-40"
                aria-label={`Remove ${target.email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-meta">
          <Users className="mr-1 inline h-3 w-3 -translate-y-px" />
          Colleagues are invited on Slack and booked a seat; anyone else gets an email invite.
        </p>
      )}

      {targets.some(target => !target.profile) && (
        <p className="ui-meta">
          External guests are not booked a room seat — only Orbit colleagues hold one.
        </p>
      )}

      <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2">
        <input
          type="checkbox"
          checked={includeOutlook}
          disabled={disabled}
          onChange={event => onIncludeOutlookChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded text-[var(--accent)]"
        />
        <span className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-[var(--ink)]">Include an Outlook meeting invite</span>
          <span className="ui-meta block">
            Colleagues with a seat are on the meeting automatically. Tick to also invite people who
            could not take a seat; external addresses always get one.
          </span>
        </span>
      </label>
    </div>
  );
}
