import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolProfile } from "../../utils/config.js";
import type { ToolRegistrar } from "../types.js";

export type ToolGroup =
  | "layer1"
  | "layer2"
  | "layer3"
  | "foundation"
  | "library"
  | "vault"
  | "ai"
  | "cli"
  | "util";
export type ToolsetPreset = "core" | "inspect" | "build" | "show" | "library";
export type SelectableToolsetPreset = ToolsetPreset | "safe" | "directory";
export type ToolProfileState = ToolProfile | "custom";
export type ToolRisk = "read_only" | "safe_mutation" | "destructive" | "raw_code";

export interface ToolRegistrarGroup {
  group: ToolGroup;
  registrars: readonly ToolRegistrar[];
}

export interface CapturedToolRegistration {
  name: string;
  group: ToolGroup;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  handle: RegisteredTool;
}

export interface ToolCatalogEntry {
  name: string;
  title?: string;
  summary: string;
  group: ToolGroup;
  tags: string[];
  presets: ToolsetPreset[];
  readOnly: boolean;
  destructive: boolean;
  rawCode: boolean;
  openWorld: boolean;
  metadataBytes: number;
}

export interface DiscoverToolsInput {
  query: string;
  preset?: ToolsetPreset;
  risk?: "read_only" | "safe_mutation" | "any";
  limit?: number;
}

export interface DiscoverToolCandidate {
  name: string;
  summary: string;
  group: ToolGroup;
  presets: ToolsetPreset[];
  risk: ToolRisk;
  score: number;
  reason: string;
}

export interface DiscoverToolsOutput {
  ok: true;
  query: string;
  normalized_query: string;
  candidates: DiscoverToolCandidate[];
}

export interface SelectToolsetInput {
  preset?: SelectableToolsetPreset;
  tools?: string[];
  mode?: "replace" | "add";
  include_risky?: boolean;
}

export interface ToolsetTransitionOutput {
  ok: true;
  previous_profile: ToolProfileState;
  current_profile: ToolProfileState;
  active_count: number;
  metadata_bytes: number;
  added: string[];
  removed: string[];
  warnings: string[];
  client_refresh_required: true;
}

export interface ActiveToolsetOutput {
  ok: true;
  startup_profile: ToolProfile;
  current_profile: ToolProfileState;
  active_tools: string[];
  active_count: number;
  metadata_bytes: number;
  max_active: number;
  metadata_budget_bytes: number;
  dynamic_toolsets: boolean;
  protected_core: string[];
}

export interface ToolsetController {
  discover(input: DiscoverToolsInput): DiscoverToolsOutput;
  select(input: SelectToolsetInput): Promise<ToolsetTransitionOutput>;
  getActive(): ActiveToolsetOutput;
  reset(): Promise<ToolsetTransitionOutput>;
}

export interface ToolsetManagerOptions {
  server: McpServer;
  startupProfile: ToolProfile;
  maxActive: number;
  metadataBudgetBytes: number;
  allowRawPython: boolean;
}

export interface GeneratedToolMetadataEntry {
  bytes: number;
  fingerprint: string;
}
