export async function evaluateConfiguredRuntime(input) {
  const {
    createRuntime,
    createBaseline,
    cases,
    compareResponses,
    onCaseStart,
    onTraceEvent,
    onCaseFinish,
  } = input;

  const results = [];

  for (const [caseIndex, testCase] of cases.entries()) {
    let runtime = null;
    let traceListener = null;
    try {
      await onCaseStart?.({
        testCase,
        caseIndex,
        totalCases: cases.length,
      });
      runtime = await createRuntime(testCase);
      if (onTraceEvent && typeof runtime?.onTrace === 'function') {
        traceListener = (event) => {
          onTraceEvent({
            testCase,
            caseIndex,
            totalCases: cases.length,
            event,
          });
        };
        runtime.onTrace(traceListener);
      }
      const startedAt = Date.now();
      const requestHandle = typeof runtime?.startRequest === 'function'
        ? await runtime.startRequest({
          requestText: testCase.request,
          sessionId: testCase.session_id,
          budgets: testCase.budgets,
        })
        : null;
      const runtimeOutcome = requestHandle
        ? await requestHandle.done
        : await runtime.submitRequest({
        requestText: testCase.request,
        sessionId: testCase.session_id,
        budgets: testCase.budgets,
      });
      const inspection = typeof runtime?.inspectRequestPublic === 'function'
        ? await runtime.inspectRequestPublic(runtimeOutcome.request_id ?? requestHandle?.request_id)
        : null;
      const baselineOutcome = await createBaseline(testCase);
      const comparison = compareResponses
        ? await compareResponses({ testCase, runtimeOutcome, baselineOutcome, runtime, inspection })
        : {
          equal: String(runtimeOutcome.response) === String(baselineOutcome.response),
          message: null,
        };

      const result = {
        id: testCase.id,
        session_id: runtimeOutcome.session_id ?? requestHandle?.session_id ?? testCase.session_id ?? null,
        request_id: runtimeOutcome.request_id ?? requestHandle?.request_id ?? null,
        runtime_response: runtimeOutcome.response,
        baseline_response: baselineOutcome.response,
        response_equal: Boolean(comparison?.equal),
        comparison_message: comparison?.message ?? null,
        trace_events: runtime.invocationHistory.length,
        stop_reason: runtimeOutcome.stop_reason,
        duration_ms: Date.now() - startedAt,
        sop_length: inspection?.plan_snapshot?.length ?? 0,
        declaration_count: (inspection?.plan_snapshot?.match(/^@/gm) ?? []).length,
        family_count: Array.isArray(inspection?.family_state) ? inspection.family_state.length : 0,
      };
      results.push(result);
      await onCaseFinish?.({
        testCase,
        caseIndex,
        totalCases: cases.length,
        result,
        runtimeOutcome,
        baselineOutcome,
        inspection,
      });
    } finally {
      if (traceListener && typeof runtime?.offTrace === 'function') {
        runtime.offTrace(traceListener);
      }
      if (runtime && typeof runtime.close === 'function') {
        await runtime.close();
      }
    }
  }

  return {
    total_cases: results.length,
    matching_responses: results.filter((entry) => entry.response_equal).length,
    results,
  };
}
