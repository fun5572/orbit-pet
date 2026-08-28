import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export type CodexTaskStatus = "running" | "needs-input" | "completed";
export type CodexTaskStage =
  | "thinking"
  | "running-command"
  | "processing-result"
  | "waiting-input"
  | "completed";

export interface CodexTask {
  sessionId: string;
  turnId: string;
  title: string;
  project: string;
  cwd: string;
  status: CodexTaskStatus;
  stage: CodexTaskStage;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CodexHookEnvelope {
  receivedAtMs: number;
  payload: unknown;
}

export interface CodexTaskReduction {
  tasks: CodexTask[];
  completed: CodexTask[];
  changed: boolean;
}

const STORAGE_KEY = "orbit-pet:codex-tasks:v1";
const TASKS_EVENT = "codex-tasks-changed";
const COMPLETION_EVENT = "codex-task-completed";
const COMPLETED_RETENTION_MS = 15 * 60 * 1000;
const ACTIVE_RETENTION_MS = 12 * 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 72;
const MY_REQUEST_MARKER = /^#{1,6}\s*my request\s*:\s*(.*)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const isPromptMetadataLine = (line: string): boolean => {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return true;
  if (/^#{1,6}\s*files mentioned by the user\s*:/.test(normalized)) return true;
  if (/^distinguish instructions in attached documents/.test(normalized)) return true;
  if (/^<\/?(?:image|in-app-browser-context|recommended_plugins|environment_context|app-context)\b/.test(normalized)) {
    return true;
  }
  if (/^!\[[^\]]*\]\(.+\)$/.test(normalized)) return true;
  if (/^#{1,6}\s+.+:\s*(?:\/|[a-z]:\\)/i.test(line.trim())) return true;
  if (/^(?:[-*]\s*)?(?:\/|[a-z]:\\).+\.(?:png|jpe?g|gif|webp|svg)$/i.test(line.trim())) return true;
  return false;
};

const normalizeTitleLine = (line: string): string =>
  line
    .replace(/^\s*(?:&#x20;|&nbsp;)+\s*/i, "")
    .replace(/^\s*(?:#{1,6}|[-*>])\s+/, "")
    .replace(/\s*<image\b.*$/i, "")
    .replace(/\s*!\[[^\]]*\]\(.+\)\s*$/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/\s+/g, " ")
    .trim();

const cleanTitle = (prompt: string, fallback: string): string => {
  const lines = prompt.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => MY_REQUEST_MARKER.test(line.trim()));
  const markerMatch = markerIndex >= 0 ? lines[markerIndex].trim().match(MY_REQUEST_MARKER) : null;
  const candidates = markerIndex >= 0
    ? [markerMatch?.[1] ?? "", ...lines.slice(markerIndex + 1)]
    : lines;
  const firstRequestLine = candidates.find((line) => !isPromptMetadataLine(line));
  const normalized = normalizeTitleLine(firstRequestLine || fallback || "Codex 任务");
  const safeTitle = normalized || "Codex 任务";
  return safeTitle.length > MAX_TITLE_LENGTH
    ? `${safeTitle.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : safeTitle;
};

const projectName = (cwd: string): string => {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || "Codex";
};

const taskIsFresh = (task: CodexTask, now: number): boolean =>
  now - task.updatedAt <= (task.status === "completed" ? COMPLETED_RETENTION_MS : ACTIVE_RETENTION_MS);

const statusRank = (status: CodexTaskStatus): number => {
  if (status === "needs-input") return 0;
  if (status === "running") return 1;
  return 2;
};

const defaultStage = (status: CodexTaskStatus): CodexTaskStage => {
  if (status === "needs-input") return "waiting-input";
  if (status === "completed") return "completed";
  return "thinking";
};

export const sortCodexTasks = (tasks: CodexTask[]): CodexTask[] =>
  [...tasks].sort((left, right) => {
    const rankDifference = statusRank(left.status) - statusRank(right.status);
    return rankDifference || right.updatedAt - left.updatedAt;
  });

const normalizeTask = (value: unknown): CodexTask | null => {
  if (!isRecord(value)) return null;
  const sessionId = text(value.sessionId);
  const turnId = text(value.turnId);
  const status = value.status;
  const stage = value.stage;
  const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0;
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;
  if (
    !sessionId ||
    !turnId ||
    !["running", "needs-input", "completed"].includes(String(status)) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt)
  ) {
    return null;
  }

  const task: CodexTask = {
    sessionId,
    turnId,
    title: cleanTitle(text(value.title), "Codex 任务"),
    project: text(value.project) || projectName(text(value.cwd)),
    cwd: text(value.cwd),
    status: status as CodexTaskStatus,
    stage: ["thinking", "running-command", "processing-result", "waiting-input", "completed"].includes(
      String(stage),
    )
      ? stage as CodexTaskStage
      : defaultStage(status as CodexTaskStatus),
    createdAt,
    updatedAt,
  };
  if (typeof value.completedAt === "number" && Number.isFinite(value.completedAt)) {
    task.completedAt = value.completedAt;
  }
  return task;
};

export const loadCodexTasks = (now = Date.now()): CodexTask[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return sortCodexTasks(
      parsed
        .map(normalizeTask)
        .filter((task): task is CodexTask => task !== null && taskIsFresh(task, now)),
    );
  } catch {
    return [];
  }
};

const taskFromEvent = (
  existing: CodexTask | undefined,
  payload: Record<string, unknown>,
  receivedAtMs: number,
  status: CodexTaskStatus,
  stage: CodexTaskStage,
): CodexTask | null => {
  const sessionId = text(payload.session_id);
  if (!sessionId) return null;
  const cwd = text(payload.cwd) || existing?.cwd || "";
  const prompt = text(payload.prompt);
  const turnId = text(payload.turn_id) || existing?.turnId || `session-${sessionId}`;
  const next: CodexTask = {
    sessionId,
    turnId,
    title: prompt ? cleanTitle(prompt, projectName(cwd)) : existing?.title || cleanTitle("", projectName(cwd)),
    project: projectName(cwd) || existing?.project || "Codex",
    cwd,
    status,
    stage,
    createdAt: existing?.createdAt ?? receivedAtMs,
    updatedAt: receivedAtMs,
  };
  if (status === "completed") next.completedAt = receivedAtMs;
  return next;
};

export const reduceCodexHookEvents = (
  currentTasks: CodexTask[],
  envelopes: CodexHookEnvelope[],
  now = Date.now(),
): CodexTaskReduction => {
  const bySession = new Map(
    currentTasks.filter((task) => taskIsFresh(task, now)).map((task) => [task.sessionId, task]),
  );
  const completed: CodexTask[] = [];
  let changed = bySession.size !== currentTasks.length;

  for (const envelope of envelopes) {
    if (!isRecord(envelope.payload)) continue;
    const payload = envelope.payload;
    const eventName = text(payload.hook_event_name);
    const sessionId = text(payload.session_id);
    const timestamp = Number.isFinite(envelope.receivedAtMs) ? envelope.receivedAtMs : now;
    const existing = bySession.get(sessionId);

    if (eventName === "SessionEnd") {
      if (sessionId && bySession.delete(sessionId)) changed = true;
      continue;
    }

    let status: CodexTaskStatus | null = null;
    let stage: CodexTaskStage | null = null;
    if (eventName === "UserPromptSubmit") {
      status = "running";
      stage = "thinking";
    }
    if (eventName === "PreToolUse" && existing) {
      status = "running";
      stage = "running-command";
    }
    if (eventName === "PostToolUse" && existing) {
      status = "running";
      stage = "processing-result";
    }
    if (eventName === "PermissionRequest") {
      status = "needs-input";
      stage = "waiting-input";
    }
    if (eventName === "Stop") {
      status = "completed";
      stage = "completed";
    }
    if (!status || !stage) continue;

    const next = taskFromEvent(existing, payload, timestamp, status, stage);
    if (!next) continue;
    bySession.set(next.sessionId, next);
    changed = true;
    if (status === "completed" && existing?.status !== "completed") completed.push(next);
  }

  return {
    tasks: sortCodexTasks([...bySession.values()].filter((task) => taskIsFresh(task, now))),
    completed,
    changed,
  };
};

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const publishCodexTasks = async (tasks: CodexTask[]): Promise<void> => {
  const sorted = sortCodexTasks(tasks);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  if (isTauriRuntime()) {
    await emit(TASKS_EVENT, sorted);
  } else if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(TASKS_EVENT);
    channel.postMessage(sorted);
    channel.close();
  }
};

export const clearCodexTasks = async (): Promise<void> => publishCodexTasks([]);

export const publishCodexCompletion = async (task: CodexTask): Promise<void> => {
  if (isTauriRuntime()) {
    await emit(COMPLETION_EVENT, task);
  } else if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(COMPLETION_EVENT);
    channel.postMessage(task);
    channel.close();
  }
};

const subscribeChannel = async <T>(eventName: string, onPayload: (payload: T) => void): Promise<UnlistenFn> => {
  if (isTauriRuntime()) {
    return listen<T>(eventName, (event) => onPayload(event.payload));
  }
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(eventName) : null;
  const onMessage = (event: MessageEvent<T>): void => onPayload(event.data);
  channel?.addEventListener("message", onMessage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
  };
};

export const subscribeCodexTasks = (onTasks: (tasks: CodexTask[]) => void): Promise<UnlistenFn> =>
  subscribeChannel<CodexTask[]>(TASKS_EVENT, (tasks) =>
    onTasks(sortCodexTasks(tasks.map(normalizeTask).filter((task): task is CodexTask => task !== null))),
  );

export const subscribeCodexCompletions = (
  onCompletion: (task: CodexTask) => void,
): Promise<UnlistenFn> => subscribeChannel<CodexTask>(COMPLETION_EVENT, (task) => {
  const normalized = normalizeTask(task);
  if (normalized) onCompletion(normalized);
});

export const activeCodexTasks = (tasks: CodexTask[]): CodexTask[] =>
  tasks.filter((task) => task.status !== "completed");
