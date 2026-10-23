/**
 * Regression tests for the pi SDK adapter boundary
 * Covers narrow bridge-facing helpers over concrete pi context contracts
 * Zones: pi agent sdk boundary, shared adapters
 */

import assert from "node:assert/strict";
import test, { mock } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdirSync, renameSync, utimesSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canStartPollingInExtensionContext,
  compactExtensionContext,
  createExtensionApiRuntimePorts,
  createScopedModelPatternPersister,
  type ExtensionContext,
  getExtensionContextCwd,
  getExtensionContextSessionId,
  formatPollingStartBlockedByRunMode,
  getExtensionContextMode,
  getExtensionContextModel,
  hasExtensionContextPendingMessages,
  isExtensionContextIdle,
  isExtensionContextAbortRequested,
  isExtensionContextPassiveRunMode,
  normalizeSettingsManager,
  listPiSessions,
  trashPiSession,
} from "../lib/pi.ts";

type PiRuntimeApiHarness = Parameters<
  typeof createExtensionApiRuntimePorts
>[0] & {
  events: string[];
};

type PiRuntimeModel = Parameters<PiRuntimeApiHarness["setModel"]>[0];

function createHarnessModel(id: string): PiRuntimeModel {
  return { id } as PiRuntimeModel;
}

function getHarnessModelId(model: PiRuntimeModel): string {
  return String(Reflect.get(Object(model), "id"));
}

test("Pi context mode helpers feature-detect passive run modes", () => {
  assert.equal(getExtensionContextMode({ mode: "print" }), "print");
  assert.equal(getExtensionContextMode({ mode: "bogus" }), undefined);
  assert.equal(isExtensionContextPassiveRunMode({ mode: "print" }), true);
  assert.equal(isExtensionContextPassiveRunMode({ mode: "json" }), true);
  assert.equal(isExtensionContextPassiveRunMode({ mode: "rpc" }), false);
  assert.equal(isExtensionContextPassiveRunMode({}), false);
  assert.equal(canStartPollingInExtensionContext({ mode: "tui" }), true);
  assert.equal(canStartPollingInExtensionContext({ mode: "rpc" }), true);
  assert.equal(canStartPollingInExtensionContext({ mode: "json" }), false);
  assert.equal(canStartPollingInExtensionContext({ mode: "print" }), false);
  assert.equal(canStartPollingInExtensionContext({}), true);
  assert.equal(
    formatPollingStartBlockedByRunMode({ mode: "json" }),
    "Telegram polling is unavailable in Pi json mode. Use /telegram-connect from a long-lived Pi session.",
  );
});

test("Pi abort adapter reads the current public signal without inventing one", () => {
  const abort = new AbortController();
  const ctx = { signal: abort.signal } as ExtensionContext;
  assert.equal(isExtensionContextAbortRequested(ctx), false);
  abort.abort();
  assert.equal(isExtensionContextAbortRequested(ctx), true);
  assert.equal(isExtensionContextAbortRequested({} as ExtensionContext), false);
});

test("Pi session identity adapter is lifecycle-alias agnostic", () => {
  assert.equal(getExtensionContextSessionId(undefined), undefined, "Missing context cannot invent a session identity");
  const sessionManager = { getSessionId: () => "stable-session" };
  for (const lifecycleAlias of ["restart", "reload", "resume", "continue-recent"]) {
    const ctx = { sessionManager, lifecycleAlias } as unknown as ExtensionContext;
    assert.equal(getExtensionContextSessionId(ctx), "stable-session");
  }
  const forked = { sessionManager: { getSessionId: () => "forked-session" } } as ExtensionContext;
  assert.notEqual(getExtensionContextSessionId(forked), "stable-session");
});

test("Pi API runtime ports bind methods without losing receiver context", async () => {
  const api: PiRuntimeApiHarness = {
    events: [],
    sendUserMessage(content, options) {
      this.events.push(
        `send:${String(content)}:${options?.deliverAs ?? "default"}`,
      );
    },
    async exec(command, args) {
      this.events.push(`exec:${command}:${args.join(",")}`);
      return { stdout: "ok", stderr: "", code: 0, killed: false };
    },
    getCommands() {
      this.events.push("commands");
      return [];
    },
    getThinkingLevel() {
      this.events.push("get-thinking");
      return "high";
    },
    setThinkingLevel(level) {
      this.events.push(`thinking:${String(level)}`);
    },
    getActiveTools() {
      this.events.push("get-tools");
      return ["read"];
    },
    setActiveTools(names) {
      this.events.push(`set-tools:${names.join(",")}`);
    },
    async setModel(model) {
      this.events.push(`model:${getHarnessModelId(model)}`);
      return true;
    },
    registerCommand(name) {
      this.events.push(`command:${name}`);
    },
  };
  const runtime = createExtensionApiRuntimePorts(api);
  runtime.sendUserMessage("hello", { deliverAs: "followUp" });
  assert.deepEqual(await runtime.exec("cmd", ["arg"]), {
    stdout: "ok",
    stderr: "",
    code: 0,
    killed: false,
  });
  assert.deepEqual(runtime.getCommands(), []);
  assert.equal(runtime.getThinkingLevel(), "high");
  runtime.setThinkingLevel("low");
  assert.deepEqual(runtime.getActiveTools(), ["read"]);
  runtime.setActiveTools(["read", "telegram_attach"]);
  assert.equal(await runtime.setModel(createHarnessModel("gpt-5")), true);
  runtime.registerCommand("telegram-internal", {
    description: "internal",
    handler: async () => {},
  });
  assert.deepEqual(api.events, [
    "send:hello:followUp",
    "exec:cmd:arg",
    "commands",
    "get-thinking",
    "thinking:low",
    "get-tools",
    "set-tools:read,telegram_attach",
    "model:gpt-5",
    "command:telegram-internal",
  ]);
});

test("Pi settings adapter preserves legacy and generic host capabilities", async () => {
  const legacyEvents: string[] = [];
  const legacy = normalizeSettingsManager({
    reload: async () => legacyEvents.push("reload"),
    flush: async () => legacyEvents.push("flush"),
    getEnabledModels: () => ["openai/gpt-5"],
    setEnabledModels: (patterns: string[] | undefined) =>
      legacyEvents.push(`set:${patterns?.join(",") ?? "all"}`),
  });
  await legacy.reload();
  assert.deepEqual(legacy.getEnabledModels(), ["openai/gpt-5"]);
  legacy.setEnabledModels(undefined);
  await legacy.flush();
  assert.deepEqual(legacyEvents, ["reload", "set:all", "flush"]);

  const genericEvents: string[] = [];
  let enabledModels = ["anthropic/claude-sonnet-4"];
  const generic = normalizeSettingsManager({
    get: (key: string) => {
      genericEvents.push(`get:${key}`);
      return enabledModels;
    },
    set: (key: string, value: unknown) => {
      genericEvents.push(`set:${key}:${JSON.stringify(value)}`);
      enabledModels = value as string[];
    },
    flush: async () => genericEvents.push("flush"),
  });
  await generic.reload();
  assert.deepEqual(generic.getEnabledModels(), ["anthropic/claude-sonnet-4"]);
  generic.setEnabledModels(undefined);
  await generic.flush();
  assert.deepEqual(genericEvents, [
    "get:enabledModels",
    "set:enabledModels:[]",
    "flush",
  ]);
});

test("Pi scoped model persister invalidates cached inputs without clearing live menus", async () => {
  const events: string[] = [];
  const persist = createScopedModelPatternPersister({
    createSettingsManager: async (cwd) => ({
      reload: async () => {},
      flush: async () => {
        events.push("flush");
      },
      getEnabledModels: () => undefined,
      setEnabledModels: (patterns) => {
        events.push(`set:${cwd}:${patterns?.join(",") ?? "all"}`);
      },
    }),
    clearCachedModelMenuInputs: () => {
      events.push("clear-cache");
    },
  });
  await persist(["openai/gpt-5"], { cwd: "/tmp/project" } as ExtensionContext);
  assert.deepEqual(events, [
    "set:/tmp/project:openai/gpt-5",
    "flush",
    "clear-cache",
  ]);
});

test("Pi context helpers expose model, idle, pending-message, and compact adapters", () => {
  const model = { provider: "openai", id: "gpt-5", name: "GPT-5" };
  const events: string[] = [];
  const ctx = {
    model,
    isIdle: () => true,
    hasPendingMessages: () => false,
    cwd: "/tmp/project",
    compact: (callbacks: { onComplete: () => void }) => {
      events.push("compact");
      callbacks.onComplete();
    },
  } as unknown as ExtensionContext;
  compactExtensionContext(ctx, {
    onComplete: () => {
      events.push("complete");
    },
    onError: () => {
      events.push("error");
    },
  });
  assert.equal(getExtensionContextModel(ctx), model);
  assert.equal(getExtensionContextCwd(ctx), "/tmp/project");
  assert.equal(isExtensionContextIdle(ctx), true);
  assert.equal(hasExtensionContextPendingMessages(ctx), false);
  assert.deepEqual(events, ["compact", "complete"]);
});

test("/resume scans session metadata without retaining conversation text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-telegram-resume-"));
  try {
    const path = join(dir, "saved.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "session", id: "12345678-1234-1234-1234-123456789abc", cwd: "/repo" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "private transcript" } }),
      JSON.stringify({ type: "session_info", name: "  Latest <name>  " }),
      "",
    ].join("\n"));
    writeFileSync(join(dir, "other.jsonl"), JSON.stringify({ type: "session", id: "other", cwd: "/elsewhere" }));
    const ctx = { cwd: "/repo", sessionManager: { getSessionDir: () => dir } } as ExtensionContext;
    assert.deepEqual((await listPiSessions(ctx)).map(({ id, name, path: found }) => ({ id, name, found })), [
      { id: "12345678-1234-1234-1234-123456789abc", name: "Latest <name>", found: path },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withDeletionFiles(run: (ctx: ExtensionContext, dir: string, old: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-delete-"));
  const old = join(dir, "historical.jsonl");
  const file = (id: string, cwd = "/repo") => JSON.stringify({ type: "session", id, cwd }) + "\n" +
    JSON.stringify({ type: "message", message: { role: "user", content: "preserve conversation bytes" } }) + "\n";
  writeFileSync(old, file("old")); writeFileSync(join(dir, "active.jsonl"), file("current"));
  const ctx = { cwd: "/repo", sessionManager: { getSessionDir: () => dir,
    getSessionId: () => "current", getSessionFile: () => join(dir, "active.jsonl") } } as unknown as ExtensionContext;
  return run(ctx, dir, old).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("historical session deletion preserves bytes and restore metadata outside the resume listing", async () => {
  await withDeletionFiles(async (ctx, dir, old) => {
    const bytes = readFileSync(old); const item = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    let checks = 0; await trashPiSession(ctx, "old", item.modified.getTime(), () => { checks++; });
    assert.ok(checks >= 3); assert.equal(existsSync(old), false);
    assert.deepEqual((await listPiSessions(ctx)).map(s => s.id), ["current"]);
    const recycle = join(dir, ".trash", readdirSync(join(dir, ".trash"))[0]!);
    assert.deepEqual(readFileSync(join(recycle, "historical.jsonl")), bytes);
    const metadata = JSON.parse(readFileSync(join(recycle, "restore.json"), "utf8"));
    assert.deepEqual([metadata.id, metadata.cwd, metadata.originalName], ["old", "/repo", "historical.jsonl"]);
    assert.equal(lstatSync(recycle).mode & 0o777, 0o700);
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime(), () => {}), /missing/);
  });
});

test("historical deletion refuses active, foreign, changed, linked and ambiguous sessions", async () => {
  await withDeletionFiles(async (ctx, dir, old) => {
    const item = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    await assert.rejects(trashPiSession(ctx, "current", 0, () => {}), /current session/);
    await assert.rejects(trashPiSession(ctx, "../old", 0, () => {}), /missing/);
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime() - 100, () => {}), /changed/);
    writeFileSync(join(dir, "foreign.jsonl"), JSON.stringify({ type: "session", id: "foreign", cwd: "/elsewhere" }) + "\n");
    await assert.rejects(trashPiSession(ctx, "foreign", 0, () => {}), /missing/);
    symlinkSync(old, join(dir, "linked.jsonl"));
    assert.equal((await listPiSessions(ctx)).filter(s => s.id === "old").length, 1);
    writeFileSync(join(dir, "duplicate.jsonl"), readFileSync(old));
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime(), () => {}), /ambiguous/);
    assert.ok(existsSync(old)); assert.equal(existsSync(join(dir, ".trash")), false);
  });
});

test("historical deletion refuses a linked recycle root and revoked authority", async () => {
  await withDeletionFiles(async (ctx, dir, old) => {
    const item = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    symlinkSync(dir, join(dir, ".trash"));
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime(), () => {}), /Invalid recycle/);
    rmSync(join(dir, ".trash"));
    let checks = 0;
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime(), () => {
      if (++checks === 3) throw new Error("revoked");
    }), /revoked/);
    assert.ok(existsSync(old));
    assert.deepEqual(readdirSync(join(dir, ".trash")), []);
  });
});


test("historical deletion rechecks registered active session protection at the move boundary", async () => {
  await withDeletionFiles(async (ctx, _dir, old) => {
    const item = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    let checks = 0;
    await assert.rejects(trashPiSession(ctx, "old", item.modified.getTime(), () => {},
      () => ++checks >= 3 ? [{ sessionId: "old" }] : []), /active in a registered/);
    assert.ok(existsSync(old));
  });
});

type SessionBodyRead = { file: string; start: number };
async function withSessionBodyReads(run: (reads: SessionBodyRead[]) => Promise<void>) {
  const reads: SessionBodyRead[] = [];
  const original = fs.createReadStream;
  const replacement = mock.method(fs, "createReadStream", (path: Parameters<typeof fs.createReadStream>[0], options?: Parameters<typeof fs.createReadStream>[1]) => {
    reads.push({ file: String(path), start: typeof options === "object" ? options?.start ?? 0 : 0 });
    return original(path, options);
  });
  syncBuiltinESMExports();
  try { await run(reads); }
  finally { replacement.mock.restore(); syncBuiltinESMExports(); }
}
const sessionIndexPath = (dir: string) => join(dir, ".telegram-session-index.json");
const sessionNameLine = (name: string) => JSON.stringify({ type: "session_info", name }) + "\n";

test("shared summaries cold-scan bounded metadata once, then reuse a private transcript-free disk index", async () => {
  await withDeletionFiles(async (ctx, dir, old) => withSessionBodyReads(async reads => {
    const privateMarker = "PRIVATE_LARGE_TOOL_PAYLOAD";
    writeFileSync(old, JSON.stringify({ type: "session", id: "old", cwd: "/repo" }) + "\n" +
      JSON.stringify({ type: "message", message: { content: privateMarker + "x".repeat(8 * 1024 * 1024) } }) + "\n" +
      sessionNameLine("Previous") + sessionNameLine("Latest 名称"));
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Latest 名称");
    assert.equal(reads.length, 2); assert.ok(reads.every(read => read.start === 0));
    const index = readFileSync(sessionIndexPath(dir), "utf8");
    assert.doesNotMatch(index, /PRIVATE_LARGE_TOOL_PAYLOAD|preserve conversation bytes|"message"/u);
    assert.ok(index.length < 4096); assert.equal(lstatSync(sessionIndexPath(dir)).mode & 0o777, 0o600);
    const indexBefore = lstatSync(sessionIndexPath(dir)).mtimeMs;
    reads.length = 0;
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Latest 名称");
    assert.deepEqual(reads, []);
    assert.equal(lstatSync(sessionIndexPath(dir)).mtimeMs, indexBefore, "unchanged summaries do not rewrite the index");
  }));
});

test("shared summaries read only appended bytes and preserve rename and clear semantics", async () => {
  await withDeletionFiles(async (ctx, _dir, old) => withSessionBodyReads(async reads => {
    await listPiSessions(ctx); reads.length = 0;
    const boundary = lstatSync(old).size;
    appendFileSync(old, sessionNameLine("Appended rename"));
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Appended rename");
    assert.deepEqual(reads, [{ file: old, start: boundary }]);
    reads.length = 0;
    const nextBoundary = lstatSync(old).size;
    appendFileSync(old, sessionNameLine("   "));
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, undefined);
    assert.deepEqual(reads, [{ file: old, start: nextBoundary }]);
  }));
});

test("shared summaries rebuild incomplete boundaries, including a rename split across writes", async () => {
  await withDeletionFiles(async (ctx, _dir, old) => withSessionBodyReads(async reads => {
    writeFileSync(old, JSON.stringify({ type: "session", id: "old", cwd: "/repo" }) + "\n" + sessionNameLine("Before").trimEnd());
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Before");
    appendFileSync(old, '\n{"type":"session_info","name":"Split'); reads.length = 0;
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Before");
    assert.deepEqual(reads, [{ file: old, start: 0 }]);
    appendFileSync(old, ' name"}\n'); reads.length = 0;
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Split name");
    assert.deepEqual(reads, [{ file: old, start: 0 }]);
  }));
});

test("shared summaries invalidate same-size edits with restored mtime, truncation and file replacement", async () => {
  await withDeletionFiles(async (ctx, dir, old) => withSessionBodyReads(async reads => {
    const header = JSON.stringify({ type: "session", id: "old", cwd: "/repo" }) + "\n";
    writeFileSync(old, header + sessionNameLine("Old")); await listPiSessions(ctx);
    const info = lstatSync(old);
    writeFileSync(old, header + sessionNameLine("New")); utimesSync(old, info.atimeMs / 1000, info.mtimeMs / 1000);
    reads.length = 0;
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "New");
    assert.deepEqual(reads, [{ file: old, start: 0 }]);
    writeFileSync(old, header); reads.length = 0;
    assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, undefined);
    assert.deepEqual(reads, [{ file: old, start: 0 }]);
    const replacement = join(dir, "replacement.tmp");
    writeFileSync(replacement, JSON.stringify({ type: "session", id: "replacement", cwd: "/repo" }) + "\n" + sessionNameLine("Different file"));
    renameSync(replacement, old); reads.length = 0;
    const sessions = await listPiSessions(ctx);
    assert.equal(sessions.some(s => s.id === "old"), false);
    assert.equal(sessions.find(s => s.id === "replacement")!.name, "Different file");
    assert.deepEqual(reads, [{ file: old, start: 0 }]);
  }));
});

test("shared summaries rebuild missing, corrupt, unsupported and oversized indexes", async () => {
  await withDeletionFiles(async (ctx, dir, _old) => withSessionBodyReads(async reads => {
    for (const contents of ["not json", "null", JSON.stringify({ version: 99, entries: [] }), "x".repeat(2 * 1024 * 1024 + 1)]) {
      writeFileSync(sessionIndexPath(dir), contents); reads.length = 0;
      assert.deepEqual((await listPiSessions(ctx)).map(s => s.id).sort(), ["current", "old"]);
      assert.equal(reads.length, 2);
      assert.equal(JSON.parse(readFileSync(sessionIndexPath(dir), "utf8")).version, 1);
    }
    rmSync(sessionIndexPath(dir)); reads.length = 0;
    assert.equal((await listPiSessions(ctx)).length, 2); assert.equal(reads.length, 2);
    assert.ok(readdirSync(dir).every(file => !file.endsWith(".tmp")));
  }));
});

test("shared summaries tolerate an unavailable index without following its symlink or leaving temporary files", async () => {
  await withDeletionFiles(async (ctx, dir, old) => {
    const bytes = readFileSync(old);
    symlinkSync(old, sessionIndexPath(dir));
    assert.equal((await listPiSessions(ctx)).length, 2);
    assert.deepEqual(readFileSync(old), bytes); assert.ok(lstatSync(sessionIndexPath(dir)).isSymbolicLink());
    assert.ok(readdirSync(dir).every(file => !file.endsWith(".tmp")));
    rmSync(sessionIndexPath(dir)); mkdirSync(sessionIndexPath(dir));
    assert.equal((await listPiSessions(ctx)).length, 2);
    assert.ok(lstatSync(sessionIndexPath(dir)).isDirectory());
    assert.ok(readdirSync(dir).every(file => !file.endsWith(".tmp")));
  });
});

test("shared summaries retain a completed cold-scan prefix when the live session grows during reading", async () => {
  await withDeletionFiles(async (ctx, _dir, old) => {
    const boundary = lstatSync(old).size;
    const original = fs.createReadStream;
    let appended = false;
    const replacement = mock.method(fs, "createReadStream", (path: Parameters<typeof fs.createReadStream>[0], options?: Parameters<typeof fs.createReadStream>[1]) => {
      if (String(path) === old && !appended) { appended = true; appendFileSync(old, sessionNameLine("Live append")); }
      return original(path, options);
    });
    syncBuiltinESMExports();
    try { await listPiSessions(ctx); }
    finally { replacement.mock.restore(); syncBuiltinESMExports(); }
    await withSessionBodyReads(async reads => {
      assert.equal((await listPiSessions(ctx)).find(s => s.id === "old")!.name, "Live append");
      assert.deepEqual(reads, [{ file: old, start: boundary }]);
    });
  });
});

test("deletion uses fresh source headers even with a forged index and never scans full history", async () => {
  await withDeletionFiles(async (ctx, dir, old) => {
    const selected = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    const index = JSON.parse(readFileSync(sessionIndexPath(dir), "utf8"));
    index.entries.find((entry: { file: string }) => entry.file === "historical.jsonl").id = "forged";
    writeFileSync(sessionIndexPath(dir), JSON.stringify(index));
    await withSessionBodyReads(async reads => {
      await assert.rejects(trashPiSession(ctx, "forged", selected.modified.getTime(), () => {}), /missing/);
      assert.ok(existsSync(old));
      await trashPiSession(ctx, "old", selected.modified.getTime(), () => {});
      assert.equal(existsSync(old), false); assert.deepEqual(reads, []);
      assert.deepEqual((await listPiSessions(ctx)).map(s => s.id), ["current"]);
      assert.deepEqual(reads, []);
    });
  });
});

test("deletion detects a last-boundary file rewrite even when its mtime is restored", async () => {
  await withDeletionFiles(async (ctx, _dir, old) => {
    const selected = (await listPiSessions(ctx)).find(s => s.id === "old")!;
    const info = lstatSync(old); let checks = 0;
    await assert.rejects(trashPiSession(ctx, "old", selected.modified.getTime(), () => {
      if (++checks === 3) {
        appendFileSync(old, sessionNameLine("Changed after admission"));
        utimesSync(old, info.atimeMs / 1000, info.mtimeMs / 1000);
      }
    }), /changed before deletion/i);
    assert.ok(existsSync(old));
  });
});
