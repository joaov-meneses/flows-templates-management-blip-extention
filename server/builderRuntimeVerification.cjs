const { isDeepStrictEqual } = require("node:util");
const { setTimeout: wait } = require("node:timers/promises");

// A successful SET can precede visibility on GET. Only retry reads: replaying
// the activation command would publish twice and conceal uncertain outcomes.
async function confirmBuilderRuntime(
  readRuntime,
  expectedApplication,
  { delays = [0, 250, 750, 1500, 3000], pause = wait } = {},
) {
  for (const delay of delays) {
    if (delay) await pause(delay);
    const resource = await readRuntime();
    let application = resource?.Application;
    if (typeof application === "string") {
      try {
        application = JSON.parse(application);
      } catch {
        application = undefined;
      }
    }
    if (resource?.Template === "builder" && isDeepStrictEqual(application, expectedApplication))
      return resource;
  }
  throw new Error(
    "A leitura não confirmou o fluxo ativo após aguardar a atualização da Blip. O comando pode ter sido aplicado; confira o Builder antes de repetir.",
  );
}

module.exports = { confirmBuilderRuntime };
