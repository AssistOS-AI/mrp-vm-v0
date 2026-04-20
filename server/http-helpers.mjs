export function parseUrl(request) {
  return new URL(request.url, 'http://127.0.0.1');
}

export function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

export function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

export function text(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(body);
}

export function notFound(response) {
  json(response, 404, { error: 'not_found' });
}

export function badRequest(response, message) {
  json(response, 400, { error: 'bad_request', message });
}

export function forbidden(response, message = 'forbidden') {
  json(response, 403, { error: 'forbidden', message });
}

export async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

export async function readJsonBody(request) {
  const raw = await readRequestBody(request);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

export function parseMultipart(body, boundary) {
  const parts = [];
  const chunks = body.split(`--${boundary}`);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === '--') {
      continue;
    }

    const [rawHeaders, ...rest] = trimmed.split('\r\n\r\n');
    const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
    const headers = {};
    for (const line of rawHeaders.split('\r\n')) {
      const separator = line.indexOf(':');
      if (separator === -1) {
        continue;
      }
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      headers[key] = value;
    }
    parts.push({ headers, content });
  }
  return parts;
}

export function startSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  response.write(': connected\n\n');
}

export function writeSseEvent(response, event) {
  response.write(`id: ${event.event_id}\n`);
  response.write(`event: ${event.event}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
