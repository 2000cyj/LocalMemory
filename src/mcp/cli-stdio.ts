/*
*  file  : src/mcp/cli-stdio.ts
*  usage : CLI entry for stdio MCP transport.
*          Reads/writes JSON-RPC over stdin/stdout for agent processes.
*
*  Run:
*    npx longmemory-mcp-stdio
*/

import { start_mcp_stdio_server } from './server.js';

async function main(): Promise<void> {
    const { engine, close } = await start_mcp_stdio_server();

    const shutdown = async (signal: string): Promise<void> => {
        // eslint-disable-next-line no-console
        console.error(`[longmemory-mcp-stdio] received ${signal}, shutting down`);
        await close();
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[longmemory-mcp-stdio] fatal:', err);
    process.exit(1);
});