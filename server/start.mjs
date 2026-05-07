import { createRuntimeConfig } from '../src/index.mjs';
import { createServer } from './index.mjs';

const rootDir = process.cwd();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const runtimeConfig = createRuntimeConfig({
  baseDir: rootDir,
  env: process.env,
});

function logLine(level, event, context = {}) {
  const logger = level === 'error' ? console.error : console.log;
  logger(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  }));
}

const server = createServer({
  rootDir,
  verboseLogging: true,
  runtimeOptions: {
    runtimeConfig,
  },
});

server.listen(port, host, () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  logLine('info', 'server.listening', {
    url: `http://${host}:${activePort}/chat`,
    llm_adapter: runtimeConfig.llm.adapter,
  });
});

server.on('error', (error) => {
  logLine('error', 'server.error', {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    stack: error?.stack ?? null,
  });
});

server.on('clientError', (error, socket) => {
  logLine('error', 'server.client_error', {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    remote_address: socket?.remoteAddress ?? null,
    stack: error?.stack ?? null,
  });
});

for (const eventName of ['uncaughtException', 'unhandledRejection']) {
  process.on(eventName, (error) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    logLine('error', `process.${eventName}`, {
      message: normalized.message,
      code: normalized.code ?? null,
      stack: normalized.stack ?? null,
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
