/**
 * Pure agent resolution logic for opencode-graphiti compaction.
 *
 * This module is intentionally side-effect-free: no filesystem access,
 * no network calls, no logging. All inputs are passed explicitly so the
 * logic can be unit-tested without mocking.
 */

export interface StoredMessageLike {
  agent?: string;
  model?: { providerID?: string; modelID?: string };
}

export interface ResolveAgentInput {
  /** Direct hint from the caller (e.g. captured before compaction started). */
  hint?: string;
  /** Candidate messages ordered newest → oldest. */
  candidates: StoredMessageLike[];
  /**
   * Agent names that are considered "untrusted" (i.e. framework defaults that
   * leak into the cache and should not be reused as the active agent).
   */
  untrustedAgents: ReadonlySet<string>;
  /**
   * When true, fall back to the most recent untrusted candidate if no trusted
   * agent is found. Useful for callers that only need model info and don't
   * care about agent trustworthiness.
   */
  allowUntrustedFallback?: boolean;
}

export interface ResolveAgentResult {
  /**
   * The resolved agent name, or `undefined` if none could be determined.
   * Callers MUST omit the `agent` field entirely when this is `undefined`
   * rather than passing `agent: undefined`.
   */
  agent?: string;
  /** Describes which resolution path was taken — useful for diagnostics. */
  source: "hint" | "trusted-candidate" | "untrusted-fallback" | "none";
}

/**
 * Resolve the active agent from a hint and/or a list of cached messages.
 *
 * Resolution order:
 * 1. `hint` — if provided and not in `untrustedAgents`, return immediately.
 * 2. Scan `candidates` newest-first for the first trusted agent.
 * 3. If `allowUntrustedFallback`, return the most recent candidate's agent
 *    even if it is untrusted.
 * 4. Return `{ agent: undefined, source: "none" }`.
 */
export function resolveAgent(input: ResolveAgentInput): ResolveAgentResult {
  const { hint, candidates, untrustedAgents, allowUntrustedFallback = false } = input;

  // Step 1: use the hint if it is trusted
  if (hint !== undefined && hint !== "" && !untrustedAgents.has(hint)) {
    return { agent: hint, source: "hint" };
  }

  // Step 2: scan candidates newest-first for a trusted agent
  let untrustedFallback: string | undefined;

  for (const candidate of candidates) {
    const agentValue = candidate.agent;
    if (!agentValue) continue;

    if (untrustedAgents.has(agentValue)) {
      // Remember the first (most recent) untrusted match as a potential fallback
      if (untrustedFallback === undefined) {
        untrustedFallback = agentValue;
      }
      continue;
    }

    // Found a trusted agent
    return { agent: agentValue, source: "trusted-candidate" };
  }

  // Step 3: fall back to untrusted if allowed
  if (allowUntrustedFallback && untrustedFallback !== undefined) {
    return { agent: untrustedFallback, source: "untrusted-fallback" };
  }

  // Step 4: nothing found
  return { agent: undefined, source: "none" };
}
