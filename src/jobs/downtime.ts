import { config } from "../config.js";
import { q, withTenant } from "../db/pool.js";
import type { MdmProvider } from "../mdm/provider.js";
import { deployDevicePolicy, loadSpec } from "../policy/deploy.js";
import { isInDowntime } from "../policy/spec.js";

/**
 * Run every minute. AMAPI has no native schedule, so downtime is applied by switching each
 * device's policy into / out of a kiosk policy at window boundaries. The change reaches the
 * device when it is online; status stays 'pending' until the device confirms.
 */
export async function runDowntimeTick(mdm: MdmProvider, now: Date): Promise<number> {
  let switched = 0;
  const orgs = await q<{ id: string }>("SELECT list_org_ids() AS id");
  for (const { id: orgId } of orgs.rows) {
    await withTenant(orgId, async (tx) => {
      const devices = (await tx.query("SELECT id, student_id, in_downtime FROM devices WHERE state = 'active'")).rows;
      for (const d of devices) {
        const { spec } = await loadSpec(tx, d.student_id);
        const should = config().COMPANION_APP_ENABLED && isInDowntime(spec, now);
        if (should !== d.in_downtime) {
          await deployDevicePolicy(tx, mdm, d.id, should ? "downtime_start" : "downtime_end", now);
          switched++;
        }
      }
    });
  }
  return switched;
}
