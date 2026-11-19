import { prisma } from "../src/db.js";
import { commitStep } from "../src/services/commitStep.js";
import { forkBranch } from "../src/services/forkBranch.js";

const agent = await prisma.agent.create({ data: { modelName: "gpt-4o-mini" } });
const main = await prisma.branch.create({ data: { name: "main", lockedPrngSeed: 42n } });
const emb = (tick: number, salt = 0) =>
  Array.from({ length: 1536 }, (_, j) => Math.sin(tick * 31 + j + salt));

for (let tick = 1; tick <= 12; tick++) {
  const bad = tick === 8; // guardrail violation -> red node
  await commitStep({
    branch_id: main.branchId,
    lamport_tick: tick,
    agent_id: agent.agentId,
    prompt_input: `step ${tick} prompt`,
    llm_output: bad ? "AST guardrail failed: file delta exceeded safety threshold" : `step ${tick} output`,
    token_cost: 0.002 + tick * 0.0001,
    state_blob: { step: tick, memory: `after step ${tick}` },
    embedding: emb(tick),
    io_logs:
      tick % 3 === 0
        ? [{ io_seq_no: 0, kind: "http", req_payload: { url: "https://example.com" }, res_payload: { status: 200 } }]
        : [],
    ast_metrics: {
      net_loc_delta: 3,
      dead_ast_nodes: bad ? 2 : 0,
      files_created_delta: bad ? 1 : 0,
      max_allowed_files: 0,
      gate_passed: !bad,
    },
  });
}

const fork = await forkBranch({
  parent_branch_id: main.branchId,
  fork_lamport_tick: 6,
  locked_prng_seed: 42,
  new_branch_name: "fix-attempt",
  edited_prompt: "Refactor without creating new files",
});

for (let tick = 6; tick <= 9; tick++) {
  await commitStep({
    branch_id: fork.new_branch_id,
    lamport_tick: tick,
    agent_id: agent.agentId,
    prompt_input: `fork step ${tick} prompt`,
    llm_output: `fork step ${tick} output`,
    token_cost: 0.003,
    state_blob: { step: tick, memory: `fork after step ${tick}`, forked: true },
    embedding: emb(tick, 5),
    io_logs: [],
    ast_metrics: { net_loc_delta: 2, dead_ast_nodes: 0, files_created_delta: 0, max_allowed_files: 0, gate_passed: true },
  });
}

console.log("main:", main.branchId, "| fork:", fork.new_branch_id);
await prisma.$disconnect();
