export const DEMO_TASKS = [
  {
    id: 'incident-triage',
    title: 'Incident triage and parallel response',
    prompt: `You are assisting an operations lead during a live incident review.

Available signals:
- Region eu-central latency jumped from 120ms to 840ms after the last deploy.
- Two enterprise customers reported intermittent 502 responses between 09:12 and 09:27 UTC.
- Synthetic checks for the public homepage still pass from us-east.
- Billing events are delayed by 11 minutes, but queue depth is still below the alert threshold.
- One internal note says "rollback fixed it", while another says "rollback did not change error rate".

Requirements:
1. Validate the evidence and identify contradictions.
2. Classify severity with explicit reasoning.
3. Split the response into parallel workstreams with owners and immediate checks.
4. Produce a 90-minute action plan.
5. End with a short operator-facing summary that could be posted in incident chat.
6. Keep each section compact; prefer bullets over long paragraphs.

Output sections:
- Evidence assessment
- Severity decision
- Parallel workstreams
- 90-minute plan
- Operator summary`,
  },
  {
    id: 'ops-budget',
    title: 'Incident operations budget note',
    prompt: `Prepare a quarterly incident-operations budget note for leadership.

Workstreams:
- On-call uplift: 12 engineers x 180 per month x 3 months
- Observability licenses: 28 seats x 45 per month x 3 months
- Game-day program: 4 exercises x 1200 each
- Training fund: 12 engineers x 300 one-time
- Savings offset: retire old pager contract = 2500 total

Requirements:
1. Calculate each subtotal explicitly.
2. Compute the gross budget, savings, and final net budget.
3. Present the result as compact line items plus a short recommendation.
4. Mention one operational risk if the training fund is cut.
5. Keep the answer concise and decision-oriented.

Output sections:
- Line items
- Totals
- Recommendation
- Risk note`,
  },
  {
    id: 'security-remediation',
    title: 'Security remediation program',
    prompt: `Create a 30-day remediation plan for the following audit findings.

Findings:
- Public admin endpoint lacks rate limiting.
- Session export logs do not consistently record actor identity.
- Two external interpreters are enabled in production but have no owner documented.
- Default KUs for export policy are present but too vague for operators.

Requirements:
1. Group the findings into implementation tracks.
2. Distinguish quick wins from deeper fixes.
3. Mark which work can run in parallel.
4. Add one release gate that must be satisfied before closing the effort.
5. Finish with a concise leadership summary.

Output sections:
- Tracks
- Quick wins
- Parallel work
- Release gate
- Leadership summary`,
  },
  {
    id: 'js-review-batcher',
    title: 'JS review batch utility',
    prompt: `Design a tiny JavaScript utility named allocateReviewBatches(items, reviewers, maxPerReviewer).

Scenario:
- items = ["parser", "trace-ui", "kb-browser", "settings-auth", "planner-fixes", "runtime-tests"]
- reviewers = ["Ana", "Mihai", "Ioana"]
- maxPerReviewer = 2

Requirements:
1. Explain the allocation strategy.
2. Generate the JavaScript function.
3. Compute the exact sample output for the scenario above.
4. Mention one edge case and how the function should behave.

Output sections:
- Strategy
- JavaScript
- Sample output
- Edge case`,
  },
  {
    id: 'water-jug-proof',
    title: 'Water jug proof and generalization',
    prompt: `Solve the classic 8L-5L-3L water jug problem.

Initial state: (8,0,0)
Goal: get exactly 4L in one container.
Allowed move: pour from one container into another until the source is empty or the destination is full.

Requirements:
1. Determine if the goal is reachable.
2. Give the minimal sequence of states.
3. Explain why the sequence is minimal.
4. End with a short gcd-style generalization for capacities (a, b, c) and target T.
5. Keep the wording crisp and step-oriented.

Output sections:
- Reachability
- Minimal sequence
- Minimality argument
- Generalization`,
  },
  {
    id: 'rollout-blueprint',
    title: 'Parallel rollout blueprint',
    prompt: `Prepare an implementation blueprint for adding a trace export feature.

Requested changes:
- Add an Export Trace button to the traceability page.
- Add a server endpoint that returns the current request trace as JSON.
- Add one default KU explaining when export is allowed.
- Update docs and tests.
- Preserve admin/user authority boundaries.

Requirements:
1. Break the work into explicit deliverables.
2. Separate parallel work from serial work.
3. Produce a compact SOP Lang-style draft using only plausible commands or interpreter names.
4. Finish with a release checklist.
5. Keep the plan concrete and implementation-oriented.

Output sections:
- Deliverables
- Parallel work
- Serial work
- SOP Lang draft
- Release checklist`,
  },
];

export const DEMO_TASK_MAP = Object.fromEntries(DEMO_TASKS.map((item) => [item.id, item]));
