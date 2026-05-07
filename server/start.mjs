import { createRuntimeConfig } from '../src/index.mjs';
import { createServer } from './index.mjs';

const rootDir = process.cwd();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const runtimeConfig = createRuntimeConfig({
  baseDir: rootDir,
  env: process.env,
});

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
  console.log(`MRP-VM server listening on http://${host}:${activePort}/chat`);
  console.log(`LLM adapter: ${runtimeConfig.llm.adapter}`);
});

server.on('error', (error) => {
  console.error('[MRP-VM] server.error', {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
  });
  if (error?.stack) {
    console.error(error.stack);
  }
});

server.on('clientError', (error, socket) => {
  console.error('[MRP-VM] server.client_error', {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    remote_address: socket?.remoteAddress ?? null,
  });
  if (error?.stack) {
    console.error(error.stack);
  }
});

for (const eventName of ['uncaughtException', 'unhandledRejection']) {
  process.on(eventName, (error) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error(`[MRP-VM] process.${eventName}`, {
      message: normalized.message,
      code: normalized.code ?? null,
    });
    if (normalized.stack) {
      console.error(normalized.stack);
    }
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
