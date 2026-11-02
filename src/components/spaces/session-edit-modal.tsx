"use client";

import React, { useMemo, useState } from 'react';
import { Clock, Mail, MessageSquare, Trash2, Users } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';
import { SessionInviteFields } from '@/components/spaces/session-invite-fields';
import { clockLabel, sessionEnded, summarizeInviteDelivery, type InviteDeliverySummary } from '@/lib/spaces';
import type { Profile, SessionInviteOutcome, Space, SpaceSession, SpaceSessionInvite } from '@/lib/types';

type DirectoryPerson = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'work_email' | 'status'>;

export interface SessionEditModalProps {
  /** The session being edited, or null to keep the dialog closed. */
  session: SpaceSession | null;
  space?: Space;
  dayLabel: string;
  people: DirectoryPerson[];
  /** Everyone currently invited to the session. */
  invites: SpaceSessionInvite[];
  onClose: () => void;
  onSave: (changes: {
    startsAt: string;
    endsAt: string;
    title: string;
    description: string;
  }) => Promise<{ ok: boolean; error?: string; notified?: number; calendarError?: string }>;
  onAddInvitees: (emails: string[], includeOutlook: boolean) => Promise<{
    ok: boolean;
    error?: string;
    invites?: SessionInviteOutcome[];
  }>;
  onRemoveInvitee: (invite: SpaceSessionInvite) => Promise<{ ok: boolean; error?: string }>;
}

const inviteName = (invite: SpaceSessionInvite): string =>
  invite.name
  || [invite.profile?.first_name, invite.profile?.last_name].filter(Boolean).join(' ').trim()
  || invite.email;

/**
 * Everything an organiser can change about a session that already exists: its window, its title and
 * agenda, and who is invited. The same dialog adds people (Slack, plus an optional Outlook meeting)
 * and takes them off again, so the session is managed in one place instead of a scatter of buttons.
 *
 * The parent mounts it with a `key` of the session id, so switching sessions starts from that
 * session's own values rather than the previous one's.
 */
export function SessionEditModal({
  session, space, dayLabel, people, invites, onClose, onSave, onAddInvitees, onRemoveInvitee,
}: SessionEditModalProps) {
  const [startsAt, setStartsAt] = useState(() => clockLabel(session?.starts_at));
  const [endsAt, setEndsAt] = useState(() => clockLabel(session?.ends_at));
  const [title, setTitle] = useState(() => session?.title || '');
  const [description, setDescription] = useState(() => session?.description || '');
  const [emails, setEmails] = useState<string[]>([]);
  const [includeOutlook, setIncludeOutlook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InviteDeliverySummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const over = session ? sessionEnded(session) : false;

  const detailsChanged = useMemo(() => {
    if (!session) return false;
    const initialTitle = (session.title || '').trim();
    const initialDescription = (session.description || '').trim();
    return startsAt !== clockLabel(session.starts_at)
      || endsAt !== clockLabel(session.ends_at)
      || title.trim() !== initialTitle
      || description.trim() !== initialDescription;
  }, [session, startsAt, endsAt, title, description]);

  if (!session) return null;

  const remove = async (invite: SpaceSessionInvite) => {
    if (!confirm(`Remove ${inviteName(invite)} from this session? Their seat and calendar invite go with them.`)) return;
    setRemoving(invite.email);
    setError(null);
    const result = await onRemoveInvitee(invite);
    setRemoving(null);
    if (!result.ok) setError(result.error || 'That person could not be removed.');
  };

  const submit = async () => {
    if (busy || (!detailsChanged && emails.length === 0)) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setNotice(null);

    let notifyLine = '';
    if (detailsChanged) {
      const saved = await onSave({ startsAt, endsAt, title, description });
      if (!saved.ok) {
        setBusy(false);
        setError(saved.error || 'The session could not be updated.');
        return;
      }
      notifyLine = saved.calendarError
        ? ' The Outlook meeting could not be updated.'
        : saved.notified
          ? ` ${saved.notified} colleague${saved.notified === 1 ? '' : 's'} told about the new time.`
          : '';
    }

    if (emails.length === 0) {
      setBusy(false);
      onClose();
      return;
    }

    const added = await onAddInvitees(emails, includeOutlook);
    setBusy(false);
    if (!added.ok) {
      setError(added.error || 'The invitations could not be sent.');
      return;
    }
    const outcome = summarizeInviteDelivery(added.invites || []);
    if (outcome.problems.length > 0) {
      setSummary(outcome);
      setEmails([]);
      return;
    }
    setNotice(
      `${outcome.invited} invitation${outcome.invited === 1 ? '' : 's'} sent`
      + `${outcome.seatsBooked > 0 ? ` · ${outcome.seatsBooked} seat${outcome.seatsBooked === 1 ? '' : 's'} reserved` : ''}.`
      + notifyLine
    );
    setEmails([]);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title.trim() || 'Untitled session'}
      eyebrow={`Edit session · ${space?.name || 'Room'} · ${dayLabel}`}
      size="lg"
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label block mb-1.5">Starts</label>
            <input
              type="time"
              value={startsAt}
              disabled={busy}
              onChange={event => setStartsAt(event.target.value)}
              className="ui-input w-full font-mono"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Ends</label>
            <input
              type="time"
              value={endsAt}
              disabled={busy}
              onChange={event => setEndsAt(event.target.value)}
              className="ui-input w-full font-mono"
            />
          </div>
        </div>

        <div>
          <label className="ui-label block mb-1.5">Title</label>
          <input
            type="text"
            value={title}
            disabled={busy}
            onChange={event => setTitle(event.target.value)}
            placeholder="What is happening in this room?"
            className="ui-input w-full"
          />
        </div>

        <div>
          <label className="ui-label block mb-1.5">Description</label>
          <textarea
            value={description}
            disabled={busy}
            onChange={event => setDescription(event.target.value)}
            placeholder="Agenda, links, anything the room should know"
            rows={3}
            className="ui-input w-full resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-label">Invited</span>
            <span className="ui-meta">{invites.length} on this session</span>
          </div>
          {invites.length > 0 ? (
            <ul className="divide-y divide-[var(--line)] rounded-[var(--radius-control)] border border-[var(--line)]">
              {invites.map(invite => (
                <li key={invite.email} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-semibold text-[var(--ink)]">{inviteName(invite)}</span>
                    <span className="ui-meta block truncate">{invite.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {invite.profile_id ? (
                      <MessageSquare className="h-3 w-3 text-[var(--accent)]" aria-label="Invited on Slack" />
                    ) : (
                      <Mail className="h-3 w-3 text-[var(--ink-4)]" aria-label="Invited by email" />
                    )}
                    <button
                      type="button"
                      disabled={busy || removing === invite.email}
                      onClick={() => void remove(invite)}
                      className="cursor-pointer rounded p-0.5 text-[var(--ink-4)] transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                      title={`Remove ${inviteName(invite)} from this session`}
                      aria-label={`Remove ${inviteName(invite)} from this session`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-meta">
              <Users className="mr-1 inline h-3 w-3 -translate-y-px" />
              Nobody invited yet — add someone below.
            </p>
          )}
        </div>

        {over ? (
          <p className="ui-meta">
            This session is over — its invitation list can be reviewed but no longer extended.
          </p>
        ) : (
          <SessionInviteFields
            emails={emails}
            onEmailsChange={setEmails}
            includeOutlook={includeOutlook}
            onIncludeOutlookChange={setIncludeOutlook}
            people={people}
            disabled={busy}
          />
        )}

        {error && <p className="text-[11.5px] font-medium text-rose-600">{error}</p>}
        {notice && (
          <p className="rounded-[var(--radius-control)] border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11.5px] font-semibold text-emerald-800">
            {notice}
          </p>
        )}
        {summary && (
          <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[11.5px] font-semibold text-amber-900">
              Invitations sent, with a few warnings:
            </p>
            <ul className="mt-1 space-y-0.5">
              {summary.problems.map(problem => (
                <li key={`${problem.who}:${problem.problem}`} className="text-[11px] text-amber-800">
                  • <span className="font-semibold">{problem.who}</span> — {problem.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <p className="ui-meta">
            <Clock className="mr-1 inline h-3 w-3 -translate-y-px" />
            The Outlook meeting and the Slack invitees move with the session.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void submit()}
              disabled={busy || (!detailsChanged && emails.length === 0)}
            >
              {busy
                ? 'Saving…'
                : emails.length > 0
                  ? `Save & invite ${emails.length}`
                  : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
