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

import { startServer } from './server.js';

startServer().catch((error) => {
  console.error('[noteplan-mcp] Failed to start server:', error);
  process.exit(1);
});
