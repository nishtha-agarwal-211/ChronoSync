import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { forkSchema } from "../schemas/fork.js";
import { ForkError, forkBranch } from "../services/forkBranch.js";

export const forkRouter = Router();

forkRouter.post("/branches/fork", async (req, res) => {
  const parsed = forkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }
  try {
    res.status(201).json(await forkBranch(parsed.data));
  } catch (e) {
    if (e instanceof ForkError) {
      res.status(e.status).json({ error: e.code });
      return;
    }
    throw e;
  }
});

// Python StateLoader.load_state(branch_id, tick)
forkRouter.get("/branches/:branchId/state/:tick", async (req, res) => {
  const row = await prisma.branchStepMap.findUnique({
    where: {
      branchId_lamportTick: {
        branchId: req.params.branchId,
        lamportTick: Number(req.params.tick),
      },
    },
    include: { node: { include: { snapshot: true } } },
  });
  if (!row) {
    res.status(404).json({ error: "no_step_at_tick" });
    return;
  }
  res.json(row.node.snapshot.memoryBlobJson);
});

// Bootstrap so the interceptor has real IDs to commit against
forkRouter.post("/agents", async (req, res) => {
  const { model_name, temperature = 0 } = req.body ?? {};
  if (typeof model_name !== "string") {
    res.status(400).json({ error: "model_name_required" });
    return;
  }
  const a = await prisma.agent.create({ data: { modelName: model_name, temperature } });
  res.status(201).json({ agent_id: a.agentId });
});

forkRouter.post("/branches", async (req, res) => {
  const { name, locked_prng_seed = 0 } = req.body ?? {};
  const b = await prisma.branch.create({
    data: { name: name ?? "main", lockedPrngSeed: BigInt(locked_prng_seed) },
  });
  res.status(201).json({ branch_id: b.branchId });
});
