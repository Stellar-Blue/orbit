"use client";

import React, { useState } from 'react';
import { CheckCircle2, Clock, MapPin, Users } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';
import { SessionInviteFields } from '@/components/spaces/session-invite-fields';
import { clockLabel, summarizeInviteDelivery, type InviteDeliverySummary } from '@/lib/spaces';
import type { Profile, SessionInviteOutcome, Space, SpaceSession, SpaceSessionInvite } from '@/lib/types';

type DirectoryPerson = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'work_email' | 'status'>;

export interface SessionInviteModalProps {
  /** The session being invited to, or null to keep the dialog closed. */
  session: SpaceSession | null;
  space?: Space;
  dayLabel: string;
  people: DirectoryPerson[];
  /** Invitations already on the session, so a second batch does not repeat the first one. */
  existing: SpaceSessionInvite[];
  onClose: () => void;
  onSend: (emails: string[], includeOutlook: boolean) => Promise<{
    ok: boolean;
    error?: string;
    invites?: SessionInviteOutcome[];
  }>;
}

/**
 * Inviting more people to a session that already exists — the same picker the creation dialog uses,
 * so a colleague invited later is delivered exactly like the first batch.
 */
export function SessionInviteModal({
  session, space, dayLabel, people, existing, onClose, onSend,
}: SessionInviteModalProps) {
  const [emails, setEmails] = useState<string[]>([]);
  const [includeOutlook, setIncludeOutlook] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InviteDeliverySummary | null>(null);

  if (!session) return null;

  const send = async () => {
    if (emails.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const result = await onSend(emails, includeOutlook);
    setSending(false);
    if (!result.ok) {
      setError(result.error || 'The invitations could not be sent.');
      return;
    }
    setSummary(summarizeInviteDelivery(result.invites || []));
    setEmails([]);
  };

  return (
    <Modal isOpen onClose={onClose} title="Invite people" eyebrow={`${space?.name || 'Session'} · ${dayLabel}`} size="lg">
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5 text-[11.5px] text-[var(--ink-2)]">
          <p className="font-semibold text-[var(--ink)]">
            {session.title?.trim() || 'Untitled session'}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 ui-meta">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {clockLabel(session.starts_at)} – {clockLabel(session.ends_at)}
            </span>
            {space?.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {space.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {existing.length} already invited
            </span>
          </p>
        </div>

        <SessionInviteFields
          emails={emails}
          onEmailsChange={setEmails}
          includeOutlook={includeOutlook}
          onIncludeOutlookChange={setIncludeOutlook}
          people={people}
          disabled={sending}
        />

        {error && <p className="text-[11.5px] font-medium text-rose-600">{error}</p>}

        {summary && (
          <div className="rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {summary.invited} invitation{summary.invited === 1 ? '' : 's'} sent
              {summary.slackSent > 0 ? ` · ${summary.slackSent} on Slack` : ''}
              {summary.outlookSent > 0 ? ` · ${summary.outlookSent} by Outlook` : ''}
              {summary.seatsBooked > 0 ? ` · ${summary.seatsBooked} seat${summary.seatsBooked === 1 ? '' : 's'} reserved` : ''}
            </p>
            {summary.problems.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {summary.problems.map(problem => (
                  <li key={`${problem.who}:${problem.problem}`} className="text-[11px] text-amber-800">
                    • <span className="font-semibold">{problem.who}</span> — {problem.problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <p className="ui-meta">Only the person who opened the session, or an admin, can invite people.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void send()}
              disabled={sending || emails.length === 0}
            >
              {sending ? 'Sending…' : `Invite ${emails.length || ''}`.trim()}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
