import type { MemoryType } from "../types/index.js";
import type { ReplayTimeline } from "./replay.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;
const ENGLISH_PREFERENCE_PATTERN = /\b(?:i\s+(?:prefer|like|always|never)|please\s+(?:keep|be|use|make)|my\s+(?:preference|style))\b/i;
const KOREAN_PREFERENCE_PATTERN = /(?:나는|저는|내|제|앞으로|항상|절대).{0,40}(?:선호|좋아|응답|답변|스타일|코드|형식|간결|자세)|(?:응답|답변|코드|설명|스타일).{0,40}(?:해줘|해주세요|해라|로\s*해|으로\s*해|선호|좋아)/i;
const STYLE_PATTERN = /\b(?:response|responses|answer|answers|communication|coding|code|format|tone|style|concise|verbose|detailed|korean|english)\b|(?:응답|답변|스타일|코드|형식|간결|자세|한국어|영어)/i;
const ENGLISH_DURABILITY_PATTERN = /\b(?:always|from now on|generally|across projects|my\s+(?:preference|style))\b/i;
const KOREAN_DURABILITY_PATTERN = /(?:앞으로|항상|기본적으로|내\s*(?:선호|스타일)|제\s*(?:선호|스타일))/i;
const ONE_OFF_SCOPE_PATTERN = /\b(?:(?:this|current|the\s+current)\s+(?:response|release|session|request|task|project|repository|repo|codebase|service|build|deployment|pr|pull\s+request|branch|commit|issue|ticket)|for\s+(?:this|the\s+current)\s+(?:response|release|session|request|task|project|repository|repo|codebase|service|build|deployment|pr|pull\s+request|branch|commit|issue|ticket))\b|(?:이번|이|현재)\s*(?:응답|릴리즈|세션|요청|작업|프로젝트|리포지토리|저장소|코드베이스|서비스|빌드|배포|PR|브랜치|커밋|이슈|티켓)/i;
const ENGLISH_GLOBAL_PROFILE_PATTERN = /^(?:my\s+(?:preference|style)\s+is|i\s+(?:generally|usually|typically|always)\s+(?:prefer|like)|always\s+(?:answer|respond\s+to)\s+me|from\s+now\s+on,?\s*(?:please\s+)?(?:(?:answer|respond\s+to)\s+me|(?:keep|make|use)\s+(?:my\s+)?(?:responses?|answers?|communication|coding|code|format|tone|style)))\b/i;
const KOREAN_GLOBAL_PROFILE_PATTERN = /^(?:앞으로|항상|기본적으로).{0,40}(?:응답|답변|스타일|코드|형식|간결|자세).{0,40}(?:해줘|해주세요|해라|로\s*해|으로\s*해|선호|좋아)/i;
const DIRECT_LANGUAGE_PROFILE_PATTERN = /^(?:please\s+)?(?:answer|respond|reply)\s+(?:in|using)\s+(?:korean|english)\b|^(?:한국어|영어)\s*(?:로|로만)?\s*(?:답변|응답|대화)/i;
const COMPOUND_PREFERENCE_PATTERN = /\b(?:and|also|then|plus|but|while|afterwards|as\s+well\s+as)\b|(?:그리고|또한|그\s*다음|이후|하면서|및|또는)|[;:]/i;
const MAX_PROFILE_MEMORY_LENGTH = 800;
const MAX_DIGEST_EVENTS = 12;
const MAX_DIGEST_EVENT_LENGTH = 480;
const MAX_DIGEST_LENGTH = 6000;

export interface ProfileMemory {
  type: Extract<MemoryType, "preference" | "style">;
  content: string;
}

function removeCode(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function hasDurableUserPreferenceSignal(text: string): boolean {
  const withoutCode = removeCode(text);
  if (isFullyPrivate(withoutCode)) return false;

  const content = normalizeWhitespace(stripPrivateContent(withoutCode));
  if (!content || content.length > MAX_PROFILE_MEMORY_LENGTH) return false;
  const hasDurability = ENGLISH_DURABILITY_PATTERN.test(content) || KOREAN_DURABILITY_PATTERN.test(content);
  if (!hasDurability && !DIRECT_LANGUAGE_PROFILE_PATTERN.test(content)) {
    return false;
  }
  if (ONE_OFF_SCOPE_PATTERN.test(content)) return false;

  return ENGLISH_GLOBAL_PROFILE_PATTERN.test(content)
    || KOREAN_GLOBAL_PROFILE_PATTERN.test(content)
    || DIRECT_LANGUAGE_PROFILE_PATTERN.test(content);
}

function isNarrowGlobalPreferenceSentence(sentence: string): boolean {
  return !COMPOUND_PREFERENCE_PATTERN.test(sentence) && hasDurableUserPreferenceSignal(sentence);
}

export function extractExplicitProfileMemory(text: string): ProfileMemory | null {
  const withoutCode = removeCode(text);
  if (isFullyPrivate(withoutCode)) return null;

  const content = normalizeWhitespace(stripPrivateContent(withoutCode));
  if (!content || content.length > MAX_PROFILE_MEMORY_LENGTH) return null;
  const profileAtom = content
    .split(/(?<=[.!?])\s+/u)
    .find((sentence) =>
      (ENGLISH_PREFERENCE_PATTERN.test(sentence)
        || KOREAN_PREFERENCE_PATTERN.test(sentence)
        || DIRECT_LANGUAGE_PROFILE_PATTERN.test(sentence))
      && isNarrowGlobalPreferenceSentence(sentence)
    );
  if (!profileAtom) return null;

  return {
    type: STYLE_PATTERN.test(profileAtom) ? "style" : "preference",
    content: profileAtom,
  };
}

export function buildSessionDigest(timeline: ReplayTimeline): string | null {
  const events = timeline.events
    .filter((event) => event.role === "user" || event.role === "assistant")
    .flatMap((event) => {
      if (isFullyPrivate(event.content)) return [];
      const content = normalizeWhitespace(stripPrivateContent(event.content));
      if (!content) return [];
      const role = event.role === "user" ? "User" : "Assistant";
      return [`${role}: ${content.slice(0, MAX_DIGEST_EVENT_LENGTH)}`];
    })
    .slice(-MAX_DIGEST_EVENTS);

  if (events.length === 0) return null;

  return [
    "[Session Digest]",
    `Session: ${timeline.sessionId}`,
    `Captured exchanges: ${events.length}`,
    ...events,
  ].join("\n").slice(0, MAX_DIGEST_LENGTH);
}
