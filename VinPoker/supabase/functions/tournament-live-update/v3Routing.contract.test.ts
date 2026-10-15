import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("V3 start-hand context is forwarded while legacy start-hand remains available", () => {
  assertStringIncludes(source, 'case "start_hand":');
  assertStringIncludes(source, "table_session_id, tournament_table_id, control_epoch");
  assertStringIncludes(source, 'supabase.rpc("start_tracker_hand_v3"');
  assertStringIncludes(source, "p_tournament_table_id: tournament_table_id");
  assertStringIncludes(source, "p_table_session_id: table_session_id");
  assertStringIncludes(source, "p_control_epoch: control_epoch");
  assertStringIncludes(source, 'supabase.rpc("start_hand"');
  assertStringIncludes(source, '"record_tracker_manual_hand_v1"');
  assert(!source.includes('supabase.rpc("record_hand"'));
  assert(source.indexOf('supabase.rpc("start_tracker_hand_v3"') < source.indexOf('supabase.rpc("start_hand"'));
});

Deno.test("partial or malformed V3 context is rejected before either writer", () => {
  assertStringIncludes(source, "table_session_id !== undefined || tournament_table_id !== undefined || control_epoch !== undefined");
  assertStringIncludes(source, 'typeof table_session_id !== "string" || typeof tournament_table_id !== "string"');
  assertStringIncludes(source, "!Number.isInteger(control_epoch) || control_epoch < 1");
  assertStringIncludes(source, 'validationError("INVALID_TRACKER_CONTEXT"');
});
