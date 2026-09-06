import 'dotenv/config';

import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = createApp(config.allowedOrigins);

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
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
