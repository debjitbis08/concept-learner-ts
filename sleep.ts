import { Op } from "./types";
import { programToString } from "./ops";
import { Trace, Program } from "./types";
import { Library } from "./library";

// ─── Sleep config ──────────────────────────────────────────────────────────────

export interface SleepConfig {
  minSupport?: number;       // minimum occurrence count (default 2)
  maxLen?: number;           // max n-gram length (default 4)
  topM?: number;             // max candidates to install (default 8)
  mdlAlpha?: number;         // MDL complexity penalty (default 1.0)
  mdlGainThreshold?: number; // minimum MDL gain to accept (default 0.0)
}

// ─── N-gram counting ───────────────────────────────────────────────────────────

type NGram = string; // serialized as "id1,id2,..."

function programToNGrams(program: Program, maxLen: number): Map<NGram, number> {
  const counts = new Map<NGram, number>();
  const n = program.length;

  for (let len = 2; len <= Math.min(maxLen, n); len++) {
    for (let i = 0; i <= n - len; i++) {
      const gram = program.slice(i, i + len).join(",");
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }

  return counts;
}

function parseNGram(gram: NGram): Program {
  return gram.split(",").map(Number);
}

// ─── MDL scoring ──────────────────────────────────────────────────────────────
//
// gain = count * (length - 1) - (length + alpha)
//
// Intuition:
//   count * (length - 1) = total steps saved if we name this pattern
//   (length + alpha)      = cost of adding a new entry to the library

function mdlGain(count: number, length: number, alpha: number): number {
  return count * (length - 1) - (length + alpha);
}

// ─── Build existing slot fingerprints for deduplication ───────────────────────

function existingFingerprints(library: Library): Set<NGram> {
  const fingerprints = new Set<NGram>();
  for (const slot of library.all()) {
    fingerprints.add(slot.program.join(","));
  }
  return fingerprints;
}

// ─── Infer ret_policy from last op ────────────────────────────────────────────
// If the last op is a compare op, the boolean stream carries the result

function inferLabel(ops: Op[], program: Program): string | undefined {
  const lastOp = ops[program[program.length - 1]];
  if (!lastOp) return undefined;
  if (lastOp.spec.kind === "compare_eq") return "compare_eq_result";
  if (lastOp.spec.kind === "compare_gt") return "compare_gt_result";
  if (lastOp.spec.kind === "compare_lt") return "compare_lt_result";
  return undefined;
}

// ─── Gapped pattern generation ────────────────────────────────────────────────
// From a length-3 contiguous candidate, generate gapped variants by
// dropping each interior element. Adds coverage without PrefixSpan complexity.

function gappedVariants(program: Program): Program[] {
  if (program.length !== 3) return [];
  // Drop middle element only (first and last are anchors)
  return [[program[0], program[2]]];
}

// ─── Sleep: mine traces, score, install ───────────────────────────────────────

export interface SleepResult {
  installed: number[];
  candidates: { program: Program; gain: number; count: number }[];
}

export function sleep(
  ops: Op[],
  traces: Trace[],
  library: Library,
  config: SleepConfig = {},
  verbose: boolean = false
): SleepResult {
  const minSupport = config.minSupport ?? 2;
  const maxLen = config.maxLen ?? 4;
  const topM = config.topM ?? 8;
  const mdlAlpha = config.mdlAlpha ?? 1.0;
  const mdlGainThreshold = config.mdlGainThreshold ?? 0.0;

  // Count n-grams across all traces
  const globalCounts = new Map<NGram, number>();

  for (const trace of traces) {
    const localCounts = programToNGrams(trace.program, maxLen);
    for (const [gram, cnt] of localCounts) {
      globalCounts.set(gram, (globalCounts.get(gram) ?? 0) + cnt);
    }
  }

  // Add gapped variants for length-3 patterns
  const gappedCounts = new Map<NGram, number>();
  for (const [gram, cnt] of globalCounts) {
    const program = parseNGram(gram);
    if (program.length === 3) {
      for (const variant of gappedVariants(program)) {
        const vGram = variant.join(",");
        if (!globalCounts.has(vGram)) {
          gappedCounts.set(vGram, (gappedCounts.get(vGram) ?? 0) + cnt);
        }
      }
    }
  }

  // Merge gapped counts
  for (const [gram, cnt] of gappedCounts) {
    globalCounts.set(gram, (globalCounts.get(gram) ?? 0) + cnt);
  }

  // Get existing slot fingerprints for deduplication
  const existing = existingFingerprints(library);

  // Score candidates
  const scored: { program: Program; gain: number; count: number }[] = [];

  for (const [gram, count] of globalCounts) {
    if (count < minSupport) continue;

    const program = parseNGram(gram);
    const length = program.length;
    const gain = mdlGain(count, length, mdlAlpha);

    if (gain <= mdlGainThreshold) continue;
    if (existing.has(gram)) continue;

    scored.push({ program, gain, count });
  }

  // Sort by gain descending
  scored.sort((a, b) => b.gain - a.gain || b.count - a.count || b.program.length - a.program.length);

  // Install top-M
  const installed: number[] = [];
  const topCandidates = scored.slice(0, topM);

  for (const { program } of topCandidates) {
    const label = inferLabel(ops, program);
    const id = library.install(program, label);
    installed.push(id);

    if (verbose) {
      const prog = programToString(ops, program);
      console.log(`  → installed slot#${id}: ${prog}`);
    }
  }

  if (verbose && scored.length > topM) {
    console.log(`  (${scored.length - topM} additional candidates below topM threshold)`);
  }

  return { installed, candidates: topCandidates };
}
