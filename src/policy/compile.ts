import type { PolicySpec } from "./spec.js";

/**
 * Compiles SafeTab's policy document into an Android Management API (AMAPI) Policy.
 * Field names follow https://developers.google.com/android/management/reference/rest/v1/enterprises.policies
 * — re-verify enum values (e.g. playStoreMode) against current docs before production.
 */

export interface CompileInput {
  spec: PolicySpec;
  ownership: "school_owned" | "family_owned";
  inDowntime: boolean;
  companionPackage: string;
  apiBaseUrl: string;
  /** One-time code delivered via managed configuration until the companion app registers. */
  registrationCode?: string | null;
}

export interface ControlStatus {
  control: "downtime" | "apps" | "web" | "usageSummaries";
  supported: boolean;
  note?: string;
}

export interface CompileResult {
  policy: Record<string, unknown>;
  controls: ControlStatus[];
}

const CHROME = "com.android.chrome";

export function compilePolicy(input: CompileInput): CompileResult {
  const { spec } = input;
  const controls: ControlStatus[] = [];

  const companion: Record<string, unknown> = {
    packageName: input.companionPackage,
    installType: input.inDowntime ? "KIOSK" : "FORCE_INSTALLED",
    managedConfiguration: {
      api_base_url: input.apiBaseUrl,
      ...(input.registrationCode ? { registration_code: input.registrationCode } : {}),
      usage_summaries_enabled: spec.usageSummaries.enabled,
    },
  };

  const applications: Record<string, unknown>[] = [companion];
  const policy: Record<string, unknown> = {
    applications,
    // Transparency: shown on the device's lock screen / settings by the OS.
    shortSupportMessage: { defaultMessage: "This device is managed. Open the SafeTab app to see what is managed." },
    longSupportMessage: {
      defaultMessage:
        "This device is managed by your school or parent/guardian using SafeTab. Open the SafeTab app to see active controls, what information is collected and who can see it.",
    },
    // Safety baselines that keep management visible and prevent tampering.
    factoryResetDisabled: input.ownership === "school_owned",
    addUserDisabled: true,
    debuggingFeaturesAllowed: false,
  };

  // --- Apps ---------------------------------------------------------------
  if (spec.apps.mode === "allowlist") {
    policy.playStoreMode = "WHITELIST"; // AMAPI enum name; only listed apps are available
    for (const pkg of spec.apps.packages) {
      if (pkg === input.companionPackage) continue;
      applications.push({ packageName: pkg, installType: "AVAILABLE" });
    }
  } else {
    policy.playStoreMode = "BLACKLIST";
    for (const pkg of spec.apps.packages) {
      if (pkg === input.companionPackage) continue; // never let a policy remove the transparency app
      applications.push({ packageName: pkg, installType: "BLOCKED" });
    }
  }
  controls.push({ control: "apps", supported: true });

  // --- Web (managed Chrome only) -----------------------------------------
  if (spec.web.mode !== "off") {
    const domains = spec.web.domains;
    const managedConfiguration: Record<string, unknown> =
      spec.web.mode === "allowlist"
        ? { URLBlocklist: ["*"], URLAllowlist: domains }
        : { URLBlocklist: domains };
    const existing = applications.find((a) => a.packageName === CHROME);
    if (existing) existing.managedConfiguration = managedConfiguration;
    else applications.push({ packageName: CHROME, installType: "FORCE_INSTALLED", managedConfiguration });

    const otherBrowsersPossible = spec.apps.mode === "blocklist";
    controls.push({
      control: "web",
      supported: true,
      note: otherBrowsersPossible
        ? "Applies to Chrome only. Use app allowlist mode so other browsers cannot be installed."
        : "Applies to Chrome only.",
    });
  }

  // --- Downtime ------------------------------------------------------------
  if (spec.downtime.enabled) {
    // AMAPI has no native schedule. SafeTab switches the device into a kiosk policy whose
    // only app is the companion app (showing "Downtime until HH:MM") and back again.
    // Requires the device to be online at the window boundary.
    controls.push({
      control: "downtime",
      supported: true,
      note: "Applied by server-side policy switch at window boundaries; takes effect when the device is online.",
    });
    if (input.inDowntime) {
      policy.kioskCustomization = {
        statusBar: "NOTIFICATIONS_AND_SYSTEM_INFO_ENABLED",
        powerButtonActions: "POWER_BUTTON_AVAILABLE",
        systemErrorWarnings: "ERROR_AND_WARNINGS_ENABLED",
        deviceSettings: "SETTINGS_ACCESS_BLOCKED",
      };
    }
  }

  // --- Usage summaries -------------------------------------------------------
  if (spec.usageSummaries.enabled) {
    controls.push({
      control: "usageSummaries",
      supported: true,
      note: "Requires 'Usage access' to be granted to the SafeTab app in Android Settings; the app shows when it is collecting.",
    });
  }

  return { policy, controls };
}
