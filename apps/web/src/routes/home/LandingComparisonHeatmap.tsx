import { HeatLogoMark } from "../../components/HeatLogoMark";

// Ordered by Popcorn Ready's strength: what it's best at on the left, weakest on
// the right. Every HEATMAP_ROWS `scores` array is in this same column order.
const HEATMAP_COLUMNS = [
  "AI workflow",
  "Gen AI",
  "Timeline model",
  "Audio",
  "Captions",
  "Versioning",
  "VFX",
  "Manual edit",
];

const HEATMAP_LEVELS = ["Minimal", "Light", "Medium", "Strong"];

const HEATMAP_EXPLANATIONS: Record<string, string> = {
  "Manual edit":
    "Whether a user can directly cut, trim, rearrange, and stitch video without relying on AI.",
  "Timeline model":
    "Whether the product represents the edit as a structured timeline with inspectable segments and render decisions.",
  Audio:
    "Whether the product can create, clean up, arrange, or export useful audio alongside the video.",
  VFX: "Whether the product supports deeper visual compositing, masking, effects, and shot manipulation.",
  Captions:
    "Whether captions, transcripts, subtitles, or localization workflows are a central capability.",
  "Gen AI":
    "Whether the product can generate or transform media such as video, images, voice, or effects.",
  "AI workflow":
    "Whether AI drives the full workflow end to end, rather than appearing as isolated tools inside a manual editor.",
  Versioning:
    "Whether the product supports review, project history, collaboration, or version control.",
};

const POPCORN_READY_HEATMAP_EXPLANATIONS: Record<string, string> = {
  "Manual edit":
    "Popcorn Ready does not currently provide a manual timeline UI for hand-stitching or editing without AI.",
  "Timeline model":
    "Popcorn Ready produces a structured timeline from graph-linked assets, so the output remains inspectable even though edits are AI-driven.",
  Audio:
    "Popcorn Ready can generate or overlay audio and render it with the finished video, but it is not a full audio-post workstation.",
  VFX: "Popcorn Ready focuses on generated shots and deterministic assembly, not deep manual compositing or effects work.",
  Captions:
    "Popcorn Ready supports burned-in caption text in rendered videos, but it is not yet a full transcript, subtitle, and localization suite.",
  "Gen AI":
    "Popcorn Ready is generation-first: it can create missing visual assets instead of requiring source footage.",
  "AI workflow":
    "This is the core differentiator: brief, plan, asset generation, audio, timeline, and export happen through one AI-driven loop.",
  Versioning:
    "Local exports and inspectable plans exist today; richer cloud review and version history would come later.",
};

const HEATMAP_ROWS = [
  {
    app: "Popcorn Ready",
    scores: [3, 3, 3, 2, 2, 2, 1, 0],
    note: "Fully AI-driven brief-to-plan-to-assets-to-timeline flow; not a manual stitching or hand-editing tool.",
    featured: true,
  },
  {
    app: "Premiere Pro",
    scores: [1, 2, 3, 2, 3, 2, 2, 3],
    note: "Broad professional craft stack with Adobe ecosystem depth.",
  },
  {
    app: "DaVinci Resolve",
    scores: [1, 1, 3, 3, 2, 3, 3, 3],
    note: "Deepest finishing, color, audio, VFX, and collaboration suite.",
  },
  {
    app: "CapCut",
    scores: [2, 3, 2, 1, 3, 2, 1, 2],
    note: "Fast social editing with strong creator AI.",
  },
  {
    app: "VEED",
    scores: [2, 3, 1, 1, 3, 2, 0, 1],
    note: "Web editing shell with captions, dubbing, and model brokerage.",
  },
  {
    app: "Descript",
    scores: [2, 2, 2, 2, 3, 2, 1, 2],
    note: "Transcript-native editing for explainers, podcasts, and repurposing.",
  },
  {
    app: "Runway",
    scores: [2, 3, 1, 0, 0, 1, 2, 1],
    note: "Generative studio for shot invention and manipulation.",
  },
  {
    app: "Frame.io",
    scores: [0, 0, 0, 0, 1, 3, 0, 0],
    note: "Review and versioning backbone rather than an editor.",
  },
];

function heatmapTooltip(app: string, column: string, score: number) {
  const explanation =
    app === "Popcorn Ready"
      ? POPCORN_READY_HEATMAP_EXPLANATIONS[column]
      : HEATMAP_EXPLANATIONS[column];
  return `${app}: ${column} is ${HEATMAP_LEVELS[score].toLowerCase()}. ${explanation}`;
}

function HeatLogoScale({ score }: { score: number }) {
  return (
    <span className={`lp-heat-scale count-${score}`} aria-hidden="true">
      {Array.from({ length: score }, (_, index) => (
        <HeatLogoMark className="lp-heat-mark" key={index} />
      ))}
    </span>
  );
}

export function LandingComparisonHeatmap() {
  return (
    <div className="lp-heatmap-wrap">
      <div className="lp-heatmap">
        <div className="lp-heatmap-head">
          <span>Tool</span>
          {HEATMAP_COLUMNS.map((column) => (
            <span key={column}>{column}</span>
          ))}
          <span>Positioning</span>
        </div>
        {HEATMAP_ROWS.map((row) => (
          <div
            className={`lp-heatmap-row${row.featured ? " featured" : ""}`}
            key={row.app}
          >
            <strong>{row.app}</strong>
            {row.scores.map((score, index) => (
              <button
                type="button"
                className={`lp-heat-cell level-${score}`}
                key={`${row.app}-${HEATMAP_COLUMNS[index]}`}
                aria-label={heatmapTooltip(row.app, HEATMAP_COLUMNS[index], score)}
              >
                <em>{HEATMAP_COLUMNS[index]}</em>
                <HeatLogoScale score={score} />
                <span className="lp-heat-tip">
                  {heatmapTooltip(row.app, HEATMAP_COLUMNS[index], score)}
                </span>
              </button>
            ))}
            <p>{row.note}</p>
          </div>
        ))}
      </div>
      <div className="lp-heatmap-legend" aria-hidden="true">
        <span>
          <span className="lp-heat-scale count-0" /> Minimal
        </span>
        <span>
          <span className="lp-heat-scale count-1">
            <HeatLogoMark className="lp-heat-mark" />
          </span>
          Light
        </span>
        <span>
          <span className="lp-heat-scale count-2">
            <HeatLogoMark className="lp-heat-mark" />
            <HeatLogoMark className="lp-heat-mark" />
          </span>
          Medium
        </span>
        <span>
          <span className="lp-heat-scale count-3">
            <HeatLogoMark className="lp-heat-mark" />
            <HeatLogoMark className="lp-heat-mark" />
            <HeatLogoMark className="lp-heat-mark" />
          </span>
          Strong
        </span>
      </div>
    </div>
  );
}
