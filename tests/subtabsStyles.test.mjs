import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("as três áreas com abas internas compartilham o estilo de subtabs", () => {
  const app = readFileSync(
    new URL("../src/components/CreateTemplatesApp.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../src/styles/blip-app.css", import.meta.url), "utf8");

  assert.equal((app.match(/className="ember-subtabs(?: bulk-source-tabs)?"/g) || []).length, 3);
  assert.match(css, /\.ember-subtabs button\[aria-selected="true"\]/);
  assert.match(css, /\.ember-subtabs button:focus-visible/);
  assert.doesNotMatch(app, /className="dev-tabs/);
});
