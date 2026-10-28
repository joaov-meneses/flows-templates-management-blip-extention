const fs = require("node:fs");
const path = require("node:path");

// These are blip-iframe SDK chunks from the releases before confirmation used the loaded proxy.
const LEGACY_ALERT_CHUNKS = Object.freeze([
  "/assets/index-DKq2oou9.js",
  "/assets/index-2rxfKCC3.js",
  "/assets/index-11eeWibJ.js",
  "/assets/index-BaWZOObU.js",
]);

function installWebDelivery(app, clientDistPath) {
  app.get(LEGACY_ALERT_CHUNKS, (req, res, next) => {
    const currentAsset = path.join(clientDistPath, req.path);
    if (fs.existsSync(currentAsset)) return next();
    const compatibilityAsset = path.join(clientDistPath, "assets", "portal-alert-compat-v1.js");
    if (!fs.existsSync(compatibilityAsset)) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(compatibilityAsset);
  });
}

function setWebResponseCache(webResponse, res) {
  if (webResponse.headers.get("content-type")?.includes("text/html")) {
    // The HTML entry must revalidate instead of referring to assets removed by a deployment.
    res.set("Cache-Control", "no-cache");
  }
}

module.exports = { installWebDelivery, setWebResponseCache, LEGACY_ALERT_CHUNKS };
