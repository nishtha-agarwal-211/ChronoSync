-- DropIndex
DROP INDEX "state_snapshots_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "edited_prompt" TEXT,
ADD COLUMN     "edited_state" JSONB;
