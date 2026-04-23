/**
 * QuestionGenerator – produces standardized questions from missing obligations.
 * Uses templates; no open-ended creativity required.
 */

const TEMPLATES = {
  default: (obligation) => `Please clarify: ${obligation}`,
  cardinality: (group) => `How many items are in the group "${group}"?`,
  orderType: () => `Is the ordering linear or circular?`,
  numericBound: (variable) => `What is the finite interval for "${variable}"?`,
  missingDomain: (variable) => `What are the possible values for "${variable}"?`,
  missingQuery: (solver) => `What should the ${solver} query return?`,
  missingActions: () => `What actions are available to transform the state?`,
  missingNodes: () => `What are the nodes of the graph?`,
  missingEdges: () => `What are the edges of the graph?`,
  missingInitialState: () => `What is the initial state?`,
  missingGoalState: () => `What is the goal state?`,
  missingStrategy: () => `What search strategy should be used (bfs or dfs)?`,
  missingFacts: () => `What facts or rules are known?`,
  missingConstraints: () => `What constraints must be satisfied?`,
};

function pickTemplate(missingText) {
  const lower = missingText.toLowerCase();
  if (lower.includes('cardinality')) return TEMPLATES.cardinality;
  if (lower.includes('order')) return TEMPLATES.orderType;
  if (lower.includes('interval') || lower.includes('bound')) return TEMPLATES.numericBound;
  if (lower.includes('domain')) return TEMPLATES.missingDomain;
  if (lower.includes('query')) return TEMPLATES.missingQuery;
  if (lower.includes('actions')) return TEMPLATES.missingActions;
  if (lower.includes('nodes')) return TEMPLATES.missingNodes;
  if (lower.includes('edges')) return TEMPLATES.missingEdges;
  if (lower.includes('initialstate')) return TEMPLATES.missingInitialState;
  if (lower.includes('goalstate')) return TEMPLATES.missingGoalState;
  if (lower.includes('strategy')) return TEMPLATES.missingStrategy;
  if (lower.includes('facts') || lower.includes('rules')) return TEMPLATES.missingFacts;
  if (lower.includes('constraints')) return TEMPLATES.missingConstraints;
  return TEMPLATES.default;
}

export class QuestionGenerator {
  static generate(missingObligations) {
    if (!Array.isArray(missingObligations) || missingObligations.length === 0) {
      return [];
    }
    const questions = [];
    for (const obligation of missingObligations) {
      const template = pickTemplate(obligation);
      const text = typeof template === 'function' ? template(obligation) : template;
      questions.push({
        kind: 'structural',
        source: 'obligation',
        text,
      });
    }
    return questions;
  }
}
