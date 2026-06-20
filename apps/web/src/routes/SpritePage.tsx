import { useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./SpritePage.module.css";

type Direction = "down" | "left" | "right" | "up";
type Action = "idle" | "walk1" | "walk2" | "action1" | "action2";
type SpriteMode = "walk" | "action";
type Backdrop = "grid" | "light" | "checker";

const backdrops: { id: Backdrop; label: string }[] = [
  { id: "grid", label: "grid" },
  { id: "light", label: "light" },
  { id: "checker", label: "checker" },
];

type SpriteConfig = {
  id: string;
  name: string;
  eyebrow: string;
  url: string;
  sheetWidth: number;
  sheetHeight: number;
  columns: number;
  rows: number;
  /** Sheet row index for each facing direction. */
  rowByDirection: Record<Direction, number>;
  /** Human label for the non-walk action (e.g. "repair", "film"). */
  actionName: string;
  /** Default tuning for this sheet. */
  defaults: {
    cellWidth: number;
    cellHeight: number;
    cropHeight: number;
    scale: number;
  };
};

const directions: Direction[] = ["down", "left", "right", "up"];
const actions: Action[] = ["idle", "walk1", "walk2", "action1", "action2"];

const colByAction: Record<Action, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  action1: 3,
  action2: 4,
};

const walkCycle: Action[] = ["walk1", "idle", "walk2", "idle"];
const actionCycle: Action[] = ["action1", "action2"];

const SPRITES: SpriteConfig[] = [
  {
    id: "worker",
    name: "Worker",
    eyebrow: "Sprite atlas demo",
    url: "/sprites/work-sprite-sheet.png",
    sheetWidth: 1402,
    sheetHeight: 1122,
    columns: 5,
    rows: 4,
    rowByDirection: { down: 0, left: 1, right: 2, up: 3 },
    actionName: "repair",
    defaults: { cellWidth: 280, cellHeight: 280, cropHeight: 280, scale: 0.75 },
  },
  {
    id: "cameraman",
    name: "Cameraman",
    eyebrow: "Sprite atlas demo",
    url: "/sprites/camera-man-sprite-sheet.png",
    sheetWidth: 1254,
    sheetHeight: 1254,
    columns: 5,
    rows: 5,
    // The cameraman sheet has 5 rows; row 3 is a diagonal we skip for the
    // four cardinal facings (up uses the full-back row 4).
    rowByDirection: { down: 0, left: 1, right: 2, up: 4 },
    actionName: "film",
    defaults: { cellWidth: 251, cellHeight: 251, cropHeight: 251, scale: 0.8 },
  },
];

const MOVE_STEP = 28;
const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 520;

function actionLabel(value: Action, actionName: string) {
  switch (value) {
    case "idle":
      return "idle";
    case "walk1":
      return "walk 1";
    case "walk2":
      return "walk 2";
    case "action1":
      return `${actionName} 1`;
    case "action2":
      return `${actionName} 2`;
  }
}

function Sprite({
  config,
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
  config: SpriteConfig;
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
  const row = config.rowByDirection[direction];
  const col = colByAction[action];
  const x = offsetX + col * cellWidth;
  const y = offsetY + row * cellHeight;
  const style = {
    "--frame-width": `${cropWidth}px`,
    "--frame-height": `${cropHeight}px`,
    "--sprite-scale": scale,
    backgroundImage: `url("${config.url}")`,
    backgroundPosition: `${-x}px ${-y}px`,
  } as CSSProperties;

  return (
    <div
      className={styles.sprite}
      style={style}
      role="img"
      aria-label={`${direction} ${actionLabel(action, config.actionName)} ${config.name} sprite`}
    />
  );
}

export function SpritePage() {
  const [spriteId, setSpriteId] = useState<string>(SPRITES[0].id);
  const config = useMemo(
    () => SPRITES.find((item) => item.id === spriteId) ?? SPRITES[0],
    [spriteId],
  );

  const [direction, setDirection] = useState<Direction>("right");
  const [action, setAction] = useState<Action>("idle");
  const [position, setPosition] = useState({ x: 230, y: 150 });
  const [cellWidth, setCellWidth] = useState(config.defaults.cellWidth);
  const [cellHeight, setCellHeight] = useState(config.defaults.cellHeight);
  const [cropHeight, setCropHeight] = useState(config.defaults.cropHeight);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(config.defaults.scale);
  const [speedMs, setSpeedMs] = useState(160);
  const [isPlaying, setIsPlaying] = useState(true);
  const [spriteMode, setSpriteMode] = useState<SpriteMode>("walk");
  const [frameIndex, setFrameIndex] = useState(0);
  const [backdrop, setBackdrop] = useState<Backdrop>("grid");

  const cycle = spriteMode === "walk" ? walkCycle : actionCycle;
  const activeAction = isPlaying ? cycle[frameIndex % cycle.length] : action;
  const row = config.rowByDirection[direction];
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

  function selectSprite(nextId: string) {
    const next = SPRITES.find((item) => item.id === nextId) ?? SPRITES[0];
    setSpriteId(next.id);
    setCellWidth(next.defaults.cellWidth);
    setCellHeight(next.defaults.cellHeight);
    setCropHeight(next.defaults.cropHeight);
    setScale(next.defaults.scale);
    setOffsetX(0);
    setOffsetY(0);
    setAction("idle");
    setSpriteMode("walk");
    setIsPlaying(true);
  }

  function clampPosition(next: { x: number; y: number }) {
    return {
      x: Math.min(STAGE_WIDTH - 96, Math.max(0, next.x)),
      y: Math.min(STAGE_HEIGHT - 96, Math.max(0, next.y)),
    };
  }

  function moveActor(nextDirection: Direction) {
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

  function performAction() {
    setSpriteMode("action");
    setIsPlaying(true);
  }

  function resetActor() {
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
      moveActor(nextDirection);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const atlasRows = useMemo(
    () =>
      directions.flatMap((rowDirection) =>
        actions.map((rowAction) => {
          const atlasX = offsetX + colByAction[rowAction] * cellWidth;
          const atlasY = offsetY + config.rowByDirection[rowDirection] * cellHeight;
          return {
            name: `${rowDirection}_${actionLabel(rowAction, config.actionName).replace(" ", "")}`,
            x: atlasX,
            y: atlasY,
            w: cellWidth,
            h: cropHeight,
          };
        }),
      ),
    [cellHeight, cellWidth, config, cropHeight, offsetX, offsetY],
  );

  const actionTitle = `${config.actionName.charAt(0).toUpperCase()}${config.actionName.slice(1)}`;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div
          className={`${styles.stage} ${
            backdrop === "light"
              ? styles.stageLight
              : backdrop === "checker"
                ? styles.stageChecker
                : ""
          }`}
        >
          <div
            className={styles.actor}
            style={
              {
                "--actor-x": `${position.x}px`,
                "--actor-y": `${position.y}px`,
              } as CSSProperties
            }
          >
            <Sprite
              config={config}
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
          <p className={styles.eyebrow}>{config.eyebrow}</p>
          <h1>{config.name} sprite renderer</h1>
          <dl>
            <div>
              <dt>Sheet</dt>
              <dd>
                {config.sheetWidth} x {config.sheetHeight}
              </dd>
            </div>
            <div>
              <dt>Grid</dt>
              <dd>
                {config.columns} x {config.rows}
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{spriteMode === "action" ? config.actionName : "walk"}</dd>
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
                {-x}px {-y}px
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.playControls} aria-label="Actor movement controls">
        <div className={styles.modeButtons}>
          <button
            className={`${styles.modeButton} ${spriteMode === "walk" ? styles.activeMode : ""}`}
            type="button"
            onClick={startWalking}
          >
            Walk
          </button>
          <button
            className={`${styles.modeButton} ${spriteMode === "action" ? styles.activeMode : ""}`}
            type="button"
            onClick={performAction}
          >
            Stop and {config.actionName}
          </button>
          <button className={styles.modeButton} type="button" onClick={resetActor}>
            Reset
          </button>
        </div>

        <div className={styles.dpad} aria-label="Move actor">
          <button type="button" className={styles.upButton} onClick={() => moveActor("up")}>
            Up
          </button>
          <button type="button" className={styles.leftButton} onClick={() => moveActor("left")}>
            Left
          </button>
          <button type="button" className={styles.centerButton} onClick={performAction}>
            {actionTitle}
          </button>
          <button type="button" className={styles.rightButton} onClick={() => moveActor("right")}>
            Right
          </button>
          <button type="button" className={styles.downButton} onClick={() => moveActor("down")}>
            Down
          </button>
        </div>
      </section>

      <section className={styles.controls} aria-label="Sprite controls">
        <label>
          Sprite
          <select value={spriteId} onChange={(event) => selectSprite(event.target.value)}>
            {SPRITES.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Backdrop
          <select
            value={backdrop}
            onChange={(event) => setBackdrop(event.target.value as Backdrop)}
          >
            {backdrops.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

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
                {actionLabel(item, config.actionName)}
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
            <option value="action">{config.actionName}</option>
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
            min="220"
            max="300"
            value={cellWidth}
            onChange={(event) => setCellWidth(Number(event.target.value))}
          />
          <span>{cellWidth}px</span>
        </label>

        <label>
          Cell height
          <input
            type="range"
            min="220"
            max="300"
            value={cellHeight}
            onChange={(event) => setCellHeight(Number(event.target.value))}
          />
          <span>{cellHeight}px</span>
        </label>

        <label>
          Crop height
          <input
            type="range"
            min="180"
            max="300"
            value={cropHeight}
            onChange={(event) => setCropHeight(Number(event.target.value))}
          />
          <span>{cropHeight}px</span>
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
            min="0.4"
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
          <img src={config.url} alt={`${config.name} sprite sheet`} />
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
