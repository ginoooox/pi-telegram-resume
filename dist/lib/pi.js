/**
 * pi SDK adapter boundary
 * Zones: pi agent sdk boundary, shared adapters
 * Owns direct pi SDK imports and exposes narrow bridge-facing helpers/types for the extension composition layer
 */
import { createReadStream, existsSync, lstatSync, realpathSync, mkdirSync, renameSync, writeFileSync, rmdirSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SettingsManager, } from "@earendil-works/pi-coding-agent";
export function setExtensionSessionName(api, name) {
    api.setSessionName(name);
}
const PI_SESSION_INDEX = ".telegram-session-index.json";
const PI_SESSION_METADATA_LIMIT = 64 * 1024;
const PI_SESSION_INDEX_LIMIT = 2 * 1024 * 1024;
function sessionFileIdentity(info) {
    return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
}
function sessionFileStamp(info) {
    return `${sessionFileIdentity(info)}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}
/** Headers are fresh even on an index hit; cached labels never grant file authority. */
async function readSessionHeader(path, info) {
    const file = await open(path, "r");
    try {
        if (sessionFileIdentity(await file.stat()) !== sessionFileIdentity(info))
            return undefined;
        const buffer = Buffer.alloc(Math.min(PI_SESSION_METADATA_LIMIT, info.size));
        let length = 0;
        let consumed = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, Math.min(4096, buffer.length - length), length);
            if (!bytesRead)
                break;
            length += bytesRead;
            let newline;
            while ((newline = buffer.indexOf(10, consumed)) >= consumed && newline < length) {
                const line = buffer.subarray(consumed, newline).toString("utf8");
                consumed = newline + 1;
                let entry;
                try {
                    entry = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!entry || typeof entry !== "object")
                    continue;
                return entry.type === "session" && typeof entry.id === "string" && typeof entry.cwd === "string"
                    ? { id: entry.id, cwd: entry.cwd } : undefined;
            }
        }
        if (length < PI_SESSION_METADATA_LIMIT) {
            try {
                const entry = JSON.parse(buffer.subarray(consumed, length).toString("utf8"));
                if (entry?.type === "session" && typeof entry.id === "string" && typeof entry.cwd === "string")
                    return { id: entry.id, cwd: entry.cwd };
            }
            catch { /* An incomplete or corrupt header is not a session. */ }
        }
        return undefined;
    }
    finally {
        await file.close();
    }
}
async function listPiSessionFiles(ctx) {
    const dir = ctx.sessionManager.getSessionDir();
    let files;
    try {
        files = await readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
    const result = [];
    for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))) {
        const path = join(dir, file.name);
        try {
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink())
                continue;
            const header = await readSessionHeader(path, info);
            if (header && resolve(header.cwd) === resolve(ctx.cwd))
                result.push({ path, info, header });
        }
        catch { /* A concurrently removed/unreadable file cannot prevent browsing. */ }
    }
    return result;
}
function isSessionIndexEntry(value) {
    if (!value || typeof value !== "object")
        return false;
    const entry = value;
    return typeof entry.file === "string" && basename(entry.file) === entry.file && entry.file.endsWith(".jsonl") &&
        typeof entry.id === "string" && typeof entry.cwd === "string" &&
        (entry.name === undefined || typeof entry.name === "string" && entry.name.length <= 4096) &&
        typeof entry.stamp === "string" && entry.stamp.length < 256 &&
        typeof entry.identity === "string" && entry.identity.length < 128 &&
        Number.isSafeInteger(entry.size) && entry.size >= 0 &&
        typeof entry.tail === "string" && /^[a-f0-9]{64}$/u.test(entry.tail) && typeof entry.complete === "boolean";
}
async function readSessionIndex(path) {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > PI_SESSION_INDEX_LIMIT)
            return { entries: new Map() };
        const text = await readFile(path, "utf8");
        const index = JSON.parse(text);
        if (index.version !== 1 || !Array.isArray(index.entries) || index.entries.length > 2048 ||
            !index.entries.every(isSessionIndexEntry))
            return { entries: new Map() };
        return { text, entries: new Map(index.entries.map((entry) => [entry.file, entry])) };
    }
    catch {
        return { entries: new Map() };
    }
}
async function readSessionTail(path, end) {
    const file = await open(path, "r");
    try {
        const buffer = Buffer.alloc(Math.min(128, end));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, end - buffer.length);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        await file.close();
    }
}
/** Bound retained lines and parse metadata only, never message/tool payloads. */
async function readSessionName(path, start, end, name) {
    if (start >= end)
        return name;
    const stream = createReadStream(path, { start, end: end - 1, highWaterMark: PI_SESSION_METADATA_LIMIT });
    let parts = [];
    let length = 0;
    let oversized = false;
    const append = (part) => {
        length += part.length;
        if (length > PI_SESSION_METADATA_LIMIT) {
            oversized = true;
            parts = [];
        }
        else if (!oversized)
            parts.push(part);
    };
    const finish = () => {
        if (!oversized && length) {
            const line = Buffer.concat(parts, length).toString("utf8");
            if (/"type"\s*:\s*"session_info"/u.test(line)) {
                try {
                    const entry = JSON.parse(line);
                    if (entry?.type === "session_info")
                        name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
                }
                catch { /* Partial/corrupt metadata does not replace a known name. */ }
            }
        }
        parts = [];
        length = 0;
        oversized = false;
    };
    try {
        for await (const chunk of stream) {
            const buffer = chunk;
            let start = 0;
            let newline;
            while ((newline = buffer.indexOf(10, start)) !== -1) {
                append(buffer.subarray(start, newline));
                finish();
                start = newline + 1;
            }
            append(buffer.subarray(start));
        }
        finish();
        return name;
    }
    finally {
        stream.destroy();
    }
}
async function writeSessionIndex(path, entries, previous) {
    const text = JSON.stringify({ version: 1, entries: entries.filter(isSessionIndexEntry).slice(0, 2048) }) + "\n";
    if (text === previous || Buffer.byteLength(text) > PI_SESSION_INDEX_LIMIT)
        return;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        try {
            if ((await lstat(path)).isSymbolicLink())
                return;
        }
        catch { /* Missing cache is normal. */ }
        await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    }
    catch { /* Derived metadata is optional, including on a read-only directory. */ }
    finally {
        try {
            await unlink(temporary);
        }
        catch { /* No published temporary file remains. */ }
    }
}
/** Both /resume and /delete use the same disposable, transcript-free summary index. */
export async function listPiSessions(ctx) {
    const files = await listPiSessionFiles(ctx);
    const indexPath = join(ctx.sessionManager.getSessionDir(), PI_SESSION_INDEX);
    const index = await readSessionIndex(indexPath);
    const next = [];
    const sessions = [];
    for (const { path, header, info } of files) {
        try {
            const cached = index.entries.get(basename(path));
            const sameHeader = cached?.id === header.id && cached.cwd === header.cwd;
            let name;
            let entry;
            if (sameHeader && cached.stamp === sessionFileStamp(info)) {
                name = cached.name;
                entry = cached;
            }
            else {
                let start = 0;
                // Pi appends entries. Verify the old complete boundary before reading only its new suffix.
                if (sameHeader && cached.identity === sessionFileIdentity(info) && cached.complete && info.size > cached.size &&
                    createHash("sha256").update(await readSessionTail(path, cached.size)).digest("hex") === cached.tail) {
                    start = cached.size;
                    name = cached.name;
                }
                name = await readSessionName(path, start, info.size, name);
                const tail = await readSessionTail(path, info.size);
                entry = { ...header, file: basename(path), ...(name ? { name } : {}), stamp: sessionFileStamp(info),
                    identity: sessionFileIdentity(info), size: info.size, tail: createHash("sha256").update(tail).digest("hex"), complete: tail.at(-1) === 10 };
            }
            const current = await lstat(path);
            if (!current.isFile() || current.isSymbolicLink())
                continue;
            if (sessionFileStamp(current) !== sessionFileStamp(info)) {
                // A live Pi may append while a cold index is built. Keep its completed prefix for the next suffix read.
                if (sessionFileIdentity(current) === sessionFileIdentity(info) && current.size > info.size && entry.complete)
                    next.push(entry);
                continue;
            }
            next.push(entry);
            sessions.push({ ...header, cwd: ctx.cwd, path, modified: info.mtime, ...(name ? { name } : {}) });
        }
        catch { /* Changed/unreadable metadata is retried from disk on the next listing. */ }
    }
    next.sort((a, b) => a.file.localeCompare(b.file));
    if (files.length)
        await writeSessionIndex(indexPath, next, index.text);
    return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
/** Move one unchanged historical session to a private, non-enumerated recycle folder. */
export async function trashPiSession(ctx, id, expectedModified, assertCurrent, listActiveSessions = () => []) {
    const assertHistorical = () => {
        assertCurrent();
        if (listActiveSessions().some(session => session.sessionId === id))
            throw new Error("Session is active in a registered Pi instance.");
    };
    assertHistorical();
    if (id === ctx.sessionManager.getSessionId())
        throw new Error("The current session is protected.");
    const matches = (await listPiSessionFiles(ctx)).filter(session => session.header.id === id);
    assertHistorical();
    if (matches.length !== 1)
        throw new Error("Session identity is missing or ambiguous.");
    const selected = matches[0];
    const session = { ...selected.header, path: selected.path, modified: selected.info.mtime };
    const root = realpathSync(ctx.sessionManager.getSessionDir());
    if (dirname(session.path) !== resolve(ctx.sessionManager.getSessionDir()) ||
        dirname(realpathSync(session.path)) !== root || !session.path.endsWith(".jsonl"))
        throw new Error("Session is outside the current session directory.");
    const file = lstatSync(session.path);
    if (!file.isFile() || file.isSymbolicLink() || sessionFileStamp(file) !== sessionFileStamp(selected.info) || file.mtime.getTime() !== expectedModified ||
        session.modified.getTime() !== expectedModified)
        throw new Error("Session changed; select it again.");
    const currentPath = ctx.sessionManager.getSessionFile();
    if (id === ctx.sessionManager.getSessionId() ||
        (currentPath && (resolve(currentPath) === resolve(session.path) ||
            (existsSync(currentPath) && realpathSync(currentPath) === realpathSync(session.path)))))
        throw new Error("The current session is protected.");
    const recycleRoot = join(root, ".trash");
    try {
        mkdirSync(recycleRoot, { mode: 0o700 });
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    const recycleInfo = lstatSync(recycleRoot);
    if (!recycleInfo.isDirectory() || recycleInfo.isSymbolicLink())
        throw new Error("Invalid recycle directory.");
    const recycle = join(recycleRoot, randomUUID());
    mkdirSync(recycle, { mode: 0o700 });
    const metadata = join(recycle, "restore.json");
    let moved = false;
    try {
        writeFileSync(metadata, JSON.stringify({ version: 1, id, cwd: ctx.cwd,
            originalName: basename(session.path), deletedAt: new Date().toISOString() }) + "\n", { mode: 0o600, flag: "wx" });
        assertHistorical();
        // No await separates the final context/file check from the move.
        if (id === ctx.sessionManager.getSessionId() || sessionFileStamp(lstatSync(session.path)) !== sessionFileStamp(file))
            throw new Error("Session changed before deletion.");
        renameSync(session.path, join(recycle, basename(session.path)));
        moved = true;
    }
    finally {
        if (!moved) {
            try {
                unlinkSync(metadata);
            }
            catch { /* Keep the original disposition error. */ }
            try {
                rmdirSync(recycle);
            }
            catch { /* Do not recursively remove unknown contents. */ }
        }
    }
}
function isPiRunMode(value) {
    return (value === "tui" || value === "rpc" || value === "json" || value === "print");
}
/** Pi rejects a context captured before session replacement with a stale-context error; this is not a domain failure. */
export function isPiStaleContextError(error) {
    return (error instanceof Error &&
        (error.message.includes("stale after session") ||
            error.message.includes("stale ctx")));
}
export function getExtensionContextMode(ctx) {
    const mode = typeof ctx === "object" && ctx !== null
        ? ctx.mode
        : undefined;
    return isPiRunMode(mode) ? mode : undefined;
}
export function isExtensionContextPassiveRunMode(ctx) {
    const mode = getExtensionContextMode(ctx);
    return mode === "print" || mode === "json";
}
export function canStartPollingInExtensionContext(ctx) {
    return !isExtensionContextPassiveRunMode(ctx);
}
export function formatPollingStartBlockedByRunMode(ctx) {
    const mode = getExtensionContextMode(ctx);
    return mode
        ? `Telegram polling is unavailable in Pi ${mode} mode. Use /telegram-connect from a long-lived Pi session.`
        : "Telegram polling is unavailable in this Pi run mode.";
}
export function getSessionCompactionReason(event) {
    const reason = event && typeof event === "object" && "reason" in event
        ? event.reason
        : undefined;
    return reason === "manual" || reason === "threshold" || reason === "overflow"
        ? reason
        : "unknown";
}
export function createExtensionApiRuntimePorts(api) {
    return {
        sendUserMessage: (content, options) => api.sendUserMessage(content, options),
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
function readEnabledModels(value) {
    if (value === undefined)
        return undefined;
    if (Array.isArray(value) &&
        value.every((entry) => typeof entry === "string")) {
        return [...value];
    }
    throw new TypeError("Host settings enabledModels must be a string array or undefined.");
}
export function normalizeSettingsManager(manager) {
    if (typeof manager !== "object" || manager === null) {
        throw new TypeError("Host settings manager must be an object.");
    }
    const host = manager;
    if (typeof host.flush !== "function") {
        throw new TypeError("Host settings manager must provide flush().");
    }
    const read = typeof host.getEnabledModels === "function"
        ? () => host.getEnabledModels.call(host)
        : typeof host.get === "function"
            ? () => host.get.call(host, "enabledModels")
            : undefined;
    const write = typeof host.setEnabledModels === "function"
        ? (patterns) => host.setEnabledModels.call(host, patterns)
        : typeof host.set === "function"
            ? (patterns) => host.set.call(host, "enabledModels", patterns ?? [])
            : undefined;
    if (!read || !write) {
        throw new TypeError("Host settings manager must provide enabled-model read and write capabilities.");
    }
    return {
        reload: async () => {
            await host.reload?.call(host);
        },
        flush: async () => {
            await host.flush.call(host);
        },
        getEnabledModels: () => readEnabledModels(read()),
        setEnabledModels: write,
    };
}
export async function createSettingsManager(cwd) {
    // Pi returns its legacy settings surface synchronously. Compatible hosts may
    // resolve a generic settings service asynchronously; normalize both once at
    // the SDK boundary instead of leaking host distinctions into menu domains.
    const factory = SettingsManager;
    return normalizeSettingsManager(await factory.create(cwd));
}
export function createScopedModelPatternPersister(deps) {
    return async (patterns, ctx) => {
        const settingsManager = await deps.createSettingsManager(ctx.cwd);
        settingsManager.setEnabledModels(patterns.length > 0 ? patterns : undefined);
        await settingsManager.flush();
        deps.clearCachedModelMenuInputs();
    };
}
export function getExtensionContextModel(ctx) {
    return ctx.model;
}
export function getExtensionContextCwd(ctx) {
    return ctx.cwd;
}
export function getExtensionContextSessionId(ctx) {
    // Minimal hosts and stale contexts may omit a session manager; absence is not an invented ID.
    return ctx?.sessionManager?.getSessionId?.();
}
export function isExtensionContextIdle(ctx) {
    return ctx.isIdle();
}
export function isExtensionContextAbortRequested(ctx) {
    return ctx.signal?.aborted === true;
}
export function hasExtensionContextPendingMessages(ctx) {
    return ctx.hasPendingMessages();
}
export function compactExtensionContext(ctx, callbacks) {
    return ctx.compact(callbacks);
}
