import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph } from '../../src/index.mjs';
import { buildExecutionGraph } from '../../server/create-server.mjs';

test('buildExecutionGraph marks failed and skipped nodes after a terminal execution error', () => {
  const planText = `
@facts js-eval
throw new Error("boom")

@summary template-eval
Use $facts

@response template-eval
Answer $summary
`;
  const compiled = compileGraph(planText);
  const [factsNode, summaryNode, responseNode] = compiled.nodes;
  const graph = buildExecutionGraph(planText, [
    {
      event: 'request_started',
      request_id: 'request_1',
      budgets: { steps_remaining: 3 },
      request_metadata: { file_count: 0 },
      trigger: 'new_session_request',
    },
    {
      event: 'command_invoked',
      declaration_id: factsNode.id,
      command_id: 'js-eval',
      execution_ordinal: 1,
    },
    {
      event: 'context_packaged',
      declaration_id: factsNode.id,
      context_sections: {},
      resolved_dependencies: [],
      byte_counts: 0,
      selected_items: [],
      pruned_items: [],
      selected_knowledge_units: [],
    },
    {
      event: 'request_stopped',
      stop_reason: 'execution_error',
      error_message: 'boom',
    },
  ], {
    session_id: 'session_1',
    request_id: 'request_1',
    outcome: {
      stop_reason: 'execution_error',
      error: {
        code: 'EXECUTION_ERROR',
        message: 'boom',
      },
      remaining_budgets: {
        steps_remaining: 2,
      },
    },
  });

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNode = graph.nodes.find((node) => node.workflow_role === 'start');
  const finalNode = graph.nodes.find((node) => node.workflow_role === 'final');
  assert.equal(startNode?.topological_level, 0);
  assert.equal(startNode?.status, 'completed');
  assert.equal(byId.get(factsNode.id)?.status, 'failed');
  assert.match(String(byId.get(factsNode.id)?.status_reason), /boom/i);
  assert.equal(byId.get(summaryNode.id)?.status, 'skipped');
  assert.equal(byId.get(responseNode.id)?.status, 'skipped');
  assert.equal(finalNode?.status, 'failed');
  assert.deepEqual(graph.summary.counts, {
    completed: 1,
    failed: 2,
    skipped: 2,
  });
});

test('buildExecutionGraph keeps synthetic start and final nodes even when planning fails before a plan exists', () => {
  const graph = buildExecutionGraph('', [
    {
      event: 'planning_triggered',
      event_id: 1,
      created_at: '2026-05-07T10:00:00.000Z',
      request_id: 'request_1',
      mode: 'new_session_request',
      trigger_reason: 'new_session_request',
    },
    {
      event: 'request_started',
      event_id: 2,
      created_at: '2026-05-07T10:00:00.100Z',
      request_id: 'request_1',
      budgets: { steps_remaining: 8 },
      request_metadata: { file_count: 0 },
      trigger: 'new_session_request',
      initial_mode: 'new_session_request',
    },
    {
      event: 'planning_stopped',
      event_id: 3,
      created_at: '2026-05-07T10:00:00.200Z',
      request_id: 'request_1',
      mode: 'new_session_request',
      outcome: 'failed',
      accepted_actions: [],
      rejected_actions: ['initial_plan'],
      error: {
        code: 'PLANNING_ERROR',
        message: 'boom',
        stack: 'Error: boom\n    at planning',
      },
      planning_attempts: [
        {
          attempt: 1,
          valid: false,
          diagnostics: ['boom'],
        },
      ],
    },
    {
      event: 'request_stopped',
      event_id: 4,
      created_at: '2026-05-07T10:00:00.300Z',
      request_id: 'request_1',
      stop_reason: 'execution_error',
      error: {
        code: 'PLANNING_ERROR',
        message: 'boom',
        stack: 'Error: boom\n    at planning',
      },
      error_message: 'boom',
    },
  ], {
    session_id: 'session_1',
    request_id: 'request_1',
    request_text: 'Say hello',
    outcome: {
      stop_reason: 'execution_error',
      error: {
        code: 'PLANNING_ERROR',
        message: 'boom',
        stack: 'Error: boom\n    at planning',
      },
      remaining_budgets: {
        steps_remaining: 7,
      },
    },
  });

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.strata.map((layer) => layer.layer), [0, 1]);
  const startNode = graph.nodes.find((node) => node.workflow_role === 'start');
  const finalNode = graph.nodes.find((node) => node.workflow_role === 'final');
  assert.equal(startNode?.status, 'failed');
  assert.equal(finalNode?.status, 'failed');
  assert.equal(startNode?.details?.planning?.attempts?.length, 1);
  assert.equal(startNode?.details?.planning?.outcome, 'failed');
  assert.match(String(startNode?.details?.failure?.stack), /boom/);
});
