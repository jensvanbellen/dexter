import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_COMMAND = 'npx';
// Pin the server version so an unreviewed publish cannot run in this process.
const SERVER_ARGS = ['-y', '@statewavedev/mcp-server@0.4.8'];
const DEFAULT_STATEWAVE_URL = 'http://localhost:8100';
const CALL_TIMEOUT_MS = 20_000;

// Only Statewave-specific vars are forwarded to the child, on top of the SDK's
// safe default environment. Dexter's other secrets (LLM, finance, tracing keys)
// are never exposed to the spawned server.
const FORWARDED_ENV_VARS = ['STATEWAVE_API_KEY', 'STATEWAVE_TENANT_ID'] as const;

interface TextContent {
  type: string;
  text?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Singleton stdio MCP client for the Statewave memory server.
 *
 * Lazily spawns the pinned `@statewavedev/mcp-server` on first call and reuses
 * the connection. A failed connect resets the pending promise so a later call
 * retries; an `onclose` (child exit / transport close) clears the cached client
 * so the next call respawns instead of reusing a dead connection. Callers
 * surface failures as text so the agent degrades gracefully.
 */
export class StatewaveClient {
  private static instance: StatewaveClient | null = null;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  static get(): StatewaveClient {
    if (!StatewaveClient.instance) {
      StatewaveClient.instance = new StatewaveClient();
    }
    return StatewaveClient.instance;
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {
      ...getDefaultEnvironment(),
      STATEWAVE_URL: process.env.STATEWAVE_URL ?? DEFAULT_STATEWAVE_URL,
    };
    for (const key of FORWARDED_ENV_VARS) {
      const value = process.env[key];
      if (value) {
        env[key] = value;
      }
    }
    return env;
  }

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StdioClientTransport({
          command: SERVER_COMMAND,
          args: SERVER_ARGS,
          env: this.buildEnv(),
          stderr: 'ignore',
        });
        const client = new Client({ name: 'dexter', version: '1.0.0' });
        await client.connect(transport);
        // Respawn on next use if the connection drops. Guard on identity so a
        // late close from a superseded client does not clear a newer one.
        client.onclose = () => {
          if (this.client === client) {
            this.client = null;
            this.connecting = null;
          }
        };
        this.client = client;
        return client;
      })();
    }
    try {
      return await this.connecting;
    } catch (error) {
      this.connecting = null;
      throw error;
    }
  }

  /** Call a Statewave tool and return its concatenated text content. */
  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.connect();
    const result = await withTimeout(
      client.callTool({ name, arguments: args }),
      CALL_TIMEOUT_MS,
      `Statewave call "${name}" timed out`,
    );
    const content = (result.content ?? []) as TextContent[];
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
}
