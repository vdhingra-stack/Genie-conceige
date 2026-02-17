const fs = require("fs");
const path = require("path");

const AUTH_HEADER = process.env.MCP_AUTH_HEADER || ""; // e.g. "Bearer <token>"

async function postJson(url, headers, bodyObj) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(AUTH_HEADER ? { "Authorization": `Bearer ${AUTH_HEADER}` } : {}),
      ...headers,
    },
    body: JSON.stringify(bodyObj),
  });

  const text = await res.text();
  return { res, text };
}

async function deleteSession(url, sessionId) {
  await fetch(url, {
    method: "DELETE",
    headers: {
      "Accept": "application/json, text/event-stream",
      ...(AUTH_HEADER ? { "Authorization": `Bearer ${AUTH_HEADER}` } : {}),
      "mcp-session-id": sessionId,
    },
  });
}



function requireEnv(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing ${name} (set env var)`);
  return v;
}

async function main() {
  const mcpUrl = requireEnv("MCP_URL", "http://127.0.0.1:8000/mcp");
  const reqFile = process.argv[2];
  if (!reqFile) throw new Error("Usage: node scripts/mcp_call.cjs <request.json>");

  const fullPath = path.resolve(reqFile);
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  console.log("REQUEST_FILE:", fullPath);
  console.log("REQUEST_PAYLOAD:", JSON.stringify(payload, null, 2));

  // 1) initialize
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "file-runner", version: "0.1.0" },
    },
  };

  const init = await postJson(mcpUrl, {}, initBody);
  const sessionId = init.res.headers.get("mcp-session-id");

  if (!sessionId) {
    console.error("Initialize response:", init.text);
    throw new Error("No mcp-session-id header returned from initialize.");
  }

  console.log("mcp-session-id:", sessionId);

  // 2) tools/list
  const listBody = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const list = await postJson(mcpUrl, { "mcp-session-id": sessionId }, listBody);
  console.log("\nTOOLS/LIST:\n" + list.text);

  // 3) tools/call using file payload
  const callBody = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: payload.name,
      arguments: payload.arguments || {},
    },
  };

  const call = await postJson(mcpUrl, { "mcp-session-id": sessionId }, callBody);
  console.log("\nTOOLS/CALL RESULT:\n" + call.text);

  // 4) close session
  await deleteSession(mcpUrl, sessionId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
