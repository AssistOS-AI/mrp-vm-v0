import http from 'node:http';
import { createRuntime } from '../src/index.mjs';
import { parseUrl, json, html, text, notFound, badRequest, forbidden, readJsonBody, readRequestBody, parseMultipart, startSse, writeSseEvent } from './http-helpers.mjs';
import { renderChatApp } from './chat-app.mjs';

function parsePathname(pathname) {
  return pathname.split('/').filter(Boolean);
}

async function resolveCallerSession(runtime, request) {
  const callerSessionId = request.headers['x-session-id'];
  if (!callerSessionId) {
    return null;
  }
  try {
    return await runtime.getSession(callerSessionId);
  } catch {
    return null;
  }
}

function requireAdmin(response, callerSession) {
  if (!callerSession?.is_admin) {
    forbidden(response, 'admin_required');
    return false;
  }
  return true;
}

async function parseRequestPayload(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
    if (!boundaryMatch) {
      return { request: '', files: [] };
    }
    const body = await readRequestBody(request);
    const parts = parseMultipart(body, boundaryMatch[1]);
    const result = {
      request: '',
      files: [],
    };
    for (const part of parts) {
      const disposition = part.headers['content-disposition'] ?? '';
      const nameMatch = /name="([^"]+)"/.exec(disposition);
      const fileMatch = /filename="([^"]+)"/.exec(disposition);
      const name = nameMatch?.[1];
      if (fileMatch) {
        result.files.push({
          name: fileMatch[1],
          content: part.content,
        });
      } else if (name === 'request') {
        result.request = part.content;
      } else if (name === 'budgets') {
        result.budgets = JSON.parse(part.content);
      }
    }
    return result;
  }
  return readJsonBody(request);
}

export function createServer(options = {}) {
  const runtime = options.runtime ?? createRuntime(options.rootDir ?? process.cwd(), options.runtimeOptions ?? {});
  const config = {
    default_llm: 'plannerLLM',
    interpreter_mappings: {
      fastLLM: 'fastLLM',
      deepLLM: 'deepLLM',
      plannerLLM: 'plannerLLM',
      writerLLM: 'writerLLM',
      codeGeneratorLLM: 'codeGeneratorLLM',
    },
    policies: {
      allow_session_ku_promotion: false,
      enable_cross_request_analytic_memory: true,
    },
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = parseUrl(request);
      const parts = parsePathname(url.pathname);
      const callerSession = await resolveCallerSession(runtime, request);

      if (request.method === 'GET' && url.pathname === '/chat') {
        html(response, 200, renderChatApp());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readJsonBody(request);
        const session = await runtime.createSession({
          sessionId: body.session_id,
          policyProfile: body.policy_profile ?? 'default',
          isAdmin: Boolean(body.is_admin),
        });
        json(response, 201, {
          session_id: session.session_id,
          policy_profile: session.policy_profile,
          is_admin: session.is_admin,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        const sessions = await runtime.listSessions();
        const filtered = callerSession?.is_admin
          ? sessions
          : callerSession
            ? sessions.filter((item) => item.session_id === callerSession.session_id)
            : [];
        json(response, 200, { sessions: filtered });
        return;
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts.length === 3) {
        const session = await runtime.getSession(parts[2]);
        const details = await runtime.inspectSession(session);
        json(response, 200, details);
        return;
      }

      if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'requests' && parts.length === 4) {
        const session = await runtime.getSession(parts[2]);
        const payload = await parseRequestPayload(request);
        const started = await runtime.submitRequest(session, {
          requestText: payload.request ?? payload.requestText ?? '',
          files: payload.files ?? [],
          budgets: payload.budgets,
        });
        started.done.catch(() => {});
        json(response, 202, {
          session_id: session.session_id,
          request_id: started.request_id,
          status: 'accepted',
        });
        return;
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'requests' && parts.length >= 5) {
        const session = await runtime.getSession(parts[2]);
        const requestId = parts[4];

        if (parts.length === 5) {
          const details = await session.executor.inspectRequestPublic(requestId);
          json(response, 200, details ?? { request_id: requestId, status: 'unknown' });
          return;
        }

        if (parts[5] === 'plan') {
          const details = await session.executor.inspectRequestPublic(requestId);
          text(response, 200, details?.plan_snapshot ?? '');
          return;
        }

        if (parts[5] === 'state') {
          const details = await session.executor.inspectRequestPublic(requestId);
          json(response, 200, {
            request_id: requestId,
            family_state: details?.family_state ?? [],
          });
          return;
        }

        if (parts[5] === 'trace') {
          const details = await session.executor.getTraceEvents(requestId, {
            eventType: url.searchParams.get('event'),
          });
          json(response, 200, {
            request_id: requestId,
            events: details,
          });
          return;
        }

        if (parts[5] === 'stream') {
          const lastEventId = Number(request.headers['last-event-id'] ?? 0);
          startSse(response);
          const replay = await session.executor.getTraceEvents(requestId, {
            afterEventId: lastEventId,
          });
          for (const event of replay) {
            writeSseEvent(response, event);
          }

          const listener = (event) => {
            if (event.request_id === requestId && Number(event.event_id ?? 0) > lastEventId) {
              writeSseEvent(response, event);
            }
          };
          session.executor.onTrace(listener);
          request.on('close', () => {
            session.executor.offTrace(listener);
          });
          return;
        }
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'kb' && parts.length === 4) {
        const session = await runtime.getSession(parts[2]);
        const kus = await session.executor.kbStore.listSessionKus(session.session_id);
        json(response, 200, {
          session_id: session.session_id,
          items: kus.map((entry) => ({
            ku_id: entry.kuId,
            summary: entry.meta.summary,
            scope: entry.scope,
          })),
        });
        return;
      }

      if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'kb' && parts.length === 4) {
        const session = await runtime.getSession(parts[2]);
        const body = await readJsonBody(request);
        await session.executor.kbStore.upsertSessionKu(session.session_id, {
          fileName: body.file_name,
          sopText: body.sop_text,
        });
        json(response, 201, { ok: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/kb/promote') {
        if (!requireAdmin(response, callerSession)) {
          return;
        }
        const body = await readJsonBody(request);
        await callerSession.executor.kbStore.promoteSessionKu(body.session_id, body.file_name, body.target_file_name);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/kb/global') {
        const sampleSession = callerSession ?? await runtime.createSession({ sessionId: 'public-kb-probe', isAdmin: false });
        const items = await sampleSession.executor.kbStore.listGlobalKus();
        json(response, 200, {
          items: items.map((entry) => ({
            ku_id: entry.kuId,
            summary: entry.meta.summary,
          })),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        json(response, 200, config);
        return;
      }

      if (request.method === 'PUT' && url.pathname === '/api/config') {
        if (!requireAdmin(response, callerSession)) {
          return;
        }
        const body = await readJsonBody(request);
        Object.assign(config, body);
        json(response, 200, config);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readJsonBody(request);
        const sessionId = request.headers['session_id'] ?? request.headers['x-session-id'] ?? body.session_id;
        const session = sessionId ? await runtime.getSession(sessionId) : await runtime.createSession({});
        const started = await runtime.submitRequest(session, {
          requestText: (body.messages ?? []).map((message) => message.content).join('\n'),
          budgets: body.budgets,
        });
        const outcome = await started.done;
        json(response, 200, {
          id: outcome.request_id,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: String(outcome.response ?? ''),
            },
          }],
        });
        return;
      }

      notFound(response);
    } catch (error) {
      if (error.code === 'ACTIVE_REQUEST') {
        json(response, 409, {
          error: 'active_request',
          message: error.message,
        });
        return;
      }
      badRequest(response, error.message);
    }
  });

  server.runtime = runtime;
  server.config = config;
  return server;
}
