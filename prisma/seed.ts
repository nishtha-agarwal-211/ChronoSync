import { prisma } from "../src/db.js";
import { commitStep } from "../src/services/commitStep.js";

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
console.log("seeded branch", main.branchId);
await prisma.$disconnect();
