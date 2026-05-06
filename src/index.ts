#!/usr/bin/env node

// NotePlan MCP Server Entry Point

process.on('uncaughtException', (error) => {
  console.error('[noteplan-mcp] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[noteplan-mcp] Unhandled rejection:', reason);
  process.exit(1);
});

// Exit when our parent (Claude Code/Desktop) closes the stdio pipe so we
// don't accumulate zombie Node processes after parent crashes / restarts.
// Without this we've seen multi-week-old MCP servers piling up and
// hammering the bridge endlessly.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(1));

import { startServer } from './server.js';

startServer().catch((error) => {
  console.error('[noteplan-mcp] Failed to start server:', error);
  process.exit(1);
});
