/**
 * pi SDK adapter boundary
 * Zones: pi agent sdk boundary, shared adapters
 * Owns direct pi SDK imports and exposes narrow bridge-facing helpers/types for the extension composition layer
 */

import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createReadStream, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  type AgentEndEvent,
  type AgentSettledEvent,
  type AgentStartEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type InputEvent,
  type MessageEndEvent,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SlashCommandInfo,
  type UIPromptEndEvent,
  type UIPromptStartEvent,
  SettingsManager,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

export type {
  AgentEndEvent,
  AgentSettledEvent,
  AgentStartEvent,
  AssistantMessageEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  MessageEndEvent,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionInfo,
  SlashCommandInfo,
  UIPromptEndEvent,
  UIPromptStartEvent,
};

export type PiSessionSummary = Pick<SessionInfo, "id" | "cwd" | "path" | "modified"> &
  Partial<Pick<SessionInfo, "name">>;

export async function listPiSessions(ctx: ExtensionContext): Promise<PiSessionSummary[]> {
  const dir = ctx.sessionManager.getSessionDir();
  let files: Dirent[];
  try {
    files = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const sessions: PiSessionSummary[] = [];
  for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))) {
    const path = join(dir, file.name);
    try {
      const modified = (await stat(path)).mtime;
      const stream = createReadStream(path, { encoding: "utf8" });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let header: { id: string; cwd: string } | undefined;
      let name: string | undefined;
      try {
        for await (const line of lines) {
          let entry: { type?: unknown; id?: unknown; cwd?: unknown; name?: unknown };
          try { entry = JSON.parse(line); } catch { continue; }
          if (!entry || typeof entry !== "object") continue;
          if (!header) {
            if (entry.type !== "session" || typeof entry.id !== "string" ||
                typeof entry.cwd !== "string") break;
            header = { id: entry.id, cwd: entry.cwd };
          } else if (entry.type === "session_info") {
            name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
          }
        }
      } finally {
        lines.close();
        stream.destroy();
      }
      if (header && resolve(header.cwd) === resolve(ctx.cwd))
        sessions.push({ id: header.id, cwd: ctx.cwd, path, modified, ...(name ? { name } : {}) });
    } catch {
      // A deleted or unreadable session does not prevent browsing other sessions.
    }
  }
  return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

export interface SessionCompactFailedEvent {
  type: "session_compact_failed";
  reason: "manual" | "threshold" | "overflow";
  errorMessage?: string;
  aborted: boolean;
  willRetry: boolean;
  fromExtension: boolean;
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface PiSettingsManager {
  reload: () => Promise<void>;
  flush: () => Promise<void>;
  getEnabledModels: () => string[] | undefined;
  setEnabledModels: (patterns: string[] | undefined) => void;
}

export type PiSlashCommandInfo = SlashCommandInfo;
export type PiRunMode = "tui" | "rpc" | "json" | "print";

function isPiRunMode(value: unknown): value is PiRunMode {
  return (
    value === "tui" || value === "rpc" || value === "json" || value === "print"
  );
}

/** Pi rejects a context captured before session replacement with a stale-context error; this is not a domain failure. */
export function isPiStaleContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("stale after session") ||
      error.message.includes("stale ctx"))
  );
}

export function getExtensionContextMode(ctx: unknown): PiRunMode | undefined {
  const mode =
    typeof ctx === "object" && ctx !== null
      ? (ctx as { mode?: unknown }).mode
      : undefined;
  return isPiRunMode(mode) ? mode : undefined;
}

export function isExtensionContextPassiveRunMode(ctx: unknown): boolean {
  const mode = getExtensionContextMode(ctx);
  return mode === "print" || mode === "json";
}

export function canStartPollingInExtensionContext(ctx: unknown): boolean {
  return !isExtensionContextPassiveRunMode(ctx);
}

export function formatPollingStartBlockedByRunMode(ctx: unknown): string {
  const mode = getExtensionContextMode(ctx);
  return mode
    ? `Telegram polling is unavailable in Pi ${mode} mode. Use /telegram-connect from a long-lived Pi session.`
    : "Telegram polling is unavailable in this Pi run mode.";
}

export function getSessionCompactionReason(
  event: unknown,
): "manual" | "threshold" | "overflow" | "unknown" {
  const reason =
    event && typeof event === "object" && "reason" in event
      ? (event as { reason?: unknown }).reason
      : undefined;
  return reason === "manual" || reason === "threshold" || reason === "overflow"
    ? reason
    : "unknown";
}

export interface PiExtensionApiRuntimePorts {
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  exec: ExtensionAPI["exec"];
  getCommands: ExtensionAPI["getCommands"];
  getThinkingLevel: ExtensionAPI["getThinkingLevel"];
  setThinkingLevel: ExtensionAPI["setThinkingLevel"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
  setModel: ExtensionAPI["setModel"];
  registerCommand: ExtensionAPI["registerCommand"];
}

export function createExtensionApiRuntimePorts(
  api: Pick<
    ExtensionAPI,
    | "sendUserMessage"
    | "exec"
    | "getCommands"
    | "getThinkingLevel"
    | "setThinkingLevel"
    | "getActiveTools"
    | "setActiveTools"
    | "setModel"
    | "registerCommand"
  >,
): PiExtensionApiRuntimePorts {
  return {
    sendUserMessage: (content, options) =>
      api.sendUserMessage(content, options),
    exec: (command, args, options) => api.exec(command, args, options),
    getCommands: () => api.getCommands(),
    getThinkingLevel: () => api.getThinkingLevel(),
    setThinkingLevel: (level) => api.setThinkingLevel(level),
    getActiveTools: () => api.getActiveTools(),
    setActiveTools: (names) => api.setActiveTools(names),
    setModel: (model) => api.setModel(model),
    registerCommand: (name, options) => api.registerCommand(name, options),
  };
}

type PiSettingsManagerFactory = {
  create: (cwd: string) => unknown | PromiseLike<unknown>;
};

type HostSettingsManager = {
  reload?: () => void | PromiseLike<void>;
  flush?: () => void | PromiseLike<void>;
  getEnabledModels?: () => unknown;
  setEnabledModels?: (patterns: string[] | undefined) => void;
  get?: (key: string) => unknown;
  set?: (key: string, value: unknown) => void;
};

function readEnabledModels(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return [...value];
  }
  throw new TypeError(
    "Host settings enabledModels must be a string array or undefined.",
  );
}

export function normalizeSettingsManager(manager: unknown): PiSettingsManager {
  if (typeof manager !== "object" || manager === null) {
    throw new TypeError("Host settings manager must be an object.");
  }
  const host = manager as HostSettingsManager;
  if (typeof host.flush !== "function") {
    throw new TypeError("Host settings manager must provide flush().");
  }
  const read =
    typeof host.getEnabledModels === "function"
      ? () => host.getEnabledModels!.call(host)
      : typeof host.get === "function"
        ? () => host.get!.call(host, "enabledModels")
        : undefined;
  const write =
    typeof host.setEnabledModels === "function"
      ? (patterns: string[] | undefined) =>
          host.setEnabledModels!.call(host, patterns)
      : typeof host.set === "function"
        ? (patterns: string[] | undefined) =>
            host.set!.call(host, "enabledModels", patterns ?? [])
        : undefined;
  if (!read || !write) {
    throw new TypeError(
      "Host settings manager must provide enabled-model read and write capabilities.",
    );
  }
  return {
    reload: async () => {
      await host.reload?.call(host);
    },
    flush: async () => {
      await host.flush!.call(host);
    },
    getEnabledModels: () => readEnabledModels(read()),
    setEnabledModels: write,
  };
}

export async function createSettingsManager(
  cwd: string,
): Promise<PiSettingsManager> {
  // Pi returns its legacy settings surface synchronously. Compatible hosts may
  // resolve a generic settings service asynchronously; normalize both once at
  // the SDK boundary instead of leaking host distinctions into menu domains.
  const factory = SettingsManager as unknown as PiSettingsManagerFactory;
  return normalizeSettingsManager(await factory.create(cwd));
}

export function createScopedModelPatternPersister(deps: {
  createSettingsManager: (
    cwd: string,
  ) => PiSettingsManager | PromiseLike<PiSettingsManager>;
  clearCachedModelMenuInputs: () => void;
}): (patterns: string[], ctx: ExtensionContext) => Promise<void> {
  return async (patterns, ctx) => {
    const settingsManager = await deps.createSettingsManager(ctx.cwd);
    settingsManager.setEnabledModels(
      patterns.length > 0 ? patterns : undefined,
    );
    await settingsManager.flush();
    deps.clearCachedModelMenuInputs();
  };
}

export function getExtensionContextModel(
  ctx: ExtensionContext,
): ExtensionContext["model"] {
  return ctx.model;
}

export function getExtensionContextCwd(ctx: ExtensionContext): string {
  return ctx.cwd;
}

export function getExtensionContextSessionId(ctx: ExtensionContext): string;
export function getExtensionContextSessionId(
  ctx: ExtensionContext | undefined,
): string | undefined;
export function getExtensionContextSessionId(
  ctx: ExtensionContext | undefined,
): string | undefined {
  // Minimal hosts and stale contexts may omit a session manager; absence is not an invented ID.
  return ctx?.sessionManager?.getSessionId?.();
}

export function isExtensionContextIdle(ctx: ExtensionContext): boolean {
  return ctx.isIdle();
}

export function hasExtensionContextPendingMessages(
  ctx: ExtensionContext,
): boolean {
  return ctx.hasPendingMessages();
}

export function compactExtensionContext(
  ctx: ExtensionContext,
  callbacks: Parameters<ExtensionContext["compact"]>[0],
): ReturnType<ExtensionContext["compact"]> {
  return ctx.compact(callbacks);
}
