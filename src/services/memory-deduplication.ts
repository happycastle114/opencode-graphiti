const MIN_CONTAINMENT_CHARACTERS = 80;

export type DuplicateCandidate = {
  readonly id: string;
  readonly memory?: string;
  readonly similarity: number | null;
};

export type DuplicateReason =
  | "normalized-exact"
  | "normalized-containment";

export type DuplicateDecision =
  | {
      readonly kind: "duplicate";
      readonly existingId: string;
      readonly reason: DuplicateReason;
    }
  | { readonly kind: "distinct" };

export type DuplicateDecisionInput = {
  readonly content: string;
  readonly candidates: readonly DuplicateCandidate[];
};

function normalizeMemoryText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function duplicate(
  existingId: string,
  reason: DuplicateReason,
): DuplicateDecision {
  return { kind: "duplicate", existingId, reason };
}

export function decideMemoryDuplicate(
  input: DuplicateDecisionInput,
): DuplicateDecision {
  const normalizedContent = normalizeMemoryText(input.content);

  for (const candidate of input.candidates) {
    if (candidate.memory === undefined || normalizedContent.length === 0) {
      continue;
    }

    const normalizedCandidate = normalizeMemoryText(candidate.memory);
    if (normalizedCandidate.length === 0) {
      continue;
    }

    if (normalizedCandidate === normalizedContent) {
      return duplicate(candidate.id, "normalized-exact");
    }

    if (
      normalizedContent.length >= MIN_CONTAINMENT_CHARACTERS &&
      normalizedCandidate.length >= MIN_CONTAINMENT_CHARACTERS &&
      normalizedCandidate.includes(normalizedContent)
    ) {
      return duplicate(candidate.id, "normalized-containment");
    }
  }

  return { kind: "distinct" };
}
