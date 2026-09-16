import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runPipeline } from "../src/pipeline.ts";

async function paths() {
  const root = await mkdtemp(resolve(tmpdir(), "dealersource-test-"));
  return { statePath: resolve(root, "state.json"), reportPath: resolve(root, "report.json") };
}

test("full fixture pipeline produces evidence-backed ranked shortlist without network", async () => {
  const files = await paths();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network access attempted in offline mode"); };
  try {
    const { report, state, run } = await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
    assert.equal(report.shortlist.length, 2);
    assert.equal(report.shortlist[0].sharedLot, false);
    assert.equal(report.shortlist[1].sharedLot, true);
    assert.equal(state.listings.length, 5);
    assert.equal(state.sites.length, 4, "duplicate listings must merge into one site");
    assert.equal(run.paidCalls, 0);
    for (const site of report.shortlist) {
      assert.deepEqual(site.gates.map((gate) => gate.status), ["pass", "pass", "pass"]);
      for (const gate of site.gates) {
        const item = state.evidence.find((evidence) => evidence.id === gate.evidenceId);
        assert.ok(item?.sourceUrl);
        assert.ok(item?.fetchedAt);
        assert.ok(item?.expiresAt);
      }
    }
    const stored = JSON.parse(await readFile(files.reportPath, "utf8"));
    assert.equal(stored.shortlist.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same-day replay sends zero duplicate messages", async () => {
  const files = await paths();
  const first = await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
  const second = await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
  assert.equal(first.run.counts.outboundMessages, 1);
  assert.equal(second.run.counts.outboundMessages, 0);
  assert.equal(second.state.messages.length, 1);
  assert.equal(new Set(second.state.messages.map((message) => message.dedupeKey)).size, 1);
});

test("follow-ups wait for the configured interval", async () => {
  const files = await paths();
  await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
  const early = await runPipeline({ offline: true, runDate: "2026-09-20", ...files });
  const due = await runPipeline({ offline: true, runDate: "2026-09-22", ...files });
  assert.equal(early.run.counts.outboundMessages, 0);
  assert.equal(due.run.counts.outboundMessages, 1);
  assert.equal(due.state.cases[0].followups, 1);
});

test("rolling bounce threshold automatically pauses mail", async () => {
  const files = await paths();
  await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
  const state = JSON.parse(await readFile(files.statePath, "utf8"));
  state.messages[0].status = "bounced";
  await writeFile(files.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const replay = await runPipeline({ offline: true, runDate: "2026-09-16", ...files });
  assert.equal(replay.state.system[0].paused, true);
  assert.match(replay.state.system[0].reason, /bounce rate/);
  assert.ok(replay.report.exceptions.some((item) => item.type === "outreach"));
});
