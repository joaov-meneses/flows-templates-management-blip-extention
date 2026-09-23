import test from "node:test";
import assert from "node:assert/strict";
import { postJsonWithProgress } from "../src/lib/api.ts";
import progressStream from "../server/progressStream.cjs";

test("progress transport handles split chunks and returns the final result", async (t) => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"kind":"progress","processed":0,"total":2,"stage":"Copiando fl',
    'ows"}\n{"kind":"progress","processed":1,"total":2,"stage":"Copiando flows"}\n',
    '{"kind":"result","data":{"totals":{"copied":1}}}\n',
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
      ),
  );
  const updates = [];
  const result = await postJsonWithProgress("/api/flows/replicate/progress", {}, (progress) =>
    updates.push(progress),
  );
  assert.deepEqual(
    updates.map(({ processed, total }) => [processed, total]),
    [
      [0, 2],
      [1, 2],
    ],
  );
  assert.deepEqual(result, { totals: { copied: 1 } });
});

test("streamed operation reports acknowledged items and one result", async () => {
  const lines = [];
  let ended = false;
  const response = {
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    flushHeaders() {},
    write(line) {
      lines.push(JSON.parse(line));
    },
    end() {
      ended = true;
    },
  };
  await progressStream.streamOperation(response, async (progress) => {
    progress(0, 2, "Atualizando flows");
    progress(1, 2, "Atualizando flows");
    progress(2, 2, "Atualizando flows");
    return { updated: 2 };
  });
  assert.equal(ended, true);
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["progress", "progress", "progress", "result"],
  );
  assert.deepEqual(lines.at(-1).data, { updated: 2 });
});

test("an interrupted stream never reports success", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      ),
  );
  await assert.rejects(
    postJsonWithProgress("/api/flows/replicate/progress", {}, () => {}),
    /sem resultado/,
  );
});
