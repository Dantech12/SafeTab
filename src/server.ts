import { buildApp } from "./app.js";
import { config } from "./config.js";
import { HttpPaystackClient } from "./billing/paystack.js";
import { FakeMdmProvider } from "./mdm/fake.js";
import { AmapiProvider } from "./mdm/amapi.js";
import { makePubSubVerifier } from "./mdm/pubsub.js";

const c = config();
if (c.NODE_ENV === "production" && c.MDM_PROVIDER === "fake") {
  throw new Error("MDM_PROVIDER=fake is not allowed in production");
}

const app = await buildApp({
  mdm: c.MDM_PROVIDER === "amapi" ? new AmapiProvider() : new FakeMdmProvider(),
  paystack: new HttpPaystackClient(c.PAYSTACK_SECRET_KEY, c.PAYSTACK_BASE_URL),
  verifyPubSubPush: makePubSubVerifier(c.PUBSUB_PUSH_AUDIENCE, c.PUBSUB_PUSH_SERVICE_ACCOUNT),
  now: () => new Date(),
});

await app.listen({ port: c.PORT, host: "0.0.0.0" });
