import { z } from "zod";

const obj = z.record(z.string(), z.unknown());

export const forkSchema = z
  .object({
    parent_branch_id: z.string().min(1),
    fork_lamport_tick: z.number().int().min(1),
    locked_prng_seed: z.union([
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^\d{1,18}$/),
    ]),
    edited_prompt: z.string().optional(),
    edited_state: obj.optional(),
  })
  .refine((b) => b.edited_prompt !== undefined || b.edited_state !== undefined, {
    message: "a fork needs edited_prompt or edited_state",
  });

export type ForkInput = z.infer<typeof forkSchema>;
