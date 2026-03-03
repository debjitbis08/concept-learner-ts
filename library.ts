import { Slot, Program, Op, isParametrized } from "./types";
import { programToString } from "./ops";

// ─── Library ──────────────────────────────────────────────────────────────────

export class Library {
  private slots: Map<number, Slot> = new Map();
  private nextId: number = 0;

  // Install a new slot, returns its id
  install(program: Program, label?: string, groundIds?: number[]): number {
    // Check for duplicates
    for (const [, slot] of this.slots) {
      if (programsEqual(slot.program, program)) {
        return slot.id; // already exists
      }
    }

    const id = this.nextId++;
    this.slots.set(id, {
      id,
      program,
      isParametrized: isParametrized(program),
      groundIds,
      confidence: 0.5, // start uncertain
      testCount: 0,
      falsificationCount: 0,
      version: 0,
      label,
    });
    return id;
  }

  get(id: number): Slot | undefined {
    return this.slots.get(id);
  }

  remove(id: number): void {
    this.slots.delete(id);
  }

  all(): Slot[] {
    return Array.from(this.slots.values());
  }

  // Update confidence after a play-mode test
  updateConfidence(id: number, correct: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.testCount++;
    if (!correct) slot.falsificationCount++;

    // Bayesian-ish update: confidence = successes / tests
    // with a weak prior toward 0.5
    const successes = slot.testCount - slot.falsificationCount;
    slot.confidence = (successes + 1) / (slot.testCount + 2); // Laplace smoothing
    slot.version++;
  }

  // Slots sorted by confidence ascending — least confident first (priority for play)
  byConfidenceAsc(): Slot[] {
    return this.all().sort((a, b) => a.confidence - b.confidence);
  }

  // Prune slots with confidence below threshold after enough tests
  prune(minTests: number = 5, threshold: number = 0.3): number[] {
    const pruned: number[] = [];
    for (const [id, slot] of this.slots) {
      if (slot.testCount >= minTests && slot.confidence < threshold) {
        this.slots.delete(id);
        pruned.push(id);
      }
    }
    return pruned;
  }

  setLabel(id: number, label: string): void {
    const slot = this.slots.get(id);
    if (slot) slot.label = label;
  }

  print(ops: Op[]): void {
    if (this.slots.size === 0) {
      console.log("  (empty library)");
      return;
    }
    for (const slot of this.all()) {
      const prog = programToString(ops, slot.program);
      const label = slot.label ? ` [${slot.label}]` : "";
      const conf = (slot.confidence * 100).toFixed(0);
      const stability = slot.testCount > 0
        ? ` tested=${slot.testCount} falsified=${slot.falsificationCount}`
        : "";
      console.log(`  slot#${slot.id}${label}: ${prog}`);
      console.log(`    confidence=${conf}%${stability}`);
    }
  }
}

function programsEqual(a: Program, b: Program): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
