import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { listPiSessions } from "../lib/pi.ts";
import { parseSessionRename, renameSession, selectSessionToResume } from "../lib/commands.ts";

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

test("/resume accepts only an unambiguous saved session in this workspace", () => {
  const sessions = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", cwd: "/repo" },
    { id: "aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cwd: "/repo" },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", cwd: "/other" },
  ];
  assert.deepEqual(selectSessionToResume(sessions, "/repo", sessions[0]!.id, "aaaaaaaa"),
    { error: "Session ID is ambiguous; use more characters." });
  assert.deepEqual(selectSessionToResume(sessions, "/repo", sessions[0]!.id, "aaaaaaaa-bbbb"),
    { id: sessions[1]!.id });
  assert.deepEqual(selectSessionToResume(sessions, "/repo", sessions[0]!.id, sessions[0]!.id),
    { error: "This session is already active." });
  assert.deepEqual(selectSessionToResume(sessions, "/repo", sessions[0]!.id, "cccccccc"),
    { error: "Session not found in this workspace." });
  assert.ok("error" in selectSessionToResume(sessions, "/repo", sessions[0]!.id, "bad"));
});

test("/resume resolves exact names without guessing between duplicate names", () => {
  const sessions = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", cwd: "/repo", name: "Current" },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cwd: "/repo", name: "Resume   Test" },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", cwd: "/repo", name: "resume test" },
    { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", cwd: "/repo", name: "Distinct" },
    { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", cwd: "/other", name: "Distinct" },
    { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", cwd: "/repo", name: "deadbeef" },
  ];
  const select = (name: string) => selectSessionToResume(sessions, "/repo", sessions[0]!.id, name);
  assert.deepEqual(select(" distinct "), { id: sessions[3]!.id });
  assert.deepEqual(select("current"), { error: "This session is already active." });
  assert.match((select("RESUME TEST") as { error: string }).error, /Several sessions/);
  assert.deepEqual(select("unknown"), { error: "Session not found in this workspace." });
  assert.deepEqual(select("bbbbbbbb"), { id: sessions[1]!.id });
  assert.deepEqual(select("deadbeef"), { id: sessions[5]!.id });
});

test("/rename validates its session name without touching the Thread title", () => {
  let stored = "";
  const setName = (name: string) => { stored = name; };
  assert.deepEqual(parseSessionRename("  Release notes  "), { name: "Release notes" });
  assert.equal(renameSession("  Release notes  ", setName), "Pi session renamed: Release notes");
  assert.equal(stored, "Release notes");
  for (const input of ["", "  ", "A".repeat(81), "line\nbreak", "a\u0000b"]) {
    assert.ok("error" in parseSessionRename(input));
    renameSession(input, setName);
    assert.equal(stored, "Release notes");
  }
  assert.ok("name" in parseSessionRename("A".repeat(80)));
});
