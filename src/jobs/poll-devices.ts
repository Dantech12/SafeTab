import { q } from "../db/pool.js";
import { applyDeviceReport } from "../mdm/device-reports.js";
import type { MdmProvider } from "../mdm/provider.js";

/**
 * Pulls device status from the MDM for every connected enterprise and applies it, in
 * place of Pub/Sub push notifications. Picks up new enrollments and policy confirmations.
 */
export async function pollDeviceStatus(mdm: MdmProvider, now: Date): Promise<{ seen: number; matched: number; errors: number }> {
  let seen = 0, matched = 0, errors = 0;
  const orgs = (await q<{ org_id: string; enterprise: string }>("SELECT org_id, enterprise FROM list_android_orgs()")).rows;
  for (const { enterprise } of orgs) {
    try {
      for (const d of await mdm.listDevices(enterprise)) {
        seen++;
        if (await applyDeviceReport(d, now)) matched++;
      }
    } catch (e) {
      errors++;
      console.error(`device poll failed for ${enterprise}:`, e instanceof Error ? e.message : e);
    }
  }
  return { seen, matched, errors };
}
