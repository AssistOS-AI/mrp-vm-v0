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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
