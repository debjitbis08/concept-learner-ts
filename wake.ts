import { Op } from "./types";
import { programToString } from "./ops";
import { Episode, Trace, RelationKind } from "./types";
import { searchProgram } from "./search";
import { execute } from "./executor";

// ─── Generate episodes for a relation ─────────────────────────────────────────

export function generateEpisodes(
  relation: RelationKind,
  domain: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
): Episode[] {
  const episodes: Episode[] = [];

  switch (relation) {
    case "successor":
      // is b the successor of a? i.e. b === a + 1
      for (const a of domain) {
        for (const b of domain) {
          episodes.push({ relation, a, b, expected: b === a + 1 });
        }
      }
      break;

    case "predecessor":
      // is b the predecessor of a? i.e. b === a - 1
      for (const a of domain) {
        for (const b of domain) {
          episodes.push({ relation, a, b, expected: b === a - 1 });
        }
      }
      break;

    case "parity":
      // is a even?
      for (const a of domain) {
        episodes.push({ relation, a, expected: a % 2 === 0 });
      }
      break;
  }

  return episodes;
}

// ─── Imitation traces: hand-authored correct programs ─────────────────────────
//
// These are the "show the model a correct trace" path.
// For successor: reset(a), add(-b), add(+1), compare_eq
//   → val = a - b + 1, boolean = (a - b + 1 === 0) ↔ b = a + 1
// For predecessor: reset(a), add(-b), add(-1), compare_eq
//   → val = a - b - 1, boolean = (a - b - 1 === 0) ↔ b = a - 1
// For parity: reset(a), add(-2)*k, compare_eq (only works for small a)
//   → we use a different encoding: reset(a % 2), compare_eq

export function imitationTraces(
  ops: Op[],
  episodes: Episode[]
): Trace[] {
  const traces: Trace[] = [];

  for (const ep of episodes) {
    const trace = buildImitationTrace(ops, ep);
    if (trace) traces.push(trace);
  }

  return traces;
}

function buildImitationTrace(ops: Op[], ep: Episode): Trace | null {
  const findOp = (name: string) => ops.find(o => o.name === name);

  switch (ep.relation) {
    case "successor": {
      if (ep.b === undefined) return null;
      // reset(a), add(-b), add(+1), compare_eq
      // val = a - b + 1; eq ↔ b = a+1
      const r = findOp(`reset(${ep.a})`);
      const sub = findOp(`add(-1)`);
      const cmp = findOp("compare_eq");
      // simpler: reset(b), add(-a), add(-1), compare_eq
      // val = b - a - 1; eq ↔ b = a+1
      const rb = findOp(`reset(${ep.b})`);
      const ra = findOp(`reset(${ep.a})`);
      const addN1 = findOp("add(-1)");
      const addP1 = findOp("add(+1)");
      if (!rb || !ra || !addN1 || !cmp) return null;
      // program: reset(a) → add(+1) → reset is wrong approach
      // Better: reset(a), add(+1), add(-b's reset is not an op)
      // Actually simplest: search will handle this; imitation just needs a valid trace
      // Use: val = a, then subtract b by repeated add(-1) — but b could be large
      // For single digit domain, just use search as fallback
      return null; // let search handle successor/predecessor
    }

    case "predecessor":
      return null; // let search handle

    case "parity": {
      // Parity imitation: reset(a % 2), compare_eq
      // This encodes the answer directly — not quite "learning" but valid as imitation
      // A better imitation: we provide a trace using repeated subtraction
      // For a <= 9, we can do: reset(a), add(-2)*floor(a/2), compare_eq
      const resetOp = findOp(`reset(${ep.a})`);
      const addM2 = findOp("add(-2)");
      const addM1 = findOp("add(-1)");
      const cmpEq = findOp("compare_eq");
      if (!resetOp || !addM2 || !addM1 || !cmpEq) return null;

      // Build: reset(a), add(-2) * floor(a/2), [add(-1) if odd], compare_eq
      // For even a: ends at 0 → true
      // For odd a: ends at 1 → false  (we want false for odd, true for even)
      const steps = floor(ep.a / 2);
      const program = [
        resetOp.id,
        ...Array(steps).fill(addM2.id),
        cmpEq.id
      ];

      const initial = { val: ep.a, boolean: false };
      try {
        const trace = execute(ops, program, initial);
        // Verify it's correct
        if (trace.finalState.boolean === ep.expected) return trace;
      } catch { /* skip */ }
      return null;
    }
  }
}

function floor(n: number): number {
  return Math.floor(n);
}

// ─── Wake mode: run search + imitation, return all collected traces ────────────

export interface WakeResult {
  traces: Trace[];
  solved: number;
  total: number;
}

export function wake(
  ops: Op[],
  episodes: Episode[],
  maxSearchLength: number = 5,
  verbose: boolean = false
): WakeResult {
  const traces: Trace[] = [];
  let solved = 0;

  for (const ep of episodes) {
    // Try imitation first
    let trace = buildImitationTrace(ops, ep);

    // Fall back to search
    if (!trace) {
      trace = searchProgram(ops, ep, maxSearchLength);
    }

    if (trace) {
      traces.push(trace);
      solved++;
      if (verbose) {
        const prog = programToString(ops, trace.program);
        console.log(`  ✓ ${ep.relation}(${ep.a}${ep.b !== undefined ? `,${ep.b}` : ""})=${ep.expected}: ${prog}`);
      }
    } else {
      if (verbose) {
        console.log(`  ✗ ${ep.relation}(${ep.a}${ep.b !== undefined ? `,${ep.b}` : ""})=${ep.expected}: no solution found`);
      }
    }
  }

  return { traces, solved, total: episodes.length };
}
