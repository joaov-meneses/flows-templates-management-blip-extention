const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const cors = require("cors");
const express = require("express");
const {
  InputError,
  searchTemplates,
  compareTemplates,
  deleteTemplate,
  bulkDeleteTemplates,
  replicateTemplates,
} = require("./server/templateService.cjs");
const {
  InputError: FlowInputError,
  searchFlows,
  getFlowPreview,
  getFlowJson,
  createFlow,
  updateFlowMetadata,
  updateFlowJson,
  bulkUpdateFlowJson,
  publishFlow,
  deprecateFlow,
  replicateFlows,
} = require("./server/flowService.cjs");
const {
  InputError: PluginInputError,
  searchPlugins,
  savePlugins,
  getPluginConflicts,
  replicatePlugins,
} = require("./server/pluginService.cjs");
const {
  InputError: BotInputError,
  cloneBot,
  identifyBot,
} = require("./server/botCloneService.cjs");
const {
  InputError: RouterDirectoryInputError,
  getRouterPhoneNumber,
} = require("./server/routerDirectoryService.cjs");
const {
  RouterCloneInputError,
  getRouterServices,
  previewRouterClone,
  prepareRouterClone,
  verifyRouterClone,
  cloneRouter,
  cloneNewRouter,
} = require("./server/routerCloneService.cjs");
const { streamOperation } = require("./server/progressStream.cjs");

const PORT = Number(process.env.API_PORT || process.env.PORT || 3000);
const app = express();
let ssrServerPromise;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "create-templates-api",
  });
});

app.post("/api/routers/whatsapp-number", async (req, res, next) => {
  try {
    res.json(await getRouterPhoneNumber(req.body || {}));
  } catch (error) {
    next(error);
  }
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
app.post("/api/templates/replicate/progress", (req, res) =>
  streamOperation(res, (onProgress) => replicateTemplates(req.body, onProgress)),
);

app.post("/api/templates/compare", async (req, res, next) => {
  try {
    const result = await compareTemplates(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/delete", async (req, res, next) => {
  try {
    const result = await deleteTemplate(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/bulk-delete", async (req, res, next) => {
  try {
    const result = await bulkDeleteTemplates(req.body);
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

app.post("/api/flows/update-metadata", async (req, res, next) => {
  try {
    const result = await updateFlowMetadata(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/update-json", async (req, res, next) => {
  try {
    const result = await updateFlowJson(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/bulk-update-json", async (req, res, next) => {
  try {
    const result = await bulkUpdateFlowJson(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
app.post("/api/flows/bulk-update-json/progress", (req, res) =>
  streamOperation(res, (onProgress) => bulkUpdateFlowJson(req.body, onProgress)),
);

app.post("/api/flows/publish", async (req, res, next) => {
  try {
    const result = await publishFlow(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/flows/deprecate", async (req, res, next) => {
  try {
    const result = await deprecateFlow(req.body);
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
app.post("/api/flows/replicate/progress", (req, res) =>
  streamOperation(res, (onProgress) => replicateFlows(req.body, onProgress)),
);

app.post("/api/plugins/search", async (req, res, next) => {
  try {
    const result = await searchPlugins(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/plugins/save", async (req, res, next) => {
  try {
    const result = await savePlugins(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/plugins/conflicts", async (req, res, next) => {
  try {
    const result = await getPluginConflicts(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/plugins/replicate", async (req, res, next) => {
  try {
    const result = await replicatePlugins(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
app.post("/api/plugins/replicate/progress", (req, res) =>
  streamOperation(res, (onProgress) => replicatePlugins(req.body, onProgress)),
);

app.post("/api/bots/clone", async (req, res, next) => {
  try {
    const result = await cloneBot(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/clone/preview", async (req, res, next) => {
  try {
    res.json(await previewRouterClone(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/services", async (req, res, next) => {
  try {
    res.json(await getRouterServices(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/clone", async (req, res, next) => {
  try {
    res.json(await cloneRouter(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/clone/new", async (req, res, next) => {
  try {
    res.json(await cloneNewRouter(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/clone/prepare", async (req, res, next) => {
  try {
    res.json(await prepareRouterClone(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/routers/clone/verify", async (req, res, next) => {
  try {
    res.json(await verifyRouterClone(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/bots/identity", async (req, res, next) => {
  try {
    const result = await identifyBot(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

function getRequestOrigin(req) {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || req.protocol || "http";
  return `${protocol}://${req.get("host")}`;
}

function createWebRequest(req) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  const requestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    requestInit.body = req;
    requestInit.duplex = "half";
  }

  return new Request(`${getRequestOrigin(req)}${req.originalUrl}`, requestInit);
}

async function sendWebResponse(webResponse, res) {
  res.status(webResponse.status);

  webResponse.headers.forEach((value, key) => {
    if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  const body = Buffer.from(await webResponse.arrayBuffer());
  res.send(body);
}

async function getSsrServer() {
  if (!ssrServerPromise) {
    const serverEntryPath = path.join(__dirname, "dist", "server", "server.js");
    ssrServerPromise = import(pathToFileURL(serverEntryPath).href).then(
      (module) => module.default ?? module,
    );
  }

  return ssrServerPromise;
}

const clientDistPath = path.join(__dirname, "dist", "client");
const serverEntryPath = path.join(__dirname, "dist", "server", "server.js");
const legacyIndexPath = path.join(__dirname, "dist", "index.html");

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath, { index: false }));

  if (fs.existsSync(serverEntryPath)) {
    app.use(/^\/(?!api\/).*/, async (req, res, next) => {
      try {
        const ssrServer = await getSsrServer();
        const webResponse = await ssrServer.fetch(createWebRequest(req), {}, {});
        await sendWebResponse(webResponse, res);
      } catch (error) {
        next(error);
      }
    });
  }
} else if (fs.existsSync(legacyIndexPath)) {
  const distPath = path.dirname(legacyIndexPath);
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
    error instanceof InputError ||
    error instanceof FlowInputError ||
    error instanceof PluginInputError ||
    error instanceof BotInputError ||
    error instanceof RouterDirectoryInputError ||
    error instanceof RouterCloneInputError
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
