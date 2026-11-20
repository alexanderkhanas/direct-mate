import type { McpServer, RegisteredResource, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';

/**
 * The server half of MCP Apps (`@modelcontextprotocol/ext-apps/server`): a
 * tool that names a UI resource, and that resource. The package is ESM-only
 * and exposes this entry only through its `exports` map, which the API's
 * TypeScript module resolution doesn't read, so it is loaded with `require`
 * (Node 22 loads ESM this way) and typed here for what we use.
 */
interface UiCsp {
  /** Origins the page may load images, styles and scripts from. */
  resourceDomains?: string[];
  /** Origins the page may call with fetch. */
  connectDomains?: string[];
}

interface ExtAppsServer {
  /** `text/html;profile=mcp-app` */
  RESOURCE_MIME_TYPE: string;
  registerAppTool<Args extends ZodRawShape>(
    server: McpServer,
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Args;
      annotations?: ToolAnnotations;
      _meta: { ui: { resourceUri: string } };
    },
    cb: ToolCallback<Args>,
  ): RegisteredTool;
  registerAppResource(
    server: McpServer,
    name: string,
    uri: string,
    config: { description?: string; _meta?: { ui?: { csp?: UiCsp; prefersBorder?: boolean } } },
    read: (uri: URL) => Promise<ReadResourceResult> | ReadResourceResult,
  ): RegisteredResource;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const extApps = require('@modelcontextprotocol/ext-apps/server') as ExtAppsServer;

/** The browser half, bundled with its dependencies: the `App` class a UI page talks to its host with. */
export function appBundlePath(): string {
  return require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
}
