import http from 'node:http';

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

export function createServer(runtime) {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'POST' && request.url === '/api/requests') {
        const body = JSON.parse(await readRequestBody(request));
        const outcome = await runtime.submitRequest({
          sessionId: body.session_id,
          requestText: body.request,
          files: body.files ?? [],
          budgets: body.budgets,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(outcome));
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const body = JSON.parse(await readRequestBody(request));
        const outcome = await runtime.submitRequest({
          sessionId: body.user ?? undefined,
          requestText: body.messages?.map((message) => message.content).join('\n') ?? '',
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: outcome.request_id,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: String(outcome.response ?? ''),
            },
          }],
        }));
        return;
      }

      if (request.method === 'GET' && request.url === '/api/inspect') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(runtime.inspect()));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: error.message,
      }));
    }
  });

  return server;
}
