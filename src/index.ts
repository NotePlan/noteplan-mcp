#!/usr/bin/env node

// NotePlan MCP Server Entry Point

import { startServer } from './server.js';

startServer().catch((error) => {
  console.error('Failed to start NotePlan MCP server:', error);
  process.exit(1);
});
