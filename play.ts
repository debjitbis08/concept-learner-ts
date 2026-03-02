import { Op } from "./types";
import { programToString } from "./ops";
import { Slot } from "./types";
import { Library } from "./library";
import { executeSlot } from "./executor";

// ─── Play config ──────────────────────────────────────────────────────────────

export interface PlayConfig {
  testsPerSlot?: number;   // how many inputs to test per slot (default 10)
  domain?: number[];       // input domain to test over
  rounds?: number;         // how many play rounds to run (default 1)
}

// ─── Hypothesis: what behavior do we *expect* from a slot? ────────────────────
//
// During play, we need to know what the "expected" output of a slot is for a
// given input. We infer this from the slot's existing test history:
//   - If the slot has been tested before, we use the majority vote as expected
//   - If not, we run the slot on the domain and observe what it does
//
// A slot is "interesting" if it produces true for some inputs and false for
// others — i.e., it's not trivially always-true or always-false.

export interface SlotBehavior {
  trueInputs: number[];    // inputs where slot returns true
  falseInputs: number[];   // inputs where slot returns false
  isInteresting: boolean;  // true if both sets are non-empty
  pattern?: string;        // inferred label if pattern is clear
}

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

  // Try to infer what concept this slot might represent
  const pattern = inferPattern(trueInputs, domain);

  return { trueInputs, falseInputs, isInteresting, pattern };
}

// ─── Pattern inference: can we name what this slot does? ──────────────────────
//
// Check if the set of true inputs matches a known pattern

function inferPattern(trueInputs: number[], domain: number[]): string | undefined {
  if (trueInputs.length === 0) return "always_false";

  const all = new Set(domain);
  const trueSet = new Set(trueInputs);

  // Even numbers
  const evens = domain.filter(n => n % 2 === 0);
  if (setsEqual(trueSet, new Set(evens))) return "even";

  // Odd numbers
  const odds = domain.filter(n => n % 2 !== 0);
  if (setsEqual(trueSet, new Set(odds))) return "odd";

  // Single value
  if (trueInputs.length === 1) return `equals_${trueInputs[0]}`;

  // Consecutive successor pattern: true for {n: n+1 is in domain}
  // i.e. slot computes "has a successor in domain"
  const hasSuccessor = domain.filter(n => domain.includes(n + 1));
  if (setsEqual(trueSet, new Set(hasSuccessor))) return "has_successor";

  // Predecessor pattern
  const hasPredecessor = domain.filter(n => domain.includes(n - 1));
  if (setsEqual(trueSet, new Set(hasPredecessor))) return "has_predecessor";

  // Greater than threshold
  for (const thresh of domain) {
    const gt = domain.filter(n => n > thresh);
    if (setsEqual(trueSet, new Set(gt))) return `greater_than_${thresh}`;
  }

  return undefined;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ─── Play mode: test slots, update confidence, discover patterns ───────────────

export interface PlayResult {
  slotsTested: number;
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
  const testsPerSlot = config.testsPerSlot ?? domain.length;
  const rounds = config.rounds ?? 1;

  const patternsDiscovered: string[] = [];
  const behaviors = new Map<number, SlotBehavior>();

  for (let round = 0; round < rounds; round++) {
    if (verbose && rounds > 1) {
      console.log(`  Play round ${round + 1}/${rounds}`);
    }

    // Prioritize least-confident slots
    const slots = library.byConfidenceAsc();

    if (slots.length === 0) {
      if (verbose) console.log("  No slots to test.");
      break;
    }

    for (const slot of slots) {
      // Observe what this slot actually does across the domain
      const behavior = observeBehavior(ops, slot, domain);
      behaviors.set(slot.id, behavior);

      if (verbose) {
        const prog = programToString(ops, slot.program);
        console.log(`\n  Testing slot#${slot.id}: ${prog}`);
        console.log(`    true on:  [${behavior.trueInputs.join(", ")}]`);
        console.log(`    false on: [${behavior.falseInputs.join(", ")}]`);
        console.log(`    interesting: ${behavior.isInteresting}`);
        if (behavior.pattern) {
          console.log(`    pattern: ${behavior.pattern}`);
        }
      }

      if (!behavior.isInteresting) {
        // Trivial slot: always true or always false — low confidence
        for (let i = 0; i < testsPerSlot; i++) {
          library.updateConfidence(slot.id, false);
        }
        if (verbose) console.log(`    → trivial, penalizing confidence`);
        continue;
      }

      // Test the slot: run on random inputs and check for consistency
      // A "consistent" slot should produce the same pattern every time it runs
      // (our ops are deterministic, so this is really checking for instability
      // introduced by any future stochastic elements)
      let correct = 0;
      const testInputs = selectTestInputs(domain, testsPerSlot);

      for (const input of testInputs) {
        try {
          const { result } = executeSlot(ops, slot.program, input);
          // "Correct" means consistent with observed behavior
          const expected = behavior.trueInputs.includes(input);
          if (result === expected) correct++;
          library.updateConfidence(slot.id, result === expected);
        } catch {
          library.updateConfidence(slot.id, false);
        }
      }

      // If a pattern was inferred, label the slot
      if (behavior.pattern && !slot.label) {
        library.setLabel(slot.id, behavior.pattern);
        if (!patternsDiscovered.includes(behavior.pattern)) {
          patternsDiscovered.push(behavior.pattern);
          if (verbose) {
            console.log(`    ✓ DISCOVERED pattern: "${behavior.pattern}"`);
          }
        }
      }
    }
  }

  return {
    slotsTested: library.all().length,
    patternsDiscovered,
    behaviors
  };
}

// ─── Select test inputs with some coverage strategy ───────────────────────────
// Ensure we test both boundary and middle values

function selectTestInputs(domain: number[], n: number): number[] {
  if (n >= domain.length) return [...domain];

  // Always include first, last, and random middle
  const result = new Set<number>();
  result.add(domain[0]);
  result.add(domain[domain.length - 1]);

  while (result.size < n) {
    const idx = Math.floor(Math.random() * domain.length);
    result.add(domain[idx]);
  }

  return Array.from(result);
}
