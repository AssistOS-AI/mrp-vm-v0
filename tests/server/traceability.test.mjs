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
  assert.equal(byId.get(factsNode.id)?.status, 'failed');
  assert.match(String(byId.get(factsNode.id)?.status_reason), /boom/i);
  assert.equal(byId.get(summaryNode.id)?.status, 'skipped');
  assert.equal(byId.get(responseNode.id)?.status, 'skipped');
  assert.deepEqual(graph.summary.counts, {
    failed: 1,
    skipped: 2,
  });
});
