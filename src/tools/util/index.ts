import type { ToolRegistrar } from "../types.js";
import { registerDiscoverTools } from "./discoverTools.js";
import { registerGetActiveToolset } from "./getActiveToolset.js";
import { registerResetToolset } from "./resetToolset.js";
import { registerSelectToolset } from "./selectToolset.js";

export type {
  DropExternalToxOk,
  DropExternalToxOptions,
  DropExternalToxResult,
} from "./dropExternalTox.js";
export { dropExternalTox } from "./dropExternalTox.js";
export type { ToxCandidatePrecheckResult } from "./toxCandidatePrecheck.js";
export { precheckToxCandidates } from "./toxCandidatePrecheck.js";

export const utilRegistrars: ToolRegistrar[] = [
  registerDiscoverTools,
  registerSelectToolset,
  registerGetActiveToolset,
  registerResetToolset,
];
