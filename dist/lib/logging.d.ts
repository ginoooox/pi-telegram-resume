/**
 * Telegram diagnostics logs
 * Zones: telegram diagnostics, filesystem, session observability
 * Owns bounded JSONL runtime evidence files, previous-log preservation, and profile-aware log paths without becoming routing state
 */
import * as Status from "./status.ts";
/** Sink shape shared with the runtime event recorder this domain already owns. */
export type TelegramFailureRecordSink = (category: string, errorOrMessage: unknown, details: Record<string, unknown>) => void;
export interface TelegramFailureRunSummary {
    signature: string;
    failedAttempts: number;
    suppressedFailures: number;
    failedForMs: number;
}
export interface TelegramFailureRunLog {
    /** Records one failure; a repeated identical failure only extends the current run and returns false. */
    record: (error: unknown, details?: Record<string, unknown>) => boolean;
    /** Closes the run after a success, emitting its single outcome record. */
    settled: () => TelegramFailureRunSummary | undefined;
    /** Ends the run without an outcome record, for a stop or replacement that reports its own outcome. */
    reset: () => void;
}
export interface TelegramFailureRunLogInput {
    category: string;
    failurePhase: string;
    outcomePhase: string;
    /** Human-readable subject for the outcome record, e.g. `follower heartbeat`. */
    label: string;
    record?: TelegramFailureRecordSink;
    /** Static context reapplied to every record of this phase, e.g. a session or profile key. */
    context?: () => Record<string, unknown>;
    getNowMs?: () => number;
}
/** Stable identity of one failure kind: errno when present, otherwise the failure text. */
export declare function getTelegramFailureSignature(error: unknown): string;
/**
 * Consecutive identical failure runs for one diagnostic phase: a repeat extends the run instead of logging again,
 * and a closing success or reset emits at most one outcome record. This never gates detection or recovery.
 */
export declare function createTelegramFailureRunLog(input: TelegramFailureRunLogInput): TelegramFailureRunLog;
type TelegramLogPathInput = string | (() => string);
interface TelegramRuntimeJsonlEvent {
    at: number;
    category: string;
    message: string;
    details?: Record<string, unknown>;
}
interface TelegramRuntimeJsonlLogOptions {
    path?: TelegramLogPathInput;
    previousPath?: TelegramLogPathInput;
    maxBytes?: number;
    getNowMs?: () => number;
    canReset?: () => boolean;
    commitReset?: (commit: () => void) => boolean;
    /** Explicit shared-file protocol; profile-labelled scope reset is an append, never truncation. */
    sharedProfiles?: {
        getProfileName: () => string | undefined;
        captureAuthority: () => (() => boolean) | undefined;
    };
}
interface TelegramRuntimeJsonlLog {
    getPath: () => string;
    reset: (reason: string, scope?: Record<string, unknown>) => void;
    resetIfScopeChanged: (scopeKey: string, reason: string, scope?: Record<string, unknown>) => void;
    record: (event: TelegramRuntimeJsonlEvent) => void;
}
export declare function getTelegramRuntimeLogPath(agentDir?: string, profileName?: string): string;
export declare function getTelegramPreviousRuntimeLogPath(agentDir?: string, profileName?: string): string;
export declare function createTelegramRuntimeJsonlLog(options?: TelegramRuntimeJsonlLogOptions): TelegramRuntimeJsonlLog;
interface TelegramRuntimeDiagnosticsStatusPorts<TContext> {
    instanceId: string;
    updateStatus(ctx: TContext, error?: string): void;
    getStatusState(): Status.TelegramBridgeStatusLineState;
    persistSnapshot(snapshot: ReturnType<typeof Status.createTelegramStatusSnapshot>): Promise<void>;
    session?: {
        get(): TContext | undefined;
        getGeneration(): number;
        isCurrent(ctx: TContext, generation?: number): boolean;
    };
}
interface TelegramRuntimeDiagnosticsRuntime<TContext> {
    events: Status.TelegramRuntimeEventRecorder;
    recordRuntimeEvent(category: string, error: unknown, details?: Record<string, unknown>): void;
    /** A phase-scoped failure log whose records travel through this runtime's own event pipeline. */
    createFailureLog(input: Omit<TelegramFailureRunLogInput, "record">): TelegramFailureRunLog;
    bindStorage(ports: {
        getBotToken(): string | undefined;
        getProfileName(): string | undefined;
        canReset(): boolean;
        commitReset(commit: () => void): boolean;
        captureAuthority?: () => (() => boolean) | undefined;
    }): void;
    bindStatus(ports: TelegramRuntimeDiagnosticsStatusPorts<TContext>): void;
    onSessionStart(): void;
    onSessionShutdown(): Promise<void>;
    updateStatus(ctx: TContext, error?: string): void;
    getStatusLines(options?: Status.TelegramBridgeStatusLineOptions): string[];
    scheduleSnapshotPersist(): void;
}
export declare function createTelegramRuntimeDiagnosticsRuntime<TContext>(options?: {
    sharedFile?: boolean;
    snapshotTimer?: Pick<Parameters<typeof Status.createTelegramRuntimeDiagnosticsSnapshotScheduler>[0], "setTimer" | "clearTimer">;
}): TelegramRuntimeDiagnosticsRuntime<TContext>;
export {};
