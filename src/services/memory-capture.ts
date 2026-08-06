import { extractExplicitProfileMemory } from "./memory-enhancement.js";
import {
  persistDistinctMemory,
  type MemoryCaptureObserver,
  type MemoryStore,
  type MemoryWriter,
  type MemoryWriteOutcome,
} from "./memory-storage.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";
import { isStorageWorthy, sanitizeTextForStorage } from "./storage-sanitizer.js";

export type { MemoryStore, MemoryWriter } from "./memory-storage.js";

export type TurnWriteOutcome =
  | MemoryWriteOutcome
  | { readonly kind: "skipped"; readonly reason: "short-or-private" };

export type FinishedTurnInput = MemoryCaptureObserver & {
  readonly turnId: string;
  readonly userText: string;
  readonly assistantText: string;
  readonly saveProfile: boolean;
};

export type FinishedTurnResult = {
  readonly profileSaved: boolean;
  readonly turn: TurnWriteOutcome;
  readonly contentLength: number;
};

export type SessionDigestInput = MemoryCaptureObserver & {
  readonly sessionId: string;
  readonly digest: string | null;
};

export interface MemoryGroups {
  readonly user: string;
  readonly project: string;
}

export interface SessionDigestSaver {
  save(sessionId: string, digest: string | null): Promise<boolean>;
  forget(sessionId: string): void;
}

export async function saveExplicitProfileMemory(
  writer: MemoryWriter,
  groups: MemoryGroups,
  userText: string,
  turnId: string,
): Promise<boolean> {
  const profileMemory = extractExplicitProfileMemory(userText);
  if (!profileMemory) return false;

  const result = await writer.addMemory(profileMemory.content, groups.user, {
    type: profileMemory.type,
    name: `profile-${turnId}`,
    source: "message",
  });
  return result.success;
}

export async function saveFinishedTurnMemories(
  store: MemoryStore,
  groups: MemoryGroups,
  input: FinishedTurnInput,
): Promise<FinishedTurnResult> {
  const userText = sanitizeTextForStorage(input.userText);
  const assistantText = sanitizeTextForStorage(input.assistantText);
  const profileMemory = input.saveProfile
    ? extractExplicitProfileMemory(userText)
    : null;
  const profileOutcome = profileMemory
    ? await persistDistinctMemory(store, {
        content: profileMemory.content,
        groupId: groups.user,
        metadata: {
          type: profileMemory.type,
          name: `profile-${input.turnId}`,
          source: "message",
        },
        onDedupLookupFailure: input.onDedupLookupFailure,
      })
    : null;

  const rawContent = [
    "Conversation turn:",
    `User: ${userText}`,
    `Assistant: ${assistantText}`,
  ].join("\n\n");
  const content = stripPrivateContent(rawContent).trim();
  if (
    (!isStorageWorthy(userText) && !isStorageWorthy(assistantText))
    || isFullyPrivate(rawContent)
    || content.length < 80
  ) {
    return {
      profileSaved: profileOutcome?.kind === "saved",
      turn: { kind: "skipped", reason: "short-or-private" },
      contentLength: content.length,
    };
  }

  const turn = await persistDistinctMemory(store, {
    content,
    groupId: groups.project,
    metadata: {
      type: "conversation",
      name: `turn-${input.turnId}`,
      source: "message",
    },
    onDedupLookupFailure: input.onDedupLookupFailure,
  });
  return {
    profileSaved: profileOutcome?.kind === "saved",
    turn,
    contentLength: content.length,
  };
}

export async function saveSessionDigestMemory(
  store: MemoryStore,
  groups: MemoryGroups,
  input: SessionDigestInput,
): Promise<boolean> {
  if (!input.digest) return false;

  const content = sanitizeTextForStorage(input.digest);
  if (!isStorageWorthy(content)) return false;

  const outcome = await persistDistinctMemory(store, {
    content,
    groupId: groups.project,
    metadata: {
      type: "conversation",
      name: `session-digest-${input.sessionId}`,
      source: "message",
    },
    onDedupLookupFailure: input.onDedupLookupFailure,
  });
  return outcome.kind === "saved";
}

export function createSessionDigestSaver(
  store: MemoryStore,
  groups: MemoryGroups,
  observer: MemoryCaptureObserver = {},
): SessionDigestSaver {
  const savedDigests = new Map<string, string>();
  const writeChains = new Map<string, Promise<boolean>>();

  return {
    async save(sessionId: string, digest: string | null): Promise<boolean> {
      if (!digest || savedDigests.get(sessionId) === digest) return false;

      const writeDigest = async (): Promise<boolean> => {
        if (savedDigests.get(sessionId) === digest) return false;
        const saved = await saveSessionDigestMemory(store, groups, {
          sessionId,
          digest,
          onDedupLookupFailure: observer.onDedupLookupFailure,
        });
        if (saved) savedDigests.set(sessionId, digest);
        return saved;
      };
      const previousWrite = writeChains.get(sessionId);
      const write = previousWrite
        ? previousWrite.catch(() => false).then(writeDigest)
        : writeDigest();
      writeChains.set(sessionId, write);

      try {
        return await write;
      } finally {
        if (writeChains.get(sessionId) === write) writeChains.delete(sessionId);
      }
    },
    forget(sessionId: string): void {
      savedDigests.delete(sessionId);
    },
  };
}

export function createSessionDigestRefresher(saver: SessionDigestSaver) {
  const generations = new Map<string, number>();

  return {
    async refresh(sessionId: string, loadDigest: () => Promise<string | null>): Promise<boolean> {
      const generation = (generations.get(sessionId) ?? 0) + 1;
      generations.set(sessionId, generation);

      const digest = await loadDigest();
      if (generations.get(sessionId) !== generation) return false;
      return saver.save(sessionId, digest);
    },
    forget(sessionId: string): void {
      generations.delete(sessionId);
      saver.forget(sessionId);
    },
  };
}
