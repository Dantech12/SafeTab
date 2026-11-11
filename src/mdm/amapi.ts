import { GoogleAuth } from "google-auth-library";
import type { EnrollmentToken, MdmDeviceStatus, MdmProvider } from "./provider.js";

/**
 * Android Management API client (REST, v1). Uses a service account with the
 * https://www.googleapis.com/auth/androidmanagement scope. Requires a Google Cloud
 * project with the API enabled and an enterprise created via signupUrls/enterprises.create.
 *
 * NOT exercised by automated tests — validate against a real test enterprise and devices.
 */
const BASE = "https://androidmanagement.googleapis.com/v1";

function toStatus(d: any): MdmDeviceStatus {
  return {
    name: d.name,
    state: d.state,
    appliedPolicyVersion: d.appliedPolicyVersion ? Number(d.appliedPolicyVersion) : undefined,
    lastStatusReportTime: d.lastStatusReportTime,
    policyCompliant: d.policyCompliant,
    nonComplianceDetails: d.nonComplianceDetails,
    enrollmentTokenName: d.enrollmentTokenName,
  };
}

export class AmapiProvider implements MdmProvider {
  constructor(private projectId: string) {}
  private auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidmanagement"] });

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const client = await this.auth.getClient();
    const res = await client.request<T>({ url: `${BASE}/${path}`, method: method as "GET", data: body });
    return res.data;
  }

  async createEnrollmentToken(enterprise: string, policyId: string, durationSeconds: number, additionalData: string): Promise<EnrollmentToken> {
    const tok = await this.call<{ name: string; qrCode: string; expirationTimestamp: string }>(
      "POST",
      `${enterprise}/enrollmentTokens`,
      {
        policyName: `${enterprise}/policies/${policyId}`,
        duration: `${durationSeconds}s`,
        additionalData,
        oneTimeOnly: true,
        allowPersonalUsage: "PERSONAL_USAGE_DISALLOWED", // fully managed school/family device
      },
    );
    return { name: tok.name, qrCode: tok.qrCode, expiresAt: new Date(tok.expirationTimestamp) };
  }

  async upsertPolicy(enterprise: string, policyId: string, policy: Record<string, unknown>) {
    // PATCH without updateMask replaces the whole policy (creating it if absent).
    const res = await this.call<{ name: string; version: string }>("PATCH", `${enterprise}/policies/${policyId}`, policy);
    return { name: res.name, version: Number(res.version) };
  }

  async getDevice(deviceName: string): Promise<MdmDeviceStatus> {
    return toStatus(await this.call<any>("GET", deviceName));
  }

  async lockDevice(deviceName: string) {
    await this.call("POST", `${deviceName}:issueCommand`, { type: "LOCK" });
  }

  async deleteDevice(deviceName: string) {
    await this.call("DELETE", deviceName);
  }

  async listDevices(enterprise: string): Promise<MdmDeviceStatus[]> {
    const out: MdmDeviceStatus[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ pageSize: "100", ...(pageToken ? { pageToken } : {}) });
      const page = await this.call<{ devices?: any[]; nextPageToken?: string }>("GET", `${enterprise}/devices?${qs}`);
      for (const d of page.devices ?? []) out.push(toStatus(d));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async createSignupUrl(callbackUrl: string) {
    const qs = new URLSearchParams({ projectId: this.projectId, callbackUrl });
    return this.call<{ name: string; url: string }>("POST", `signupUrls?${qs}`);
  }

  async createEnterprise(signupUrlName: string, enterpriseToken: string, displayName: string) {
    const qs = new URLSearchParams({ projectId: this.projectId, signupUrlName, enterpriseToken });
    // No pubsubTopic: pilot uses status polling (no Pub/Sub / billing required).
    return this.call<{ name: string }>("POST", `enterprises?${qs}`, { enterpriseDisplayName: displayName });
  }
}
