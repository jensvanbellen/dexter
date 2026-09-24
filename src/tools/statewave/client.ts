import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_COMMAND = 'npx';
const SERVER_ARGS = ['-y', '@statewavedev/mcp-server'];
const DEFAULT_STATEWAVE_URL = 'http://localhost:8100';

interface TextContent {
  type: string;
  text?: string;
}

/**
 * Singleton stdio MCP client for the Statewave memory server.
 *
 * Lazily spawns `npx @statewavedev/mcp-server` on first call and reuses the
 * connection for the process lifetime. A failed connect resets the pending
 * promise so a later call can retry; callers surface failures as text so the
 * agent degrades gracefully rather than throwing.
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

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StdioClientTransport({
          command: SERVER_COMMAND,
          args: SERVER_ARGS,
          env: {
            ...process.env,
            STATEWAVE_URL: process.env.STATEWAVE_URL ?? DEFAULT_STATEWAVE_URL,
          } as Record<string, string>,
        });
        const client = new Client({ name: 'dexter', version: '1.0.0' });
        await client.connect(transport);
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
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as TextContent[];
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
}
