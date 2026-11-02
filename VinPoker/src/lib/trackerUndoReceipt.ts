// One canonical receipt contract shared by the Edge and the operator controller.
export function trackerUndoReceiptMatches(value: unknown, expected: {
  hand_id: string; expected_action_id: string; expected_source_revision: number;
}): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return proof.ok === true && !proof.error && typeof proof.duplicate === "boolean"
    && proof.operation === "undo_open_hand" && proof.hand_id === expected.hand_id
    && proof.undone_action_id === expected.expected_action_id
    && Number.isSafeInteger(proof.source_revision)
    && Number(proof.source_revision) > expected.expected_source_revision;
}
