export class InvalidGroupIdsError extends Error {
  override readonly name = "InvalidGroupIdsError";
  readonly groupIds: readonly string[];

  constructor(groupIds: readonly string[]) {
    super("Group ids must contain only non-blank strings");
    this.groupIds = [...groupIds];
  }
}

export function assertNonEmptyGroupIds(
  groupIds: readonly string[]
): asserts groupIds is readonly [string, ...string[]] {
  if (groupIds.length === 0 || groupIds.some((groupId) => groupId.trim().length === 0)) {
    throw new InvalidGroupIdsError(groupIds);
  }
}
