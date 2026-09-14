import type { SupabaseClient } from '@supabase/supabase-js';

export interface RealtimeTableBinding {
  /** Postgres table in the `public` schema to listen to. */
  table: string;
  /** Runs (debounced) when that table changes. Usually "reload this one slice". */
  onChange: () => void;
}

export interface RealtimeSyncOptions {
  /** Coalesce bursts of writes per table into one handler run. Default 300ms. */
  debounceMs?: number;
  /** Tune logs; the status callback is noisy on reconnect. */
  onStatus?: (status: string) => void;
}

/**
 * Live row-change sync for the whole app.
 *
 * The stack equivalent of a SignalR hub: one WebSocket carries `postgres_changes` for every
 * table the UI shows, and each event tells the client to reload just the slice(s) that table
 * feeds — so grids update after ANY write (this tab, another user, a cron route or the MCP
 * server) without refetching the world.
 *
 * Delivery obeys Row Level Security: a client only hears about rows its policies allow, which is
 * why the published tables set REPLICA IDENTITY FULL (migration 0068) — without it an UPDATE or
 * DELETE arrives with only the primary key, and the policy cannot be evaluated.
 *
 * Returns an unsubscribe function.
 */
export function startRealtimeSync(
  supabase: SupabaseClient,
  bindings: RealtimeTableBinding[],
  { debounceMs = 300, onStatus }: RealtimeSyncOptions = {}
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const channel = supabase.channel(`orbit-live-sync-${Math.random().toString(36).slice(2, 8)}`);

  bindings.forEach(({ table, onChange }) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      const pending = timers.get(table);
      if (pending) clearTimeout(pending);
      timers.set(table, setTimeout(() => {
        timers.delete(table);
        try {
          onChange();
        } catch (error) {
          console.error(`[live] ${table} change handler failed:`, error);
        }
      }, debounceMs));
    });
  });

  channel.subscribe(status => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[live] realtime channel ${channel.topic}: ${status}`);
    }
    onStatus?.(status);
  });

  return () => {
    timers.forEach(clearTimeout);
    timers.clear();
    supabase.removeChannel(channel);
  };
}
