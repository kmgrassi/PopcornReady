import { useEffect, useId, useMemo, useState } from "react";
import { type CatalogEntryKind } from "../../lib/catalog";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import styles from "./PublishAnchorDialog.module.css";

type PublishAnchorSource =
  | {
      type: "asset";
      assetId: string;
      defaultKind?: Extract<CatalogEntryKind, "character" | "image">;
      title?: string | null;
      summary?: string | null;
    }
  | {
      type: "story";
      storyBlueprintId: string;
      title?: string | null;
      summary?: string | null;
    };

export interface PublishAnchorDialogProps {
  source: PublishAnchorSource | null;
  onClose: () => void;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function defaultKind(source: PublishAnchorSource): CatalogEntryKind {
  if (source.type === "story") return "story";
  return source.defaultKind ?? "image";
}

function sourceTitle(source: PublishAnchorSource): string {
  return source.title?.trim() || (source.type === "story" ? "Story anchor" : "Image anchor");
}

function sourceSummary(source: PublishAnchorSource): string {
  return source.summary?.trim() ?? "";
}

export function PublishAnchorDialog({ source, onClose }: PublishAnchorDialogProps) {
  const titleId = useId();
  const [kind, setKind] = useState<CatalogEntryKind>("image");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!source) return;
    setKind(defaultKind(source));
    setTitle(sourceTitle(source));
    setSummary(sourceSummary(source));
    setTags("");
  }, [source]);

  const canSubmit = useMemo(() => Boolean(source && title.trim()), [source, title]);
  if (!source) return null;

  const kindOptions =
    source.type === "story"
      ? [{ value: "story" as const, label: "Story" }]
      : [
          { value: "image" as const, label: "Image" },
          { value: "character" as const, label: "Character" },
        ];

  const parsedTags = parseTags(tags);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={styles.dialog}
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => event.preventDefault()}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Anchors</p>
            <h2 id={titleId}>Publish as anchor</h2>
          </div>
          <CloseButton className={styles.closeButton} onClick={onClose} />
        </header>

        <label className={styles.field}>
          <span>Kind</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CatalogEntryKind)}
            disabled={source.type === "story"}
          >
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Title</span>
          <input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>

        <label className={styles.field}>
          <span>Summary</span>
          <textarea
            value={summary}
            rows={4}
            maxLength={640}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Tags</span>
          <input
            value={tags}
            placeholder="noir, product, hero"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>

        {canSubmit ? (
          <p className={styles.pending}>
            {title.trim()} will publish as a {kind} anchor
            {parsedTags.length > 0 ? ` with ${parsedTags.length} tag${parsedTags.length === 1 ? "" : "s"}` : ""} once the catalog API lands.
          </p>
        ) : null}

        <footer className={styles.actions}>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled>
            Publish pending API
          </Button>
        </footer>
      </form>
    </div>
  );
}
