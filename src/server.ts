import { buildApp } from "./app.js";
import { config } from "./config.js";
import { HttpPaystackClient } from "./billing/paystack.js";
import { makeMdm } from "./mdm/factory.js";
import { makePubSubVerifier } from "./mdm/pubsub.js";
import { startScheduler } from "./jobs/scheduler.js";

const c = config();
const mdm = makeMdm();

const app = await buildApp({
  mdm,
  paystack: new HttpPaystackClient(c.PAYSTACK_SECRET_KEY, c.PAYSTACK_BASE_URL),
  // In poll mode the Pub/Sub endpoint stays closed (verifier rejects everything).
  verifyPubSubPush: c.DEVICE_STATUS_MODE === "pubsub"
    ? makePubSubVerifier(c.PUBSUB_PUSH_AUDIENCE, c.PUBSUB_PUSH_SERVICE_ACCOUNT)
    : async () => false,
  now: () => new Date(),
});

await app.listen({ port: c.PORT, host: c.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1" });

// Local pilot convenience: run scheduled jobs here so one window is enough.
// Production runs `npm run worker` as a separate single instance instead.
if (c.EMBED_SCHEDULER) startScheduler(mdm, (m) => app.log.info(m));
console.log(`\nSafeTab portal: open ${c.PUBLIC_BASE_URL} in your browser\n`);
