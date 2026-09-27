import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OperatorCaseR50Error,
  R50_AUTHORITY,
  createCaptureTemplateR50,
  exportAiRunnerPacketR50,
  freezeEvidenceR50,
  freezeHumanPriorR50,
  getOperatorCaseStateR50,
  listOperatorCasesR50,
  previewEvidenceR50,
  readAiRunnerPacketR50,
  startOperatorCaseR50,
  validateHumanPriorR50
} from "../../benchmarks/chart-intent-r26/src/operator-case-r50.js";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 16 * 1024 * 1024;
const BLOCKED_API_PATTERN =
  /^\/api\/(?:outcome-vault|outcome|future|ai\/run|fusion|reveal|score|scoring|baseline)(?:\/|$)/i;

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]]
]);

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()"
  };
}

function sendJson(response, status, payload, requestContext) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(status, securityHeaders());
  response.end(body);
  requestContext?.complete(status);
}

function sendStatic(response, fileName, contentType, requestContext) {
  const body = readFileSync(path.join(APP_ROOT, fileName));
  response.writeHead(200, {
    ...securityHeaders(contentType),
    "content-length": body.length
  });
  response.end(body);
  requestContext?.complete(200);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      throw new OperatorCaseR50Error("Request body exceeds 16 MiB.", {
        code: "BODY_TOO_LARGE",
        status: 413
      });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OperatorCaseR50Error("Request body is not valid JSON.", {
      code: "INVALID_JSON",
      status: 400
    });
  }
}

function methodNotAllowed(response, requestContext) {
  sendJson(response, 405, {
    error: "METHOD_NOT_ALLOWED",
    authority: R50_AUTHORITY
  }, requestContext);
}

function createRequestContext(request, logger) {
  const started = performance.now();
  const requestId = randomUUID();
  return {
    requestId,
    complete(status) {
      logger?.({
        request_id: requestId,
        method: request.method,
        path: new URL(request.url, "http://127.0.0.1").pathname,
        status,
        latency_ms: Number((performance.now() - started).toFixed(2))
      });
    }
  };
}

export function createOperatorServerR50({
  storeRoot,
  host = "127.0.0.1",
  logger = (record) => process.stdout.write(`${JSON.stringify(record)}\n`)
} = {}) {
  if (host !== "127.0.0.1") {
    throw new OperatorCaseR50Error(
      "R50 product runtime is loopback-only.",
      { code: "LOOPBACK_ONLY", status: 400 }
    );
  }
  storeRoot ||= path.join(
    process.env.TEMP || process.env.TMP || ".",
    "VisionAssist-R50-Operator"
  );
  const server = createServer(async (request, response) => {
    const context = createRequestContext(request, logger);
    response.setHeader("x-request-id", context.requestId);
    try {
      const url = new URL(request.url, `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (BLOCKED_API_PATTERN.test(pathname)) {
        sendJson(response, 403, {
          error: "PRODUCT_BOUNDARY_BLOCK",
          message:
            "Outcome vault, AI execution, fusion, baseline, reveal and scoring are inaccessible in this runtime.",
          authority: R50_AUTHORITY
        }, context);
        return;
      }

      if (pathname === "/api/status") {
        if (request.method !== "GET") return methodNotAllowed(response, context);
        sendJson(response, 200, {
          schema_version: "visionassist.product.runtime-status.r50.v1",
          product: "VisionAssist Operator Case Capture",
          runtime: "LOCAL_LOOPBACK_ONLY",
          profile: "FORWARD_LOCKED_FULL_CONTEXT",
          data_root: path.resolve(storeRoot),
          cases: listOperatorCasesR50(storeRoot),
          inaccessible: [
            "outcome-vault",
            "AI execution",
            "fusion",
            "baseline",
            "reveal",
            "scoring"
          ],
          authority: R50_AUTHORITY
        }, context);
        return;
      }

      if (pathname === "/api/cases") {
        if (request.method !== "GET") return methodNotAllowed(response, context);
        sendJson(response, 200, {
          cases: listOperatorCasesR50(storeRoot),
          authority: R50_AUTHORITY
        }, context);
        return;
      }

      const templateMatch = /^\/api\/cases\/(MKT-R50-00[1-3])\/template$/.exec(
        pathname
      );
      if (templateMatch) {
        if (request.method !== "GET") return methodNotAllowed(response, context);
        sendJson(response, 200, {
          template: createCaptureTemplateR50(storeRoot, templateMatch[1]),
          template_status: "INCOMPLETE_NOT_FREEZABLE",
          authority: R50_AUTHORITY
        }, context);
        return;
      }

      const caseMatch = /^\/api\/cases\/(MKT-R50-00[1-3])$/.exec(pathname);
      if (caseMatch) {
        if (request.method !== "GET") return methodNotAllowed(response, context);
        sendJson(
          response,
          200,
          getOperatorCaseStateR50(storeRoot, caseMatch[1]),
          context
        );
        return;
      }

      const startMatch = /^\/api\/cases\/(MKT-R50-00[1-3])\/start$/.exec(
        pathname
      );
      if (startMatch) {
        if (request.method !== "POST") return methodNotAllowed(response, context);
        const body = await readJsonBody(request);
        const slot = startOperatorCaseR50(
          storeRoot,
          startMatch[1],
          body.applicability ?? {}
        );
        sendJson(response, 201, { slot }, context);
        return;
      }

      const evidenceValidateMatch =
        /^\/api\/cases\/(MKT-R50-00[1-3])\/evidence\/validate$/.exec(pathname);
      if (evidenceValidateMatch) {
        if (request.method !== "POST") return methodNotAllowed(response, context);
        const body = await readJsonBody(request);
        try {
          const result = previewEvidenceR50(
            storeRoot,
            evidenceValidateMatch[1],
            body.capture
          );
          sendJson(response, 200, result, context);
        } catch (error) {
          if (!(error instanceof OperatorCaseR50Error)) throw error;
          sendJson(response, 200, {
            status: "FAIL",
            error: error.code,
            message: error.message,
            violations: error.violations,
            preview_only: true,
            authority: R50_AUTHORITY
          }, context);
        }
        return;
      }

      const evidenceFreezeMatch =
        /^\/api\/cases\/(MKT-R50-00[1-3])\/evidence\/freeze$/.exec(pathname);
      if (evidenceFreezeMatch) {
        if (request.method !== "POST") return methodNotAllowed(response, context);
        const body = await readJsonBody(request);
        const receipt = freezeEvidenceR50(
          storeRoot,
          evidenceFreezeMatch[1],
          body.capture
        );
        sendJson(response, 201, { receipt }, context);
        return;
      }

      const priorValidateMatch =
        /^\/api\/cases\/(MKT-R50-00[1-3])\/prior\/validate$/.exec(pathname);
      if (priorValidateMatch) {
        if (request.method !== "POST") return methodNotAllowed(response, context);
        const body = await readJsonBody(request);
        const violations = validateHumanPriorR50(body.prior);
        sendJson(response, 200, {
          status: violations.length > 0 ? "FAIL" : "PASS",
          violations,
          authority: R50_AUTHORITY
        }, context);
        return;
      }

      const priorFreezeMatch =
        /^\/api\/cases\/(MKT-R50-00[1-3])\/prior\/freeze$/.exec(pathname);
      if (priorFreezeMatch) {
        if (request.method !== "POST") return methodNotAllowed(response, context);
        const body = await readJsonBody(request);
        const receipt = freezeHumanPriorR50(
          storeRoot,
          priorFreezeMatch[1],
          body.prior
        );
        sendJson(response, 201, { receipt }, context);
        return;
      }

      const packetMatch =
        /^\/api\/cases\/(MKT-R50-00[1-3])\/ai-packet$/.exec(pathname);
      if (packetMatch) {
        if (request.method === "POST") {
          const receipt = exportAiRunnerPacketR50(storeRoot, packetMatch[1]);
          sendJson(response, 201, { receipt }, context);
          return;
        }
        if (request.method === "GET") {
          sendJson(
            response,
            200,
            readAiRunnerPacketR50(storeRoot, packetMatch[1]),
            context
          );
          return;
        }
        return methodNotAllowed(response, context);
      }

      const staticFile = STATIC_FILES.get(pathname);
      if (staticFile && request.method === "GET") {
        sendStatic(response, staticFile[0], staticFile[1], context);
        return;
      }
      sendJson(response, 404, {
        error: "NOT_FOUND",
        authority: R50_AUTHORITY
      }, context);
    } catch (error) {
      const known = error instanceof OperatorCaseR50Error;
      sendJson(response, known ? error.status : 500, {
        error: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "The local runtime failed safely.",
        violations: known ? error.violations : [],
        authority: R50_AUTHORITY
      }, context);
    }
  });
  return server;
}

function parseArguments(argv) {
  const result = {
    host: "127.0.0.1",
    port: 8790,
    storeRoot: process.env.VISIONASSIST_R50_DATA_DIR
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port") {
      result.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (argv[index] === "--data-dir") {
      result.storeRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--host") {
      result.host = argv[index + 1];
      index += 1;
    }
  }
  if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  result.storeRoot ||= path.join(
    process.env.TEMP || process.env.TMP || ".",
    "VisionAssist-R50-Operator"
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const server = createOperatorServerR50(options);
  server.listen(options.port, options.host, () => {
    process.stdout.write(
      `VISIONASSIST_R50_READY http://${options.host}:${options.port} data=${path.resolve(options.storeRoot)}\n`
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
