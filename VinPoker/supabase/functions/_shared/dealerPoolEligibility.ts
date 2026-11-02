/** Read snapshot only; DB acquisition guard must still revalidate at commit. */
export async function loadEligibleDealerAttendance(
  admin: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  },
  clubId: string,
  attendanceIds: string[],
): Promise<{ ids: Set<string>; error: unknown | null }> {
  const requested = new Set(attendanceIds);
  if (requested.size === 0) return { ids: new Set(), error: null };
  try {
    const { data, error } = await admin.rpc(
      "get_dealer_pool_eligible_attendance_v1",
      {
        p_club_id: clubId,
        p_attendance_ids: [...requested],
      },
    );
    if (error) return { ids: new Set(), error };
    if (!Array.isArray(data)) {
      throw new Error("dealer_pool_eligibility_invalid");
    }
    const ids = new Set<string>();
    for (const row of data) {
      if (
        !row || typeof row !== "object" || Object.keys(row).length !== 1 ||
        typeof row.attendance_id !== "string" ||
        !requested.has(row.attendance_id) || ids.has(row.attendance_id)
      ) {
        throw new Error("dealer_pool_eligibility_invalid");
      }
      ids.add(row.attendance_id);
    }
    return { ids, error: null };
  } catch (error) {
    return { ids: new Set(), error };
  }
}
