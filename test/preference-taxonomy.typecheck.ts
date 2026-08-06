import type { PreferenceCandidate } from "../src/services/preference-taxonomy.js";

// @ts-expect-error An unallowlisted key cannot become a preference candidate.
const invalidKeyCandidate: PreferenceCandidate = { key: "project-database", value: "postgres", state: "candidate", decayClass: "persistent", evidence: [] };

// @ts-expect-error Graphiti fact text cannot become an allowlisted candidate value.
const invalidValueCandidate: PreferenceCandidate = { key: "response-verbosity", value: "PROJECT_VOCABULARY_MUST_NOT_LEAK", state: "candidate", decayClass: "persistent", evidence: [] };

void invalidKeyCandidate;
void invalidValueCandidate;
