import test from "node:test";
import assert from "node:assert/strict";

const listeners = new Set();
const sent = [];
let reply = true;
let failure = null;
globalThis.window = {
  name: "test-extension",
  addEventListener(type, listener) {
    if (type === "message") listeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === "message") listeners.delete(listener);
  },
  parent: {
    postMessage(envelope) {
      sent.push(envelope.message);
      const data = failure
        ? { trackingProperties: envelope.trackingProperties, error: failure }
        : { trackingProperties: envelope.trackingProperties, response: reply };
      for (const listener of listeners) listener({ data });
    },
  },
};
const { showBlipAlert } = await import("../src/lib/blipProxy.ts");
const { blip } = await import("../src/lib/portalAlertCompat.ts");
const params = {
  variant: "warning",
  icon: "warning",
  title: "Criar template neste router?",
  body: "Template fictício",
  buttons: { cancel: "Cancelar", confirm: "Criar template" },
};

test("confirmation uses the existing Portal proxy and preserves approve/cancel booleans", async () => {
  reply = true;
  assert.equal(await showBlipAlert(params), true);
  reply = false;
  assert.equal(await showBlipAlert(params), false);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].action, "blipEvent:showAlert");
  assert.deepEqual(sent[0].content, params);
});
test("a malformed confirmation or Portal error cannot approve a mutation", async () => {
  for (const invalid of [null, undefined, { success: true }, "true"]) {
    reply = invalid;
    await assert.rejects(showBlipAlert(params), /Resposta inválida/);
  }
  failure = new Error("Portal indisponível");
  await assert.rejects(showBlipAlert(params), /Portal indisponível/);
  failure = null;
});
test("old SDK compatibility preserves its success/data contract for both approval and cancellation", async () => {
  reply = true;
  assert.deepEqual(await blip.showAlert(params), { success: true, data: true });
  reply = false;
  assert.deepEqual(await blip.showAlert(params), { success: true, data: false });
  assert.deepEqual(sent.at(-1).content, params);
});
test("old SDK compatibility reports errors without approving or resending an action", async () => {
  const before = sent.length;
  reply = { invalid: true };
  assert.equal((await blip.showAlert(params)).success, false);
  failure = new Error("Falha de confirmação");
  assert.deepEqual(await blip.showAlert(params), {
    success: false,
    error: { message: "Falha de confirmação" },
  });
  assert.equal(sent.length, before + 2);
  failure = null;
});
