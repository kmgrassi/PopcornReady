import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { AssetCritiqueDialog } from "./AssetCritiqueDialog";

export function AssetCritiqueButton({
  projectId,
  assetId,
  title,
  subtitle,
  preview,
  size = "sm",
}: {
  projectId: string;
  assetId: string;
  title: string;
  subtitle?: string | null;
  preview: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        Receive feedback
      </Button>
      <AssetCritiqueDialog
        open={open}
        projectId={projectId}
        assetId={assetId}
        title={title}
        subtitle={subtitle}
        preview={preview}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
