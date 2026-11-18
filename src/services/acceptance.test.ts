import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db.js";
import { sha256Hex } from "../canonical.js";
import { commitStep } from "./commitStep.js";
import { forkBranch, ForkError } from "./forkBranch.js";

const run = Date.now();
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

const agent = await prisma.agent.create({ data: { modelName: "test" } });
after(() => prisma.$disconnect());

test("identical state committed twice -> one snapshot row", async () => {
  const br = await prisma.branch.create({ data: { name: "t-dup", lockedPrngSeed: 1n } });
  const a = await commitStep(step(br.branchId, agent.agentId, 0, { dup: run }));
  const b = await commitStep(step(br.branchId, agent.agentId, 1, { dup: run }));
  assert.equal(a.state_hash, b.state_hash);
  assert.equal(await prisma.stateSnapshot.count({ where: { stateHash: a.state_hash } }), 1);
});

test("fork at step 19 of 20 copies 19 pointers and adds no snapshot/node rows", async () => {
  const main = await prisma.branch.create({ data: { name: "t-main", lockedPrngSeed: 1n } });
  for (let t = 0; t < 20; t++) await commitStep(step(main.branchId, agent.agentId, t, { run, t }));

  const snaps = await prisma.stateSnapshot.count();
  const nodes = await prisma.executionNode.count();
  const r = await forkBranch({
    parent_branch_id: main.branchId, fork_lamport_tick: 19, locked_prng_seed: 1, edited_prompt: "x",
  });

  assert.equal(r.cached_steps_copied, 19);
  assert.equal(r.replay_token_cost, 0);
  assert.equal(await prisma.branchStepMap.count({ where: { branchId: r.new_branch_id, isCachedCow: true } }), 19);
  assert.equal(await prisma.stateSnapshot.count(), snaps);
  assert.equal(await prisma.executionNode.count(), nodes);
});

test("failed fork leaves no partial rows", async () => {
  const empty = await prisma.branch.create({ data: { name: "t-empty", lockedPrngSeed: 1n } });
  const branches = await prisma.branch.count();
  const map = await prisma.branchStepMap.count();
  await assert.rejects(
    forkBranch({ parent_branch_id: empty.branchId, fork_lamport_tick: 5, locked_prng_seed: 1, edited_prompt: "x" }),
    (e) => e instanceof ForkError && e.code === "nothing_to_fork",
  );
  assert.equal(await prisma.branch.count(), branches);
  assert.equal(await prisma.branchStepMap.count(), map);
});

test("failed commit (unknown agent) leaves no snapshot", async () => {
  const br = await prisma.branch.create({ data: { name: "t-orphan", lockedPrngSeed: 1n } });
  const state = { orphan: run };
  await assert.rejects(commitStep(step(br.branchId, "no-such-agent", 0, state)));
  assert.equal(await prisma.stateSnapshot.count({ where: { stateHash: sha256Hex(state) } }), 0);
});

test("duplicate tick on a branch is rejected and rolled back", async () => {
  const br = await prisma.branch.create({ data: { name: "t-tick", lockedPrngSeed: 1n } });
  await commitStep(step(br.branchId, agent.agentId, 1, { tick: run }));
  const second = { tick: run, other: true };
  await assert.rejects(
    commitStep(step(br.branchId, agent.agentId, 1, second)),
    (e: any) => e.code === "P2002",
  );
  assert.equal(await prisma.stateSnapshot.count({ where: { stateHash: sha256Hex(second) } }), 0);
  assert.equal(await prisma.branchStepMap.count({ where: { branchId: br.branchId } }), 1);
});
