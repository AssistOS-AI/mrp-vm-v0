import vm from 'node:vm';

export const HUMAN_LIKE_VERDICTS = Object.freeze({
  EXECUTE: 'EXECUTE',
  INVALID_PROGRAM: 'INVALID_PROGRAM',
  TOO_COMPLEX: 'TOO_COMPLEX',
});

const ALLOWED_CONSTRUCTORS = new Set([
  'ExecutionContext',
  'RuleProblem',
  'ConstraintProblem',
  'GraphProblem',
  'SearchProblem',
  'NumericProblem',
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
];

export class HumanLikePreflightAnalyzer {
  static analyze(programSource, options = {}) {
    const source = String(programSource ?? '').trim();
    const diagnostics = [];
    const maxSourceLength = options.maxSourceLength ?? 12_000;

    if (!source) {
      return {
        verdict: HUMAN_LIKE_VERDICTS.INVALID_PROGRAM,
        diagnostics: ['Program source is empty.'],
        reason: 'Program source is empty.',
      };
    }

    if (source.length > maxSourceLength) {
      return {
        verdict: HUMAN_LIKE_VERDICTS.TOO_COMPLEX,
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

    if (!/\bctx\.emit\s*\(/.test(source)) {
      diagnostics.push('Program must emit at least one final target with ctx.emit(...).');
    }

    if (!/\bnew\s+ExecutionContext\s*\(/.test(source)) {
      diagnostics.push('Program must create an ExecutionContext instance.');
    }

    try {
      new vm.Script(`"use strict";\n(() => {\n${source}\n})();`);
    } catch (error) {
      diagnostics.push(`Syntax error: ${error.message}`);
    }

    if (diagnostics.length > 0) {
      return {
        verdict: HUMAN_LIKE_VERDICTS.INVALID_PROGRAM,
        diagnostics,
        reason: diagnostics.join(' '),
      };
    }

    return {
      verdict: HUMAN_LIKE_VERDICTS.EXECUTE,
      diagnostics: [],
      reason: '',
    };
  }
}
