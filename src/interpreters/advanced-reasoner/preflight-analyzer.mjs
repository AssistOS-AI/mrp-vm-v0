import vm from 'node:vm';

export const ADVANCED_REASONER_VERDICTS = Object.freeze({
  EXECUTE: 'EXECUTE',
  INVALID_PROGRAM: 'INVALID_PROGRAM',
  TOO_COMPLEX: 'TOO_COMPLEX',
});

const ALLOWED_CONSTRUCTORS = new Set([
  'ExecutionContext',
  'ReasonerResponse',
  'AbductiveReasoningProblem',
  'ProbabilisticReasoningProblem',
  'CausalReasoningProblem',
  'ArgumentationProblem',
  'BeliefRevisionProblem',
  'LegalReasoningProblem',
  'ScientificSynthesisProblem',
  'OptimizationReasoningProblem',
  'FormalProofRoutingProblem',
  'SMTReasoningProblem',
  'PragmaticInterpretationProblem',
  'AnalogicalReasoningProblem',
  'EthicalDeliberationProblem',
  'CreativeEvaluationProblem',
]);

const BANNED_PATTERNS = [
  /\bimport\b/,
  /\bexport\b/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bmodule\b/,
  /\bexports\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\basync\b/,
  /\bawait\b/,
  /\bwhile\s*\(/,
  /\bdo\s*\{/,
  /\bfor\s*\(/,
  /\bclass\b/,
  /\btry\s*\{/,
  /\bcatch\s*\(/,
  /\bctx\.emit\s*\(/,
  /\bctx\.useKU\s*\(/,
  /\bctx\.call\s*\(/,
];

export class AdvancedReasonerPreflightAnalyzer {
  static analyze(programSource, options = {}) {
    const source = String(programSource ?? '').trim();
    const diagnostics = [];
    const maxSourceLength = options.maxSourceLength ?? 16_000;

    if (!source) {
      return {
        verdict: ADVANCED_REASONER_VERDICTS.INVALID_PROGRAM,
        diagnostics: ['Program source is empty.'],
        reason: 'Program source is empty.',
      };
    }

    if (source.length > maxSourceLength) {
      return {
        verdict: ADVANCED_REASONER_VERDICTS.TOO_COMPLEX,
        diagnostics: [`Program source length ${source.length} exceeds ${maxSourceLength}.`],
        reason: `Program source length ${source.length} exceeds ${maxSourceLength}.`,
      };
    }

    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(source)) {
        diagnostics.push(`Banned construct detected: ${pattern}`);
      }
    }

    for (const match of source.matchAll(/\bnew\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (!ALLOWED_CONSTRUCTORS.has(match[1])) {
        diagnostics.push(`Unknown constructor ${match[1]}.`);
      }
    }

    if (!/\bnew\s+ExecutionContext\s*\(/.test(source)) {
      diagnostics.push('Program must create an ExecutionContext instance.');
    }

    if (!/\bctx\.returnResponse\s*\(/.test(source)) {
      diagnostics.push('Program must terminate with ctx.returnResponse(...).');
    }

    try {
      new vm.Script(`"use strict";\n(() => {\n${source}\n})();`);
    } catch (error) {
      diagnostics.push(`Syntax error: ${error.message}`);
    }

    if (diagnostics.length > 0) {
      return {
        verdict: ADVANCED_REASONER_VERDICTS.INVALID_PROGRAM,
        diagnostics,
        reason: diagnostics.join(' '),
      };
    }

    return {
      verdict: ADVANCED_REASONER_VERDICTS.EXECUTE,
      diagnostics: [],
      reason: '',
    };
  }
}
