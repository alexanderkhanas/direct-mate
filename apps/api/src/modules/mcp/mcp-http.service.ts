import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { McpToolsService } from './mcp-tools.service';
import { buildMcpServer } from './mcp.server';
import { ACCESS_TTL_S, OAuthError, OAuthService, type TokenPair } from './oauth/oauth.service';
import { tokenHash } from './oauth/pkce';
import { redirectAllowed, redirectRegistered } from './oauth/redirects';

/** The cookie that ties a sign-in to the browser that started it. */
export const REQUEST_COOKIE = 'dm_claude_request';
/** Calls per connection per minute. Per token, not per IP: every claude.ai user arrives from the same addresses. */
const CALLS_PER_MINUTE = 120;

/**
 * The Claude connector's HTTP surface: OAuth discovery and endpoints, and the
 * MCP endpoint itself. Plain Express handlers, mounted in `main.ts` ahead of
 * the admin CORS layer, because OAuth clients expect RFC 6749 error bodies
 * (`{error, error_description}`) and Nest's exception filter would rewrite them.
 * The owner's «Allow» happens in the admin (`/claude/authorize`), which talks
 * to `ClaudeController`.
 */
@Injectable()
export class McpHttpService {
  private readonly logger = new Logger(McpHttpService.name);
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly config: ConfigService,
    private readonly tools: McpToolsService,
    private readonly oauth: OAuthService,
  ) {}

  get enabled(): boolean {
    return this.config.get<boolean>('mcp.enabled') === true;
  }

  private get publicUrl(): string {
    return this.config.get<string>('mcp.publicUrl') ?? 'http://localhost:3000';
  }

  /** The `resource` Claude names in every OAuth request: the connector URL, exactly. */
  private get resource(): string {
    return `${this.publicUrl}/mcp`;
  }

  /** A static bearer token for one tenant, for MCP Inspector and curl. Never outside development and test. */
  private devTenant(token: string): string | undefined {
    const env = this.config.get<string>('nodeEnv');
    if (env !== 'development' && env !== 'test') return undefined;
    const devToken = this.config.get<string>('mcp.devToken') ?? '';
    const tenantId = this.config.get<string>('mcp.devTenantId') ?? '';
    return devToken && tenantId && tokenHash(token) === tokenHash(devToken) ? tenantId : undefined;
  }

  router(): Router {
    const router = Router();
    const open = (_req: Request, res: Response, next: NextFunction) => {
      // Bearer tokens, no cookies: any origin may read these.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      next();
    };
    const preflight = (_req: Request, res: Response) => res.status(204).end();

    const resourcePaths = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];
    const serverPaths = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'];
    router.options([...resourcePaths, ...serverPaths, '/oauth/token', '/oauth/register'], open, preflight);

    router.get(resourcePaths, open, (_req, res) => {
      res.json({
        resource: this.resource,
        authorization_servers: [this.publicUrl],
        bearer_methods_supported: ['header'],
      });
    });

    router.get(serverPaths, open, (_req, res) => {
      res.json({
        issuer: this.publicUrl,
        authorization_endpoint: `${this.publicUrl}/oauth/authorize`,
        token_endpoint: `${this.publicUrl}/oauth/token`,
        registration_endpoint: `${this.publicUrl}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true,
      });
    });

    const guarded = (work: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => {
      work(req, res).catch((err) => {
        this.logger.error(`OAuth request failed: ${err instanceof Error ? err.stack : err}`);
        if (!res.headersSent) res.status(500).json({ error: 'server_error' });
      });
    };
    router.post('/oauth/register', open, guarded((req, res) => this.register(req, res)));
    router.get('/oauth/authorize', guarded((req, res) => this.authorize(req, res)));
    router.post('/oauth/token', open, guarded((req, res) => this.token(req, res)));

    router.post('/mcp', (req, res) => {
      this.mcp(req, res).catch((err) => {
        this.logger.error(`MCP request failed: ${err instanceof Error ? err.stack : err}`);
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
        }
      });
    });
    // Stateless: no session to open a stream on or to delete.
    router.all('/mcp', (_req, res) => {
      res
        .status(405)
        .set('Allow', 'POST')
        .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    });

    return router;
  }

  // ─── OAuth ───────────────────────────────────────────────────────

  private async register(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (uris.length === 0 || uris.length > 10 || !uris.every((u) => redirectAllowed(u))) {
      this.logger.warn(`register refused: redirect_uris=${JSON.stringify(body.redirect_uris)?.slice(0, 500)}`);
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Redirect URI not allowed' });
      return;
    }
    const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : 'MCP client';
    const client = await this.oauth.registerClient(name, uris as string[]);
    this.logger.log(`register: client "${name}", redirects ${uris.join(', ')}`);
    res.status(201).json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Public clients only: PKCE proves who redeems the code.
      token_endpoint_auth_method: 'none',
    });
  }

  private async authorize(req: Request, res: Response): Promise<void> {
    const q = req.query as Record<string, unknown>;
    const client = await this.oauth.client(q.client_id);
    const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
    // An unknown client or redirect is never redirected to: that would make us an open redirector.
    if (!client || !redirectAllowed(redirectUri) || !redirectRegistered(redirectUri, client.redirectUris)) {
      this.logger.warn(`authorize refused: client=${String(q.client_id).slice(0, 80)} redirect=${redirectUri.slice(0, 200)}`);
      res.status(400).type('text/plain').send('This sign-in link is not valid. Add the DirectMate connector again.');
      return;
    }
    const state = typeof q.state === 'string' ? q.state.slice(0, 1000) : null;
    const back = (params: Record<string, string>) => res.redirect(302, this.oauth.callback(redirectUri, state, params));
    if (q.response_type !== 'code') return back({ error: 'unsupported_response_type' });
    if (typeof q.code_challenge !== 'string' || q.code_challenge.length > 200 || q.code_challenge_method !== 'S256') {
      return back({ error: 'invalid_request', error_description: 'PKCE with S256 is required' });
    }
    if (q.resource !== undefined && q.resource !== this.resource) {
      this.logger.warn(`authorize: resource "${String(q.resource).slice(0, 200)}" is not "${this.resource}"`);
      return back({ error: 'invalid_target' });
    }
    const request = await this.oauth.createRequest({
      clientId: client.clientId,
      redirectUri,
      codeChallenge: q.code_challenge,
      state,
      resource: typeof q.resource === 'string' ? q.resource : null,
    });
    // Only the browser holding this cookie can allow the request, so a consent
    // link passed to someone else is useless to them.
    const domain = this.config.get<string>('mcp.cookieDomain') ?? '';
    res.cookie(REQUEST_COOKIE, request.browserToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.publicUrl.startsWith('https://'),
      maxAge: 600_000,
      path: '/',
      ...(domain && { domain }),
    });
    const admin = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';
    this.logger.log(`authorize: "${client.clientName}" sent to the consent page`);
    res.redirect(302, `${admin}/claude/authorize?request=${request.id}`);
  }

  private async token(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const client = await this.oauth.client(body.client_id);
      if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
      let tokens: TokenPair;
      if (body.grant_type === 'authorization_code') {
        tokens = await this.oauth.exchangeCode({
          client,
          code: body.code,
          redirectUri: body.redirect_uri,
          resource: body.resource,
          codeVerifier: body.code_verifier,
        });
        this.logger.log(`token: code exchanged by "${client.clientName}"`);
      } else if (body.grant_type === 'refresh_token') {
        tokens = await this.oauth.refresh(client, body.refresh_token);
      } else {
        res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token' });
        return;
      }
      res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TTL_S,
        refresh_token: tokens.refreshToken,
      });
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      this.logger.warn(`token refused (${String(body.grant_type)}): ${err.error}, ${err.message}`);
      res.status(err.status).json({ error: err.error, error_description: err.message });
    }
  }

  // ─── MCP ─────────────────────────────────────────────────────────

  /** The tenant a request acts for, and the key its calls are counted under. */
  private async caller(req: Request): Promise<{ tenantId: string; key: string; userId?: string } | undefined> {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) return undefined;
    const devTenant = this.devTenant(token);
    if (devTenant) return { tenantId: devTenant, key: 'dev' };
    const identity = await this.oauth.identify(token);
    return identity && { tenantId: identity.tenantId, key: identity.grantId, userId: identity.userId };
  }

  private overLimit(key: string): boolean {
    const minuteAgo = Date.now() - 60_000;
    const recent = (this.calls.get(key) ?? []).filter((t) => t > minuteAgo);
    if (recent.length >= CALLS_PER_MINUTE) {
      this.calls.set(key, recent);
      return true;
    }
    recent.push(Date.now());
    this.calls.set(key, recent);
    return false;
  }

  private async mcp(req: Request, res: Response): Promise<void> {
    const caller = await this.caller(req);
    if (!caller) {
      // This header is how Claude discovers where to sign in.
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${this.publicUrl}/.well-known/oauth-protected-resource/mcp"`,
        )
        .json({ error: 'invalid_token', error_description: 'Sign in to DirectMate' });
      return;
    }
    if (this.overLimit(caller.key)) {
      res
        .status(429)
        .set('Retry-After', '60')
        .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests, try again in a minute' }, id: null });
      return;
    }
    const server = buildMcpServer({ tenantId: caller.tenantId, userId: caller.userId ?? null }, this.tools);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
