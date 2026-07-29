import type { V1Project } from "@popcorn/shared/v1/types";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button } from "../ui/Button";
import styles from "./ProjectPicker.module.css";

interface ProjectPickerProps {
  projects: V1Project[];
  value: string;
  selectedName?: string;
  isLoading: boolean;
  error: Error | null;
  loadMoreError: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isCreating: boolean;
  createError: Error | null;
  onChange: (projectId: string) => void;
  onCreate: (name: string) => Promise<V1Project>;
  onResetCreateError: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function ProjectPicker({
  projects,
  value,
  selectedName,
  isLoading,
  error,
  loadMoreError,
  hasNextPage,
  isFetchingNextPage,
  isCreating,
  createError,
  onChange,
  onCreate,
  onResetCreateError,
  onLoadMore,
  onRetry,
}: ProjectPickerProps) {
  const labelId = useId();
  const valueId = useId();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const createAttemptRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [search, setSearch] = useState("");
  const [projectName, setProjectName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLocaleLowerCase().includes(query),
    );
  }, [projects, search]);

  function closePicker({ returnFocus = true } = {}) {
    createAttemptRef.current += 1;
    setIsOpen(false);
    setMode("list");
    setSearch("");
    setValidationError(null);
    if (returnFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openPicker() {
    const nextMode =
      !isLoading && !error && projects.length === 0 ? "create" : "list";
    if (nextMode === "create" && !isCreating) onResetCreateError();
    setIsOpen(true);
    setMode(nextMode);
  }

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (mode === "create") nameRef.current?.focus();
      else searchRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closePicker({ returnFocus: false });
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(
    () => () => {
      createAttemptRef.current += 1;
    },
    [],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) {
      setValidationError("Enter a project name.");
      nameRef.current?.focus();
      return;
    }
    setValidationError(null);
    const attempt = createAttemptRef.current + 1;
    createAttemptRef.current = attempt;
    try {
      const project = await onCreate(name);
      if (createAttemptRef.current !== attempt) return;
      onChange(project.id);
      setProjectName("");
      closePicker();
    } catch {
      if (createAttemptRef.current !== attempt) return;
      nameRef.current?.focus();
    }
  }

  const triggerText =
    selectedName ??
    (isLoading
      ? "Loading projects…"
      : error || projects.length > 0
        ? "Choose a project"
        : "Create your first project");

  return (
    <div className={styles.field} ref={rootRef}>
      <span id={labelId} className={styles.label}>
        Project
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        disabled={isLoading && projects.length === 0}
        onClick={() => {
          if (isOpen) closePicker({ returnFocus: false });
          else openPicker();
        }}
      >
        <span id={valueId} className={selectedName ? styles.triggerValue : styles.placeholder}>
          {triggerText}
        </span>
        <ChevronIcon open={isOpen} />
      </button>

      {isOpen ? (
        <section
          id={panelId}
          className={styles.panel}
          aria-label="Choose or create a project"
        >
          {mode === "list" ? (
            <>
              <div className={styles.searchWrap}>
                <SearchIcon />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={styles.search}
                  aria-label="Find a project"
                  placeholder="Find a project"
                />
              </div>

              {error ? (
                <div className={styles.message}>
                  <p role="alert">Projects could not be loaded.</p>
                  <Button variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <div className={styles.list} aria-label="Projects">
                    {filteredProjects.map((project) => {
                      const selected = project.id === value;
                      return (
                        <button
                          key={project.id}
                          type="button"
                          aria-pressed={selected}
                          className={styles.option}
                          onClick={() => {
                            onChange(project.id);
                            closePicker();
                          }}
                        >
                          <span>{project.name}</span>
                          {selected ? <CheckIcon /> : null}
                        </button>
                      );
                    })}
                  </div>
                  {filteredProjects.length === 0 ? (
                    <p className={styles.noResults}>
                      {projects.length === 0
                        ? "No projects yet."
                        : "No loaded projects match that search."}
                    </p>
                  ) : null}
                  {loadMoreError ? (
                    <div className={styles.paginationError}>
                      <p role="alert">More projects could not be loaded.</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        isLoading={isFetchingNextPage}
                        onClick={onLoadMore}
                      >
                        Retry loading more
                      </Button>
                    </div>
                  ) : hasNextPage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.loadMore}
                      isLoading={isFetchingNextPage}
                      onClick={onLoadMore}
                    >
                      Load more projects
                    </Button>
                  ) : null}
                </>
              )}

              <button
                type="button"
                className={styles.createToggle}
                disabled={isCreating}
                onClick={() => {
                  if (!isCreating) onResetCreateError();
                  setMode("create");
                  setValidationError(null);
                }}
              >
                <PlusIcon />
                <span>Create new project</span>
              </button>
            </>
          ) : (
            <form className={styles.createForm} onSubmit={(event) => void handleCreate(event)}>
              <label htmlFor={`${panelId}-name`}>Project name</label>
              <input
                ref={nameRef}
                id={`${panelId}-name`}
                value={projectName}
                disabled={isCreating}
                onChange={(event) => {
                  onResetCreateError();
                  setProjectName(event.target.value);
                  setValidationError(null);
                }}
                autoComplete="off"
                aria-invalid={Boolean(validationError || createError)}
                aria-describedby={
                  validationError || createError ? `${panelId}-create-error` : undefined
                }
                placeholder="Homepage concepts"
              />
              {validationError || createError ? (
                <p id={`${panelId}-create-error`} role="alert" className={styles.error}>
                  {validationError ?? createError?.message}
                </p>
              ) : null}
              <div className={styles.createActions}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    onResetCreateError();
                    setMode("list");
                    setValidationError(null);
                  }}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button variant="secondary" type="submit" isLoading={isCreating}>
                  Create project
                </Button>
              </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? styles.chevronOpen : styles.chevron}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.5 12.5 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
