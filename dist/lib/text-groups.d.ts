/**
 * Telegram text-group coalescing helpers
 * Zones: telegram inbound, queue admission, split-message recovery
 * Owns conservative delayed grouping for Telegram text messages that look like automatic long-message splits
 */
import { type TelegramMessageForwardOrigin, type TelegramMessageUser, type TelegramRichMessage } from "./media.ts";
export interface TelegramTextGroupMessage {
    message_id: number;
    media_group_id?: string;
    chat: {
        id: number;
    };
    message_thread_id?: number;
    from?: {
        id?: number;
        is_bot?: boolean;
    };
    text?: string;
    caption?: string;
    rich_message?: TelegramRichMessage;
    forward_origin?: TelegramMessageForwardOrigin;
    forward_from?: TelegramMessageUser;
    forward_sender_name?: string;
}
export type TelegramForwardCommentBatchPosition = "comment" | "forward";
export interface TelegramTextGroupController<TMessage, TContext = unknown> {
    prepareUpdateBatch: (updates: readonly {
        message?: TMessage;
    }[]) => void;
    getPreparedForwardingPosition: (message: TelegramTextGroupMessage) => TelegramForwardCommentBatchPosition | undefined;
    prepareForwardedMessage: (message: TelegramTextGroupMessage, position: TelegramForwardCommentBatchPosition) => void;
    queueMessage: (options: {
        message: TMessage;
        context: TContext;
        dispatchMessages: (messages: TMessage[], ctx: TContext) => unknown | Promise<unknown>;
    }) => boolean;
    flushMessage: (messageId: number) => Promise<boolean>;
    suspend: () => void;
    resume: (context: TContext) => void;
    clear: () => void;
}
export interface TelegramTextGroupControllerOptions {
    debounceMs?: number;
    forwardCommentWaitMs?: number | false;
    minSplitLength?: number;
    setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}
export interface TelegramTextGroupDispatchRuntime<TMessage extends TelegramTextGroupMessage, TContext> {
    handleMessage: (message: TMessage, ctx: TContext) => Promise<void>;
}
export interface TelegramGroupedInputClearerDeps {
    clearMediaGroups: () => void;
    clearTextGroups: () => void;
}
export declare function createTelegramTextGroupController<TMessage extends TelegramTextGroupMessage, TContext = unknown>(options?: TelegramTextGroupControllerOptions): TelegramTextGroupController<TMessage, TContext>;
export declare function createTelegramTextGroupDispatchRuntime<TMessage extends TelegramTextGroupMessage, TContext>(deps: {
    textGroups: TelegramTextGroupController<TMessage, TContext>;
    dispatchMessages: (messages: TMessage[], ctx: TContext) => Promise<void>;
    dispatchSingleMessage: (message: TMessage, ctx: TContext) => Promise<void>;
    onDeferredMessage?: (message: TMessage) => void;
}): TelegramTextGroupDispatchRuntime<TMessage, TContext>;
export declare function createTelegramGroupedInputClearer(deps: TelegramGroupedInputClearerDeps): () => void;
