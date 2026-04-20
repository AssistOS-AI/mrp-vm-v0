export async function evaluateConfiguredRuntime(input) {
  const {
    createRuntime,
    createBaseline,
    cases,
  } = input;

  const results = [];

  for (const testCase of cases) {
    const runtime = await createRuntime(testCase);
    const runtimeOutcome = await runtime.submitRequest({
      requestText: testCase.request,
      sessionId: testCase.session_id,
      budgets: testCase.budgets,
    });
    const baselineOutcome = await createBaseline(testCase);

    results.push({
      id: testCase.id,
      runtime_response: runtimeOutcome.response,
      baseline_response: baselineOutcome.response,
      response_equal: String(runtimeOutcome.response) === String(baselineOutcome.response),
      trace_events: runtime.invocationHistory.length,
      stop_reason: runtimeOutcome.stop_reason,
    });
  }

  return {
    total_cases: results.length,
    matching_responses: results.filter((entry) => entry.response_equal).length,
    results,
  };
}
