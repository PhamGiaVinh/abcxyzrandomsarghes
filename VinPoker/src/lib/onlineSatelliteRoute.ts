import { z } from "zod";

export const satellitePilotId = z.string().uuid();

export function safeSatelliteReturnTarget(value: string | null): string | null {
  const prefix = "/poker/satellite/";
  if (!value?.startsWith(prefix)) return null;
  const pilotId = satellitePilotId.safeParse(value.slice(prefix.length));
  return pilotId.success ? `${prefix}${pilotId.data}` : null;
}
