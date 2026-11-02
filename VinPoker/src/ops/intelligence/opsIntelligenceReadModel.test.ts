import { describe, expect, it } from "vitest";
import {
  SERIES_CLUB_PULSE_METRIC_DEFINITIONS,
  parseSeriesClubLivePulseV1,
  type SeriesClubPulseMetricKey,
} from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { deriveDealerAssignmentState, deriveOpsTableCapacityQ0, loadOpsLiveOperations } from "./opsLiveOperationsAdapter";
import { buildOpsIntelligenceReadModelV1, deriveHeadlineStatus } from "./opsIntelligenceReadModel";

const CLUB_ID = "10000000-0000-4000-8000-000000000001";
const AS_OF = "2026-08-27T01:02:03.000Z";
const OBSERVED_AT = "2026-08-27T01:02:04.000Z";

function metric(key: SeriesClubPulseMetricKey, value: number, availability: "exact" | "partial" | "stale" = "exact") {
  return { ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key], value, unit: "count", availability, privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe", asOf: AS_OF };
}

function pulse(overrides: Record<string, unknown> = {}) {
  return parseSeriesClubLivePulseV1({
    version: "series-club-live-pulse-v1", clubId: CLUB_ID, asOf: AS_OF, clubLocalDate: "2026-08-27", timezone: "Asia/Ho_Chi_Minh",
    clubMemberProfiles: metric("clubMemberProfiles", 10), uniquePlayersToday: metric("uniquePlayersToday", 5), entriesToday: metric("entriesToday", 0), playersPlayingNow: metric("playersPlayingNow", 5), runningEvents: metric("runningEvents", 5), openTables: metric("openTables", 5), dealersOnDuty: metric("dealersOnDuty", 5),
    dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] }, ...overrides,
  });
}

function operations(overrides: Record<string, unknown> = {}) {
  return {
    observedAt: OBSERVED_AT, asOf: AS_OF, availability: "exact" as const, reasonCode: null,
    rows: Object.freeze([{ tableId: "table-1", tableName: "Bàn 1", tableStatus: "active", tournamentId: "tournament-1", tournamentName: "Main", currentLevel: null, averageStack: null, dealerName: "Duy", dealerAssignmentState: "assigned" as const, sourceAvailability: "exact" as const }]),
    runningTournamentIds: Object.freeze(["event-1"]), openTableCount: 5, configuredTableCount: 101, operationalTableCount: 5, dealersOnDutyCount: 5, countComparisonEligible: false, ...overrides,
  };
}

describe("Ops Intelligence read model", () => {
  it.each([
    [null,'physical-a',['physical-a']],
    ['physical-a','physical-b',[]],
  ])('resolves canonical physical link legacy=%s canonical=%s without masking conflicts', (legacy,canonical,expected)=>{
    const capacity=deriveOpsTableCapacityQ0(['physical-a','physical-b'],[{tournament_tables:[
      {table_id:legacy,game_table_id:canonical,status:'active'},
    ]}] as never);
    expect(capacity.activeTableIds).toEqual(expected);
    expect(capacity.operationalTableCount).toBe(expected.length);
  });
  it.each([false,true])('requests canonical tournament links and reports conflicts as unverified (conflict=%s)',async(conflict)=>{
    const selections:Record<string,string>={};
    const client={rpc:async()=>({data:[{game_table_id:'c474ac95-6896-445d-81ba-dd6d752528df',table_number:2,table_name:'Paid journey TEST 2',
      operational_status:'available',availability_status:'in_use',table_session_id:'session-current',session_type:'tournament',
      control_mode:'tracker',control_epoch:1,revision:1,tournament_id:'46cab483-91e7-4220-aacf-e17bdf05269c',
      tournament_table_id:'logical-current',tournament_table_status:'active',active_dealer_assignment_id:null}],error:null}),from:(table:string)=>{
      const data=table==='game_tables'?[{id:'c474ac95-6896-445d-81ba-dd6d752528df',table_name:'Paid journey TEST 2',status:'active',current_blind_level:1}]
        :table==='tournaments'?[{id:'46cab483-91e7-4220-aacf-e17bdf05269c',name:'Cash identity local TEST',status:'live',current_level:1,average_stack:30000,
          tournament_tables:[{id:'logical-current',table_session_id:'session-current',table_id:conflict?'another-physical-id':null,game_table_id:'c474ac95-6896-445d-81ba-dd6d752528df',status:'active'}]}]:[];
      const query=Promise.resolve({data,error:null}) as Promise<unknown>&Record<string,(value:string)=>unknown>;
      for(const method of ['eq','is','in','order'])query[method]=()=>query;
      query.select=(value:string)=>{selections[table]=value;return query;};return query;
    }} as never;
    const result=await loadOpsLiveOperations(client,CLUB_ID,{q0CapacityTruth:true});
    expect(selections.tournaments).toContain('game_table_id');
    if(conflict){
      expect(result.availability).toBe('partial');expect(result.reasonCode).toBe('OPS_LIVE_TABLE_IDENTITY_UNVERIFIED');
      expect(result.countComparisonEligible).toBe(false);expect(result.rows).toHaveLength(0);
    }else{
      expect(result.openTableCount).toBe(1);expect(result.rows).toHaveLength(1);
      expect(result.rows[0].tournamentId).toBe('46cab483-91e7-4220-aacf-e17bdf05269c');
    }
  });
  it.each(['game_tables','tournaments','dealer_assignments','dealer_attendance'])(
    'does not accept a null successful %s payload as an exact empty source',async(malformedTable)=>{
      const client={rpc:async()=>({data:[],error:null}),from:(table:string)=>{
        const query=Promise.resolve({data:table===malformedTable?null:[],error:null}) as Promise<unknown>&Record<string,()=>unknown>;
        for(const method of ['select','eq','is','in','order'])query[method]=()=>query;
        return query;
      }} as never;
      const result=await loadOpsLiveOperations(client,CLUB_ID,{q0CapacityTruth:true});
      expect(result.availability).toBe(malformedTable==='game_tables'?'unavailable':'partial');
      expect(result.reasonCode).toMatch(/READ_FAILED/);
      if(malformedTable==='game_tables')expect(result.openTableCount).toBeNull();
      if(malformedTable==='dealer_attendance')expect(result.dealersOnDutyCount).toBeNull();
    });
  it('retains exact empty arrays as successful empty operation sources',async()=>{
    const client={rpc:async()=>({data:[],error:null}),from:()=>{
      const query=Promise.resolve({data:[],error:null}) as Promise<unknown>&Record<string,()=>unknown>;
      for(const method of ['select','eq','is','in','order'])query[method]=()=>query;
      return query;
    }} as never;
    expect(await loadOpsLiveOperations(client,CLUB_ID,{q0CapacityTruth:true}))
      .toMatchObject({availability:'exact',reasonCode:null,rows:[],openTableCount:0,dealersOnDutyCount:0});
  });
  it("keeps a successful zero count distinct from missing", () => {
    const model = buildOpsIntelligenceReadModelV1({ clubId: CLUB_ID, pulse: { value: pulse(), observedAt: OBSERVED_AT }, pulseError: null, operations: operations(), supplemental: [], verifiedTrackerAlertCount: null });
    expect(model.metrics.find((item) => item.metricId === "entries_today")).toMatchObject({ value: 0, availability: "exact" });
    expect(model.metrics.find((item) => item.metricId === "entries_today")?.value).not.toBeNull();
  });

  it.each([
    ["UNAVAILABLE", "unavailable", "unavailable", [], "UNAVAILABLE"],
    ["PARTIAL with one usable core", "exact", "unavailable", [], "PARTIAL"],
    ["STALE after both sources are usable", "stale", "exact", [], "STALE"],
    ["LIVE only with exact core sources", "exact", "exact", [], "LIVE"],
  ] as const)("derives %s without supplemental source interference", (_label, pulseState, operationsState, metrics, expected) => {
    expect(deriveHeadlineStatus(pulseState, operationsState, metrics)).toBe(expected);
  });

  it("freezes observedAt at source acceptance rather than a render timestamp", () => {
    const model = buildOpsIntelligenceReadModelV1({ clubId: CLUB_ID, pulse: { value: pulse(), observedAt: OBSERVED_AT }, pulseError: null, operations: operations(), supplemental: [], verifiedTrackerAlertCount: null });
    expect(model.metrics[0].observedAt).toBe(OBSERVED_AT);
    expect(model.sources.find((source) => source.sourceId === "ops-live-operations")?.observedAt).toBe(OBSERVED_AT);
  });

  it("reports a count mismatch without overwriting either source", () => {
    const model = buildOpsIntelligenceReadModelV1({ clubId: CLUB_ID, pulse: { value: pulse(), observedAt: OBSERVED_AT }, pulseError: null, operations: operations({ openTableCount: 4, countComparisonEligible: true }), supplemental: [], verifiedTrackerAlertCount: null });
    expect(model.alerts.some((alert) => alert.kind === "source_count_mismatch")).toBe(true);
    expect(model.metrics.find((item) => item.metricId === "open_tables")?.value).toBe(5);
  });

  it("keeps configured capacity distinct from active tournament tables", () => {
    const configured = Array.from({ length: 101 }, (_, index) => `table-${index + 1}`);
    const capacity = deriveOpsTableCapacityQ0(configured, [{ tournament_tables: configured.slice(0, 4).map((table_id) => ({ table_id, status: "active" })) }]);
    expect(capacity).toMatchObject({ configuredTableCount: 101, operationalTableCount: 4 });
    expect(capacity.activeTableIds).toHaveLength(4);
  });

  it("does not coerce a missing count to zero for a mismatch diagnostic", () => {
    const parsed = pulse();
    const model = buildOpsIntelligenceReadModelV1({
      clubId: CLUB_ID,
      pulse: { value: { ...parsed, openTables: { ...parsed.openTables, value: null, availability: "exact" } }, observedAt: OBSERVED_AT },
      pulseError: null,
      operations: operations({ openTableCount: 0, countComparisonEligible: true }),
      supplemental: [],
      verifiedTrackerAlertCount: null,
    });
    expect(model.alerts.some((alert) => alert.kind === "source_count_mismatch")).toBe(false);
  });

  it("uses canonical Dealer Swing pre-assignment semantics for overdue state", () => {
    const now = Date.parse(OBSERVED_AT);
    expect(deriveDealerAssignmentState({ swing_due_at: "2026-08-27T01:00:00.000Z", pre_assigned_attendance_id: "next", pre_assigned_at: "2026-08-27T00:59:30.000Z", swing_in_progress: false, updated_at: "2026-08-27T00:59:30.000Z", last_swing_attempted_at: null, released_at: null, swing_processed_at: null, status: "assigned" }, now)).toBe("overdue");
    expect(deriveDealerAssignmentState({ swing_due_at: "2026-08-27T01:00:00.000Z", pre_assigned_attendance_id: "next", pre_assigned_at: "2026-08-27T01:02:00.000Z", swing_in_progress: true, updated_at: "2026-08-27T01:02:03.000Z", last_swing_attempted_at: null, released_at: null, swing_processed_at: null, status: "assigned" }, now)).toBe("assigned");
  });

  it("never puts supplemental finance values into headline metrics", () => {
    const model = buildOpsIntelligenceReadModelV1({ clubId: CLUB_ID, pulse: { value: pulse(), observedAt: OBSERVED_AT }, pulseError: null, operations: operations(), supplemental: [{ sourceId: "finance-summary", label: "Finance", availability: "exact", asOf: AS_OF, observedAt: OBSERVED_AT, reasonCode: null }], verifiedTrackerAlertCount: null });
    expect(model.metrics.every((item) => item.unit === "count")).toBe(true);
  });

  it("does not derive a dealer alert from a partial operation row", () => {
    const model = buildOpsIntelligenceReadModelV1({
      clubId: CLUB_ID,
      pulse: { value: pulse(), observedAt: OBSERVED_AT },
      pulseError: null,
      operations: operations({ rows: Object.freeze([{ tableId: "table-1", tableName: "Bàn 1", tableStatus: "active", tournamentId: "tournament-1", tournamentName: "Main", currentLevel: null, averageStack: null, dealerName: null, dealerAssignmentState: "missing", sourceAvailability: "partial" as const }]) }),
      supplemental: [],
      verifiedTrackerAlertCount: null,
    });
    expect(model.alerts.some((alert) => alert.kind === "dealer_assignment_missing")).toBe(false);
  });

  it("shows a Tracker alert only when the verified source is exact", () => {
    const model = buildOpsIntelligenceReadModelV1({
      clubId: CLUB_ID,
      pulse: { value: pulse(), observedAt: OBSERVED_AT },
      pulseError: null,
      operations: operations(),
      supplemental: [{ sourceId: "tracker-alerts", label: "Tracker alerts", availability: "exact", asOf: AS_OF, observedAt: OBSERVED_AT, reasonCode: null }],
      verifiedTrackerAlertCount: 2,
    });
    expect(model.alerts.some((alert) => alert.kind === "tracker_alert")).toBe(true);
  });
});
