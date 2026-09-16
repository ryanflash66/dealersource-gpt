import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { projectRoot } from "../src/config.ts";

test("migration contains every core table, PostGIS, and RLS", async () => {
  const sql = await readFile(resolve(projectRoot, "supabase", "migrations", "202609160001_initial.sql"), "utf8");
  for (const table of ["sources", "raw_documents", "listings", "sites", "parcels", "evidence", "cases", "messages", "contacts", "scores", "runs"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /create extension if not exists postgis/i);
});
