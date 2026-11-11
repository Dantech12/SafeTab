import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { config } from "../config.js";
import { audit } from "../audit.js";
import { verifyPaystackSignature } from "../billing/paystack.js";
import { handlePaystackEvent } from "../billing/service.js";
import { reconcileDeviceStatus } from "../policy/deploy.js";

const PubSubPush = z.object({
  message: z.object({
    data: z.string(),
    attributes: z.record(z.string(), z.string()).optional(),
    messageId: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  const { deps } = app;

  // Encapsulated scope: JSON bodies arrive as raw Buffers so signatures cover exact bytes.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/paystack", async (req, reply) => {
      const raw = req.body as Buffer;
      const sig = req.headers["x-paystack-signature"];
      if (!verifyPaystackSignature(raw, typeof sig === "string" ? sig : undefined, config().PAYSTACK_SECRET_KEY)) {
        return reply.status(401).send({ error: "bad_signature" });
      }
      await handlePaystackEvent(raw, deps.paystack, deps.now());
      return reply.status(200).send({ ok: true });
    });

    /**
     * Android Management API notifications via Google Cloud Pub/Sub push.
     * Authenticated by the OIDC token Pub/Sub attaches (audience + service account checked).
     */
    scope.post("/webhooks/amapi", async (req, reply) => {
      if (!(await deps.verifyPubSubPush(req.headers.authorization))) return reply.status(401).send({ error: "unauthenticated" });
      const raw = req.body as Buffer;
      const push = PubSubPush.parse(JSON.parse(raw.toString("utf8")));
      const id = `amapi:${push.message.messageId ?? createHash("sha256").update(raw).digest("hex")}`;
      const type = push.message.attributes?.notificationType ?? "UNKNOWN";
      const first = await q("INSERT INTO webhook_events (id, provider, event_type) VALUES ($1, 'amapi', $2) ON CONFLICT DO NOTHING", [id, type]);
      if (first.rowCount !== 1) return reply.status(204).send();
      if (type !== "ENROLLMENT" && type !== "STATUS_REPORT") return reply.status(204).send();

      const device = JSON.parse(Buffer.from(push.message.data, "base64").toString("utf8")) as {
        name?: string; enrollmentTokenName?: string; state?: string; appliedPolicyVersion?: string;
        lastStatusReportTime?: string; policyCompliant?: boolean; nonComplianceDetails?: any[];
      };
      const match = (await q("SELECT device_id, org_id FROM lookup_device_by_mdm($1, $2)", [device.enrollmentTokenName ?? null, device.name ?? null])).rows[0];
      if (!match) return reply.status(204).send(); // not ours / already deleted

      await withTenant(match.org_id, async (tx) => {
        if (type === "ENROLLMENT" && device.name) {
          await tx.query("UPDATE devices SET mdm_device_name = $2, state = 'active' WHERE id = $1 AND state = 'pending_enrollment'", [match.device_id, device.name]);
          await audit(tx, { actorType: "system", action: "device.enrolled", targetType: "device", targetId: match.device_id });
        }
        await reconcileDeviceStatus(tx, match.device_id, {
          name: device.name ?? "",
          state: device.state,
          appliedPolicyVersion: device.appliedPolicyVersion ? Number(device.appliedPolicyVersion) : undefined,
          lastStatusReportTime: device.lastStatusReportTime,
          policyCompliant: device.policyCompliant,
          nonComplianceDetails: device.nonComplianceDetails,
        }, deps.now());
      });
      return reply.status(204).send();
    });
  });
}
