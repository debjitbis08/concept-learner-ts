import { Op, State, Trace, Program } from "./types";
import { executeOp } from "./ops";

// ─── Execute a full program ────────────────────────────────────────────────────

export function execute(
  ops: Op[],
  program: Program,
  initialState: State
): Trace {
  const states: State[] = [initialState];
  let current = initialState;

  for (const opId of program) {
    const op = ops[opId];
    if (!op) throw new Error(`Unknown op id: ${opId}`);
    current = executeOp(op, current);
    states.push(current);
  }

  return { program, states, finalState: current };
}

// ─── Execute a slot (named program) on an input value ─────────────────────────

export function executeSlot(
  ops: Op[],
  slotProgram: Program,
  inputVal: number
): { result: boolean; trace: Trace } {
  const initial: State = { val: inputVal, boolean: false };
  const trace = execute(ops, slotProgram, initial);
  return { result: trace.finalState.boolean, trace };
}
