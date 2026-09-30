import 'dotenv/config';

import { createApp } from './app.js';
import { readConfig } from './config.js';
import { ToolService } from './tools/service.js';

const config = readConfig();
const tools = new ToolService({
  gs: process.env.GHOSTSCRIPT_PATH,
  qpdf: process.env.QPDF_PATH,
});
const app = createApp(config.allowedOrigins, tools);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Kagaz API listening on port ${config.port}`);
});

server.on('error', (error) => {
  console.error('Kagaz API failed to start.', error);
  process.exitCode = 1;
});

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received; closing Kagaz API.`);
  server.close((error) => {
    if (error) {
      console.error('Kagaz API did not close cleanly.', error);
      process.exitCode = 1;
    }
  });
  void tools.shutdown().then(() => server.closeAllConnections());
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
