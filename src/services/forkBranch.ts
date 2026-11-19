import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import type { ForkInput } from "../schemas/fork.js";

export class ForkError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function forkBranch(b: ForkInput) {
  return prisma.$transaction(async (tx) => {
    const parent = await tx.branch.findUnique({
      where: { branchId: b.parent_branch_id },
      select: { branchId: true },
    });
    if (!parent) throw new ForkError(404, "unknown_parent_branch");

    const maxTick = await tx.branchStepMap.findFirst({
      where: { branchId: parent.branchId },
      orderBy: { lamportTick: "desc" },
      select: { lamportTick: true },
    });
    if (maxTick && b.fork_lamport_tick > maxTick.lamportTick) {
      throw new ForkError(400, "fork_tick_beyond_parent");
    }

    const child = await tx.branch.create({
      data: {
        parentBranchId: parent.branchId,
        forkLamportTick: b.fork_lamport_tick,
        lockedPrngSeed: BigInt(b.locked_prng_seed),
        ...(b.edited_prompt !== undefined && { editedPrompt: b.edited_prompt }),
        ...(b.new_branch_name !== undefined && { name: b.new_branch_name }),
        ...(b.edited_state !== undefined && {
          editedState: b.edited_state as Prisma.InputJsonValue,
        }),
      },
    });

    // Pointer copy only: ticks < K. No snapshot/node rows are touched.
    const copied = await tx.$executeRaw`
      INSERT INTO "branch_step_map" ("branch_id", "lamport_tick", "node_id", "is_cached_cow")
      SELECT ${child.branchId}, "lamport_tick", "node_id", true
      FROM "branch_step_map"
      WHERE "branch_id" = ${parent.branchId} AND "lamport_tick" < ${b.fork_lamport_tick}`;

    if (copied === 0) throw new ForkError(422, "nothing_to_fork"); // rolls back the branch row too

    return {
      new_branch_id: child.branchId,
      cached_steps_copied: copied,
      replay_token_cost: 0.0,
    };
  });
}
