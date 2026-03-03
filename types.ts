// ─── Core State ───────────────────────────────────────────────────────────────

export interface State {
  val: number;
  boolean: boolean;
}

// ─── Ops ──────────────────────────────────────────────────────────────────────

export type OpKind =
  | { kind: "reset"; n: number }
  | { kind: "add"; k: number }
  | { kind: "compare_eq" }
  | { kind: "compare_gt" }
  | { kind: "compare_lt" };

export interface Op {
  id: number;
  name: string;
  spec: OpKind;
}

// ─── Program ──────────────────────────────────────────────────────────────────

// A step is either a single op or a parametrized repeat.
// k="free" means: at inference time try k=0,1,2,... until the
// terminal compare op returns true, or maxK exhausted → false.
export type ProgramStep =
  | { kind: "op"; id: number }
  | { kind: "repeat"; opId: number; k: number | "free" };

export type Program = ProgramStep[];

// FlatProgram: raw op-id sequence produced by search before generalization
export type FlatProgram = number[];

export function liftProgram(flat: FlatProgram): Program {
  return flat.map(id => ({ kind: "op" as const, id }));
}

export function flattenProgram(program: Program): FlatProgram {
  const out: FlatProgram = [];
  for (const step of program) {
    if (step.kind === "op") {
      out.push(step.id);
    } else if (step.kind === "repeat" && typeof step.k === "number") {
      for (let i = 0; i < step.k; i++) out.push(step.opId);
    }
  }
  return out;
}

export function isParametrized(program: Program): boolean {
  return program.some(s => s.kind === "repeat" && s.k === "free");
}

// ─── Trace ────────────────────────────────────────────────────────────────────

export interface Trace {
  program: FlatProgram;   // always flat; traces come from ground execution
  states: State[];
  finalState: State;
}

// ─── Slot ─────────────────────────────────────────────────────────────────────

export interface Slot {
  id: number;
  program: Program;
  isParametrized: boolean;
  groundIds?: number[];     // ground slot ids this subsumes (if parametrized)
  confidence: number;
  testCount: number;
  falsificationCount: number;
  version: number;
  label?: string;
}

// ─── Relations ────────────────────────────────────────────────────────────────

export type RelationKind = "successor" | "predecessor" | "parity";

export interface Episode {
  relation: RelationKind;
  a: number;
  b?: number;
  expected: boolean;
  // Initial val fed to the program. Unary: a. Binary: a - b (encodes the gap).
  // Programs are then evaluated uniformly — no binary/unary distinction at runtime.
  initialVal: number;
}
