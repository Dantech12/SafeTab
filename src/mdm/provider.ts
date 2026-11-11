/**
 * Narrow abstraction over the device-management backend so that platform-specific code
 * stays modular. Only Android (Android Management API) is implemented. An Apple MDM
 * provider would be a separate implementation with its own, different feature set.
 */
export interface EnrollmentToken {
  name: string; // e.g. enterprises/E/enrollmentTokens/T
  qrCode: string; // JSON payload rendered as QR at device setup
  expiresAt: Date;
}

export interface MdmDeviceStatus {
  name: string;
  state?: string; // ACTIVE, DISABLED, DELETED, PROVISIONING, LOST ...
  appliedPolicyVersion?: number;
  lastStatusReportTime?: string;
  policyCompliant?: boolean;
  nonComplianceDetails?: { settingName?: string; nonComplianceReason?: string; packageName?: string }[];
  enrollmentTokenName?: string;
}

export interface MdmProvider {
  createEnrollmentToken(enterprise: string, policyId: string, durationSeconds: number, additionalData: string): Promise<EnrollmentToken>;
  /** Creates or replaces a policy; returns the MDM-assigned version. */
  upsertPolicy(enterprise: string, policyId: string, policy: Record<string, unknown>): Promise<{ name: string; version: number }>;
  getDevice(deviceName: string): Promise<MdmDeviceStatus>;
  /** Visible lock of a lost device (official LOCK command). */
  lockDevice(deviceName: string): Promise<void>;
  /** Removes management (AMAPI devices.delete wipes a fully managed device). */
  deleteDevice(deviceName: string): Promise<void>;
  /** All devices of an enterprise (used by the status-polling job instead of Pub/Sub). */
  listDevices(enterprise: string): Promise<MdmDeviceStatus[]>;
  /** Step 1 of enterprise signup: a Google-hosted URL the org admin opens. */
  createSignupUrl(callbackUrl: string): Promise<{ name: string; url: string }>;
  /** Step 2: exchange the token Google appends to the callback for an enterprise. */
  createEnterprise(signupUrlName: string, enterpriseToken: string, displayName: string): Promise<{ name: string }>;
}

export const policyIdForDevice = (deviceId: string) => `device-${deviceId}`;
