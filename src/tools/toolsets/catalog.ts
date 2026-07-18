import { TOOL_DISCOVERY_OVERRIDES } from "./overrides.js";
import {
  BUILD_PROFILE_TOOL_NAMES,
  CORE_PROFILE_TOOL_NAMES,
  DYNAMIC_MANAGEMENT_TOOL_NAME_SET,
  INSPECT_PROFILE_TOOL_NAMES,
  LIBRARY_PROFILE_TOOL_NAMES,
  RAW_CODE_TOOL_NAMES,
  SAFE_PROFILE_EXCLUDE,
  SHOW_PROFILE_TOOL_NAMES,
} from "./profiles.js";
import { TOOL_METADATA } from "./toolMetadata.generated.js";
import type {
  CapturedToolRegistration,
  DiscoverToolCandidate,
  DiscoverToolsInput,
  DiscoverToolsOutput,
  ToolCatalogEntry,
  ToolRisk,
  ToolsetPreset,
} from "./types.js";

const PRESETS = ["core", "inspect", "build", "show", "library"] as const;
const PROFILE_NAMES: Record<ToolsetPreset, readonly string[]> = {
  core: CORE_PROFILE_TOOL_NAMES,
  inspect: INSPECT_PROFILE_TOOL_NAMES,
  build: BUILD_PROFILE_TOOL_NAMES,
  show: SHOW_PROFILE_TOOL_NAMES,
  library: LIBRARY_PROFILE_TOOL_NAMES,
};
const PROFILE_NAME_SETS: Record<ToolsetPreset, ReadonlySet<string>> = {
  core: new Set(CORE_PROFILE_TOOL_NAMES),
  inspect: new Set(INSPECT_PROFILE_TOOL_NAMES),
  build: new Set(BUILD_PROFILE_TOOL_NAMES),
  show: new Set(SHOW_PROFILE_TOOL_NAMES),
  library: new Set(LIBRARY_PROFILE_TOOL_NAMES),
};
const RAW_CODE_NAME_SET: ReadonlySet<string> = new Set(RAW_CODE_TOOL_NAMES);

interface IndexedCatalogEntry {
  entry: ToolCatalogEntry;
  normalizedName: string;
  normalizedTitle: string;
  normalizedSummary: string;
  normalizedAliases: string[];
  normalizedAliasAndTags: string[];
}

interface ScoreCategory {
  label: string;
  ceiling: number;
  fields: readonly string[];
  allowPrefix: boolean;
}

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeDiscoveryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function displaySummary(description: string | undefined): string {
  const normalized = description?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) return "";
  const firstSentence = normalized.match(/^.*?[.!?](?=\s|$)/u)?.[0];
  return (firstSentence ?? normalized).slice(0, 240).trim();
}

function tokens(value: string): string[] {
  return value ? value.split(" ") : [];
}

function tokenMatches(queryToken: string, fieldToken: string, allowPrefix: boolean): boolean {
  return fieldToken === queryToken || (allowPrefix && fieldToken.startsWith(queryToken));
}

function matchedQueryTokens(
  queryTokens: readonly string[],
  fields: readonly string[],
  allowPrefix: boolean,
): number {
  const fieldTokens = fields.flatMap(tokens);
  return queryTokens.filter((queryToken) =>
    fieldTokens.some((fieldToken) => tokenMatches(queryToken, fieldToken, allowPrefix)),
  ).length;
}

function presetsFor(name: string): ToolsetPreset[] {
  return PRESETS.filter((preset) => PROFILE_NAME_SETS[preset].has(name));
}

function riskFor(entry: ToolCatalogEntry): ToolRisk {
  if (entry.rawCode) return "raw_code";
  if (entry.destructive) return "destructive";
  if (entry.readOnly) return "read_only";
  return "safe_mutation";
}

function riskAllowed(risk: ToolRisk, requested: DiscoverToolsInput["risk"]): boolean {
  if (requested === "any") return true;
  if (requested === "read_only") return risk === "read_only";
  return risk === "read_only" || risk === "safe_mutation";
}

function discoveryLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return 10;
  return Math.min(20, Math.max(1, Math.trunc(limit)));
}

function suggestionLimit(limit: number): number {
  if (Number.isNaN(limit)) return 5;
  return Math.min(5, Math.max(0, Math.trunc(limit)));
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        substitution,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

function indexRegistration(registration: CapturedToolRegistration): IndexedCatalogEntry {
  const override = Object.hasOwn(TOOL_DISCOVERY_OVERRIDES, registration.name)
    ? TOOL_DISCOVERY_OVERRIDES[registration.name]
    : undefined;
  const metadata = Object.hasOwn(TOOL_METADATA, registration.name)
    ? TOOL_METADATA[registration.name]
    : undefined;
  if (!metadata && !DYNAMIC_MANAGEMENT_TOOL_NAME_SET.has(registration.name)) {
    throw new Error(`Missing generated metadata for ${registration.name}`);
  }

  const summary = displaySummary(registration.description);
  const aliases = override?.aliases.map(normalizeDiscoveryText).filter(Boolean) ?? [];
  const tags = override?.tags.map(normalizeDiscoveryText).filter(Boolean) ?? [];
  const readOnly = registration.annotations?.readOnlyHint ?? false;
  const entry: ToolCatalogEntry = {
    name: registration.name,
    title: registration.title,
    summary,
    group: registration.group,
    tags: [...(override?.tags ?? [])],
    presets: presetsFor(registration.name),
    readOnly,
    destructive:
      SAFE_PROFILE_EXCLUDE.has(registration.name) ||
      (registration.annotations?.destructiveHint ?? !readOnly),
    rawCode: RAW_CODE_NAME_SET.has(registration.name),
    openWorld: registration.annotations?.openWorldHint ?? true,
    metadataBytes: metadata?.bytes ?? 0,
  };
  return {
    entry,
    normalizedName: normalizeDiscoveryText(registration.name),
    normalizedTitle: normalizeDiscoveryText(registration.title ?? ""),
    normalizedSummary: normalizeDiscoveryText(summary),
    normalizedAliases: aliases,
    normalizedAliasAndTags: [...aliases, ...tags],
  };
}

export class ToolCatalog {
  readonly entries: readonly ToolCatalogEntry[];
  readonly #indexed: readonly IndexedCatalogEntry[];
  readonly #byName: ReadonlyMap<string, IndexedCatalogEntry>;

  constructor(registrations: Iterable<CapturedToolRegistration>) {
    const indexed = [...registrations]
      .map(indexRegistration)
      .sort((a, b) => compareAscii(a.entry.name, b.entry.name));
    const byName = new Map<string, IndexedCatalogEntry>();
    for (const item of indexed) {
      if (byName.has(item.entry.name)) {
        throw new Error(`Duplicate captured tool registration: ${item.entry.name}`);
      }
      byName.set(item.entry.name, item);
    }
    this.#indexed = indexed;
    this.#byName = byName;
    this.entries = indexed.map((item) => item.entry);
  }

  get(name: string): ToolCatalogEntry | undefined {
    return this.#byName.get(name)?.entry;
  }

  namesForPreset(preset: ToolsetPreset): string[] {
    return PROFILE_NAMES[preset].filter((name) => this.#byName.has(name));
  }

  discover(input: DiscoverToolsInput): DiscoverToolsOutput {
    const normalizedQuery = normalizeDiscoveryText(input.query);
    if (!normalizedQuery) {
      throw new TypeError("Discovery query must be non-empty after normalization.");
    }
    const queryTokens = [...new Set(tokens(normalizedQuery))];
    const requestedRisk = input.risk ?? "safe_mutation";
    const candidates: DiscoverToolCandidate[] = [];

    for (const indexed of this.#indexed) {
      const risk = riskFor(indexed.entry);
      if (!riskAllowed(risk, requestedRisk)) continue;

      const reasons: string[] = [];
      let score = 0;
      if (indexed.normalizedName === normalizedQuery) {
        score = 1000;
        reasons.push("exact name");
      } else if (indexed.normalizedAliases.includes(normalizedQuery)) {
        score = 1000;
        reasons.push("exact alias");
      } else {
        const categories: readonly ScoreCategory[] = [
          {
            label: "name",
            ceiling: 600,
            fields: [indexed.normalizedName],
            allowPrefix: true,
          },
          {
            label: "alias/tag",
            ceiling: 350,
            fields: indexed.normalizedAliasAndTags,
            allowPrefix: false,
          },
          {
            label: "title",
            ceiling: 200,
            fields: [indexed.normalizedTitle],
            allowPrefix: false,
          },
          {
            label: "summary",
            ceiling: 100,
            fields: [indexed.normalizedSummary],
            allowPrefix: false,
          },
        ];
        for (const category of categories) {
          const matched = matchedQueryTokens(queryTokens, category.fields, category.allowPrefix);
          if (matched === 0) continue;
          score += Math.round(category.ceiling * (matched / queryTokens.length));
          reasons.push(`${category.label} ${matched}/${queryTokens.length}`);
        }
      }

      if (input.preset && indexed.entry.presets.includes(input.preset)) {
        score += 25;
        reasons.push(`preset ${input.preset}`);
      }
      if (score === 0) continue;

      candidates.push({
        name: indexed.entry.name,
        summary: indexed.entry.summary,
        group: indexed.entry.group,
        presets: [...indexed.entry.presets],
        risk,
        score,
        reason: reasons.join(", "),
      });
    }

    candidates.sort((a, b) => b.score - a.score || compareAscii(a.name, b.name));
    return {
      ok: true,
      query: input.query,
      normalized_query: normalizedQuery,
      candidates: candidates.slice(0, discoveryLimit(input.limit)),
    };
  }

  suggest(name: string, limit = 5): string[] {
    const normalizedName = normalizeDiscoveryText(name);
    const ranked = this.#indexed.map((item) => ({
      name: item.entry.name,
      prefix: normalizedName.length > 0 && item.normalizedName.startsWith(normalizedName),
      distance: levenshteinDistance(normalizedName, item.normalizedName),
    }));
    ranked.sort(
      (a, b) =>
        Number(b.prefix) - Number(a.prefix) ||
        a.distance - b.distance ||
        compareAscii(a.name, b.name),
    );
    return ranked.slice(0, suggestionLimit(limit)).map((item) => item.name);
  }
}
