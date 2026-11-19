import { expect, it } from "vitest";
import { parsePlayerIntelligence } from "./types";

const zero = { profileStatus: "new", verifiedSample: { totalEntries: 0, uniqueEvents: 0, reentries: 0 } };
const established = { profileStatus: "provisional", verifiedSample: { totalEntries: 4, uniqueEvents: 1, reentries: 3 } };

it.each([
  null, [], {}, { profileStatus: "new" }, { ...zero, profileStatus: "unknown" },
  { ...zero, verifiedSample: { ...zero.verifiedSample, totalEntries: -1 } },
  { ...established, verifiedSample: { ...established.verifiedSample, uniqueEvents: 1.5 } },
  { ...established, verifiedSample: { ...established.verifiedSample, reentries: "3" } },
  { ...established, profileStatus: "new" }, { ...zero, profileStatus: "verified" },
])("does not classify unusable data as a player profile (%j)", value => {
  expect(parsePlayerIntelligence(value)).toBeNull();
});

it("accepts a server-confirmed zero and valid older profiles without optional sections", () => {
  expect(parsePlayerIntelligence(zero)).toMatchObject({ profileStatus: "new", verifiedSample: zero.verifiedSample });
  expect(parsePlayerIntelligence(established)).toMatchObject({ profileStatus: "provisional", verifiedSample: established.verifiedSample });
});
