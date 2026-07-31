import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";
import { RerunProposalDialog } from "../ai-edit/RerunProposalDialog";
import styles from "./AssetEditModal.module.css";

export interface AssetEditModalProps {
  open: boolean;
  projectId: string;
  target: BoardRevisionTarget | null;
  imageUrl?: string | null;
  title?: string;
  subtitle?: string | null;
  sourcePrompt?: string | null;
  initialPrompt?: string;
  onClose: () => void;
  onExecutionStarted?: (target: BoardRevisionTarget) => Promise<void> | void;
  onExecutionSettled?: (target: BoardRevisionTarget) => Promise<void> | void;
}

export function AssetEditModal({
  open,
  projectId,
  target,
  imageUrl,
  title = "Edit this asset",
  subtitle,
  sourcePrompt,
  initialPrompt,
  onClose,
  onExecutionStarted,
  onExecutionSettled,
}: AssetEditModalProps) {
  return (
    <RerunProposalDialog
      open={open}
      projectId={projectId}
      target={target}
      title={title}
      subtitle={subtitle}
      sourcePrompt={sourcePrompt}
      initialMessage={initialPrompt}
      onClose={onClose}
      onExecutionStarted={onExecutionStarted}
      onExecutionSettled={onExecutionSettled}
      asset={
        imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          <div className={styles.mediaEmpty}>No preview available</div>
        )
      }
    />
  );
}
