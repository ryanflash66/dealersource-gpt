import test from "node:test";
import assert from "node:assert/strict";
import { JsonStateStore, SupabaseStateStore, selectStateStore } from "../src/store.ts";

test("storage falls back to fixtures unless live Supabase credentials are present", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(selectStateStore(false, "fixture.json") instanceof JsonStateStore);
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
  assert.ok(selectStateStore(false, "fixture.json") instanceof SupabaseStateStore);
  assert.ok(selectStateStore(true, "fixture.json") instanceof JsonStateStore);
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});
