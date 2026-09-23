import type { BotCloneResponse, RouterCloneTarget } from "../types/templates";

export type BuilderCloneTargetResult = {
  target: RouterCloneTarget;
  response?: BotCloneResponse;
  error?: string;
};

export async function cloneBuilderTargetsSequentially(
  targets: RouterCloneTarget[],
  cloneOne: (target: RouterCloneTarget) => Promise<BotCloneResponse>,
  onResult: (results: BuilderCloneTargetResult[]) => void,
): Promise<BuilderCloneTargetResult[]> {
  const results: BuilderCloneTargetResult[] = [];
  for (const target of targets) {
    try {
      results.push({ target, response: await cloneOne(target) });
    } catch (caughtError) {
      results.push({
        target,
        error: caughtError instanceof Error ? caughtError.message : "Erro ao clonar builder.",
      });
    }
    onResult([...results]);
  }
  return results;
}
