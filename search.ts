import { Op, State, Trace, Episode, Program } from "./types";
import { execute } from "./executor";

// ─── Enumerate all programs up to maxLength ────────────────────────────────────
//
// For a given episode, we search for programs that:
//   1. Start with reset(a) — set val to the primary input
//   2. Optionally subtract b (for binary relations like successor/predecessor)
//   3. End with a compare op that produces the expected boolean
//
// We prune heavily:
//   - Programs must start with reset(a)
//   - Programs must end with a compare op
//   - We stop as soon as we find the shortest solution

export function searchProgram(
  ops: Op[],
  episode: Episode,
  maxLength: number = 4
): Trace | null {
  // Find reset op for input a
  const resetA = ops.find(o => o.spec.kind === "reset" && o.spec.n === episode.a);
  if (!resetA) return null;

  // Find reset op for input b if needed
  const resetB = episode.b !== undefined
    ? ops.find(o => o.spec.kind === "reset" && o.spec.n === episode.b)
    : undefined;

  // Find add and compare ops
  const addOps = ops.filter(o => o.spec.kind === "add");
  const compareOps = ops.filter(o =>
    o.spec.kind === "compare_eq" ||
    o.spec.kind === "compare_gt" ||
    o.spec.kind === "compare_lt"
  );

  // Build candidate op pool: adds + compares (resets handled specially)
  const middleOps = [...addOps];

  // BFS over programs: always start with reset(a), end with compare
  // Middle ops are adds only
  const initialState: State = { val: episode.a, boolean: false };

  // Try programs of increasing length
  for (let len = 2; len <= maxLength; len++) {
    // Program structure: [reset(a), ...middle(len-2)..., compare]
    const middleLen = len - 2;

    if (middleLen < 0) continue;

    // Enumerate all combinations of middle ops
    const solutions = enumerateMiddle(
      ops,
      resetA,
      middleOps,
      compareOps,
      middleLen,
      initialState,
      episode.expected
    );

    if (solutions.length > 0) {
      return solutions[0]; // return shortest solution
    }
  }

  return null;
}

function enumerateMiddle(
  ops: Op[],
  resetOp: Op,
  middleOps: Op[],
  compareOps: Op[],
  middleLen: number,
  initialState: State,
  expected: boolean
): Trace[] {
  const solutions: Trace[] = [];

  // Generate all combinations of middleLen ops from middleOps
  const combos = cartesian(middleOps.map(o => o.id), middleLen);

  for (const middle of combos) {
    for (const cmp of compareOps) {
      const program: Program = [resetOp.id, ...middle, cmp.id];

      try {
        const trace = execute(ops, program, initialState);
        if (trace.finalState.boolean === expected) {
          solutions.push(trace);
        }
      } catch {
        // skip invalid programs
      }
    }
  }

  return solutions;
}

// ─── Cartesian product helper ──────────────────────────────────────────────────
// Generates all sequences of length `len` from `items`

function cartesian(items: number[], len: number): number[][] {
  if (len === 0) return [[]];
  if (len === 1) return items.map(i => [i]);

  const result: number[][] = [];
  const sub = cartesian(items, len - 1);
  for (const item of items) {
    for (const rest of sub) {
      result.push([item, ...rest]);
    }
  }
  return result;
}

// ─── Search for all solutions (not just first) ────────────────────────────────

export function searchAllPrograms(
  ops: Op[],
  episode: Episode,
  maxLength: number = 6
): Trace[] {
  const resetA = ops.find(o => o.spec.kind === "reset" && o.spec.n === episode.a);
  if (!resetA) return [];

  const addOps = ops.filter(o => o.spec.kind === "add");
  const compareOps = ops.filter(o =>
    o.spec.kind === "compare_eq" ||
    o.spec.kind === "compare_gt" ||
    o.spec.kind === "compare_lt"
  );

  const initialState: State = { val: episode.a, boolean: false };
  const all: Trace[] = [];

  for (let len = 2; len <= maxLength; len++) {
    const middleLen = len - 2;
    if (middleLen < 0) continue;

    const found = enumerateMiddle(
      ops, resetA, addOps, compareOps,
      middleLen, initialState, episode.expected
    );
    all.push(...found);
  }

  return all;
}
