import type { CSSProperties } from "react";
import styles from "./StudioCrewLoader.module.css";

type CrewMember = {
  id: "writer" | "camera" | "worker";
  label: string;
  sheet: string;
  cellSize: number;
  frameA: number;
  frameB: number;
  frameY: number;
  scale: number;
};

const crew: CrewMember[] = [
  {
    id: "writer",
    label: "Writer reviewing the brief",
    sheet: "/sprites/writer-sprite-sheet.png",
    cellSize: 251,
    frameA: -753,
    frameB: -1004,
    frameY: -10,
    scale: 0.56,
  },
  {
    id: "camera",
    label: "Camera operator framing the shot",
    sheet: "/sprites/camera-man-sprite-sheet.png",
    cellSize: 251,
    frameA: -753,
    frameB: -1004,
    frameY: -10,
    scale: 0.56,
  },
  {
    id: "worker",
    label: "Workshop worker building the asset",
    sheet: "/sprites/work-sprite-sheet.png",
    cellSize: 280,
    frameA: -840,
    frameB: -1120,
    frameY: 0,
    scale: 0.54,
  },
];

export function StudioCrewLoader({ active }: { active: boolean }) {
  return (
    <div
      className={styles.scene}
      data-active={active || undefined}
      data-testid="studio-crew"
      aria-hidden="true"
    >
      <div className={styles.stageLight} />
      <div className={styles.worktable} />
      {crew.map((member) => {
        const spriteStyle = {
          "--sprite-sheet": `url("${member.sheet}")`,
          "--cell-size": `${member.cellSize}px`,
          "--frame-a": `${member.frameA}px`,
          "--frame-b": `${member.frameB}px`,
          "--frame-y": `${member.frameY}px`,
          "--sprite-scale": member.scale,
        } as CSSProperties;

        return (
          <div
            key={member.id}
            className={`${styles.actor} ${styles[member.id]}`}
            data-crew-member={member.id}
            title={member.label}
          >
            <div className={styles.sprite} style={spriteStyle} />
          </div>
        );
      })}
      <div className={styles.floor} />
    </div>
  );
}
