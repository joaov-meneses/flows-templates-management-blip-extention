import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import delivery from "../server/webDelivery.cjs";

test("retired SDK URLs serve compatibility JavaScript while current files and unknown URLs remain distinct", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "portal-compat-test-"));
  await mkdir(path.join(dir, "assets"));
  const compat = "export const blip = { showAlert: async () => ({success:true,data:false}) };";
  await writeFile(path.join(dir, "assets", "portal-alert-compat-v1.js"), compat);
  await writeFile(path.join(dir, delivery.LEGACY_ALERT_CHUNKS[1]), "export const existing = true;");
  const app = express();
  delivery.installWebDelivery(app, dir);
  app.use(express.static(dir));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const url of delivery.LEGACY_ALERT_CHUNKS) {
      const res = await fetch(origin + url);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /javascript/);
      if (url === delivery.LEGACY_ALERT_CHUNKS[1]) assert.match(await res.text(), /existing/);
      else {
        assert.equal(await res.text(), compat);
        assert.equal(res.headers.get("cache-control"), "no-cache");
      }
    }
    assert.equal((await fetch(origin + "/assets/index-unknown.js")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTML revalidates after deployment without overwriting the cache policy for other response types", () => {
  const headers = new Map();
  const res = { set: (name, value) => headers.set(name, value) };
  delivery.setWebResponseCache(
    new Response("<html/>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    res,
  );
  assert.equal(headers.get("Cache-Control"), "no-cache");
  headers.clear();
  delivery.setWebResponseCache(Response.json({ status: "ok" }), res);
  assert.equal(headers.size, 0);
});
