export type AudioFitVerdict = "ok" | "needs_review" | "fail";

export interface AudioFitWord {
  w: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

export interface AudioFitWindow {
  startSec: number;
  endSec: number;
}

export interface AudioFitPlacement {
  startSec: number;
  endSec: number;
}

export interface AudioFitRetime {
  factor: number;
  applied: boolean;
  maxRetime: number;
}

export interface AudioFitDecision {
  placement: AudioFitPlacement;
  retime: AudioFitRetime;
  verdict: AudioFitVerdict;
  reasons: string[];
  metrics: {
    audioDurationSec: number;
    targetDurationSec: number;
    durationDeltaSec: number;
    wordOverlapRatio?: number;
  };
}

export interface FitAudioToPictureInput {
  audioDurationSec: number;
  targetWindow: AudioFitWindow;
  words?: AudioFitWord[];
  maxRetime?: number;
  toleranceSec?: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampRetime(value: number): number {
  if (!Number.isFinite(value)) return 0.1;
  return Math.max(0, Math.min(0.5, value));
}

function overlapSec(a: AudioFitWindow, b: AudioFitWindow): number {
  return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

function wordOverlapRatio(input: {
  words: AudioFitWord[];
  targetWindow: AudioFitWindow;
  placementStartSec: number;
  retimeFactor: number;
}): number | undefined {
  if (input.words.length === 0 || !positiveFinite(input.retimeFactor)) return undefined;

  let total = 0;
  let overlap = 0;
  for (const word of input.words) {
    if (!Number.isFinite(word.startSec) || !Number.isFinite(word.endSec)) continue;
    const start = input.placementStartSec + word.startSec / input.retimeFactor;
    const end = input.placementStartSec + word.endSec / input.retimeFactor;
    const duration = Math.max(0, end - start);
    if (duration <= 0) continue;
    total += duration;
    overlap += overlapSec({ startSec: start, endSec: end }, input.targetWindow);
  }

  if (total <= 0) return undefined;
  return round(overlap / total);
}

export function fitAudioToPicture(input: FitAudioToPictureInput): AudioFitDecision {
  const maxRetime = clampRetime(input.maxRetime ?? 0.1);
  const toleranceSec = Math.max(0, input.toleranceSec ?? 0.25);
  const windowStartSec = Math.max(0, input.targetWindow.startSec);
  const windowEndSec = Math.max(windowStartSec, input.targetWindow.endSec);
  const targetDurationSec = round(windowEndSec - windowStartSec);
  const audioDurationSec = round(Math.max(0, input.audioDurationSec));
  const durationDeltaSec = round(audioDurationSec - targetDurationSec);
  const basePlacement = {
    startSec: round(windowStartSec),
    endSec: round(windowStartSec + audioDurationSec),
  };

  if (!positiveFinite(targetDurationSec)) {
    return {
      placement: basePlacement,
      retime: { factor: 1, applied: false, maxRetime },
      verdict: "fail",
      reasons: ["target_window_invalid", "regenerate"],
      metrics: { audioDurationSec, targetDurationSec, durationDeltaSec },
    };
  }

  if (!positiveFinite(audioDurationSec)) {
    return {
      placement: basePlacement,
      retime: { factor: 1, applied: false, maxRetime },
      verdict: "fail",
      reasons: ["audio_duration_invalid", "regenerate"],
      metrics: { audioDurationSec, targetDurationSec, durationDeltaSec },
    };
  }

  const requiredFactor = round(audioDurationSec / targetDurationSec);
  const lowerBound = round(1 - maxRetime);
  const upperBound = round(1 + maxRetime);
  const withinTolerance = Math.abs(durationDeltaSec) <= toleranceSec;
  const retimeFits = requiredFactor >= lowerBound && requiredFactor <= upperBound;
  const retimeApplied = !withinTolerance && retimeFits;
  const effectiveFactor = retimeApplied ? requiredFactor : 1;
  const placement = {
    startSec: round(windowStartSec),
    endSec: round(windowStartSec + audioDurationSec / effectiveFactor),
  };
  const overlap = wordOverlapRatio({
    words: input.words ?? [],
    targetWindow: { startSec: windowStartSec, endSec: windowEndSec },
    placementStartSec: placement.startSec,
    retimeFactor: effectiveFactor,
  });

  const reasons: string[] = [];
  let verdict: AudioFitVerdict = "ok";

  if (withinTolerance) {
    reasons.push("duration_within_tolerance");
  } else if (retimeApplied) {
    reasons.push("retime_within_cap");
  } else {
    verdict = Math.abs(requiredFactor - 1) <= maxRetime * 2 ? "needs_review" : "fail";
    reasons.push("retime_exceeds_cap", "tighten_script");
    if (verdict === "fail") reasons.push("regenerate");
  }

  if (overlap !== undefined && overlap < 0.9) {
    verdict = verdict === "fail" ? "fail" : "needs_review";
    reasons.push("word_timing_outside_window");
  }

  return {
    placement,
    retime: { factor: effectiveFactor, applied: retimeApplied, maxRetime },
    verdict,
    reasons,
    metrics: {
      audioDurationSec,
      targetDurationSec,
      durationDeltaSec,
      ...(overlap !== undefined ? { wordOverlapRatio: overlap } : {}),
    },
  };
}
