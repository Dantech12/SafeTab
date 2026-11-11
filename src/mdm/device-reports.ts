import { audit } from "../audit.js";
import { q, withTenant } from "../db/pool.js";
import { reconcileDeviceStatus } from "../policy/deploy.js";
import type { MdmDeviceStatus } from "./provider.js";

/**
 * Applies one device status (from a Pub/Sub notification or from polling) to our records.
 * First sighting of a device created from one of our enrollment tokens activates it.
 * Returns false if the device is not one of ours.
 */
export async function applyDeviceReport(status: MdmDeviceStatus, now: Date): Promise<boolean> {
  const match = (await q("SELECT device_id, org_id FROM lookup_device_by_mdm($1, $2)", [status.enrollmentTokenName ?? null, status.name || null])).rows[0];
  if (!match) return false;

  await withTenant(match.org_id, async (tx) => {
    if (status.name) {
      const enrolled = await tx.query(
        "UPDATE devices SET mdm_device_name = $2, state = 'active' WHERE id = $1 AND state = 'pending_enrollment' RETURNING id",
        [match.device_id, status.name]);
      if (enrolled.rowCount) {
        await audit(tx, { actorType: "system", action: "device.enrolled", targetType: "device", targetId: match.device_id });
      }
    }
    await reconcileDeviceStatus(tx, match.device_id, status, now);
  });
  return true;
}
