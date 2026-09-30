"use client";

import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/primitives';
import { AlertTriangle, CalendarClock, Hourglass } from 'lucide-react';
import { formatDate } from '@/lib/date';
import { daysUntil } from '@/lib/leave-carryover';

/**
 * Warns the employee that carried-over days have a DUE DATE.
 *
 * Appears from the point the policy's warning window opens (Settings → Leaves, default 3 months
 * before the deadline) and escalates in the last two weeks. If the days run out of room to be
 * taken, Orbit books them itself on the remaining working days — the copy says so, so the
 * appearance of those leave rows is never a surprise.
 *
 * Renders nothing when no deadline is configured or nothing is at risk.
 */
export function CarryoverWarning() {
  const { currentUser, getCarryoverStatus } = useAuth();
  const status = getCarryoverStatus(currentUser.id);

  if (status.level === 'none') return null;
  if (status.level === 'expired' ? status.expiredDays <= 0 : status.daysAtRisk <= 0) return null;

  const left = status.expiresOn ? daysUntil(new Date().toISOString().slice(0, 10), status.expiresOn) : null;
  const theme = {
    expired: {
      wrap: 'bg-rose-50/70 border-rose-300 text-rose-900',
      icon: 'text-rose-600',
      badge: 'error' as const,
      label: 'Expired',
    },
    urgent: {
      wrap: 'bg-rose-50/70 border-rose-300 text-rose-900',
      icon: 'text-rose-600',
      badge: 'error' as const,
      label: 'Use them now',
    },
    approaching: {
      wrap: 'bg-amber-50/70 border-amber-300 text-amber-900',
      icon: 'text-amber-600',
      badge: 'warning' as const,
      label: 'Deadline approaching',
    },
  }[status.level === 'expired' ? 'expired' : status.level === 'urgent' ? 'urgent' : 'approaching'];

  return (
    <div className={`p-4 rounded-2xl border flex items-start gap-3 ${theme.wrap}`}>
      {status.level === 'expired'
        ? <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${theme.icon}`} />
        : <Hourglass className={`w-5 h-5 shrink-0 mt-0.5 ${theme.icon}`} />}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-extrabold">
            {status.level === 'expired'
              ? `${status.expiredDays} carried-over day${status.expiredDays === 1 ? '' : 's'} expired`
              : `${status.daysAtRisk} carried-over day${status.daysAtRisk === 1 ? '' : 's'} to take`}
          </span>
          <Badge variant={theme.badge} className="text-[10px] px-1.5 py-0">{theme.label}</Badge>
          {status.expiresOn && (
            <span className="text-[11px] font-bold font-mono inline-flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" />
              {status.level === 'expired' ? 'expired on' : 'by'} {formatDate(status.expiresOn)}
            </span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed">
          {status.level === 'expired' ? (
            <>
              These days were carried over from {status.year - 1} with a use-by date and have now been written off.
              Plan earlier next year — or ask an administrator to reinstate them.
            </>
          ) : (
            <>
              Days carried over from {status.year - 1} must be used by this date; they are not carried further.
              {left !== null && left > 0 && <> That is <strong>{left} calendar day{left === 1 ? '' : 's'}</strong> away.</>}
              {status.autoBook
                ? ' If they are still untaken when the deadline gets close, Orbit books them for you on the remaining working days before it.'
                : ' Book them yourself before the deadline — they are lost otherwise.'}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
