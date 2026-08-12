import { createServer } from 'node:http';

import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const server = createServer(createApp({ config }));

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  console.log(`Slack inviter listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; closing the HTTP server`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
