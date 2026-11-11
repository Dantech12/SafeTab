import { config } from "../config.js";
import { makeMdm } from "../mdm/factory.js";
import { runDowntimeTick } from "./downtime.js";
import { pollDeviceStatus } from "./poll-devices.js";

// Separate process from the API so scheduled work does not run once per API replica.
// Run exactly one worker instance (or add a Postgres advisory lock before scaling out).
const c = config();
const mdm = makeMdm();

function every(seconds: number, name: string, fn: () => Promise<unknown>) {
  const run = async () => {
    try {
      const result = await fn();
      if (result) console.log(JSON.stringify({ job: name, result }));
    } catch (e) {
      console.error(`${name} failed`, e instanceof Error ? e.message : e);
    }
  };
  void run();
  setInterval(run, seconds * 1000);
}

every(60, "downtime", async () => (await runDowntimeTick(mdm, new Date())) || null);
if (c.DEVICE_STATUS_MODE === "poll") {
  every(c.DEVICE_POLL_SECONDS, "device-poll", async () => {
    const r = await pollDeviceStatus(mdm, new Date());
    return r.seen || r.errors ? r : null;
  });
}
console.log(`worker started (status mode: ${c.DEVICE_STATUS_MODE})`);
