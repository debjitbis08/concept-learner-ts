// ─── Core State ───────────────────────────────────────────────────────────────

export interface State {
  val: number;     // current numeric value being reasoned about
  boolean: boolean; // current hypothesis evaluation
}

// ─── Ops ──────────────────────────────────────────────────────────────────────

export type OpKind =
  | { kind: "reset"; n: number }       // val = n
  | { kind: "add"; k: number }         // val += k
  | { kind: "compare_eq" }             // boolean = (val === 0)
  | { kind: "compare_gt" }             // boolean = (val > 0)
  | { kind: "compare_lt" };            // boolean = (val < 0)

export interface Op {
  id: number;
  name: string;
  spec: OpKind;
}


// ─── Program ──────────────────────────────────────────────────────────────────

// A program is just a sequence of op ids
export type Program = number[];

// A trace is a program paired with the states it produced
export interface Trace {
  program: Program;
  states: State[];   // one per step, including initial
  finalState: State;
}

// ─── Slot Library ─────────────────────────────────────────────────────────────

export interface Slot {
  id: number;
  program: Program;        // sequence of op ids
  confidence: number;      // 0..1, updated during play
  testCount: number;       // how many play-mode tests run
  falsificationCount: number; // how many times output was unexpected
  version: number;
  label?: string;          // optional human-readable name, discovered during play
}

// ─── Relations (for wake mode) ────────────────────────────────────────────────

export type RelationKind = "successor" | "predecessor" | "parity";

export interface Episode {
  relation: RelationKind;
  a: number;               // primary input
  b?: number;              // secondary input (for binary relations)
  expected: boolean;       // ground truth
}
