import { makeMdm } from "../mdm/factory.js";
import { startScheduler } from "./scheduler.js";

// Standalone worker for production (run exactly one instance). For local pilots the API
// server runs the same scheduler in-process unless EMBED_SCHEDULER=false.
startScheduler(makeMdm());
