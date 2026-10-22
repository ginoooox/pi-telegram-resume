/**
 * Telegram text-group coalescing helpers
 * Zones: telegram inbound, queue admission, split-message recovery
 * Owns conservative delayed grouping for Telegram text messages that look like automatic long-message splits
 */
import { setTimeout as waitForTimeout } from "node:timers/promises";
import { createTelegramPendingGroups, extractTelegramMessageText, } from "./media.js";
const TELEGRAM_TEXT_GROUP_DEBOUNCE_MS = 1000;
const TELEGRAM_TEXT_GROUP_MIN_SPLIT_LENGTH = 3600;
const TELEGRAM_TEXT_GROUP_MAX_MESSAGE_ID_GAP = 12;
function extractTelegramTextGroupText(message) {
    return extractTelegramMessageText(message);
}
function isTelegramForwardedMessage(message) {
    return (message.forward_origin !== undefined ||
        message.forward_from !== undefined ||
        typeof message.forward_sender_name === "string");
}
function isTelegramTextGroupCommand(text) {
    return text.trimStart().startsWith("/");
}
function isTelegramTextGroupClearingCommand(text) {
    const command = text.trimStart().split(/\s+/, 1)[0]?.split("@", 1)[0];
    return command === "/stop";
}
function getTelegramTextGroupMessageIdentity(message) {
    const threadKey = typeof message.message_thread_id === "number"
        ? `thread:${message.message_thread_id}`
        : "private";
    return `${message.chat.id}:${threadKey}:${message.message_id}`;
}
function getTelegramTextGroupKey(message) {
    if (message.media_group_id)
        return undefined;
    if (!message.from || message.from.is_bot)
        return undefined;
    if (!extractTelegramTextGroupText(message) &&
        !isTelegramForwardedMessage(message)) {
        return undefined;
    }
    const threadKey = typeof message.message_thread_id === "number"
        ? `thread:${message.message_thread_id}`
        : "private";
    return `${message.chat.id}:${threadKey}:${message.from.id}`;
}
function canStartTelegramTextGroup(message, minSplitLength) {
    const text = extractTelegramTextGroupText(message);
    return text.length >= minSplitLength && !isTelegramTextGroupCommand(text);
}
function canAppendTelegramTextGroupMessage(group, message) {
    const text = extractTelegramTextGroupText(message);
    const previous = group.messages.at(-1);
    return (!!previous &&
        message.message_id > previous.message_id &&
        message.message_id <=
            previous.message_id + TELEGRAM_TEXT_GROUP_MAX_MESSAGE_ID_GAP &&
        (text.length > 0 || isTelegramForwardedMessage(message)) &&
        !isTelegramTextGroupCommand(text));
}
export function createTelegramTextGroupController(options = {}) {
    const plannedForwardCommentStarts = new Set();
    const plannedForwardCommentEnds = new Set();
    const debounceMs = options.debounceMs ?? TELEGRAM_TEXT_GROUP_DEBOUNCE_MS;
    const minSplitLength = options.minSplitLength ?? TELEGRAM_TEXT_GROUP_MIN_SPLIT_LENGTH;
    const forwardCommentWaitMs = options.forwardCommentWaitMs === undefined
        ? debounceMs
        : options.forwardCommentWaitMs;
    const setTimer = options.setTimer ??
        ((callback, ms) => {
            const controller = new AbortController();
            void waitForTimeout(ms, undefined, {
                signal: controller.signal,
            }).then(callback, () => undefined);
            return controller;
        });
    const clearTimer = options.clearTimer ??
        (options.setTimer
            ? clearTimeout
            : (timer) => {
                timer.abort();
            });
    const groups = createTelegramPendingGroups({ debounceMs, requireContext: true, setTimer, clearTimer });
    /** Admission policy for one message; the shared group machine owns timers, batches and dispatch. */
    const queueTextGroupMessage = (options) => {
        const existing = groups.get(options.key);
        const dispatchMessages = (messages, ctx) => options.dispatchMessages(messages, ctx);
        const queued = {
            key: options.key,
            message: options.message,
            context: options.context,
            ...(options.forwardPairCandidate === undefined
                ? {}
                : { meta: options.forwardPairCandidate }),
            dispatchMessages,
        };
        if (existing?.messages.some((message) => message.message_id === options.message.message_id)) {
            groups.queue({ ...queued, delayMs: debounceMs, rearm: "ifIdle" });
            return true;
        }
        if (!existing &&
            !options.forceStart &&
            !canStartTelegramTextGroup(options.message, minSplitLength))
            return false;
        if (existing &&
            !canAppendTelegramTextGroupMessage(existing, options.message))
            return false;
        groups.queue({
            ...queued,
            delayMs: options.dispatchImmediately
                ? 0
                : (options.delayMs ?? debounceMs),
            rearm: "always",
        });
        return true;
    };
    return {
        prepareUpdateBatch(updates) {
            for (let index = 0; index + 1 < updates.length; index += 1) {
                const comment = updates[index]?.message;
                const forwarded = updates[index + 1]?.message;
                if (!comment || !forwarded)
                    continue;
                const commentText = extractTelegramTextGroupText(comment);
                const commentKey = getTelegramTextGroupKey(comment);
                const forwardedKey = getTelegramTextGroupKey(forwarded);
                if (!commentKey ||
                    commentKey !== forwardedKey ||
                    !commentText ||
                    isTelegramTextGroupCommand(commentText) ||
                    isTelegramForwardedMessage(comment) ||
                    !isTelegramForwardedMessage(forwarded) ||
                    forwarded.message_id <= comment.message_id ||
                    forwarded.message_id >
                        comment.message_id + TELEGRAM_TEXT_GROUP_MAX_MESSAGE_ID_GAP) {
                    continue;
                }
                plannedForwardCommentStarts.add(getTelegramTextGroupMessageIdentity(comment));
                plannedForwardCommentEnds.add(getTelegramTextGroupMessageIdentity(forwarded));
            }
        },
        getPreparedForwardingPosition(message) {
            const identity = getTelegramTextGroupMessageIdentity(message);
            if (plannedForwardCommentStarts.has(identity))
                return "comment";
            if (plannedForwardCommentEnds.has(identity))
                return "forward";
            return undefined;
        },
        prepareForwardedMessage(message, position) {
            const identity = getTelegramTextGroupMessageIdentity(message);
            if (position === "comment")
                plannedForwardCommentStarts.add(identity);
            else
                plannedForwardCommentEnds.add(identity);
        },
        queueMessage: ({ message, context, dispatchMessages }) => {
            const identity = getTelegramTextGroupMessageIdentity(message);
            const key = getTelegramTextGroupKey(message);
            const plannedStart = plannedForwardCommentStarts.delete(identity);
            const forwarded = isTelegramForwardedMessage(message);
            const existing = key ? groups.get(key) : undefined;
            const text = extractTelegramTextGroupText(message);
            if (existing && isTelegramTextGroupClearingCommand(text))
                groups.clearKey(key);
            const candidatePosition = forwarded
                ? "forward"
                : "comment";
            const existingCandidate = existing?.meta;
            const pairCompleted = existingCandidate !== undefined &&
                existingCandidate !== candidatePosition;
            const separateFromCandidate = existingCandidate === candidatePosition &&
                !isTelegramTextGroupCommand(text);
            if (separateFromCandidate && existing)
                groups.closeBatch(key);
            const forceStart = plannedStart ||
                (forwardCommentWaitMs !== false &&
                    !!key &&
                    (forwarded ||
                        (typeof message.text === "string" &&
                            !isTelegramTextGroupCommand(extractTelegramTextGroupText(message)))));
            const dispatchImmediately = pairCompleted ||
                separateFromCandidate ||
                plannedForwardCommentEnds.delete(identity) ||
                (forwarded && !!key && groups.get(key) !== undefined);
            if (!key)
                return false;
            return queueTextGroupMessage({
                key,
                message,
                context,
                dispatchMessages,
                forceStart,
                dispatchImmediately,
                forwardPairCandidate: forceStart && !canStartTelegramTextGroup(message, minSplitLength)
                    ? candidatePosition
                    : undefined,
                delayMs: forceStart && !canStartTelegramTextGroup(message, minSplitLength)
                    ? forwardCommentWaitMs === false
                        ? undefined
                        : forwardCommentWaitMs
                    : undefined,
            });
        },
        flushMessage: groups.flushMessage,
        suspend: groups.suspend,
        resume: groups.resume,
        clear: () => {
            groups.clear();
            plannedForwardCommentStarts.clear();
            plannedForwardCommentEnds.clear();
        },
    };
}
export function createTelegramTextGroupDispatchRuntime(deps) {
    return {
        handleMessage: async (message, ctx) => {
            const queuedTextGroup = deps.textGroups.queueMessage({
                message,
                context: ctx,
                dispatchMessages: (messages, queuedCtx) => deps.dispatchMessages(messages, queuedCtx),
            });
            if (queuedTextGroup) {
                deps.onDeferredMessage?.(message);
                return;
            }
            await deps.dispatchSingleMessage(message, ctx);
        },
    };
}
export function createTelegramGroupedInputClearer(deps) {
    return () => {
        deps.clearMediaGroups();
        deps.clearTextGroups();
    };
}
