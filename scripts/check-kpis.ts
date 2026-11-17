import { prisma } from "../src/db.js";
import { sha256Hex } from "../src/canonical.js";
import { commitStep } from "../src/services/commitStep.js";
import { forkBranch, ForkError } from "../src/services/forkBranch.js";

const run = Date.now();
const pass = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) process.exitCode = 1;
};
const step = (branch_id: string, agent_id: string, tick: number, state: Record<string, unknown>) => ({
  branch_id,
  lamport_tick: tick,
  agent_id,
  prompt_input: "p",
  llm_output: "o",
  token_cost: 0.001,
  state_blob: state,
  embedding: Array.from({ length: 1536 }, (_, j) => Math.sin(tick * 31 + j)),
  io_logs: [],
  ast_metrics: { net_loc_delta: 0, dead_ast_nodes: 0, files_created_delta: 0, gate_passed: true },
});

const agent = await prisma.agent.create({ data: { modelName: "kpi" } });

// 3.4 (1): identical state twice -> one snapshot row
const dup = await prisma.branch.create({ data: { name: "kpi-dup", lockedPrngSeed: 1n } });
const a = await commitStep(step(dup.branchId, agent.agentId, 0, { dup: run }));
const b = await commitStep(step(dup.branchId, agent.agentId, 1, { dup: run }));
pass(
  "identical state twice -> 1 snapshot row",
  a.state_hash === b.state_hash &&
    (await prisma.stateSnapshot.count({ where: { stateHash: a.state_hash } })) === 1,
);

// 3.4 (3) + D: fork at step 19 of 20
const main = await prisma.branch.create({ data: { name: "kpi-main", lockedPrngSeed: 1n } });
for (let t = 0; t < 20; t++) await commitStep(step(main.branchId, agent.agentId, t, { run, t }));

const forkInput = {
  parent_branch_id: main.branchId,
  fork_lamport_tick: 19,
  locked_prng_seed: 1,
  edited_prompt: "try again",
};
await forkBranch(forkInput); // warm-up (connection + plan cache)

const snapsBefore = await prisma.stateSnapshot.count();
const nodesBefore = await prisma.executionNode.count();
const times: number[] = [];
let last!: Awaited<ReturnType<typeof forkBranch>>;
for (let i = 0; i < 20; i++) {
  const t0 = performance.now();
  last = await forkBranch(forkInput);
  times.push(performance.now() - t0);
}
times.sort((x, y) => x - y);
const median = times[10]!;
pass("fork @19 median < 10ms", median < 10, `median ${median.toFixed(1)}ms, max ${times[19]!.toFixed(1)}ms`);
pass("19 pointers copied", last.cached_steps_copied === 19);
pass(
  "all copied rows are is_cached_cow",
  (await prisma.branchStepMap.count({ where: { branchId: last.new_branch_id, isCachedCow: true } })) === 19,
);
pass(
  "fork adds zero snapshot/node rows",
  (await prisma.stateSnapshot.count()) === snapsBefore &&
    (await prisma.executionNode.count()) === nodesBefore,
);

// 3.4 (2): failed fork leaves nothing behind
const empty = await prisma.branch.create({ data: { name: "kpi-empty", lockedPrngSeed: 1n } });
const branchesBefore = await prisma.branch.count();
const mapBefore = await prisma.branchStepMap.count();
let err: unknown;
try {
  await forkBranch({ ...forkInput, parent_branch_id: empty.branchId, fork_lamport_tick: 5 });
} catch (e) {
  err = e;
}
pass("failed fork -> nothing_to_fork", err instanceof ForkError && err.code === "nothing_to_fork");
pass(
  "failed fork leaves no partial rows",
  (await prisma.branch.count()) === branchesBefore &&
    (await prisma.branchStepMap.count()) === mapBefore,
);

// commit rollback: bad agent must not leave the snapshot behind
const orphan = { orphan: run };
try {
  await commitStep(step(main.branchId, "no-such-agent", 50, orphan));
} catch {}
pass(
  "failed commit leaves no snapshot",
  (await prisma.stateSnapshot.count({ where: { stateHash: sha256Hex(orphan) } })) === 0,
);

// Week 5: ~1 MB payload
const big = {
  run,
  items: Array.from({ length: 12_000 }, (_, i) => ({ i, s: `${i}-${"abcdefghij".repeat(7)}` })),
};
const bytes = JSON.stringify(big).length;
const t0 = performance.now();
const r = await commitStep(step(main.branchId, agent.agentId, 60, big));
console.log(`INFO  1MB commit: ${bytes} bytes in ${(performance.now() - t0).toFixed(0)}ms`);
const stored = await prisma.stateSnapshot.findUnique({ where: { stateHash: r.state_hash } });
pass("1MB blob round-trips", sha256Hex(stored!.memoryBlobJson) === r.state_hash);

await prisma.$disconnect();
