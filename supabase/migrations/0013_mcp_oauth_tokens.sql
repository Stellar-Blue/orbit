-- Orbit Financial Workspace Migration: 0013_mcp_oauth_tokens.sql
-- Implements standard OAuth 2.0 authorization code and token storage for MCP AI Operators (§3).
-- Enforces ≤ 8-hour token lifetimes and binding to corporate admin profiles.

-- 1. Authorization Codes Table (short-lived codes issued after explicit user consent)
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code VARCHAR(128) PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'invoices.admin',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. OAuth Tokens Table (active access and refresh tokens for AI Agents)
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  access_token VARCHAR(128) PRIMARY KEY,
  refresh_token VARCHAR(128) UNIQUE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  scope TEXT NOT NULL DEFAULT 'invoices.admin',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '8 hours'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for rapid token verification and cleanup
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expires ON mcp_oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_expires ON mcp_oauth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_user ON mcp_oauth_tokens(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Admins can view and revoke their own active OAuth authorizations
CREATE POLICY "Admins can view their own MCP OAuth tokens"
  ON mcp_oauth_tokens
  FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.profile_id WHERE (p.auth_user_id = auth.uid() OR p.id = auth.uid()) AND ur.role = 'admin') OR is_admin()
  );

CREATE POLICY "Admins can delete their own MCP OAuth tokens"
  ON mcp_oauth_tokens
  FOR DELETE
  USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.profile_id WHERE (p.auth_user_id = auth.uid() OR p.id = auth.uid()) AND ur.role = 'admin') OR is_admin()
  );
