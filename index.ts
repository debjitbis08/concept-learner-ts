import { buildOps, programToString } from "./ops";
import { Library } from "./library";
import { generateEpisodes, wake } from "./wake";
import { sleep } from "./sleep";
import { play, test } from "./play";

// ─── Main ──────────────────────────────────────────────────────────────────────

function separator(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

async function main() {
  const domain = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ops = buildOps(domain);
  const library = new Library();

  console.log("Concept Learner — Minimal Prototype");
  console.log(`Domain: [${domain.join(", ")}]`);
  console.log(`Primitives: ${ops.map(o => o.name).join(", ")}`);

  // ─── PHASE 1: Successor / Predecessor ───────────────────────────────────────

  separator("PHASE 1: Successor & Predecessor");

  separator("WAKE — Successor");
  const succEpisodes = generateEpisodes("successor", domain);
  const succSample = succEpisodes.filter(e => e.a <= 5 && (e.b ?? 0) <= 6);
  console.log(`Generated ${succSample.length} successor episodes`);
  const succWake = wake(ops, succSample, 4, true);
  console.log(`\nSolved ${succWake.solved}/${succWake.total} episodes`);

  separator("WAKE — Predecessor");
  const predEpisodes = generateEpisodes("predecessor", domain);
  const predSample = predEpisodes.filter(e => e.a >= 1 && e.a <= 6 && (e.b ?? 0) <= 5);
  console.log(`Generated ${predSample.length} predecessor episodes`);
  const predWake = wake(ops, predSample, 4, true);
  console.log(`\nSolved ${predWake.solved}/${predWake.total} episodes`);

  const phase1Traces = [...succWake.traces, ...predWake.traces];
  console.log(`\nTotal traces collected: ${phase1Traces.length}`);

  separator("SLEEP — Mining abstractions from succ/pred traces");
  const phase1Sleep = sleep(ops, phase1Traces, library, {
    minSupport: 2,
    maxLen: 4,
    topM: 8,
    mdlAlpha: 1.0,
  }, true);
  console.log(`\nInstalled ${phase1Sleep.installed.length} slots`);

  // Play: self-directed exploration — discover what each slot does on [0..9]
  separator("PLAY — Exploring slot behaviors");
  const phase1Play = play(ops, library, { domain, rounds: 2 }, true);
  console.log(`\nPatterns discovered: ${phase1Play.patternsDiscovered.join(", ") || "(none yet)"}`);

  // Test: evaluate slots against the known successor/predecessor episodes
  separator("TEST — Evaluating slots on succ/pred problems");
  test(ops, library, [...succSample, ...predSample], true);

  separator("Library after Phase 1");
  library.print(ops);

  // ─── PHASE 2: Parity ──────────────────────────────────────────────────────

  separator("PHASE 2: Parity");

  separator("WAKE — Parity (imitation traces)");
  const parityEpisodes = generateEpisodes("parity", domain);
  console.log(`Generated ${parityEpisodes.length} parity episodes`);
  const parityWake = wake(ops, parityEpisodes, 8, true);
  console.log(`\nSolved ${parityWake.solved}/${parityWake.total} parity episodes`);

  separator("SLEEP — Mining abstractions from parity traces");
  const allTraces = [...phase1Traces, ...parityWake.traces];
  const phase2Sleep = sleep(ops, allTraces, library, {
    minSupport: 2,
    maxLen: 6,
    topM: 8,
    mdlAlpha: 0.8,
  }, true);
  console.log(`\nInstalled ${phase2Sleep.installed.length} new slots`);

  // Play: discover patterns in new slots (unary concepts like even/odd)
  separator("PLAY — Exploring new slot behaviors");
  const phase2Play = play(ops, library, { domain, rounds: 2 }, true);
  console.log(`\nPatterns discovered: ${phase2Play.patternsDiscovered.join(", ") || "(none yet)"}`);

  // Test: evaluate all slots against the full episode bank
  separator("TEST — Evaluating slots on all problems");
  const allEpisodes = [...succSample, ...predSample, ...parityEpisodes];
  test(ops, library, allEpisodes, true);

  // ─── Final library ───────────────────────────────────────────────────────────

  separator("Final Library");
  library.print(ops);

  separator("Summary");
  const allSlots = library.all();
  const confident = allSlots.filter(s => s.confidence > 0.7);
  const labeled = allSlots.filter(s => s.label);

  console.log(`Total slots: ${allSlots.length}`);
  console.log(`High-confidence slots (>70%): ${confident.length}`);
  console.log(`Labeled slots: ${labeled.length}`);

  if (labeled.length > 0) {
    console.log("\nDiscovered concepts:");
    for (const slot of labeled) {
      const prog = programToString(ops, slot.program);
      console.log(`  "${slot.label}": ${prog} (confidence: ${(slot.confidence * 100).toFixed(0)}%)`);
    }
  }

  const paritySlot = allSlots.find(s => s.label === "even" || s.label === "odd");
  if (paritySlot) {
    console.log(`\n✓ PARITY DISCOVERED: slot#${paritySlot.id} labeled "${paritySlot.label}"`);
    console.log(`  Program: ${programToString(ops, paritySlot.program)}`);
    console.log(`  This was NOT explicitly taught — emerged from play mode.`);
  } else {
    console.log("\n✗ Parity not yet discovered as a named concept.");
  }
}

main().catch(console.error);
