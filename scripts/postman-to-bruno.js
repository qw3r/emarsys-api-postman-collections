#!/usr/bin/env node
/**
 * Convert Emarsys Postman collection to Bruno v3 opencollection format.
 */

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const POSTMAN_FILE = path.join(REPO_ROOT, "postman", "Emarsys_postman_collection.json");
const BRUNO_DIR = path.join(REPO_ROOT, "bruno");

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").trim();
}

function getUrl(urlObj) {
  if (typeof urlObj === "string") return urlObj;
  return urlObj?.raw || "";
}

function getQueryParams(urlObj) {
  if (typeof urlObj === "string") return [];
  return urlObj?.query || [];
}

function renderRequest(item, seq) {
  const req = item.request || {};
  const method = (req.method || "GET").toUpperCase();
  const url = getUrl(req.url);
  const bodyMode = req.body?.mode || null;
  const rawBody = req.body?.raw || "";
  const description = req.description || "";
  const headers = req.header || [];
  const params = getQueryParams(req.url);

  const doc = { info: { name: item.name, type: "http", seq } };

  const http = { method, url };

  if (headers.length > 0) {
    http.headers = headers.map((h) => {
      const entry = { name: h.key, value: h.value || "" };
      if (h.disabled) entry.disabled = true;
      return entry;
    });
  }

  if (params.length > 0) {
    http.params = params.map((p) => {
      const entry = { name: p.key, value: String(p.value || ""), type: "query" };
      if (p.description) entry.description = p.description;
      if (p.disabled) entry.disabled = true;
      return entry;
    });
  }

  if (bodyMode === "raw" && rawBody) {
    http.body = { type: "json", data: rawBody };
  } else if (bodyMode === "raw") {
    http.body = { type: "json", data: "" };
  }

  http.auth = "inherit";
  doc.http = http;

  doc.settings = {
    encodeUrl: true,
    timeout: 0,
    followRedirects: true,
    maxRedirects: 5,
  };

  if (description) {
    doc.docs = description;
  }

  return YAML.stringify(doc, { lineWidth: 0 });
}

function processItems(items, outputDir) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.item) {
      const folderName = sanitize(item.name);
      const folderDir = path.join(outputDir, folderName);
      fs.mkdirSync(folderDir, { recursive: true });
      processItems(item.item, folderDir);
    } else {
      const filename = sanitize(item.name) + ".yml";
      fs.writeFileSync(path.join(outputDir, filename), renderRequest(item, i + 1));
    }
  }
}

function convertEnvironments() {
  const envSource = path.join(REPO_ROOT, "postman", "environments");
  const envDest = path.join(BRUNO_DIR, "environments");
  fs.mkdirSync(envDest, { recursive: true });

  const secretKeys = ["OIDC_ClientId", "OIDC_Secret"];

  for (const file of fs.readdirSync(envSource)) {
    if (!file.endsWith(".json")) continue;
    const envData = JSON.parse(fs.readFileSync(path.join(envSource, file), "utf8"));
    const name = envData.name || path.basename(file, ".json");
    const values = envData.values || [];

    const env = { name, variables: [] };
    for (const v of values) {
      const entry = { name: v.key, value: v.value || "" };
      if (secretKeys.includes(v.key)) entry.secret = true;
      env.variables.push(entry);
    }

    const outFile = path.join(envDest, sanitize(name) + ".yml");
    fs.writeFileSync(outFile, YAML.stringify(env, { lineWidth: 0 }));
    console.log(`  Environment: ${path.relative(REPO_ROOT, outFile)}`);
  }
}

// Main
console.log(`Converting ${path.basename(POSTMAN_FILE)} to Bruno v3 opencollection format...`);

const collection = JSON.parse(fs.readFileSync(POSTMAN_FILE, "utf8"));

// Clean and create output
if (fs.existsSync(BRUNO_DIR)) {
  fs.rmSync(BRUNO_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BRUNO_DIR, { recursive: true });

// opencollection.yml
const opencollectionDoc = {
  opencollection: "1.0.0",
  info: { name: collection.info.name },
  request: {
    auth: {
      type: "oauth2",
      flow: "client_credentials",
      accessTokenUrl: "{{OIDC_TokenUrl}}",
      credentials: {
        clientId: "{{OIDC_ClientId}}",
        clientSecret: "{{OIDC_Secret}}",
        placement: "basic_auth_header",
      },
      tokenConfig: {
        id: "credential",
        placement: { header: "Bearer" },
        source: "access_token",
      },
      settings: {
        autoFetchToken: true,
        autoRefreshToken: false,
      },
    },
    variables: [{ name: "apiHost", value: "api.emarsys.net" }],
  },
  docs: {
    content: collection.info.description || "",
    type: "text/markdown",
  },
  bundled: false,
  extensions: {
    bruno: {
      ignore: ["node_modules", ".git"],
    },
  },
};
fs.writeFileSync(
  path.join(BRUNO_DIR, "opencollection.yml"),
  YAML.stringify(opencollectionDoc, { lineWidth: 0 })
);
console.log("  Created: opencollection.yml");

// Process requests
processItems(collection.item, BRUNO_DIR);
console.log("  Processed request folders");

// Environments
convertEnvironments();

// .gitignore
fs.writeFileSync(
  path.join(BRUNO_DIR, ".gitignore"),
  "# Generated — do not commit\n*\n!.gitkeep\n"
);

console.log(`\nDone! Bruno collection written to: bruno/`);
