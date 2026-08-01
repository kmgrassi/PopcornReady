import type { CSSProperties } from "react";
import styles from "./StudioCrewLoader.module.css";

type CrewMember = {
  id: "writer" | "camera" | "worker";
  label: string;
  sheet: string;
  cellSize: number;
  frameA: number;
  frameB: number;
};

const crew: CrewMember[] = [
  {
    id: "writer",
    label: "Writer reviewing the brief",
    sheet: "/sprites/progress/writer-crew.png",
    cellSize: 141,
    frameA: -141,
    frameB: -282,
  },
  {
    id: "camera",
    label: "Camera operator framing the shot",
    sheet: "/sprites/progress/camera-crew.png",
    cellSize: 141,
    frameA: -141,
    frameB: -282,
  },
  {
    id: "worker",
    label: "Workshop worker building the asset",
    sheet: "/sprites/progress/worker-crew.png",
    cellSize: 151,
    frameA: -151,
    frameB: -302,
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
