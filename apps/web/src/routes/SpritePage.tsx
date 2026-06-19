import { useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./SpritePage.module.css";

type Direction = "down" | "left" | "right" | "up";
type Action = "idle" | "walk1" | "walk2" | "repair1" | "repair2";
type SpriteMode = "walk" | "repair";

const SPRITE_URL = "/sprites/work-sprite-sheet.png";
const SHEET_WIDTH = 2304;
const SHEET_HEIGHT = 1842;
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
const MOVE_STEP = 28;
const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 520;

function labelFor(value: string) {
  return value.replace(/(\d)/, " $1");
}

function WorkerSprite({
  direction,
  action,
  cellWidth,
  cellHeight,
  cropWidth,
  cropHeight,
  offsetX,
  offsetY,
  scale,
}: {
  direction: Direction;
  action: Action;
  cellWidth: number;
  cellHeight: number;
  cropWidth: number;
  cropHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}) {
  const row = rowByDirection[direction];
  const col = colByAction[action];
  const x = offsetX + col * cellWidth;
  const y = offsetY + row * cellHeight;
  const style = {
    "--frame-width": `${cropWidth}px`,
    "--frame-height": `${cropHeight}px`,
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
  const [position, setPosition] = useState({ x: 230, y: 150 });
  const [cellWidth, setCellWidth] = useState(461);
  const [cellHeight, setCellHeight] = useState(461);
  const [cropHeight, setCropHeight] = useState(420);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(0.36);
  const [speedMs, setSpeedMs] = useState(160);
  const [isPlaying, setIsPlaying] = useState(true);
  const [spriteMode, setSpriteMode] = useState<SpriteMode>("walk");
  const [frameIndex, setFrameIndex] = useState(0);

  const cycle = spriteMode === "walk" ? walkCycle : repairCycle;
  const activeAction = isPlaying ? cycle[frameIndex % cycle.length] : action;
  const row = rowByDirection[direction];
  const col = colByAction[activeAction];
  const x = offsetX + col * cellWidth;
  const y = offsetY + row * cellHeight;

  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = window.setInterval(() => {
      setFrameIndex((index) => index + 1);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [isPlaying, speedMs]);

  function clampPosition(next: { x: number; y: number }) {
    return {
      x: Math.min(STAGE_WIDTH - 96, Math.max(0, next.x)),
      y: Math.min(STAGE_HEIGHT - 96, Math.max(0, next.y)),
    };
  }

  function moveWorker(nextDirection: Direction) {
    setDirection(nextDirection);
    setSpriteMode("walk");
    setIsPlaying(true);
    setPosition((current) => {
      const delta = {
        down: { x: 0, y: MOVE_STEP },
        left: { x: -MOVE_STEP, y: 0 },
        right: { x: MOVE_STEP, y: 0 },
        up: { x: 0, y: -MOVE_STEP },
      }[nextDirection];
      return clampPosition({
        x: current.x + delta.x,
        y: current.y + delta.y,
      });
    });
  }

  function startWalking() {
    setSpriteMode("walk");
    setIsPlaying(true);
  }

  function stopAndRepair() {
    setSpriteMode("repair");
    setIsPlaying(true);
  }

  function resetWorker() {
    setPosition({ x: 230, y: 150 });
    setDirection("right");
    setSpriteMode("walk");
    setIsPlaying(false);
    setAction("idle");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const keyDirection: Record<string, Direction | undefined> = {
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right",
        ArrowUp: "up",
        w: "up",
        W: "up",
      };
      const nextDirection = keyDirection[event.key];
      if (!nextDirection) return;
      event.preventDefault();
      moveWorker(nextDirection);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const atlasRows = useMemo(
    () =>
      directions.flatMap((rowDirection) =>
        actions.map((rowAction) => {
          const atlasX = offsetX + colByAction[rowAction] * cellWidth;
          const atlasY = offsetY + rowByDirection[rowDirection] * cellHeight;
          return {
            name: `${rowDirection}_${rowAction}`,
            x: atlasX,
            y: atlasY,
            w: cellWidth,
            h: cropHeight,
          };
        }),
      ),
    [cellHeight, cellWidth, cropHeight, offsetX, offsetY],
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.stage}>
          <div
            className={styles.actor}
            style={
              {
                "--actor-x": `${position.x}px`,
                "--actor-y": `${position.y}px`,
              } as CSSProperties
            }
          >
            <WorkerSprite
              direction={direction}
              action={activeAction}
              cellWidth={cellWidth}
              cellHeight={cellHeight}
              cropWidth={cellWidth}
              cropHeight={cropHeight}
              offsetX={offsetX}
              offsetY={offsetY}
              scale={scale}
            />
          </div>
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
              <dt>Mode</dt>
              <dd>{spriteMode}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>
                row {row}, col {col}
              </dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>
                {position.x}px, {position.y}px
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

      <section className={styles.playControls} aria-label="Worker movement controls">
        <div className={styles.modeButtons}>
          <button
            className={`${styles.modeButton} ${spriteMode === "walk" ? styles.activeMode : ""}`}
            type="button"
            onClick={startWalking}
          >
            Walk
          </button>
          <button
            className={`${styles.modeButton} ${spriteMode === "repair" ? styles.activeMode : ""}`}
            type="button"
            onClick={stopAndRepair}
          >
            Stop and repair
          </button>
          <button className={styles.modeButton} type="button" onClick={resetWorker}>
            Reset
          </button>
        </div>

        <div className={styles.dpad} aria-label="Move worker">
          <button type="button" className={styles.upButton} onClick={() => moveWorker("up")}>
            Up
          </button>
          <button type="button" className={styles.leftButton} onClick={() => moveWorker("left")}>
            Left
          </button>
          <button type="button" className={styles.centerButton} onClick={stopAndRepair}>
            Repair
          </button>
          <button type="button" className={styles.rightButton} onClick={() => moveWorker("right")}>
            Right
          </button>
          <button type="button" className={styles.downButton} onClick={() => moveWorker("down")}>
            Down
          </button>
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
            value={spriteMode}
            onChange={(event) => setSpriteMode(event.target.value as SpriteMode)}
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
            min="420"
            max="500"
            value={cellWidth}
            onChange={(event) => setCellWidth(Number(event.target.value))}
          />
          <span>{cellWidth}px</span>
        </label>

        <label>
          Cell height
          <input
            type="range"
            min="420"
            max="500"
            value={cellHeight}
            onChange={(event) => setCellHeight(Number(event.target.value))}
          />
          <span>{cellHeight}px</span>
        </label>

        <label>
          Crop height
          <input
            type="range"
            min="320"
            max="480"
            value={cropHeight}
            onChange={(event) => setCropHeight(Number(event.target.value))}
          />
          <span>{cropHeight}px</span>
        </label>

        <label>
          X offset
          <input
            type="range"
            min="-40"
            max="40"
            value={offsetX}
            onChange={(event) => setOffsetX(Number(event.target.value))}
          />
          <span>{offsetX}px</span>
        </label>

        <label>
          Y offset
          <input
            type="range"
            min="-40"
            max="40"
            value={offsetY}
            onChange={(event) => setOffsetY(Number(event.target.value))}
          />
          <span>{offsetY}px</span>
        </label>

        <label>
          Scale
          <input
            type="range"
            min="0.2"
            max="1"
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
