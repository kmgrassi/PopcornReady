import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { VideoComposition, VideoProps } from "./VideoComposition";
import { dims, timelineDurationSec } from "@popcorn/shared/types";

const defaultProps = {
  timeline: null,
  clips: [],
  baseUrl: "",
} satisfies VideoProps;

const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => {
  const fps = props.renderPlan?.output.fps ?? props.timeline?.fps ?? 30;
  const { width, height } = props.renderPlan?.output ?? dims(
    props.timeline?.aspectRatio ?? "9:16"
  );
  const durationSec =
    props.renderPlan?.durationSec ?? timelineDurationSec(props.timeline);
  const durationInFrames = Math.max(
    1,
    Math.round(durationSec * fps)
  );

  return { durationInFrames, fps, width, height };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="main"
      component={VideoComposition}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
