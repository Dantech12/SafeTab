import { config } from "../config.js";
import { AmapiProvider } from "../mdm/amapi.js";
import { FakeMdmProvider } from "../mdm/fake.js";
import { runDowntimeTick } from "./downtime.js";

// Separate process from the API so scheduled work does not run once per API replica.
// Run exactly one worker instance (or add a Postgres advisory lock before scaling out).
const mdm = config().MDM_PROVIDER === "amapi" ? new AmapiProvider() : new FakeMdmProvider();

async function tick() {
  try {
    const n = await runDowntimeTick(mdm, new Date());
    if (n) console.log(JSON.stringify({ job: "downtime", switched: n }));
  } catch (e) {
    console.error("downtime tick failed", e instanceof Error ? e.message : e);
  }
}

await tick();
setInterval(tick, 60_000);
