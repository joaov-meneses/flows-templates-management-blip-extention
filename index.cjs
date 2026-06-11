const fs = require("node:fs");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const {
  InputError,
  searchTemplates,
  compareTemplates,
  replicateTemplates,
} = require("./server/templateService.cjs");
const {
  InputError: FlowInputError,
  searchFlows,
  getFlowPreview,
  getFlowJson,
  createFlow,
  publishFlow,
  replicateFlows,
} = require("./server/flowService.cjs");

const PORT = Number(process.env.API_PORT || process.env.PORT || 3000);
const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "create-templates-api",
  });
});

app.post("/api/templates/search", async (req, res, next) => {
  try {
    const result = await searchTemplates(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/replicate", async (req, res, next) => {
  try {
    const result = await replicateTemplates(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/compare", async (req, res, next) => {
  try {
    const result = await compareTemplates(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/search", async (req, res, next) => {
  try {
    const result = await searchFlows(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/preview", async (req, res, next) => {
  try {
    const result = await getFlowPreview(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/json", async (req, res, next) => {
  try {
    const result = await getFlowJson(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/create", async (req, res, next) => {
  try {
    const result = await createFlow(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/publish", async (req, res, next) => {
  try {
    const result = await publishFlow(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/replicate", async (req, res, next) => {
  try {
    const result = await replicateFlows(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const clientDistPath = path.join(__dirname, "dist", "client");
const distPath = fs.existsSync(clientDistPath) ? clientDistPath : path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  const statusCode =
    error instanceof InputError || error instanceof FlowInputError
      ? error.statusCode
      : error.statusCode || 500;

  res.status(statusCode).json({
    error: {
      message: error.message || "Erro inesperado.",
    },
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API e interface disponíveis em http://localhost:${PORT}`);
  });
}

module.exports = app;
