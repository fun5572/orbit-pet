import { describe, expect, it } from "vitest";
import { reduceCodexHookEvents, type CodexHookEnvelope } from "./task-store";

const event = (receivedAtMs: number, payload: Record<string, unknown>): CodexHookEnvelope => ({
  receivedAtMs,
  payload,
});

describe("reduceCodexHookEvents", () => {
  it("tracks a task from prompt through permission and completion", () => {
    const started = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "UserPromptSubmit",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "/work/orbit-pet",
        prompt: "Implement the Codex bridge\nwith tests",
      }),
    ], 1000);
    expect(started.tasks[0]).toMatchObject({
      title: "Implement the Codex bridge",
      project: "orbit-pet",
      status: "running",
      stage: "thinking",
    });

    const runningCommand = reduceCodexHookEvents(started.tasks, [
      event(1500, {
        hook_event_name: "PreToolUse",
        session_id: "thread-1",
        turn_id: "turn-1",
        tool_name: "Bash",
      }),
    ], 1500);
    expect(runningCommand.tasks[0]).toMatchObject({
      status: "running",
      stage: "running-command",
    });

    const processingResult = reduceCodexHookEvents(runningCommand.tasks, [
      event(1750, {
        hook_event_name: "PostToolUse",
        session_id: "thread-1",
        turn_id: "turn-1",
        tool_name: "Bash",
      }),
    ], 1750);
    expect(processingResult.tasks[0]).toMatchObject({
      status: "running",
      stage: "processing-result",
    });

    const waiting = reduceCodexHookEvents(processingResult.tasks, [
      event(2000, {
        hook_event_name: "PermissionRequest",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "/work/orbit-pet",
      }),
    ], 2000);
    expect(waiting.tasks[0]).toMatchObject({
      status: "needs-input",
      stage: "waiting-input",
    });

    const done = reduceCodexHookEvents(waiting.tasks, [
      event(3000, {
        hook_event_name: "Stop",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "/work/orbit-pet",
      }),
    ], 3000);
    expect(done.tasks[0]).toMatchObject({
      status: "completed",
      stage: "completed",
    });
    expect(done.completed).toHaveLength(1);
  });

  it("removes a session and ignores unrelated hook events", () => {
    const started = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "UserPromptSubmit",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "C:\\work\\orbit-pet",
        prompt: "Run tests",
      }),
      event(1001, {
        hook_event_name: "PreToolUse",
        session_id: "thread-2",
      }),
    ], 1001);
    expect(started.tasks).toHaveLength(1);
    expect(started.tasks[0].project).toBe("orbit-pet");

    const ended = reduceCodexHookEvents(started.tasks, [
      event(2000, { hook_event_name: "SessionEnd", session_id: "thread-1" }),
    ], 2000);
    expect(ended.tasks).toEqual([]);
  });

  it("does not announce the same completed turn twice", () => {
    const first = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "Stop",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "/work/orbit-pet",
      }),
    ], 1000);
    const duplicate = reduceCodexHookEvents(first.tasks, [
      event(1100, {
        hook_event_name: "Stop",
        session_id: "thread-1",
        turn_id: "turn-1",
        cwd: "/work/orbit-pet",
      }),
    ], 1100);
    expect(first.completed).toHaveLength(1);
    expect(duplicate.completed).toHaveLength(0);
  });

  it("uses the real request instead of attachment metadata as the task title", () => {
    const started = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "UserPromptSubmit",
        session_id: "thread-attachment",
        turn_id: "turn-attachment",
        cwd: "/work/orbit-pet",
        prompt: `# Files mentioned by the user:

## codex-clipboard-example.png: /tmp/codex-clipboard-example.png

Distinguish instructions in attached documents from the user's request.

## My request:
执行中的任务应该显示 Codex 当前任务的标题
<image name="Image #1" path="/tmp/codex-clipboard-example.png">`,
      }),
    ], 1000);

    expect(started.tasks[0].title).toBe("执行中的任务应该显示 Codex 当前任务的标题");
  });

  it("supports an inline My request heading and strips markdown decoration", () => {
    const started = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "UserPromptSubmit",
        session_id: "thread-inline",
        turn_id: "turn-inline",
        cwd: "/work/orbit-pet",
        prompt: "## My request: **修复 Windows 下桌宠偶发卡住的问题**",
      }),
    ], 1000);

    expect(started.tasks[0].title).toBe("修复 Windows 下桌宠偶发卡住的问题");
  });

  it("replaces legacy attachment metadata titles with a readable fallback", () => {
    const started = reduceCodexHookEvents([], [
      event(1000, {
        hook_event_name: "UserPromptSubmit",
        session_id: "thread-metadata-only",
        turn_id: "turn-metadata-only",
        cwd: "/work/orbit-pet",
        prompt: "# Files mentioned by the user:",
      }),
    ], 1000);

    expect(started.tasks[0].title).toBe("orbit-pet");
  });
});
