/**
 * Telegram bridge runtime-state helpers
 * Zones: pi agent runtime state, telegram session, shared coordination
 * Owns small session-local runtime primitives that are shared by orchestration but are not specific to queueing, rendering, polling, or Telegram transport
 */
import * as Machine from "./machine.ts";
/**
 * Structural port for run-collapsing diagnostics: a repeated identical failure extends its run instead of logging
 * again, and the closing success records one outcome. The composition root owns the collapsed implementation.
 */
export interface TelegramRepeatedFailureLogPort {
    record: (error: unknown, details?: Record<string, unknown>) => void;
    settled: () => void;
    reset: () => void;
}
export interface TelegramRuntimeQueueCounters {
    nextQueuedTelegramItemOrder: number;
    nextQueuedTelegramControlOrder: number;
}
export interface TelegramRuntimeLifecycleFlags {
    activeTelegramToolExecutions: number;
    telegramTurnDispatchPending: boolean;
    compactionInProgress: boolean;
    foldQueuedPromptsIntoHistory: boolean;
    setupInProgress: boolean;
}
export interface TelegramBridgeRuntimeState extends TelegramRuntimeQueueCounters, TelegramRuntimeLifecycleFlags {
    abortHandler?: () => void;
}
export interface TelegramRuntimeQueuePort {
    syncCounters: (counters: Partial<TelegramRuntimeQueueCounters>) => void;
    allocateItemOrder: () => number;
    allocateControlOrder: () => number;
}
export interface TelegramRuntimeLifecyclePort {
    syncFlags: (flags: Partial<TelegramRuntimeLifecycleFlags>) => void;
    getActiveToolExecutions: () => number;
    setActiveToolExecutions: (count: number) => void;
    resetActiveToolExecutions: () => void;
    hasDispatchPending: () => boolean;
    setDispatchPending: (pending: boolean) => void;
    clearDispatchPending: () => void;
    isCompactionInProgress: () => boolean;
    setCompactionInProgress: (inProgress: boolean) => void;
    shouldFoldQueuedPromptsIntoHistory: () => boolean;
    setFoldQueuedPromptsIntoHistory: (fold: boolean) => void;
}
export interface TelegramRuntimeSetupPort {
    isInProgress: () => boolean;
    start: () => boolean;
    finish: () => void;
}
export interface TelegramRuntimeAbortPort {
    hasHandler: () => boolean;
    setHandler: (abortHandler: () => void) => void;
    clearHandler: () => void;
    getHandler: () => (() => void) | undefined;
    abortTurn: () => boolean;
}
export interface TelegramRuntimeTypingPort {
    start: (deps: TelegramTypingLoopDeps) => boolean;
    stop: () => boolean;
    /** Waits for the in-flight action, bounded so a never-settling request cannot hold shutdown. */
    waitForIdle: (timeoutMs?: number) => Promise<void>;
}
export interface TelegramBridgeRuntime {
    state: TelegramBridgeRuntimeState;
    queue: TelegramRuntimeQueuePort;
    lifecycle: TelegramRuntimeLifecyclePort;
    setup: TelegramRuntimeSetupPort;
    abort: TelegramRuntimeAbortPort;
    typing: TelegramRuntimeTypingPort;
}
export declare function createTelegramBridgeRuntimeState(): TelegramBridgeRuntimeState;
export declare function createTelegramBridgeRuntime(state?: TelegramBridgeRuntimeState, typing?: TelegramRuntimeTypingPort): TelegramBridgeRuntime;
export declare function syncTelegramQueueRuntimeCounters(state: TelegramBridgeRuntimeState, counters: Partial<TelegramRuntimeQueueCounters>): void;
export declare function allocateTelegramQueueItemOrder(state: TelegramBridgeRuntimeState): number;
export declare function allocateTelegramQueueControlOrder(state: TelegramBridgeRuntimeState): number;
export declare function syncTelegramLifecycleRuntimeFlags(state: TelegramBridgeRuntimeState, flags: Partial<TelegramRuntimeLifecycleFlags>): void;
export declare function getActiveTelegramToolExecutions(state: TelegramBridgeRuntimeState): number;
export declare function setActiveTelegramToolExecutions(state: TelegramBridgeRuntimeState, count: number): void;
export declare function resetActiveTelegramToolExecutions(state: TelegramBridgeRuntimeState): void;
export declare function hasTelegramDispatchPending(state: TelegramBridgeRuntimeState): boolean;
export declare function clearTelegramDispatchPending(state: TelegramBridgeRuntimeState): void;
export declare function isTelegramCompactionInProgress(state: TelegramBridgeRuntimeState): boolean;
export declare function setTelegramCompactionInProgress(state: TelegramBridgeRuntimeState, inProgress: boolean): void;
export declare function shouldFoldQueuedPromptsIntoHistory(state: TelegramBridgeRuntimeState): boolean;
export declare function setFoldQueuedPromptsIntoHistory(state: TelegramBridgeRuntimeState, fold: boolean): void;
export declare function isTelegramSetupInProgress(state: TelegramBridgeRuntimeState): boolean;
export declare function startTelegramSetup(state: TelegramBridgeRuntimeState): boolean;
export declare function finishTelegramSetup(state: TelegramBridgeRuntimeState): void;
export declare function hasTelegramAbortHandler(state: TelegramBridgeRuntimeState): boolean;
export declare function setTelegramAbortHandler(state: TelegramBridgeRuntimeState, abortHandler: () => void): void;
export declare function clearTelegramAbortHandler(state: TelegramBridgeRuntimeState): void;
export declare function getTelegramAbortHandler(state: TelegramBridgeRuntimeState): (() => void) | undefined;
export declare function abortTelegramTurn(state: TelegramBridgeRuntimeState): boolean;
export interface TelegramTypingLoopTarget {
    chatId: number;
    threadId?: number;
}
export interface TelegramTypingLoopDeps {
    chatId: number | undefined;
    target?: TelegramTypingLoopTarget;
    intervalMs: number;
    sendTypingAction: (chatId: number, options?: {
        message_thread_id?: number;
    }) => Promise<unknown>;
    shouldContinue?: () => boolean;
    onStopped?: () => void;
}
export interface TelegramRuntimeEventRecorderPort {
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
export interface TelegramTypingLoopStarterDeps<TContext> extends TelegramRuntimeEventRecorderPort {
    /** Collapses one sustained presence failure run; the caller supplies its owner. */
    failureLog: TelegramRepeatedFailureLogPort;
    typing: TelegramRuntimeTypingPort;
    getDefaultChatId: () => number | undefined;
    sendTypingAction: (chatId: number, options?: {
        message_thread_id?: number;
        assertAuthority?: () => void;
    }) => Promise<unknown>;
    updateStatus: (ctx: TContext, error?: string) => void;
    isContextActive?: (ctx: TContext) => boolean;
    getSessionGeneration?: () => number;
    isTransportAvailable?: () => boolean;
    isThreadedMode?: () => boolean;
    getTransportAuthority?: () => string | number | undefined;
    intervalMs?: number;
}
export declare function createTelegramTypingLoopStarter<TContext>(deps: TelegramTypingLoopStarterDeps<TContext>): (ctx: TContext, chatId?: number, options?: {
    target?: TelegramTypingLoopTarget;
    ensure?: boolean;
}) => boolean;
/** The whole typing-loop state; only `transitionTelegramTypingLoop` produces a new one. */
export interface TelegramTypingMachineState {
    /** The loop the interval serves; its callbacks live in the shell under `id`. A loop exists exactly while ticking. */
    readonly loop: {
        readonly id: number;
        readonly key: string;
        readonly chatId: number;
        readonly threadParams?: {
            readonly message_thread_id: number;
        };
    } | null;
    /** The action in flight; a tick waits for it, and replacing or stopping the loop forgets it. */
    readonly inFlight: number | null;
    readonly nextSendId: number;
}
export type TelegramTypingEvent = {
    type: "started";
    /** Shell-assigned, so the shell can hold the caller's callbacks before effects run. */
    loopId: number;
    chatId: number | undefined;
    key: string;
    threadParams?: {
        message_thread_id: number;
    };
    intervalMs: number;
    /** The caller's `shouldContinue`, sampled at dispatch. */
    continues: boolean;
} | {
    type: "ticked";
    continues: boolean;
} | {
    type: "sendSettled";
    sendId: number;
} | {
    type: "stopRequested";
};
export type TelegramTypingEffect = {
    type: "send";
    loopId: number;
    sendId: number;
    chatId: number;
    threadParams?: {
        message_thread_id: number;
    };
} | {
    type: "armInterval";
    intervalMs: number;
} | {
    type: "cancelInterval";
} | {
    type: "loopEnded";
    loopId: number;
};
export interface TelegramTypingStep extends Machine.TelegramMachineStep<TelegramTypingMachineState, TelegramTypingEffect> {
    /** `start`: a loop began or moved to a new target. `stop`: a running loop ended. */
    result: boolean;
}
export declare function createTelegramTypingMachineState(): TelegramTypingMachineState;
/**
 * Pure typing-loop transition. Every start replaces the caller's callbacks, even on the same target, and forgets the
 * old in-flight action; only a new target sends at once on a running loop, whose interval keeps its phase.
 */
export declare function transitionTelegramTypingLoop(state: TelegramTypingMachineState, event: TelegramTypingEvent): TelegramTypingStep;
/**
 * The shell around `transitionTelegramTypingLoop`: it holds each loop's callbacks, samples `shouldContinue` into
 * events, owns the interval and turns every action outcome into `sendSettled`.
 */
export declare function createTelegramTypingLoop(): TelegramRuntimeTypingPort;
export declare function createTelegramContextAbortHandlerSetter<TContext extends {
    abort: () => void;
}>(abort: Pick<TelegramRuntimeAbortPort, "setHandler">): (ctx: TContext) => void;
export interface TelegramAgentEndResetDeps {
    abort: Pick<TelegramRuntimeAbortPort, "clearHandler">;
    typing: Pick<TelegramRuntimeTypingPort, "stop">;
    clearActiveTurn: () => void;
    resetToolExecutions: () => void;
    clearPendingModelSwitch: () => void;
    clearDispatchPending: () => void;
}
export declare function createTelegramAgentEndResetter(deps: TelegramAgentEndResetDeps): () => void;
export interface TelegramPromptDispatchLifecycleDeps<TContext> extends TelegramRuntimeEventRecorderPort {
    lifecycle: Pick<TelegramRuntimeLifecyclePort, "setDispatchPending" | "clearDispatchPending">;
    typing: Pick<TelegramRuntimeTypingPort, "stop">;
    startTypingLoop: (ctx: TContext, chatId?: number, options?: {
        target?: TelegramTypingLoopTarget;
    }) => boolean | void;
    updateStatus: (ctx: TContext, error?: string) => void;
}
export interface TelegramPromptDispatchRuntimeDeps<TContext> extends TelegramTypingLoopStarterDeps<TContext> {
    lifecycle: TelegramPromptDispatchLifecycleDeps<TContext>["lifecycle"];
}
export interface TelegramPromptDispatchRuntime<TContext> {
    startTypingLoop: (ctx: TContext, chatId?: number, options?: {
        target?: TelegramTypingLoopTarget;
        ensure?: boolean;
    }) => boolean | void;
    onPromptDispatchStart: (ctx: TContext, chatId?: number, target?: TelegramTypingLoopTarget) => void;
    onPromptDispatchFailure: (ctx: TContext, message: string) => void;
}
export declare function createTelegramPromptDispatchRuntime<TContext>(deps: TelegramPromptDispatchRuntimeDeps<TContext>): TelegramPromptDispatchRuntime<TContext>;
export declare function createTelegramPromptDispatchLifecycle<TContext>(deps: TelegramPromptDispatchLifecycleDeps<TContext>): {
    onPromptDispatchStart: (ctx: TContext, chatId?: number, target?: TelegramTypingLoopTarget) => void;
    onPromptDispatchFailure: (ctx: TContext, message: string) => void;
};
