import { Op } from "./types";
import { Trace, Program, FlatProgram, liftProgram } from "./types";
import { Library } from "./library";
import { programToString } from "./ops";
import {
  extractShape,
  groupByShape,
  generalizeGroup,
  programStepsToString,
} from "./generalize";

export interface SleepConfig {
  minSupport?: number;
  maxLen?: number;
  topM?: number;
  mdlAlpha?: number;
  mdlGainThreshold?: number;
}

type NGram = string;

function flatToNGrams(flat: FlatProgram, maxLen: number): Map<NGram, number> {
  const counts = new Map<NGram, number>();
  const n = flat.length;
  for (let len = 2; len <= Math.min(maxLen, n); len++) {
    for (let i = 0; i <= n - len; i++) {
      const gram = flat.slice(i, i + len).join(",");
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
}

function parseNGram(gram: NGram): FlatProgram {
  return gram.split(",").map(Number);
}

function mdlGain(count: number, length: number, alpha: number): number {
  return count * (length - 1) - (length + alpha);
}

function existingFingerprints(library: Library): Set<string> {
  const fps = new Set<string>();
  for (const slot of library.all()) {
    fps.add(JSON.stringify(slot.program));
  }
  return fps;
}

function inferLabel(ops: Op[], program: Program): string | undefined {
  const last = program[program.length - 1];
  if (!last || last.kind !== "op") return undefined;
  const spec = ops[last.id]?.spec;
  if (!spec) return undefined;
  if (spec.kind === "compare_eq") return "compare_eq_result";
  if (spec.kind === "compare_gt") return "compare_gt_result";
  if (spec.kind === "compare_lt") return "compare_lt_result";
  return undefined;
}

export interface SleepResult {
  installed: number[];
  generalized: number[];
}

export function sleep(
  ops: Op[],
  traces: Trace[],
  library: Library,
  config: SleepConfig = {},
  verbose: boolean = false
): SleepResult {
  const minSupport = config.minSupport ?? 2;
  const maxLen     = config.maxLen ?? 4;
  const topM       = config.topM ?? 8;
  const mdlAlpha   = config.mdlAlpha ?? 1.0;
  const mdlGainThreshold = config.mdlGainThreshold ?? 0.0;

  // ── 1. Count n-grams across all traces ──────────────────────────────────────
  const globalCounts = new Map<NGram, number>();
  for (const trace of traces) {
    for (const [gram, cnt] of flatToNGrams(trace.program, maxLen)) {
      globalCounts.set(gram, (globalCounts.get(gram) ?? 0) + cnt);
    }
  }

  // Gapped variants from length-3 patterns (drop middle)
  for (const [gram, cnt] of Array.from(globalCounts.entries())) {
    const flat = parseNGram(gram);
    if (flat.length === 3) {
      const variant = [flat[0], flat[2]].join(",");
      if (!globalCounts.has(variant)) {
        globalCounts.set(variant, cnt);
      }
    }
  }

  // ── 2. Score and filter ──────────────────────────────────────────────────────
  const existing = existingFingerprints(library);

  const scored: { program: Program; gain: number; count: number }[] = [];
  for (const [gram, count] of globalCounts) {
    if (count < minSupport) continue;
    const flat = parseNGram(gram);
    const length = flat.length;
    const gain = mdlGain(count, length, mdlAlpha);
    if (gain <= mdlGainThreshold) continue;

    // Lift flat → shaped Program
    const shaped = extractShape(flat);

    // A program must end with a compare op to produce a meaningful boolean
    const lastStep = shaped[shaped.length - 1];
    if (!lastStep || lastStep.kind !== "op") continue;
    const lastSpec = ops[lastStep.id]?.spec;
    if (!lastSpec) continue;
    if (lastSpec.kind !== "compare_eq" && lastSpec.kind !== "compare_gt" && lastSpec.kind !== "compare_lt") continue;

    const shapedKey = JSON.stringify(shaped);
    if (existing.has(shapedKey)) continue;

    scored.push({ program: shaped, gain, count });
  }

  scored.sort((a, b) => b.gain - a.gain || b.count - a.count);

  // ── 3. Install ground slots ──────────────────────────────────────────────────
  const installed: number[] = [];
  for (const { program } of scored.slice(0, topM)) {
    const label = inferLabel(ops, program);
    const id = library.install(program, label);
    installed.push(id);
    if (verbose) {
      console.log(`  → installed slot#${id}: ${programStepsToString(ops, program)}`);
    }
  }

  // ── 4. Generalize: group slots by abstract shape, replace ground families ───
  const generalized: number[] = [];
  const groups = groupByShape(library.all());

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const result = generalizeGroup(group);
    if (!result) continue;

    // Install parametrized slot
    const paramId = library.install(result.program, undefined, result.groundIds);
    generalized.push(paramId);

    // Remove subsumed ground slots
    for (const id of result.groundIds) {
      library.remove(id);
    }

    if (verbose) {
      console.log(`  ◆ generalized ${result.groundIds.length} slots → slot#${paramId}: ${programStepsToString(ops, result.program)} (MDL gain=${result.mdlGain.toFixed(1)})`);
    }
  }

  return { installed, generalized };
}
