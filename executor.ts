import { Op, State, Trace, Program, ProgramStep, FlatProgram } from "./types";
import { executeOp } from "./ops";

const MAX_FREE_K = 20;

// ─── Execute a single ground step ─────────────────────────────────────────────

function executeStep(op: Op, state: State): State {
  return executeOp(op, state);
}

// ─── Execute a full Program (may contain repeat steps) ────────────────────────
//
// For repeat with k="free":
//   - Run the repeat op k times (k=0,1,2,...) and after each run
//     check the *next* step in the program (which must be a compare op).
//   - Stop at the first k where compare returns true.
//   - If no k in [0, MAX_FREE_K] works, return false from compare.

export function execute(
  ops: Op[],
  program: Program,
  initialState: State
): { finalState: State; flatTrace: FlatProgram } {
  let current = initialState;
  const flatTrace: FlatProgram = [];

  let i = 0;
  while (i < program.length) {
    const step = program[i];

    if (step.kind === "op") {
      const op = ops[step.id];
      if (!op) throw new Error(`Unknown op id: ${step.id}`);
      current = executeStep(op, current);
      flatTrace.push(step.id);
      i++;
      continue;
    }

    if (step.kind === "repeat") {
      const repeatOp = ops[step.opId];
      if (!repeatOp) throw new Error(`Unknown op id: ${step.opId}`);

      if (typeof step.k === "number") {
        // Ground repeat: execute exactly k times
        for (let r = 0; r < step.k; r++) {
          current = executeStep(repeatOp, current);
          flatTrace.push(step.opId);
        }
        i++;
        continue;
      }

      // Free repeat: bounded search over k
      // Peek at the next step — it should be a compare op
      const nextStep = program[i + 1];
      if (!nextStep || nextStep.kind !== "op") {
        // No terminal condition — treat as k=0
        i++;
        continue;
      }

      const compareOp = ops[nextStep.id];
      if (!compareOp) throw new Error(`Unknown op id: ${nextStep.id}`);

      // Try k = 0, 1, 2, ... until compare returns true
      let found = false;
      let stateAtK = current;
      const traceAtK: FlatProgram = [];

      for (let k = 0; k <= MAX_FREE_K; k++) {
        // Test: apply compare to current stateAtK
        const testState = executeStep(compareOp, stateAtK);
        if (testState.boolean) {
          // This k works — commit
          current = testState;
          flatTrace.push(...traceAtK, nextStep.id);
          found = true;
          break;
        }
        // Try one more repeat
        stateAtK = executeStep(repeatOp, stateAtK);
        traceAtK.push(step.opId);
      }

      if (!found) {
        // Exhausted budget — concept doesn't apply, boolean=false
        current = { val: current.val, boolean: false };
      }

      i += 2; // consumed both the repeat and the compare
      continue;
    }

    i++;
  }

  return { finalState: current, flatTrace };
}

// ─── Convenience: execute a flat program (legacy, used by search/wake) ────────

export function executeFlatProgram(
  ops: Op[],
  flatProgram: FlatProgram,
  initialState: State
): Trace {
  const program: Program = flatProgram.map(id => ({ kind: "op" as const, id }));
  const { finalState, flatTrace } = execute(ops, program, initialState);

  // Build state history
  const states: State[] = [initialState];
  let cur = initialState;
  for (const id of flatTrace) {
    cur = executeOp(ops[id], cur);
    states.push(cur);
  }

  return { program: flatTrace, states, finalState };
}

// ─── Execute a slot's program on a single input value ─────────────────────────

export function executeSlot(
  ops: Op[],
  slotProgram: Program,
  inputVal: number
): { result: boolean; flatTrace: FlatProgram } {
  const initial: State = { val: inputVal, boolean: false };
  const { finalState, flatTrace } = execute(ops, slotProgram, initial);
  return { result: finalState.boolean, flatTrace };
}
