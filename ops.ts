import { Op, OpKind, State } from "./types";


// ─── Execute a single op on a state ───────────────────────────────────────────

export function executeOp(op: Op, state: State): State {
  switch (op.spec.kind) {
    case "reset":
      return { val: op.spec.n, boolean: state.boolean };
    case "add":
      return { val: state.val + op.spec.k, boolean: state.boolean };
    case "compare_eq":
      return { val: state.val, boolean: state.val === 0 };
    case "compare_gt":
      return { val: state.val, boolean: state.val > 0 };
    case "compare_lt":
      return { val: state.val, boolean: state.val < 0 };
  }
}

// ─── Build the primitive op registry ─────────────────────────────────────────
//
// For single digits 0-9:
//   reset(n)      for n in 0..9   → 10 ops
//   add(k)        for k in {-2,-1,1,2} → 4 ops
//   compare_eq                    → 1 op
//   compare_gt                    → 1 op
//   compare_lt                    → 1 op
//
// Total: 17 primitives

export function buildOps(domain: number[] = [0,1,2,3,4,5,6,7,8,9]): Op[] {
  const ops: Op[] = [];
  let id = 0;

  // reset ops
  for (const n of domain) {
    ops.push({ id: id++, name: `reset(${n})`, spec: { kind: "reset", n } });
  }

  // add ops
  for (const k of [-2, -1, 1, 2]) {
    ops.push({ id: id++, name: `add(${k > 0 ? "+" : ""}${k})`, spec: { kind: "add", k } });
  }

  // compare ops
  ops.push({ id: id++, name: "compare_eq", spec: { kind: "compare_eq" } });
  ops.push({ id: id++, name: "compare_gt", spec: { kind: "compare_gt" } });
  ops.push({ id: id++, name: "compare_lt", spec: { kind: "compare_lt" } });

  return ops;
}

// ─── Convenience: find op by name ─────────────────────────────────────────────

export function findOp(ops: Op[], name: string): Op | undefined {
  return ops.find(o => o.name === name);
}

// ─── Pretty-print a program ────────────────────────────────────────────────────

export function programToString(ops: Op[], program: number[]): string {
  return program.map(id => ops[id]?.name ?? `op(${id})`).join(" → ");
}
