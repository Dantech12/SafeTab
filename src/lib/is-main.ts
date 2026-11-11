import { pathToFileURL } from "node:url";

/**
 * True when the calling module is the script Node was started with.
 * Uses pathToFileURL so it also works on Windows (C:\... -> file:///C:/...).
 */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return !!entry && importMetaUrl === pathToFileURL(entry).href;
}
