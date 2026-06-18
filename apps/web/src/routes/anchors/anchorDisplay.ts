import type { CatalogEntry, CatalogEntryKind } from "../../lib/catalog";

export const ANCHOR_KINDS: Array<{ id: CatalogEntryKind | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "character", label: "Characters" },
  { id: "story", label: "Stories" },
  { id: "image", label: "Images" },
];

export function isAnchorKind(value: string | null): value is CatalogEntryKind {
  return value === "character" || value === "story" || value === "image";
}

export function kindLabel(kind: CatalogEntryKind): string {
  if (kind === "character") return "Character";
  if (kind === "story") return "Story";
  return "Image";
}

export function formatUseCount(count: number): string {
  if (count === 1) return "1 use";
  return `${new Intl.NumberFormat().format(count)} uses`;
}

export function entrySummary(entry: CatalogEntry): string {
  return (
    entry.summary?.trim() ||
    entry.snapshot?.story?.logline?.trim() ||
    entry.snapshot?.logline?.trim() ||
    entry.snapshot?.description?.trim() ||
    entry.snapshot?.searchText?.trim() ||
    "No summary yet."
  );
}
