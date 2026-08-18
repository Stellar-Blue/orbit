import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { executeMcpTool, MCP_TOOL_SCHEMAS } from '@/lib/mcp/engine';
import { McpErrors } from '@/lib/mcp/errors';

/**
 * Orbit Invoice MCP Server Endpoint (§2, §3)
 * Exposes full Model Context Protocol (MCP / JSON-RPC 2.0) capabilities including initialize, tools/list, and tools/call.
 * Supported by Claude Desktop, Cowork, and Custom HTTP Connectors.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  return NextResponse.json({
    name: 'orbit-invoices-mcp',
    status: 'Operational',
    protocolVersion: '2024-11-05',
    version: '1.0.0',
    capabilities: {
      tools: {
        listChanged: false
      },
      resources: {},
      prompts: {}
    },
    tools_count: MCP_TOOL_SCHEMAS.length,
    documentation: 'Send POST requests adhering to the Model Context Protocol (JSON-RPC 2.0) structure.'
  }, { headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const method = body.method || body.action;
    const params = body.params || body.payload || {};
    const id = body.id !== undefined ? body.id : null;

    // 1. MCP Initialization Handshake (Required by Claude prior to discovering tools)
    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          protocolVersion: body.params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false
            },
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'orbit-invoices-mcp',
            version: '1.0.0'
          }
        }
      }, { headers: CORS_HEADERS });
    }

    // 2. Post-initialization notification confirmation
    if (method === 'notifications/initialized' || method === 'initialized' || method === 'ping') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id,
        result: {}
      }, { headers: CORS_HEADERS });
    }

    // 3. Tool Discovery Endpoint (tools/list)
    if (method === 'tools/list' || method === 'list_tools') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          tools: MCP_TOOL_SCHEMAS
        }
      }, { headers: CORS_HEADERS });
    }

    // 4. Resource / Prompt Discovery stubs (preventing 404 disconnection errors when AI attempts to enumerate capabilities)
    if (method === 'resources/list') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { resources: [] } }, { headers: CORS_HEADERS });
    }
    if (method === 'prompts/list') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { prompts: [] } }, { headers: CORS_HEADERS });
    }

    // 5. Tool Execution Endpoint (tools/call)
    if (method === 'tools/call' || method === 'call_tool') {
      const toolName = params.name || body.tool_name;
      const toolArgs = params.arguments || params.args || body.arguments || {};

      if (!toolName) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing required tool name parameter in call' }
        }, { status: 400, headers: CORS_HEADERS });
      }

      const authHeader = request.headers.get('authorization') || '';
      const isBearer = authHeader.startsWith('Bearer ');
      const supabase = isBearer ? await getSupabaseAdminClient() : await getSupabaseServerClient();
      
      // Authentication & Role verification via OAuth Bearer Token or Cookie Session (§3)
      let userId = '';
      let isUserAdmin = false;

      if (isBearer) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: tokenRecord } = await supabase.from('mcp_oauth_tokens').select('*').eq('access_token', token).single();
        if (tokenRecord) {
          if (new Date(tokenRecord.expires_at) < new Date()) {
            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              error: { code: -32002, message: 'OAuth Access Token has expired. Token lifetime is ≤ 8h. Please use refresh_token.' }
            }, { status: 401, headers: CORS_HEADERS });
          }
          userId = tokenRecord.user_id;
        } else {
          return NextResponse.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32002, message: 'Invalid OAuth Bearer Token.' }
          }, { status: 401, headers: CORS_HEADERS });
        }
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          userId = session.user.id;
        }
      }

      if (!userId) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32001, message: 'Authentication required. Missing or invalid token/session.' }
        }, { status: 401, headers: CORS_HEADERS });
      }

      // Check role in user_roles database & verify profile status is not departed
      const { data: profile } = await supabase.from('profiles').select('id, status').or(`id.eq.${userId},auth_user_id.eq.${userId}`).maybeSingle();
      const canonicalId = profile?.id || userId;
      const { data: roleRow } = await supabase.from('user_roles').select('role').eq('profile_id', canonicalId).eq('role', 'admin').maybeSingle();
      if (roleRow && (!profile || profile.status !== 'departed')) {
        isUserAdmin = true;
      }
      userId = canonicalId;

      // Enforce that mapped user profile MUST hold admin role; otherwise return FORBIDDEN
      if (!isUserAdmin) {
        const forbiddenErr = McpErrors.forbidden();
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(forbiddenErr, null, 2)
              }
            ],
            isError: true
          }
        }, { headers: CORS_HEADERS });
      }

      // Execute Tool with Audit logging and Idempotency guarantees
      const result = await executeMcpTool(toolName, toolArgs, userId, supabase);

      if (!result.success) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.error, null, 2)
              }
            ],
            isError: true
          }
        }, { headers: CORS_HEADERS });
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2)
            }
          ],
          isError: false
        }
      }, { headers: CORS_HEADERS });
    }

    // Default fallback for any unrecognized JSON-RPC calls (returns standard JSON-RPC error without breaking HTTP connection with 404)
    return NextResponse.json({
      jsonrpc: '2.0',
      id: id,
      error: { code: -32601, message: `Method not supported: ${method}. Supported capabilities: 'initialize', 'tools/list', and 'tools/call'.` }
    }, { status: 200, headers: CORS_HEADERS });

  } catch (ex: any) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: `Internal server error: ${ex.message || String(ex)}` }
    }, { status: 500, headers: CORS_HEADERS });
  }
}
