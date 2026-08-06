import { isRecord } from "./message-parts.js";

// ---------------------------------------------------------------------------
// Closed preference taxonomy — the single allowlist for candidate values.
// Graphiti fact text must never be copied into a candidate value; this is the
// structural defense against project-vocabulary leakage.
// ---------------------------------------------------------------------------

export const PREFERENCE_TAXONOMY = {
  "response-verbosity": ["concise", "balanced", "detailed"],
  "explanation-depth": ["minimal", "standard", "deep"],
  "response-language": ["match-user", "english", "korean"],
  "planning-preference": ["direct-execution", "plan-first", "ask-when-ambiguous"],
  "testing-workflow": ["tdd", "tests-after", "verify-only"],
  "commit-review-workflow": [
    "review-before-commit",
    "commit-after-verification",
    "no-automatic-commit",
  ],
} as const;

export type PreferenceKey = keyof typeof PREFERENCE_TAXONOMY;

export type PreferenceValueForKey<K extends PreferenceKey> =
  (typeof PREFERENCE_TAXONOMY)[K][number];

export type PreferenceValue = PreferenceValueForKey<PreferenceKey>;

/** A key correlated with one of its own allowlisted values. */
export type PreferenceSelection = {
  [K in PreferenceKey]: {
    readonly key: K;
    readonly value: PreferenceValueForKey<K>;
  };
}[PreferenceKey];

// ---------------------------------------------------------------------------
// Candidate lifecycle types
// ---------------------------------------------------------------------------

export type CandidateState =
  | "explicit"
  | "candidate"
  | "corroborated"
  | "promoted"
  | "blocked"
  | "superseded";

export type DecayClass = "permanent" | "persistent" | "ephemeral";

/**
 * Structural evidence reference. Carries only identifiers and timestamps —
 * never the free-text content of a Graphiti fact.
 */
export type PreferenceEvidence = {
  readonly kind: "graphiti-fact" | "user-statement" | "session-observation";
  readonly sourceId: string;
  readonly observedAt: string;
};

export type PreferenceCandidate = PreferenceSelection & {
  readonly state: CandidateState;
  readonly decayClass: DecayClass;
  readonly evidence: readonly PreferenceEvidence[];
};

// ---------------------------------------------------------------------------
// Deterministic profile statement renderer
// ---------------------------------------------------------------------------

type PreferenceStatementMap = {
  readonly [K in PreferenceKey]: Readonly<Record<PreferenceValueForKey<K>, string>>;
};

const PROFILE_STATEMENTS = {
  "response-verbosity": {
    concise: "Prefers concise responses.",
    balanced: "Prefers balanced response length.",
    detailed: "Prefers detailed responses.",
  },
  "explanation-depth": {
    minimal: "Prefers minimal explanations.",
    standard: "Prefers standard explanation depth.",
    deep: "Prefers deep explanations.",
  },
  "response-language": {
    "match-user": "Matches the user's language.",
    english: "Prefers English responses.",
    korean: "Prefers Korean responses.",
  },
  "planning-preference": {
    "direct-execution": "Prefers direct execution over planning.",
    "plan-first": "Prefers planning before execution.",
    "ask-when-ambiguous": "Prefers to ask when requirements are ambiguous.",
  },
  "testing-workflow": {
    tdd: "Follows test-driven development.",
    "tests-after": "Writes tests after implementation.",
    "verify-only": "Verifies without writing tests.",
  },
  "commit-review-workflow": {
    "review-before-commit": "Reviews changes before committing.",
    "commit-after-verification": "Commits after verification passes.",
    "no-automatic-commit": "Does not commit automatically.",
  },
} as const satisfies PreferenceStatementMap;

const PROFILE_STATEMENT_LOOKUP: ReadonlyMap<string, string> = new Map(
  Object.entries(PROFILE_STATEMENTS).flatMap(([key, statements]) =>
    Object.entries(statements).map(
      ([value, statement]): [string, string] => [`${key}:${value}`, statement],
    ),
  ),
);

export class PreferenceTaxonomyError extends Error {
  override readonly name = "PreferenceTaxonomyError";

  constructor(
    readonly key: string,
    readonly value: string,
  ) {
    super(`Preference pair not in taxonomy: ${key}=${value}`);
  }
}

/** Renders a deterministic profile statement purely from the enum pair. */
export function renderProfileStatement<K extends PreferenceKey>(
  key: K,
  value: PreferenceValueForKey<K>,
): string {
  const statement = PROFILE_STATEMENT_LOOKUP.get(`${key}:${value}`);
  if (statement === undefined) {
    throw new PreferenceTaxonomyError(key, value);
  }
  return statement;
}

// ---------------------------------------------------------------------------
// Runtime validator — boundary guard for unknown input
// ---------------------------------------------------------------------------

const PREFERENCE_KEYS: ReadonlySet<string> = new Set(Object.keys(PREFERENCE_TAXONOMY));

const CANDIDATE_STATES: ReadonlySet<string> = new Set([
  "explicit",
  "candidate",
  "corroborated",
  "promoted",
  "blocked",
  "superseded",
]);

const DECAY_CLASSES: ReadonlySet<string> = new Set(["permanent", "persistent", "ephemeral"]);

const ALLOWED_CANDIDATE_FIELDS: ReadonlySet<string> = new Set([
  "key",
  "value",
  "state",
  "decayClass",
  "evidence",
]);

const ALLOWED_EVIDENCE_FIELDS: ReadonlySet<string> = new Set(["kind", "sourceId", "observedAt"]);

function isPreferenceKey(value: unknown): value is PreferenceKey {
  return typeof value === "string" && PREFERENCE_KEYS.has(value);
}

function isPreferenceValueForKey(key: PreferenceKey, value: unknown): value is PreferenceValue {
  const allowed: readonly string[] = PREFERENCE_TAXONOMY[key];
  return typeof value === "string" && allowed.includes(value);
}

function isPreferenceEvidence(value: unknown): value is PreferenceEvidence {
  if (!isRecord(value)) return false;
  for (const field of Object.keys(value)) {
    if (!ALLOWED_EVIDENCE_FIELDS.has(field)) return false;
  }
  return (
    (value.kind === "graphiti-fact"
      || value.kind === "user-statement"
      || value.kind === "session-observation")
    && typeof value.sourceId === "string"
    && typeof value.observedAt === "string"
  );
}

/**
 * Validates an unknown value as a PreferenceCandidate. Rejects out-of-taxonomy
 * keys/values and any extra fields — the extra-field rejection is the runtime
 * half of the structural defense against Graphiti fact text leaking into a
 * candidate.
 */
export function isPreferenceCandidate(value: unknown): value is PreferenceCandidate {
  if (!isRecord(value)) return false;
  for (const field of Object.keys(value)) {
    if (!ALLOWED_CANDIDATE_FIELDS.has(field)) return false;
  }
  if (!isPreferenceKey(value.key)) return false;
  if (!isPreferenceValueForKey(value.key, value.value)) return false;
  if (typeof value.state !== "string" || !CANDIDATE_STATES.has(value.state)) return false;
  if (typeof value.decayClass !== "string" || !DECAY_CLASSES.has(value.decayClass)) return false;
  if (!Array.isArray(value.evidence)) return false;
  return value.evidence.every(isPreferenceEvidence);
}
