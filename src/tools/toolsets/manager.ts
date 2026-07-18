import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolCatalog } from "./catalog.js";
import { type MetadataContributor, normalizeToolsetError, ToolsetError } from "./errors.js";
import { serializedToolListBytesFromEntries } from "./metadata.js";
import { PROTECTED_CORE_TOOL_NAMES, RAW_CODE_TOOL_NAMES, staticProfileAllows } from "./profiles.js";
import type {
  ActiveToolsetOutput,
  CapturedToolRegistration,
  DiscoverToolsInput,
  DiscoverToolsOutput,
  SelectableToolsetPreset,
  SelectToolsetInput,
  ToolProfileState,
  ToolsetController,
  ToolsetManagerOptions,
  ToolsetPreset,
  ToolsetTransitionOutput,
} from "./types.js";

const SELECTABLE_PRESETS = [
  "core",
  "inspect",
  "build",
  "show",
  "library",
  "safe",
  "directory",
] as const satisfies readonly SelectableToolsetPreset[];
const SELECTABLE_PRESET_SET: ReadonlySet<string> = new Set(SELECTABLE_PRESETS);
const ORDINARY_PRESET_SET: ReadonlySet<string> = new Set([
  "core",
  "inspect",
  "build",
  "show",
  "library",
]);
const RAW_CODE_NAME_SET: ReadonlySet<string> = new Set(RAW_CODE_TOOL_NAMES);

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCompatibilityProfile(profile: ToolProfileState): boolean {
  return profile === "full" || profile === "safe";
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((name) => !right.has(name)).sort(compareAscii);
}

interface ResolvedSelection {
  names: string[];
  preset?: SelectableToolsetPreset;
  mode: "replace" | "add";
  explicit: boolean;
  includeRisky: boolean;
}

export class ToolsetManager implements ToolsetController {
  readonly #server: ToolsetManagerOptions["server"];
  readonly #startupProfile: ToolsetManagerOptions["startupProfile"];
  readonly #maxActive: number;
  readonly #metadataBudgetBytes: number;
  readonly #allowRawPython: boolean;
  readonly #registrations = new Map<string, CapturedToolRegistration>();
  readonly #handles = new Map<string, RegisteredTool>();
  #catalog: ToolCatalog | undefined;
  #startupEnabled: ReadonlyMap<string, boolean> = new Map();
  #currentProfile: ToolProfileState;
  #initialized = false;
  #transitionTail: Promise<void> = Promise.resolve();

  constructor(options: ToolsetManagerOptions) {
    this.#server = options.server;
    this.#startupProfile = options.startupProfile;
    this.#currentProfile = options.startupProfile;
    this.#maxActive = options.maxActive;
    this.#metadataBudgetBytes = options.metadataBudgetBytes;
    this.#allowRawPython = options.allowRawPython;
  }

  capture(entry: CapturedToolRegistration): void {
    if (this.#initialized) throw new Error("Toolset manager is already initialized.");
    if (this.#registrations.has(entry.name)) {
      throw new Error("Duplicate captured tool registration.");
    }
    this.#registrations.set(entry.name, entry);
    this.#handles.set(entry.name, entry.handle);
  }

  initialize(): void {
    if (this.#initialized) throw new Error("Toolset manager is already initialized.");
    try {
      const catalog = new ToolCatalog(this.#registrations.values());
      this.#assertProtectedCoreCaptured();
      const targetNames = this.#namesForProfile(this.#startupProfile, catalog);
      const target = this.#targetState(targetNames);
      this.#validateBudgets(
        new Set(targetNames),
        catalog,
        isCompatibilityProfile(this.#startupProfile),
      );
      this.#applyLifecycle(target, false);

      this.#catalog = catalog;
      this.#startupEnabled = new Map(target);
      this.#currentProfile = this.#startupProfile;
      this.#initialized = true;
    } catch (error) {
      throw normalizeToolsetError(error);
    }
  }

  discover(input: DiscoverToolsInput): DiscoverToolsOutput {
    return this.#catalogForUse().discover(input);
  }

  select(input: SelectToolsetInput): Promise<ToolsetTransitionOutput> {
    return this.#enqueueTransition(() => this.#selectNow(input));
  }

  getActive(): ActiveToolsetOutput {
    const catalog = this.#catalogForUse();
    const activeTools = this.#activeNames();
    return {
      ok: true,
      startup_profile: this.#startupProfile,
      current_profile: this.#currentProfile,
      active_tools: activeTools,
      active_count: activeTools.length,
      metadata_bytes: this.#metadataBytes(activeTools, catalog),
      max_active: this.#maxActive,
      metadata_budget_bytes: this.#metadataBudgetBytes,
      dynamic_toolsets: true,
      protected_core: [...PROTECTED_CORE_TOOL_NAMES].sort(compareAscii),
    };
  }

  reset(): Promise<ToolsetTransitionOutput> {
    return this.#enqueueTransition(() => this.#resetNow());
  }

  #selectNow(input: SelectToolsetInput): ToolsetTransitionOutput {
    const catalog = this.#catalogForUse();
    const selection = this.#resolveSelection(input, catalog);
    const requested = new Set(selection.names);
    const targetNames = selection.mode === "add" ? new Set(this.#activeNames()) : new Set<string>();
    for (const name of requested) targetNames.add(name);
    for (const name of PROTECTED_CORE_TOOL_NAMES) targetNames.add(name);

    const unknown = [...requested]
      .filter((name) => !catalog.get(name) && !RAW_CODE_NAME_SET.has(name))
      .sort(compareAscii);
    if (unknown.length > 0) {
      const closeMatches: string[] = [];
      for (const name of unknown) {
        for (const suggestion of catalog.suggest(name, 5)) {
          if (!closeMatches.includes(suggestion)) closeMatches.push(suggestion);
          if (closeMatches.length === 5) break;
        }
        if (closeMatches.length === 5) break;
      }
      throw new ToolsetError("unknown_tool", "Toolset selection includes unknown tools.", {
        close_matches: closeMatches,
      });
    }

    const riskyTools = [...requested]
      .filter((name) => {
        const entry = catalog.get(name);
        return (
          RAW_CODE_NAME_SET.has(name) || entry?.rawCode === true || entry?.destructive === true
        );
      })
      .sort(compareAscii);
    if (riskyTools.length > 0 && (!selection.explicit || !selection.includeRisky)) {
      throw new ToolsetError(
        "risky_tool_requires_explicit_opt_in",
        "Risky tools require explicit opt-in.",
        { risky_tools: riskyTools },
      );
    }

    const rawTools = riskyTools.filter((name) => RAW_CODE_NAME_SET.has(name));
    if (rawTools.length > 0 && !this.#allowRawPython) {
      throw new ToolsetError("raw_python_disabled", "Raw Python tools are disabled.", {
        raw_tools: rawTools,
      });
    }
    if ([...targetNames].some((name) => !this.#handles.has(name))) {
      throw new ToolsetError("invalid_selection", "Toolset selection is invalid.");
    }

    this.#validateBudgets(targetNames, catalog, false);
    const target = this.#targetState(targetNames);
    const nextProfile: ToolProfileState =
      selection.mode === "add" ? "custom" : (selection.preset ?? "custom");
    return this.#transitionTo(target, nextProfile, catalog);
  }

  #resetNow(): ToolsetTransitionOutput {
    const catalog = this.#catalogForUse();
    const startupNames = new Set(
      [...this.#startupEnabled].filter(([, enabled]) => enabled).map(([name]) => name),
    );
    this.#validateBudgets(startupNames, catalog, isCompatibilityProfile(this.#startupProfile));
    return this.#transitionTo(new Map(this.#startupEnabled), this.#startupProfile, catalog);
  }

  #resolveSelection(input: SelectToolsetInput, catalog: ToolCatalog): ResolvedSelection {
    const raw = input as unknown as Record<string, unknown>;
    const presetProvided = raw.preset !== undefined;
    const toolsProvided = raw.tools !== undefined;
    const mode = raw.mode ?? "replace";
    const includeRisky = raw.include_risky ?? false;
    if (
      presetProvided === toolsProvided ||
      (mode !== "replace" && mode !== "add") ||
      typeof includeRisky !== "boolean" ||
      (presetProvided && includeRisky)
    ) {
      throw new ToolsetError("invalid_selection", "Toolset selection is invalid.");
    }

    if (presetProvided) {
      if (typeof raw.preset !== "string" || !SELECTABLE_PRESET_SET.has(raw.preset)) {
        throw new ToolsetError("invalid_selection", "Toolset selection is invalid.");
      }
      const preset = raw.preset as SelectableToolsetPreset;
      return {
        names: this.#namesForProfile(preset, catalog),
        preset,
        mode,
        explicit: false,
        includeRisky: false,
      };
    }

    if (
      !Array.isArray(raw.tools) ||
      raw.tools.length === 0 ||
      raw.tools.some((name) => typeof name !== "string" || name.length === 0)
    ) {
      throw new ToolsetError("invalid_selection", "Toolset selection is invalid.");
    }
    return {
      names: [...new Set(raw.tools as string[])].sort(compareAscii),
      mode,
      explicit: true,
      includeRisky,
    };
  }

  #transitionTo(
    target: ReadonlyMap<string, boolean>,
    nextProfile: ToolProfileState,
    catalog: ToolCatalog,
  ): ToolsetTransitionOutput {
    const beforeNames = new Set(this.#activeNames());
    const targetNames = new Set([...target].filter(([, enabled]) => enabled).map(([name]) => name));
    const previousProfile = this.#currentProfile;
    const metadataBytes = this.#metadataBytes(targetNames, catalog);
    this.#applyLifecycle(target, true);
    this.#currentProfile = nextProfile;
    return {
      ok: true,
      previous_profile: previousProfile,
      current_profile: nextProfile,
      active_count: targetNames.size,
      metadata_bytes: metadataBytes,
      added: difference(targetNames, beforeNames),
      removed: difference(beforeNames, targetNames),
      warnings: [],
      client_refresh_required: true,
    };
  }

  #enqueueTransition<T>(operation: () => T): Promise<T> {
    const run = this.#transitionTail.then(operation, operation);
    this.#transitionTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #validateBudgets(names: ReadonlySet<string>, catalog: ToolCatalog, exempt: boolean): void {
    const requestedCount = names.size;
    const requestedBytes = this.#metadataBytes(names, catalog);
    if (exempt) return;
    const largestContributors = this.#largestContributors(names, catalog);
    const suggestedPresets = this.#suggestedPresets(requestedCount, requestedBytes, catalog);
    if (requestedCount > this.#maxActive) {
      throw new ToolsetError(
        "active_tool_limit_exceeded",
        "Requested toolset exceeds the active tool limit.",
        {
          requested_count: requestedCount,
          max_active: this.#maxActive,
          largest_contributors: largestContributors,
          suggested_presets: suggestedPresets,
        },
      );
    }
    if (requestedBytes > this.#metadataBudgetBytes) {
      throw new ToolsetError(
        "metadata_budget_exceeded",
        "Requested toolset exceeds the metadata budget.",
        {
          requested_bytes: requestedBytes,
          metadata_budget_bytes: this.#metadataBudgetBytes,
          largest_contributors: largestContributors,
          suggested_presets: suggestedPresets,
        },
      );
    }
  }

  #suggestedPresets(
    requestedCount: number,
    requestedBytes: number,
    catalog: ToolCatalog,
  ): SelectableToolsetPreset[] {
    return SELECTABLE_PRESETS.filter((preset) => {
      const names = new Set(this.#namesForProfile(preset, catalog));
      const bytes = this.#metadataBytes(names, catalog);
      return (
        names.size <= this.#maxActive &&
        bytes <= this.#metadataBudgetBytes &&
        (names.size < requestedCount || bytes < requestedBytes)
      );
    });
  }

  #largestContributors(names: Iterable<string>, catalog: ToolCatalog): MetadataContributor[] {
    return [...names]
      .map((name) => ({ name, bytes: this.#metadataEntryBytes(name, catalog) }))
      .sort((left, right) => right.bytes - left.bytes || compareAscii(left.name, right.name))
      .slice(0, 10);
  }

  #metadataBytes(names: Iterable<string>, catalog: ToolCatalog): number {
    return serializedToolListBytesFromEntries(
      [...names].sort(compareAscii).map((name) => this.#metadataEntryBytes(name, catalog)),
    );
  }

  #metadataEntryBytes(name: string, catalog: ToolCatalog): number {
    const entry = catalog.get(name);
    if (!entry) {
      throw new ToolsetError("toolset_transition_failed", "Toolset transition rolled back.");
    }
    return entry.metadataBytes;
  }

  #namesForProfile(
    profile: ToolsetManagerOptions["startupProfile"],
    catalog: ToolCatalog,
  ): string[] {
    const names = new Set<string>();
    if (profile === "full") {
      for (const name of this.#handles.keys()) names.add(name);
    } else if (ORDINARY_PRESET_SET.has(profile)) {
      for (const name of catalog.namesForPreset(profile as ToolsetPreset)) names.add(name);
    } else {
      for (const name of this.#handles.keys()) {
        if (staticProfileAllows(name, profile)) names.add(name);
      }
    }
    for (const name of PROTECTED_CORE_TOOL_NAMES) names.add(name);
    return [...names].sort(compareAscii);
  }

  #targetState(names: ReadonlySet<string> | readonly string[]): Map<string, boolean> {
    const selected = names instanceof Set ? names : new Set(names);
    return new Map(this.#handleEntries().map(([name]) => [name, selected.has(name)]));
  }

  #activeNames(): string[] {
    return this.#handleEntries()
      .filter(([, handle]) => handle.enabled)
      .map(([name]) => name);
  }

  #handleEntries(): Array<[string, RegisteredTool]> {
    return [...this.#handles].sort(([left], [right]) => compareAscii(left, right));
  }

  #applyLifecycle(target: ReadonlyMap<string, boolean>, notify: boolean): void {
    const before = new Map(this.#handleEntries().map(([name, handle]) => [name, handle.enabled]));
    const mutableServer = this.#server as unknown as { sendToolListChanged: () => void };
    const previousNotify = mutableServer.sendToolListChanged;
    const originalNotify = previousNotify.bind(this.#server);
    mutableServer.sendToolListChanged = () => {};
    try {
      for (const [name, shouldEnable] of target) {
        const handle = this.#handles.get(name);
        if (!handle || handle.enabled === shouldEnable) continue;
        if (shouldEnable) handle.enable();
        else handle.disable();
      }
    } catch {
      this.#restoreLifecycleSnapshot(before);
      throw new ToolsetError("toolset_transition_failed", "Toolset transition rolled back.");
    } finally {
      mutableServer.sendToolListChanged = previousNotify;
    }
    if (!notify) return;
    try {
      originalNotify();
    } catch {
      mutableServer.sendToolListChanged = () => {};
      try {
        this.#restoreLifecycleSnapshot(before);
      } finally {
        mutableServer.sendToolListChanged = previousNotify;
      }
      throw new ToolsetError("toolset_transition_failed", "Toolset transition rolled back.");
    }
  }

  #restoreLifecycleSnapshot(before: ReadonlyMap<string, boolean>): void {
    for (const [name, wasEnabled] of before) {
      const handle = this.#handles.get(name);
      if (!handle || handle.enabled === wasEnabled) continue;
      try {
        handle.update({ enabled: wasEnabled });
      } catch {
        // Continue restoring every remaining handle without exposing lifecycle failures.
      }
    }
  }

  #assertProtectedCoreCaptured(): void {
    if (PROTECTED_CORE_TOOL_NAMES.some((name) => !this.#handles.has(name))) {
      throw new Error("Missing protected core tool registration.");
    }
  }

  #catalogForUse(): ToolCatalog {
    if (!this.#initialized || !this.#catalog) {
      throw new ToolsetError("toolset_transition_failed", "Toolset transition rolled back.");
    }
    return this.#catalog;
  }
}
