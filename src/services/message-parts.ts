export type MessageInfoLike = {
  readonly id?: string;
  readonly role?: string;
  readonly sessionID?: string;
  readonly finish?: string | boolean;
  readonly time?: { readonly created?: number | string };
};

export type MessagePartLike = {
  readonly type?: string;
  readonly text?: string;
  readonly synthetic?: boolean;
};

export type MessageLike = {
  readonly info?: MessageInfoLike;
  readonly parts?: readonly MessagePartLike[];
};

type TextExtractionOptions = {
  readonly includeSynthetic?: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asMessageInfo(value: unknown): MessageInfoLike | null {
  if (!isRecord(value)) return null;
  const finish = value.finish;
  const time = isRecord(value.time) ? value.time : undefined;
  const created = time?.created;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    role: typeof value.role === "string" ? value.role : undefined,
    sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
    finish: typeof finish === "string" || typeof finish === "boolean" ? finish : undefined,
    time: typeof created === "number" || typeof created === "string" ? { created } : undefined,
  };
}

export function asMessage(value: unknown): MessageLike | null {
  if (!isRecord(value)) return null;
  const info = asMessageInfo(value.info);
  const parts = Array.isArray(value.parts)
    ? value.parts.flatMap((part): MessagePartLike[] => {
        if (!isRecord(part)) return [];
        return [{
          type: typeof part.type === "string" ? part.type : undefined,
          text: typeof part.text === "string" ? part.text : undefined,
          synthetic: typeof part.synthetic === "boolean" ? part.synthetic : undefined,
        }];
      })
    : [];
  return { info: info ?? undefined, parts };
}

export function getText(
  parts: readonly MessagePartLike[] | undefined,
  options: TextExtractionOptions = {},
): string {
  return (parts ?? [])
    .filter((part) =>
      part.type === "text"
      && typeof part.text === "string"
      && (options.includeSynthetic === true || part.synthetic !== true)
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}
