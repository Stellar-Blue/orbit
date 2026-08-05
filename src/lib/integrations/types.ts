export const GATED_EMPLOYMENT_TYPES = ['full_time', 'part_time', 'intern'];

export type IntegrationProvider = 'slack' | 'm365';
export type IntegrationStatus = 'connected' | 'revoked' | 'skipped' | 'exempt';

export interface EmployeeIntegration {
  id: string;
  profile_id: string;
  provider: IntegrationProvider;
  external_user_id?: string | null;
  token_ref?: string | null;
  status: IntegrationStatus;
  auto_reply_opt_in: boolean;
  auto_reply_template?: string | null;
  last_set_status_text?: string | null;
  last_set_status_emoji?: string | null;
  last_set_expiration_ts?: number | null;
  connected_at?: string | null;
  last_synced_at?: string | null;
  revoked_at?: string | null;
  created_at?: string;
}

export interface IntegrationExemption {
  id: string;
  profile_id: string;
  provider: string;
  reason?: string | null;
  granted_by?: string | null;
  expires_at?: string | null;
  created_at?: string;
}

export interface IntegrationOutboxRow {
  id: string;
  provider: IntegrationProvider;
  operation: string;
  orbit_kind: string;
  orbit_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  ordering_key: string;
  attempts: number;
  next_retry_at?: string | null;
  status: 'pending' | 'delivered' | 'skipped' | 'failed' | 'exception';
  last_error?: string | null;
  delivered_at?: string | null;
  created_at: string;
}

export interface IntegrationSettings {
  leave_label: string;
  leave_emoji: string;
  remote_label: string;
  remote_emoji: string;
  half_day_label: string;
}

export const DEFAULT_SLACK_SETTINGS: IntegrationSettings = {
  leave_label: 'Out of office',
  leave_emoji: ':palm_tree:',
  remote_label: 'Working remotely',
  remote_emoji: ':house:',
  half_day_label: 'Out of office (afternoon)',
};

export const ATHENS_TIMEZONE = 'Europe/Athens';
