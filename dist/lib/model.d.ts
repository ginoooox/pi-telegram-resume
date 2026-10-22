/**
 * Telegram model control domain helpers
 * Zones: pi agent model control, telegram controls, queue continuation
 * Owns model identity, thinking levels, scoped resolution, current-model state, and in-flight model switching
 */
import * as Machine from "./machine.ts";
import { type PendingTelegramTurn } from "./queue.ts";
export interface MenuModel {
    provider: string;
    id: string;
    name?: string;
    reasoning?: boolean;
}
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ScopedTelegramModel<TModel extends MenuModel = MenuModel> {
    model: TModel;
    thinkingLevel?: ThinkingLevel;
}
export declare const THINKING_LEVELS: readonly ThinkingLevel[];
export interface CurrentModelStore<TContext, TModel extends MenuModel = MenuModel> {
    get: (ctx: TContext) => TModel | undefined;
    getStored: () => TModel | undefined;
    set: (model: TModel | undefined) => void;
}
export interface CurrentModelUpdateRuntime<TContext, TModel extends MenuModel = MenuModel> {
    setCurrentModel: (model: TModel | undefined, ctx: TContext) => void;
    onModelSelect: (event: {
        model: TModel | undefined;
    }, ctx: TContext) => void;
}
export type CurrentModelRuntime<TContext, TModel extends MenuModel = MenuModel> = CurrentModelStore<TContext, TModel> & CurrentModelUpdateRuntime<TContext, TModel>;
export declare function createCurrentModelStore<TContext, TModel extends MenuModel = MenuModel>(getContextModel: (ctx: TContext) => TModel | undefined): CurrentModelStore<TContext, TModel>;
export declare function createCurrentModelUpdateRuntime<TContext, TModel extends MenuModel = MenuModel>(deps: {
    setCurrentModel: (model: TModel | undefined) => void;
    updateStatus: (ctx: TContext) => void;
}): CurrentModelUpdateRuntime<TContext, TModel>;
export declare function createCurrentModelRuntime<TContext, TModel extends MenuModel = MenuModel>(deps: {
    getContextModel: (ctx: TContext) => TModel | undefined;
    updateStatus: (ctx: TContext) => void;
}): CurrentModelRuntime<TContext, TModel>;
export declare function modelsMatch(a: Pick<MenuModel, "provider" | "id"> | undefined, b: Pick<MenuModel, "provider" | "id"> | undefined): boolean;
export declare function getCanonicalModelId(model: Pick<MenuModel, "provider" | "id">): string;
export declare function isThinkingLevel(value: string): value is ThinkingLevel;
export declare function parseTelegramScopedModelPatternList(value: string): string[];
export declare function parseTelegramCliScopedModelPatterns(args: string[]): string[] | undefined;
export declare function resolveScopedModelPatterns<TModel extends MenuModel = MenuModel>(patterns: string[], availableModels: TModel[]): ScopedTelegramModel<TModel>[];
export declare function sortScopedModels<TModel extends MenuModel = MenuModel>(models: ScopedTelegramModel<TModel>[], currentModel: TModel | undefined): ScopedTelegramModel<TModel>[];
export interface TelegramInFlightModelSwitchState {
    isIdle: boolean;
    hasAbortHandler: boolean;
}
export declare function canRestartAgentRunForTelegramModelSwitch(state: TelegramInFlightModelSwitchState): boolean;
export declare function shouldTriggerPendingTelegramModelSwitchAbort(state: {
    hasPendingModelSwitch: boolean;
    hasContinuationTurn: boolean;
    hasAbortHandler: boolean;
    activeToolExecutions: number;
}): boolean;
export declare function buildTelegramModelSwitchContinuationText<TModel extends MenuModel>(telegramPrefix: string, model: TModel, thinkingLevel?: ScopedTelegramModel<TModel>["thinkingLevel"]): string;
export type TelegramModelSwitchContinuationSource = Pick<PendingTelegramTurn, "chatId" | "replyToMessageId" | "target">;
export declare function buildTelegramModelSwitchContinuationTurn<TModel extends MenuModel>(options: {
    turn: TelegramModelSwitchContinuationSource;
    selection: ScopedTelegramModel<TModel>;
    telegramPrefix?: string;
    queueOrder: number;
    laneOrder: number;
}): PendingTelegramTurn;
export declare function createTelegramModelSwitchContinuationTurnBuilder<TModel extends MenuModel>(deps: {
    telegramPrefix?: string;
    allocateItemOrder: () => number;
    allocateControlOrder: () => number;
}): (options: {
    turn: TelegramModelSwitchContinuationSource;
    selection: ScopedTelegramModel<TModel>;
}) => PendingTelegramTurn;
export declare function createTelegramModelSwitchContinuationQueue<TContext, TSelection extends ScopedTelegramModel>(deps: {
    createContinuationTurn: (options: {
        turn: TelegramModelSwitchContinuationSource;
        selection: TSelection;
    }) => PendingTelegramTurn;
    appendQueuedItem: (item: PendingTelegramTurn, ctx: TContext) => void;
}): (turn: TelegramModelSwitchContinuationSource, selection: TSelection, ctx: TContext) => void;
export declare function createTelegramModelSwitchContinuationQueueRuntime<TContext, TSelection extends ScopedTelegramModel>(deps: {
    telegramPrefix?: string;
    allocateItemOrder: () => number;
    allocateControlOrder: () => number;
    appendQueuedItem: (item: PendingTelegramTurn, ctx: TContext) => void;
}): (turn: TelegramModelSwitchContinuationSource, selection: TSelection, ctx: TContext) => void;
export interface TelegramModelSwitchControllerDeps<TContext, TSelection> {
    isIdle: (ctx: TContext) => boolean;
    getActiveTurn: () => PendingTelegramTurn | undefined;
    getAbortHandler: () => (() => void) | undefined;
    hasAbortHandler: () => boolean;
    getActiveToolExecutions: () => number;
    queueContinuation: (turn: TelegramModelSwitchContinuationSource, selection: TSelection, ctx: TContext) => void;
    updateStatus: (ctx: TContext) => void;
}
export interface TelegramModelSwitchController<TContext, TSelection> {
    canOfferInFlightSwitch: (ctx: TContext) => boolean;
    /** A staged switch waits for its abort; queue dispatch and live-work observation treat it as pending control. */
    hasPendingSwitch: () => boolean;
    stagePendingSwitch: (selection: TSelection, ctx: TContext, continuationTurn?: TelegramModelSwitchContinuationSource) => void;
    clearPendingSwitch: () => void;
    queueContinuation: (turn: TelegramModelSwitchContinuationSource, selection: TSelection, ctx: TContext) => void;
    triggerPendingAbort: (ctx: TContext) => boolean;
    restartInterruptedTurn: (selection: TSelection, ctx: TContext, continuationTurn?: TelegramModelSwitchContinuationSource) => boolean;
}
export interface TelegramModelSwitchControllerRuntimeDeps<TContext, TSelection extends ScopedTelegramModel> extends Omit<TelegramModelSwitchControllerDeps<TContext, TSelection>, "queueContinuation"> {
    telegramPrefix?: string;
    allocateItemOrder: () => number;
    allocateControlOrder: () => number;
    appendQueuedItem: (item: PendingTelegramTurn, ctx: TContext) => void;
}
export declare function createTelegramModelSwitchControllerRuntime<TContext, TSelection extends ScopedTelegramModel>(deps: TelegramModelSwitchControllerRuntimeDeps<TContext, TSelection>): TelegramModelSwitchController<TContext, TSelection>;
/** The whole model-switch state; only `transitionTelegramModelSwitch` produces a new one. */
export interface TelegramModelSwitchMachineState<TSelection> {
    /** One staged switch: the selection and the turn its continuation answers move and clear together. */
    readonly pending: {
        readonly selection: TSelection;
        /** The active Telegram turn at staging, or the model menu's own target for a local run. */
        readonly turn?: TelegramModelSwitchContinuationSource;
    } | null;
}
/** Facts owned by other domains, sampled by the shell when the event is dispatched. */
interface TelegramModelSwitchRunFacts {
    activeTurn?: TelegramModelSwitchContinuationSource;
    hasAbortHandler: boolean;
    activeToolExecutions: number;
}
export type TelegramModelSwitchEvent<TSelection> = {
    type: "staged";
    selection: TSelection;
    turn?: TelegramModelSwitchContinuationSource;
} | ({
    type: "abortRequested";
} & TelegramModelSwitchRunFacts) | {
    type: "restartRequested";
    selection: TSelection;
    turn?: TelegramModelSwitchContinuationSource;
    hasAbortHandler: boolean;
} | {
    type: "cleared";
};
export type TelegramModelSwitchEffect<TSelection> = {
    type: "queueContinuation";
    turn: TelegramModelSwitchContinuationSource;
    selection: TSelection;
} | {
    type: "abort";
};
export interface TelegramModelSwitchStep<TSelection> extends Machine.TelegramMachineStep<TelegramModelSwitchMachineState<TSelection>, TelegramModelSwitchEffect<TSelection>> {
    /** `abortRequested` / `restartRequested`: the run was stopped for a continuation. */
    result: boolean;
}
export declare function createTelegramModelSwitchMachineState<TSelection>(): TelegramModelSwitchMachineState<TSelection>;
/**
 * Pure model-switch transition. A staged switch fires only once no tool runs and an abort handler exists; any restart
 * or clear consumes the staged switch too, so a stale selection can never abort the continuation run it started.
 */
export declare function transitionTelegramModelSwitch<TSelection>(state: TelegramModelSwitchMachineState<TSelection>, event: TelegramModelSwitchEvent<TSelection>): TelegramModelSwitchStep<TSelection>;
/**
 * The shell around `transitionTelegramModelSwitch`: it samples the active turn, abort handler and tool count into
 * events, and runs the continuation and abort effects with the caller's context and the handler it sampled.
 */
export declare function createTelegramModelSwitchController<TContext, TSelection>(deps: TelegramModelSwitchControllerDeps<TContext, TSelection>): TelegramModelSwitchController<TContext, TSelection>;
export {};
