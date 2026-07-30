import type { ReactNode } from "react";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";
import { RerunProposalDialog } from "./RerunProposalDialog";

export interface AiAssetFeedbackDialogProps {
  open: boolean;
  projectId: string;
  target: BoardRevisionTarget | null;
  rootRunId?: string | null;
  title: string;
  subtitle?: string | null;
  asset: ReactNode;
  initialMessage?: string | null;
  onClose: () => void;
  onExecutionStarted?: (target: BoardRevisionTarget) => Promise<void> | void;
  onExecutionSettled?: (target: BoardRevisionTarget) => Promise<void> | void;
}

export function AiAssetFeedbackDialog(props: AiAssetFeedbackDialogProps) {
  return <RerunProposalDialog {...props} />;
}
