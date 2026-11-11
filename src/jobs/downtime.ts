import { q, withTenant } from "../db/pool.js";
import type { MdmProvider } from "../mdm/provider.js";
import { deployDevicePolicy, loadSpec, scheduleState } from "../policy/deploy.js";

/**
 * Run every minute. AMAPI has no native schedules, so time-based rules (downtime, and
 * school-hours app switch-off) are applied by re-pushing the device policy at window
 * boundaries. Changes reach the device when it is online; status stays 'pending' until
 * the device confirms.
 */
export async function runDowntimeTick(mdm: MdmProvider, now: Date): Promise<number> {
  let switched = 0;
  const orgs = await q<{ id: string }>("SELECT list_org_ids() AS id");
  for (const { id: orgId } of orgs.rows) {
    await withTenant(orgId, async (tx) => {
      const devices = (await tx.query(
        "SELECT id, student_id, ownership, in_downtime, in_school_hours FROM devices WHERE state = 'active'")).rows;
      for (const d of devices) {
        const { spec } = await loadSpec(tx, d.student_id);
        const s = await scheduleState(tx, d.student_id, d.ownership, spec, now);
        if (s.inDowntime !== d.in_downtime) {
          await deployDevicePolicy(tx, mdm, d.id, s.inDowntime ? "downtime_start" : "downtime_end", now);
          switched++;
        } else if (s.inSchoolHours !== d.in_school_hours) {
          await deployDevicePolicy(tx, mdm, d.id, "schedule", now);
          switched++;
        }
      }
    });
  }
  return switched;
}
