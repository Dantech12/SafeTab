import type { EnrollmentToken, MdmDeviceStatus, MdmProvider } from "./provider.js";

/** In-memory provider for local development and automated tests. No real devices. */
export class FakeMdmProvider implements MdmProvider {
  policies = new Map<string, { version: number; policy: Record<string, unknown> }>();
  devices = new Map<string, MdmDeviceStatus>();
  commands: { device: string; type: string }[] = [];
  failNextUpsert = false;
  private seq = 0;

  async createEnrollmentToken(enterprise: string, policyId: string, durationSeconds: number, additionalData: string): Promise<EnrollmentToken> {
    const name = `${enterprise}/enrollmentTokens/tok${++this.seq}`;
    return {
      name,
      qrCode: JSON.stringify({ fake: true, policyId, additionalData }),
      expiresAt: new Date(Date.now() + durationSeconds * 1000),
    };
  }

  async upsertPolicy(enterprise: string, policyId: string, policy: Record<string, unknown>) {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("simulated MDM failure");
    }
    const name = `${enterprise}/policies/${policyId}`;
    const version = (this.policies.get(name)?.version ?? 0) + 1;
    this.policies.set(name, { version, policy });
    return { name, version };
  }

  async getDevice(deviceName: string): Promise<MdmDeviceStatus> {
    return this.devices.get(deviceName) ?? { name: deviceName, state: "DELETED" };
  }

  async lockDevice(deviceName: string) {
    this.commands.push({ device: deviceName, type: "LOCK" });
  }

  async deleteDevice(deviceName: string) {
    this.commands.push({ device: deviceName, type: "DELETE" });
    this.devices.delete(deviceName);
  }
}
