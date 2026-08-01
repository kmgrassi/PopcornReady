import type { CSSProperties } from "react";
import styles from "./StudioCrewLoader.module.css";

type CrewMember = {
  id: "director" | "camera" | "actor" | "actress";
  label: string;
  sheet: string;
  position: string;
  delay: string;
};

const crew: CrewMember[] = [
  {
    id: "director",
    label: "Director calling the next setup",
    sheet: "/sprites/progress/director-crew.png",
    position: "14%",
    delay: "0ms",
  },
  {
    id: "camera",
    label: "Camera operator framing the shot",
    sheet: "/sprites/progress/camera-crew.png",
    position: "38%",
    delay: "-230ms",
  },
  {
    id: "actor",
    label: "Actor rehearsing the scene",
    sheet: "/sprites/progress/actor-crew.png",
    position: "64%",
    delay: "-460ms",
  },
  {
    id: "actress",
    label: "Actress rehearsing the scene",
    sheet: "/sprites/progress/actress-crew.png",
    position: "82%",
    delay: "-690ms",
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
      <div className={styles.setBackdrop} data-testid="studio-set" />
      <div className={styles.stageLight} />
      {crew.map((member) => {
        const spriteStyle = {
          "--sprite-sheet": `url("${member.sheet}")`,
          "--actor-x": member.position,
          "--animation-delay": member.delay,
        } as CSSProperties;

        return (
          <div
            key={member.id}
            className={styles.actor}
            data-crew-member={member.id}
            title={member.label}
            style={spriteStyle}
          >
            <div className={styles.sprite} />
          </div>
        );
      })}
    </div>
  );
}
