import type { EpisodeSource, MemoryType } from "../types/index.js";
import {
  decideMemoryDuplicate,
  type DuplicateCandidate,
  type DuplicateReason,
} from "./memory-deduplication.js";

export type MemoryMetadata = {
  readonly type?: MemoryType;
  readonly name?: string;
  readonly source?: EpisodeSource;
  readonly [key: string]: unknown;
};

type MemoryListResult = {
  readonly success: boolean;
  readonly memories?: readonly {
    readonly id: string;
    readonly summary: string;
  }[];
  readonly error?: string;
};

const DEDUP_LOOKUP_LIMIT = 100;

export type DedupLookupFailure = {
  readonly groupId: string;
  readonly error?: string;
};

export type MemoryCaptureObserver = {
  readonly onDedupLookupFailure?: (failure: DedupLookupFailure) => void;
};

export type DistinctMemoryInput = MemoryCaptureObserver & {
  readonly content: string;
  readonly groupId: string;
  readonly metadata: MemoryMetadata;
};

export type MemoryWriteOutcome =
  | { readonly kind: "saved" }
  | {
      readonly kind: "duplicate";
      readonly existingId: string;
      readonly reason: DuplicateReason;
    }
  | { readonly kind: "failed"; readonly error?: string };

export interface MemoryWriter {
  addMemory(
    content: string,
    groupId: string,
    metadata?: MemoryMetadata,
  ): Promise<{ readonly success: boolean; readonly error?: string }>;
}

export interface MemoryStore extends MemoryWriter {
  listMemories(groupId: string, limit?: number): Promise<MemoryListResult>;
}

export async function persistDistinctMemory(
  store: MemoryStore,
  input: DistinctMemoryInput,
): Promise<MemoryWriteOutcome> {
  try {
    const lookup = await store.listMemories(
      input.groupId,
      DEDUP_LOOKUP_LIMIT,
    );
    if (lookup.success) {
      const decision = decideMemoryDuplicate({
        content: input.content,
        candidates: (lookup.memories ?? []).map((memory) => ({
          id: memory.id,
          memory: memory.summary,
          similarity: null,
        })),
      });
      if (decision.kind === "duplicate") return decision;
    } else {
      input.onDedupLookupFailure?.({
        groupId: input.groupId,
        error: lookup.error,
      });
    }
  } catch (error) {
    input.onDedupLookupFailure?.({
      groupId: input.groupId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const result = await store.addMemory(input.content, input.groupId, input.metadata);
  return result.success
    ? { kind: "saved" }
    : { kind: "failed", error: result.error };
}
