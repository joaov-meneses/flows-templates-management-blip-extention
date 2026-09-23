async function streamOperation(res, operation) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await operation((processed, total, stage) => {
      emit({ kind: "progress", processed, total, stage });
    });
    emit({ kind: "result", data: result });
  } catch (error) {
    emit({
      kind: "error",
      message: error instanceof Error ? error.message : "Não foi possível concluir a operação.",
    });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

module.exports = { streamOperation };
