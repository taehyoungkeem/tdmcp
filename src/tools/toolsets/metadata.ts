import { createHash } from "node:crypto";
import { TOOL_METADATA } from "./toolMetadata.generated.js";
import type { GeneratedToolMetadataEntry } from "./types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  if (serialized === undefined) {
    throw new TypeError("Tool metadata must be JSON-serializable.");
  }
  return serialized;
}

export function fingerprintTool(tool: unknown): string {
  return createHash("sha256").update(canonicalJson(tool)).digest("hex");
}

export function serializedToolListBytesFromEntries(entryBytes: readonly number[]): number {
  return (
    12 + entryBytes.reduce((sum, bytes) => sum + bytes, 0) + Math.max(0, entryBytes.length - 1)
  );
}

export function serializedToolListBytes(names: Iterable<string>): number {
  const bytes = [...names].sort().map((name) => {
    const entry: GeneratedToolMetadataEntry | undefined = TOOL_METADATA[name];
    if (!entry) throw new Error(`Missing generated metadata for ${name}`);
    return entry.bytes;
  });
  return serializedToolListBytesFromEntries(bytes);
}
