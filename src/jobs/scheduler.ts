import { config } from "../config.js";
import type { MdmProvider } from "../mdm/provider.js";
import { runDowntimeTick } from "./downtime.js";
import { pollDeviceStatus } from "./poll-devices.js";

/**
 * Starts the periodic jobs (downtime switching, device status polling).
 * Run in exactly one process: the standalone worker in production, or inside the API
 * server for local pilots so only one window is needed.
 */
export function startScheduler(mdm: MdmProvider, log: (msg: string) => void = console.log): () => void {
  const c = config();
  const timers: NodeJS.Timeout[] = [];

  function every(seconds: number, name: string, fn: () => Promise<unknown>) {
    let running = false;
    const run = async () => {
      if (running) return; // never overlap a slow run
      running = true;
      try {
        const result = await fn();
        if (result) log(JSON.stringify({ job: name, result }));
      } catch (e) {
        log(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    };
    void run();
    timers.push(setInterval(run, seconds * 1000));
  }

  every(60, "downtime", async () => (await runDowntimeTick(mdm, new Date())) || null);
  if (c.DEVICE_STATUS_MODE === "poll") {
    every(c.DEVICE_POLL_SECONDS, "device-poll", async () => {
      const r = await pollDeviceStatus(mdm, new Date());
      return r.seen || r.errors ? r : null;
    });
  }
  log(`scheduler started (status mode: ${c.DEVICE_STATUS_MODE}, poll every ${c.DEVICE_POLL_SECONDS}s)`);
  return () => timers.forEach(clearInterval);
}
