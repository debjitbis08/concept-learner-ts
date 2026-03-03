import { Op, Episode } from "./types";
import { Slot } from "./types";
import { Library } from "./library";
import { executeSlot } from "./executor";
import { programToString } from "./ops";

export interface PlayConfig {
  domain?: number[];
  rounds?: number;
}

export interface SlotBehavior {
  trueInputs: number[];
  falseInputs: number[];
  isInteresting: boolean;
  pattern?: string;
}

// ─── PLAY: discovery — no right answers, just observation ─────────────────────
//
// The model runs each slot freely across the domain, notices what it does,
// and names the pattern if it recognizes one. This is self-directed exploration.
// Confidence is NOT updated here — that belongs to test mode.

export function observeBehavior(
  ops: Op[],
  slot: Slot,
  domain: number[]
): SlotBehavior {
  const trueInputs: number[] = [];
  const falseInputs: number[] = [];

  for (const input of domain) {
    try {
      const { result } = executeSlot(ops, slot.program, input);
      if (result) trueInputs.push(input);
      else falseInputs.push(input);
    } catch {
      falseInputs.push(input);
    }
  }

  const isInteresting = trueInputs.length > 0 && falseInputs.length > 0;
  const pattern = inferPattern(trueInputs, domain);
  return { trueInputs, falseInputs, isInteresting, pattern };
}

function inferPattern(trueInputs: number[], domain: number[]): string | undefined {
  if (trueInputs.length === 0) return "always_false";
  if (trueInputs.length === domain.length) return "always_true";

  const trueSet = new Set(trueInputs);

  const evens = domain.filter(n => n % 2 === 0);
  if (setsEqual(trueSet, new Set(evens))) return "even";

  const odds = domain.filter(n => n % 2 !== 0);
  if (setsEqual(trueSet, new Set(odds))) return "odd";

  if (trueInputs.length === 1) return `equals_${trueInputs[0]}`;

  for (const thresh of domain) {
    if (setsEqual(trueSet, new Set(domain.filter(n => n > thresh)))) {
      return `greater_than_${thresh}`;
    }
  }

  if (setsEqual(trueSet, new Set(domain.filter(n => domain.includes(n + 1))))) {
    return "has_successor";
  }

  if (setsEqual(trueSet, new Set(domain.filter(n => domain.includes(n - 1))))) {
    return "has_predecessor";
  }

  return undefined;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export interface PlayResult {
  patternsDiscovered: string[];
  behaviors: Map<number, SlotBehavior>;
}

export function play(
  ops: Op[],
  library: Library,
  config: PlayConfig = {},
  verbose: boolean = false
): PlayResult {
  const domain = config.domain ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const rounds = config.rounds ?? 1;

  const patternsDiscovered: string[] = [];
  const behaviors = new Map<number, SlotBehavior>();

  for (let round = 0; round < rounds; round++) {
    if (verbose && rounds > 1) console.log(`  Play round ${round + 1}/${rounds}`);

    for (const slot of library.all()) {
      const behavior = observeBehavior(ops, slot, domain);
      behaviors.set(slot.id, behavior);

      if (verbose) {
        const type = slot.isParametrized ? " ◆" : "";
        const prog = programToString(ops, slot.program);
        console.log(`\n  Exploring slot#${slot.id}${type}: ${prog}`);
        console.log(`    true on:  [${behavior.trueInputs.join(", ")}]`);
        console.log(`    false on: [${behavior.falseInputs.join(", ")}]`);
        if (behavior.pattern) console.log(`    pattern:  ${behavior.pattern}`);
      }

      if (behavior.pattern && !slot.label) {
        library.setLabel(slot.id, behavior.pattern);
        if (!patternsDiscovered.includes(behavior.pattern)) {
          patternsDiscovered.push(behavior.pattern);
          if (verbose) console.log(`    ✓ DISCOVERED: "${behavior.pattern}"`);
        }
      }
    }
  }

  return { patternsDiscovered, behaviors };
}

// ─── TEST: evaluation — apply learned concepts to known episodes ───────────────
//
// Each episode supplies its own initialVal. The model runs every slot on that
// context and checks if the answer is correct. Confidence is updated here.
// Over time, slots that consistently predict correctly gain high confidence.

export interface TestResult {
  accuracyBySlot: Map<number, number>;
  accuracyByRelation: Record<string, number>;
}

export function test(
  ops: Op[],
  library: Library,
  episodes: Episode[],
  verbose: boolean = false
): TestResult {
  if (episodes.length === 0) {
    return { accuracyBySlot: new Map(), accuracyByRelation: {} };
  }

  const slotCorrect = new Map<number, number>();
  const slotTotal   = new Map<number, number>();
  // slotRelCorrect: slotId → relation → correct count
  const slotRelCorrect = new Map<number, Map<string, number>>();
  const slotRelTotal   = new Map<number, Map<string, number>>();

  for (const slot of library.all()) {
    for (const ep of episodes) {
      let result = false;
      try {
        result = executeSlot(ops, slot.program, ep.initialVal).result;
      } catch { /* false */ }

      const hit = result === ep.expected;
      library.updateConfidence(slot.id, hit);

      slotCorrect.set(slot.id, (slotCorrect.get(slot.id) ?? 0) + (hit ? 1 : 0));
      slotTotal.set(slot.id,   (slotTotal.get(slot.id)   ?? 0) + 1);

      if (!slotRelCorrect.has(slot.id)) slotRelCorrect.set(slot.id, new Map());
      if (!slotRelTotal.has(slot.id))   slotRelTotal.set(slot.id, new Map());
      const rc = slotRelCorrect.get(slot.id)!;
      const rt = slotRelTotal.get(slot.id)!;
      rc.set(ep.relation, (rc.get(ep.relation) ?? 0) + (hit ? 1 : 0));
      rt.set(ep.relation, (rt.get(ep.relation) ?? 0) + 1);
    }
  }

  const accuracyBySlot = new Map<number, number>();
  for (const [id, total] of slotTotal) {
    accuracyBySlot.set(id, (slotCorrect.get(id) ?? 0) / total);
  }

  // Derive per-relation accuracy from per-slot-relation data
  const relCorrectAgg = new Map<string, number>();
  const relTotalAgg   = new Map<string, number>();
  for (const ep of episodes) {
    relTotalAgg.set(ep.relation, (relTotalAgg.get(ep.relation) ?? 0) + library.all().length);
  }
  for (const [, rc] of slotRelCorrect) {
    for (const [rel, c] of rc) {
      relCorrectAgg.set(rel, (relCorrectAgg.get(rel) ?? 0) + c);
    }
  }
  const accuracyByRelation: Record<string, number> = {};
  for (const [rel, total] of relTotalAgg) {
    accuracyByRelation[rel] = (relCorrectAgg.get(rel) ?? 0) / total;
  }

  if (verbose) {
    // What was tested
    const relCounts = new Map<string, number>();
    for (const ep of episodes) relCounts.set(ep.relation, (relCounts.get(ep.relation) ?? 0) + 1);
    console.log(`\n  Tested ${episodes.length} episodes:`);
    for (const [rel, n] of relCounts) console.log(`    ${rel}: ${n} episodes`);

    // Per-slot scores broken down by relation
    console.log("\n  Score by slot:");
    for (const slot of library.all()) {
      const label = slot.label ? ` [${slot.label}]` : "";
      const prog = programToString(ops, slot.program);
      const rc = slotRelCorrect.get(slot.id)!;
      const rt = slotRelTotal.get(slot.id)!;
      const breakdown = Array.from(rt.keys())
        .map(rel => {
          const c = rc.get(rel) ?? 0;
          const t = rt.get(rel) ?? 0;
          return `${rel}: ${c}/${t}`;
        })
        .join("  ");
      console.log(`    slot#${slot.id}${label}: ${breakdown} — ${prog}`);
    }
  }

  return { accuracyBySlot, accuracyByRelation };
}
