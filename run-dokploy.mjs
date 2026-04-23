#!/usr/bin/env node
/**
 * Wrapper MCP Dokploy :
 *  1) Fetch /api/trpc/settings.getOpenApiDocument avec x-api-key
 *  2) Déballe l'enveloppe tRPC { result: { data: { json: <OpenAPI> } } }
 *  3) Écrit le spec dans un fichier temporaire
 *  4) Exec openapi-mcp-server en mode stdio en le pointant sur ce fichier
 *
 * Env requis :
 *   DOKPLOY_URL      ex: https://dockploy.gaddielcloud.online
 *   DOKPLOY_API_KEY  la clé API Dokploy
 *   DOKPLOY_NAME     (optionnel) nom affiché
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DOKPLOY_URL = (process.env.DOKPLOY_URL || "").replace(/\/$/, "");
const DOKPLOY_API_KEY = process.env.DOKPLOY_API_KEY || "";
const DOKPLOY_NAME = process.env.DOKPLOY_NAME || "dokploy";

if (!DOKPLOY_URL || !DOKPLOY_API_KEY) {
  console.error("[run-dokploy] DOKPLOY_URL et DOKPLOY_API_KEY requis");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.join(__dirname, "bin", "mcp-server.js");
const cacheDir = path.join(os.tmpdir(), "dokploy-mcp");
mkdirSync(cacheDir, { recursive: true });
const specFile = path.join(cacheDir, `${DOKPLOY_NAME}.openapi.json`);

async function fetchSpec() {
  const url = `${DOKPLOY_URL}/api/trpc/settings.getOpenApiDocument`;
  const resp = await fetch(url, { headers: { "x-api-key": DOKPLOY_API_KEY } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  const body = await resp.json();
  const spec = body?.result?.data?.json ?? body?.result?.data ?? body;
  if (!spec?.paths) throw new Error("Spec OpenAPI invalide (pas de 'paths')");
  return spec;
}

try {
  console.error(`[run-dokploy] Chargement spec depuis ${DOKPLOY_URL}…`);
  const spec = await fetchSpec();
  writeFileSync(specFile, JSON.stringify(spec));
  console.error(`[run-dokploy] ${Object.keys(spec.paths).length} paths → ${specFile}`);
  console.error(`[run-dokploy] Démarrage openapi-mcp-server (${DOKPLOY_NAME})…`);

  const result = spawnSync(process.execPath, [binPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      API_BASE_URL: DOKPLOY_URL,
      OPENAPI_SPEC_PATH: specFile,
      API_HEADERS: `x-api-key:${DOKPLOY_API_KEY}`,
      SERVER_NAME: DOKPLOY_NAME,
    },
  });
  process.exit(result.status ?? 0);
} catch (err) {
  console.error(`[run-dokploy] Échec : ${err.message}`);
  process.exit(2);
}
