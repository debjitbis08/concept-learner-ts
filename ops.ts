import { Op, OpKind, State, Program, FlatProgram, ProgramStep } from "./types";

// ─── Execute a single op ───────────────────────────────────────────────────────

export function executeOp(op: Op, state: State): State {
  switch (op.spec.kind) {
    case "reset":      return { val: op.spec.n, boolean: state.boolean };
    case "add":        return { val: state.val + op.spec.k, boolean: state.boolean };
    case "compare_eq": return { val: state.val, boolean: state.val === 0 };
    case "compare_gt": return { val: state.val, boolean: state.val > 0 };
    case "compare_lt": return { val: state.val, boolean: state.val < 0 };
  }
}

// ─── Build the primitive op registry ─────────────────────────────────────────

export function buildOps(domain: number[] = [0,1,2,3,4,5,6,7,8,9]): Op[] {
  const ops: Op[] = [];
  let id = 0;

  for (const n of domain) {
    ops.push({ id: id++, name: `reset(${n})`, spec: { kind: "reset", n } });
  }
  for (const k of [-2, -1, 1, 2]) {
    ops.push({ id: id++, name: `add(${k > 0 ? "+" : ""}${k})`, spec: { kind: "add", k } });
  }
  ops.push({ id: id++, name: "compare_eq", spec: { kind: "compare_eq" } });
  ops.push({ id: id++, name: "compare_gt", spec: { kind: "compare_gt" } });
  ops.push({ id: id++, name: "compare_lt", spec: { kind: "compare_lt" } });

  return ops;
}

// ─── Pretty-print ─────────────────────────────────────────────────────────────

export function programToString(ops: Op[], program: Program): string {
  return program.map(step => {
    if (step.kind === "op") {
      return ops[step.id]?.name ?? `op(${step.id})`;
    }
    const opName = ops[step.opId]?.name ?? `op(${step.opId})`;
    const kStr = step.k === "free" ? "?" : String(step.k);
    return `repeat(${opName}, ${kStr})`;
  }).join(" → ");
}

export function flatProgramToString(ops: Op[], flat: FlatProgram): string {
  return flat.map(id => ops[id]?.name ?? `op(${id})`).join(" → ");
}
