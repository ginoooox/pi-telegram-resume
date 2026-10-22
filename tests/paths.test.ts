/**
 * Regression tests for Telegram bridge path resolution
 * Guards agent-dir detection for Pi-compatible runtimes and path derivation helpers.
 */

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";

import {
  requireTelegramStoragePathReference,
  getTelegramDiagnosticsDisplayPaths,
  getTelegramProfilePathSuffix,
  resolveAgentDir,
  resolveTelegramConfigPath,
  resolveTelegramFollowerJournalPath,
  decodeTelegramSessionDirectoryName,
  encodeTelegramSessionDirectoryName,
  getTelegramRecipientJournalHash,
  resolveLegacyTelegramOwnersPath,
  resolveTelegramSessionDir,
  resolveTelegramSessionJournalPath,
  resolveTelegramOwnersPath,
  resolveTelegramProfileTempFilePath,
  resolveTelegramRuntimeLogPath,
  resolveTelegramStatePath,
  resolveTelegramServiceJournalStorage,
  getTelegramJournalPublicationPaths,
  resolveTelegramTempDir,
  resolveTelegramChannelPostJournalPath,
  resolveTelegramThreadCleanupWorkPath,
  resolveTelegramUpdateJournalPath,
  resolveTelegramUpdateJournalPathForProfile,
  resolveTelegramWorkspaceAdmissionPath,
  resolveTelegramWorkspaceAdmissionPathForProfile,
} from "../lib/paths.ts";

test("Consolidated service journal paths isolate raw profile identities and bind guards/staging to the same root", () => {
  const agentDir = resolve("fixture-agent");
  const files = new Set<string>();
  for (const kind of ["channel-posts", "thread-cleanup"] as const) {
    for (const profile of ["default", "work", "WORK", "work/name", "work_name"]) {
      const storage = resolveTelegramServiceJournalStorage(kind, agentDir, profile);
      files.add(storage.path);
      assert.equal(dirname(storage.path), join(resolveTelegramTempDir(agentDir), "journals"));
      assert.equal(storage.runtimeDir, join(resolveTelegramTempDir(agentDir), "runtime"));
      const publication = getTelegramJournalPublicationPaths(storage.path, storage.runtimeDir);
      assert.equal(dirname(publication.transactionPath), storage.runtimeDir);
      assert.equal(dirname(publication.temporaryBasePath), storage.runtimeDir);
      assert.throws(() => getTelegramJournalPublicationPaths(storage.path, join(agentDir, "foreign", "runtime")), /approved absolute path/u);
    }
  }
  assert.equal(files.size, 10);
  const oldPath = resolveTelegramThreadCleanupWorkPath(agentDir, "work");
  assert.deepEqual(getTelegramJournalPublicationPaths(oldPath), { transactionPath: `${oldPath}.transaction`, temporaryBasePath: oldPath });
  assert.throws(() => getTelegramJournalPublicationPaths(oldPath, join(resolveTelegramTempDir(agentDir), "runtime")), /approved absolute path|journals namespace/u);
});

test("Consolidated state has one root path independent of logical profile names", () => {
  const agentDir = resolve("fixture-agent");
  assert.equal(resolveTelegramStatePath(agentDir), join(resolveTelegramTempDir(agentDir), "state.json"));
  assert.equal(resolveTelegramStatePath(), join(resolveTelegramTempDir(), "state.json"));
});

test("Storage path reference admission requires exact absolute spelling without repairing aliases", () => {
  const agentDir = resolve("fixture-agent");
  const expected = resolveTelegramUpdateJournalPath(agentDir, "work");
  assert.equal(requireTelegramStoragePathReference(expected, expected), expected);
  const relative = join("work", "tmp", "pi-telegram", "inbox.json");
  const alias = `${agentDir}${sep}unused${sep}..${sep}tmp${sep}pi-telegram${sep}inbox.work.json`;
  for (const [actual, approved] of [
    [relative, expected], [relative, relative], [expected, relative],
    [alias, expected], [expected, alias], [alias, alias],
    [resolveTelegramUpdateJournalPath(agentDir), expected],
    [resolveTelegramUpdateJournalPath(agentDir, "other"), expected],
    [join(agentDir, "tmp", "pi-telegram", "workspace-admission.work.json"), expected],
    [expected, ""], [undefined, expected], [expected, null],
  ]) {
    assert.throws(() => requireTelegramStoragePathReference(actual as string, approved as string),
      { message: "Telegram storage reference does not match its approved absolute path." });
  }
});

await test("resolveAgentDir", async (t) => {
  await t.test("returns PI_CODING_AGENT_DIR when env is set", () => {
    assert.equal(
      resolveAgentDir({
        env: { PI_CODING_AGENT_DIR: "/custom/agent/dir" },
        execPath: "/usr/bin/omp",
        argv: ["omp"],
      }),
      resolve("/custom/agent/dir"),
    );
  });

  await t.test("returns ~/.omp/agent for OMP-compatible runtimes", () => {
    assert.equal(
      resolveAgentDir({ env: {}, execPath: "/home/user/.local/bin/omp" }),
      join(homedir(), ".omp", "agent"),
    );
    assert.equal(
      resolveAgentDir({
        env: {},
        execPath: "/usr/bin/node",
        argv: ["node", "omp"],
      }),
      join(homedir(), ".omp", "agent"),
    );
  });

  await t.test(
    "returns ~/.pi/agent as fallback when no env and no OMP runtime",
    () => {
      assert.equal(
        resolveAgentDir({ env: {}, execPath: "/usr/bin/node", argv: ["node"] }),
        join(homedir(), ".pi", "agent"),
      );
    },
  );
});

await test("resolveTelegramConfigPath", () => {
  assert.ok(
    resolveTelegramConfigPath().endsWith("telegram.json"),
    "config path ends with telegram.json",
  );
});

await test("resolveTelegramOwnersPath", () => {
  assert.ok(
    resolveTelegramOwnersPath().endsWith(join("tmp", "pi-telegram", "owners.json")),
    "owners path ends with the platform-native tmp/pi-telegram/owners.json suffix",
  );
});

await test("resolveTelegramTempDir", () => {
  assert.ok(
    resolveTelegramTempDir().endsWith(join("tmp", "pi-telegram")),
    "temp dir ends with the platform-native tmp/pi-telegram suffix",
  );
});

await test("resolveTelegramTempDir canonicalizes a symlinked agent directory for strict journal anchors", { skip: process.platform === "win32" }, () => {
  const real = realpathSync(mkdtempSync(join(tmpdir(), "pi-telegram-paths-real-")));
  const link = `${real}-link`;
  try {
    symlinkSync(real, link, "dir");
    assert.equal(resolveTelegramTempDir(link), join(real, "tmp", "pi-telegram"));
    assert.equal(resolveTelegramTempDir(join(link, "missing", "agent")), join(real, "missing", "agent", "tmp", "pi-telegram"),
      "Only the existing prefix is resolved; missing components are kept verbatim");
  } finally { rmSync(link, { force: true }); rmSync(real, { recursive: true, force: true }); }
});

await test("resolveTelegramRuntimeLogPath", () => {
  assert.ok(
    resolveTelegramRuntimeLogPath().endsWith(
      join("tmp", "pi-telegram", "logs.jsonl"),
    ),
    "runtime log path ends with the platform-native logs.jsonl suffix",
  );
});

await test("thread cleanup work paths are profile-scoped", () => {
  assert.equal(resolveTelegramThreadCleanupWorkPath("/agent", "default"),
    join("/agent", "tmp", "pi-telegram", "thread-cleanup.json"));
  assert.equal(resolveTelegramThreadCleanupWorkPath("/agent", "work"),
    join("/agent", "tmp", "pi-telegram", "thread-cleanup.work.json"));
});

test("channel post journal paths are profile-scoped", () => {
  assert.equal(resolveTelegramChannelPostJournalPath("/agent", "default"),
    join("/agent", "tmp", "pi-telegram", "channel-posts.json"));
  assert.equal(resolveTelegramChannelPostJournalPath("/agent", "work"),
    join("/agent", "tmp", "pi-telegram", "channel-posts.work.json"));
});

test("update journal paths are profile-scoped", () => {
  assert.equal(
    resolveTelegramUpdateJournalPath("/agent", "default"),
    join("/agent", "tmp", "pi-telegram", "inbox.json"),
  );
  assert.equal(
    resolveTelegramUpdateJournalPath("/agent", "work"),
    join("/agent", "tmp", "pi-telegram", "inbox.work.json"),
  );
});

test("profile-only storage callbacks bind the configured agent directory", () => {
  const agentDir = resolveAgentDir();
  assert.equal(
    resolveTelegramUpdateJournalPathForProfile("work"),
    resolveTelegramUpdateJournalPath(agentDir, "work"),
  );
  assert.equal(
    resolveTelegramWorkspaceAdmissionPathForProfile("work"),
    resolveTelegramWorkspaceAdmissionPath(agentDir, "work"),
  );
  assert.notEqual(
    resolveTelegramUpdateJournalPathForProfile("work"),
    resolveTelegramUpdateJournalPath("work"),
  );
  assert.notEqual(
    resolveTelegramWorkspaceAdmissionPathForProfile("work"),
    resolveTelegramWorkspaceAdmissionPath("work"),
  );
});

await test("follower journal paths are stable binding and profile scoped", () => {
  const first = resolveTelegramFollowerJournalPath(
    "manual-follower:owner-a",
    "/agent",
    "work",
  );
  assert.equal(
    first,
    resolveTelegramFollowerJournalPath(
      "manual-follower:owner-a",
      "/agent",
      "work",
    ),
  );
  assert.notEqual(
    first,
    resolveTelegramFollowerJournalPath(
      "manual-follower:owner-b",
      "/agent",
      "work",
    ),
  );
  assert.match(
    first,
    /follower-inbox-[a-f0-9]{16}\.work\.json$/u,
  );
});

await test("explicit default profile keeps canonical unsuffixed paths", () => {
  assert.equal(getTelegramProfilePathSuffix("default"), "");
  assert.equal(
    resolveTelegramProfileTempFilePath("state", "json", "/agent", "default"),
    resolveTelegramProfileTempFilePath("state", "json", "/agent"),
  );
  assert.deepEqual(
    getTelegramDiagnosticsDisplayPaths("default"),
    getTelegramDiagnosticsDisplayPaths(),
  );
});

await test("Diagnostic display paths are shared across default and named profiles", () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const expected = {
    state: "~/.pi/agent/tmp/pi-telegram/state.json",
    logs: "~/.pi/agent/tmp/pi-telegram/logs.jsonl",
  };
  for (const profile of [undefined, "default", "work"]) {
    assert.deepEqual(getTelegramDiagnosticsDisplayPaths(profile, agentDir), expected);
  }
});

await test("Diagnostic display paths follow a non-default agent dir", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-telegram-display-paths-")));
  try {
    const display = getTelegramDiagnosticsDisplayPaths("work", dir);
    for (const path of [display.state, display.logs]) {
      assert.ok(path.startsWith("~/") || path.startsWith(join(dir, "tmp", "pi-telegram")), path);
      assert.ok(!path.startsWith("~/.pi/agent/"), "never another profile's default files");
    }
    // Windows may resolve the temp directory outside the resolved home directory, so a display path is
    // compared separator-neutral: only the exact agent directory and file names are asserted.
    const normalizedDisplay = (value: string): string => value.split("\\").join("/");
    assert.ok(normalizedDisplay(display.state).endsWith("tmp/pi-telegram/state.json"), display.state);
    assert.ok(normalizedDisplay(display.logs).endsWith("tmp/pi-telegram/logs.jsonl"), display.logs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("The pre-0.52.0 directory is read-only legacy and never the runtime directory", () => {
  const agentDir = resolve("fixture-agent");
  assert.equal(resolveTelegramTempDir(agentDir), join(agentDir, "tmp", "pi-telegram"));
  assert.equal(resolveLegacyTelegramOwnersPath(agentDir), join(agentDir, "tmp", "telegram", "owners.json"));
  assert.notEqual(dirname(resolveLegacyTelegramOwnersPath(agentDir)), resolveTelegramTempDir(agentDir));
});

await test("Session directory names keep real ids verbatim and encode everything unsafe reversibly", () => {
  const uuid = "01a0da2f-942f-71a0-af1a-a63ec1c8ec18";
  assert.equal(encodeTelegramSessionDirectoryName(uuid), uuid);
  const cases: Array<[string, string]> = [
    ["a/b", "a%2Fb"], ["..", "%2E%2E"], [".hidden", "%2Ehidden"], ["trail.", "trail%2E"], ["in.ner", "in.ner"],
    ["ABC", "%41%42%43"], ["a b", "a%20b"], ["100%", "100%25"], ["é", "%C3%A9"], ["con", "%63on"], ["lpt1.txt", "%6Cpt1.txt"], ["a\\b:c*", "a%5Cb%3Ac%2A"],
  ];
  for (const [id, name] of cases) {
    assert.equal(encodeTelegramSessionDirectoryName(id), name, id);
    assert.equal(decodeTelegramSessionDirectoryName(name), id, `round trip ${id}`);
    assert.doesNotMatch(name, /[\\/:*?"<>|\s]|^\.|\.$/u);
  }
  assert.equal(encodeTelegramSessionDirectoryName(""), undefined);
  assert.equal(encodeTelegramSessionDirectoryName("\uD800"), undefined, "Invalid UTF-16 must not alias a replacement character session");
  assert.equal(encodeTelegramSessionDirectoryName("a".repeat(201)), undefined);
  assert.notEqual(encodeTelegramSessionDirectoryName("a".repeat(200)), undefined);
  for (const forged of ["ABC", "a%2fb", "a%2", "a%ZZ", "%61", "..", ".x", "a/b", "a b"]) {
    assert.equal(decodeTelegramSessionDirectoryName(forged), undefined, `non-canonical ${forged}`);
  }
  assert.notEqual(encodeTelegramSessionDirectoryName("Abc"), encodeTelegramSessionDirectoryName("abc"), "case-insensitive filesystems cannot merge sessions");
});

await test("Session journals sit in their session folder named by the recipient hash without revealing a role", () => {
  const agentDir = resolve("fixture-agent");
  const id = "01a0da2f-942f-71a0-af1a-a63ec1c8ec18";
  assert.equal(resolveTelegramSessionDir(id, agentDir), join(agentDir, "tmp", "pi-telegram", "sessions", id));
  const hash = getTelegramRecipientJournalHash("manual:old");
  assert.match(hash, /^[0-9a-f]{16}$/u);
  assert.equal(hash, resolveTelegramFollowerJournalPath("manual:old", agentDir).match(/follower-inbox-([0-9a-f]{16})\.json$/u)?.[1],
    "the recipient identity and its hash are unchanged");
  assert.equal(resolveTelegramSessionJournalPath(id, "manual:old", agentDir), join(agentDir, "tmp", "pi-telegram", "sessions", id, `journal.${hash}.json`));
  assert.equal(resolveTelegramSessionJournalPath(id, "manual:old", agentDir, "work"), join(agentDir, "tmp", "pi-telegram", "sessions", id, `journal.${hash}.work.json`));
  assert.notEqual(resolveTelegramSessionJournalPath(id, "manual:other", agentDir), resolveTelegramSessionJournalPath(id, "manual:old", agentDir));
  assert.throws(() => resolveTelegramSessionDir("", agentDir), /usable session id/u);
  assert.throws(() => resolveTelegramSessionJournalPath(id, "", agentDir), /binding key/u);
});
