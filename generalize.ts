import { Op, Program, ProgramStep, FlatProgram, Slot, isParametrized } from "./types";

// ─── Shape extraction ──────────────────────────────────────────────────────────

export function extractShape(flat: FlatProgram): Program {
  if (flat.length === 0) return [];
  const result: Program = [];
  let i = 0;
  while (i < flat.length) {
    const id = flat[i];
    let run = 1;
    while (i + run < flat.length && flat[i + run] === id) run++;
    if (run > 1) {
      result.push({ kind: "repeat", opId: id, k: run });
    } else {
      result.push({ kind: "op", id });
    }
    i += run;
  }
  return result;
}

// ─── Abstract shape ────────────────────────────────────────────────────────────

export function abstractShape(program: Program): Program {
  return program.map(step =>
    step.kind === "repeat"
      ? { kind: "repeat" as const, opId: step.opId, k: "free" as const }
      : step
  );
}

export function shapeKey(program: Program): string {
  return abstractShape(program)
    .map(s => s.kind === "op" ? `op(${s.id})` : `repeat(${s.opId},?)`)
    .join("|");
}

// ─── Group ground slots by abstract shape ─────────────────────────────────────

export function groupByShape(slots: Slot[]): Map<string, Slot[]> {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    if (slot.isParametrized) continue;
    const key = shapeKey(slot.program);
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }
  return groups;
}

// ─── MDL scoring ──────────────────────────────────────────────────────────────

function programLength(program: Program): number {
  let len = 0;
  for (const step of program) {
    len += step.kind === "op" ? 1 : (typeof step.k === "number" ? step.k : 1);
  }
  return len;
}

export interface GeneralizedSlot {
  program: Program;
  groundIds: number[];
  mdlGain: number;
}

export function generalizeGroup(slots: Slot[]): GeneralizedSlot | null {
  if (slots.length < 2) return null;

  const abstractProg = abstractShape(slots[0].program);
  if (!abstractProg.some(s => s.kind === "repeat")) return null;

  const groundCost = slots.reduce((sum, s) => sum + programLength(s.program), 0);
  const freeVars = abstractProg.filter(s => s.kind === "repeat" && s.k === "free").length;
  const paramCost = programLength(abstractProg) + freeVars;
  const gain = groundCost - paramCost;

  if (gain <= 0) return null;

  return { program: abstractProg, groundIds: slots.map(s => s.id), mdlGain: gain };
}

// ─── Pretty-print a Program (no dependency on ops.ts) ─────────────────────────

export function programStepsToString(ops: Op[], program: Program): string {
  return program.map(step => {
    if (step.kind === "op") return ops[step.id]?.name ?? `op(${step.id})`;
    const opName = ops[step.opId]?.name ?? `op(${step.opId})`;
    return `repeat(${opName}, ${step.k === "free" ? "?" : step.k})`;
  }).join(" → ");
}
