import { useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./SpritePage.module.css";

type Direction = "down" | "left" | "right" | "up";
type Action = "idle" | "walk1" | "walk2" | "repair1" | "repair2";

const SPRITE_URL = "/sprites/work-sprite-sheet.png";
const SHEET_WIDTH = 1402;
const SHEET_HEIGHT = 1122;
const COLUMNS = 5;
const ROWS = 4;

const directions: Direction[] = ["down", "left", "right", "up"];
const actions: Action[] = ["idle", "walk1", "walk2", "repair1", "repair2"];

const rowByDirection: Record<Direction, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

const colByAction: Record<Action, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  repair1: 3,
  repair2: 4,
};

const walkCycle: Action[] = ["walk1", "idle", "walk2", "idle"];
const repairCycle: Action[] = ["repair1", "repair2"];

function labelFor(value: string) {
  return value.replace(/(\d)/, " $1");
}

function WorkerSprite({
  direction,
  action,
  frameWidth,
  frameHeight,
  offsetX,
  offsetY,
  scale,
}: {
  direction: Direction;
  action: Action;
  frameWidth: number;
  frameHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}) {
  const row = rowByDirection[direction];
  const col = colByAction[action];
  const x = offsetX + col * frameWidth;
  const y = offsetY + row * frameHeight;
  const style = {
    "--frame-width": `${frameWidth}px`,
    "--frame-height": `${frameHeight}px`,
    "--sprite-scale": scale,
    backgroundImage: `url("${SPRITE_URL}")`,
    backgroundPosition: `-${x}px -${y}px`,
  } as CSSProperties;

  return (
    <div
      className={styles.sprite}
      style={style}
      role="img"
      aria-label={`${direction} ${action} worker sprite`}
    />
  );
}

export function SpritePage() {
  const [direction, setDirection] = useState<Direction>("right");
  const [action, setAction] = useState<Action>("idle");
  const [frameWidth, setFrameWidth] = useState(280);
  const [frameHeight, setFrameHeight] = useState(280);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1.8);
  const [speedMs, setSpeedMs] = useState(160);
  const [isPlaying, setIsPlaying] = useState(true);
  const [cycleMode, setCycleMode] = useState<"walk" | "repair">("walk");
  const [frameIndex, setFrameIndex] = useState(0);

  const cycle = cycleMode === "walk" ? walkCycle : repairCycle;
  const activeAction = isPlaying ? cycle[frameIndex % cycle.length] : action;
  const row = rowByDirection[direction];
  const col = colByAction[activeAction];
  const x = offsetX + col * frameWidth;
  const y = offsetY + row * frameHeight;

  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = window.setInterval(() => {
      setFrameIndex((index) => index + 1);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [isPlaying, speedMs]);

  const atlasRows = useMemo(
    () =>
      directions.flatMap((rowDirection) =>
        actions.map((rowAction) => {
          const atlasX = offsetX + colByAction[rowAction] * frameWidth;
          const atlasY = offsetY + rowByDirection[rowDirection] * frameHeight;
          return {
            name: `${rowDirection}_${rowAction}`,
            x: atlasX,
            y: atlasY,
            w: frameWidth,
            h: frameHeight,
          };
        }),
      ),
    [frameHeight, frameWidth, offsetX, offsetY],
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.stage}>
          <WorkerSprite
            direction={direction}
            action={activeAction}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            offsetX={offsetX}
            offsetY={offsetY}
            scale={scale}
          />
        </div>
        <div className={styles.details}>
          <p className={styles.eyebrow}>Sprite atlas demo</p>
          <h1>Worker sprite renderer</h1>
          <dl>
            <div>
              <dt>Sheet</dt>
              <dd>
                {SHEET_WIDTH} x {SHEET_HEIGHT}
              </dd>
            </div>
            <div>
              <dt>Grid</dt>
              <dd>
                {COLUMNS} x {ROWS}
              </dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>
                row {row}, col {col}
              </dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>
                -{x}px -{y}px
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.controls} aria-label="Sprite controls">
        <label>
          Direction
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as Direction)}
          >
            {directions.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          Frame
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as Action)}
            disabled={isPlaying}
          >
            {actions.map((item) => (
              <option value={item} key={item}>
                {labelFor(item)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Cycle
          <select
            value={cycleMode}
            onChange={(event) => setCycleMode(event.target.value as "walk" | "repair")}
          >
            <option value="walk">walk</option>
            <option value="repair">repair</option>
          </select>
        </label>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={isPlaying}
            onChange={(event) => setIsPlaying(event.target.checked)}
          />
          Animate
        </label>

        <label>
          Frame width
          <input
            type="range"
            min="240"
            max="300"
            value={frameWidth}
            onChange={(event) => setFrameWidth(Number(event.target.value))}
          />
          <span>{frameWidth}px</span>
        </label>

        <label>
          Frame height
          <input
            type="range"
            min="240"
            max="300"
            value={frameHeight}
            onChange={(event) => setFrameHeight(Number(event.target.value))}
          />
          <span>{frameHeight}px</span>
        </label>

        <label>
          X offset
          <input
            type="range"
            min="-30"
            max="30"
            value={offsetX}
            onChange={(event) => setOffsetX(Number(event.target.value))}
          />
          <span>{offsetX}px</span>
        </label>

        <label>
          Y offset
          <input
            type="range"
            min="-30"
            max="30"
            value={offsetY}
            onChange={(event) => setOffsetY(Number(event.target.value))}
          />
          <span>{offsetY}px</span>
        </label>

        <label>
          Scale
          <input
            type="range"
            min="0.8"
            max="2.6"
            step="0.1"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          />
          <span>{scale.toFixed(1)}x</span>
        </label>

        <label>
          Speed
          <input
            type="range"
            min="90"
            max="360"
            step="10"
            value={speedMs}
            onChange={(event) => setSpeedMs(Number(event.target.value))}
          />
          <span>{speedMs}ms</span>
        </label>
      </section>

      <section className={styles.sheetPanel} aria-label="Sprite sheet">
        <div className={styles.sheetWrap}>
          <img src={SPRITE_URL} alt="Worker sprite sheet" />
        </div>
        <div className={styles.atlas}>
          {atlasRows.map((frame) => (
            <code key={frame.name}>
              {frame.name}: {"{ "}
              x: {frame.x}, y: {frame.y}, w: {frame.w}, h: {frame.h}
              {" }"}
            </code>
          ))}
        </div>
      </section>
    </main>
  );
}
