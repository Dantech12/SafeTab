import { config } from "../config.js";
import { AmapiProvider } from "./amapi.js";
import { FakeMdmProvider } from "./fake.js";
import type { MdmProvider } from "./provider.js";

export function makeMdm(): MdmProvider {
  const c = config();
  if (c.MDM_PROVIDER === "amapi") return new AmapiProvider(c.GOOGLE_CLOUD_PROJECT_ID!);
  if (c.NODE_ENV === "production") throw new Error("MDM_PROVIDER=fake is not allowed in production");
  return new FakeMdmProvider();
}
