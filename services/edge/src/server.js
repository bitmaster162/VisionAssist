import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { validateIntentRecord } from "./intent-contract.js";
import {
  adaptIntentToMarketObservation,
  sha256Base64Image,
  validateMarketObservation
} from "./market-observation-contract.js";
import {
  createIntentRecord,
  createMarketDetectorReport,
  createOcrText,
  createRealtimeClientSecret,
  createSceneDescription
} from "./openai.js";

const intentConsoleAssets = new Map([
  ["/intent-r26", {
    url: new URL("../../../apps/intent-console/index.html", import.meta.url),
    contentType: "text/html; charset=utf-8"
  }],
  ["/intent-r26/", {
    url: new URL("../../../apps/intent-console/index.html", import.meta.url),
    contentType: "text/html; charset=utf-8"
  }],
  ["/intent-r26/styles.css", {
    url: new URL("../../../apps/intent-console/styles.css", import.meta.url),
    contentType: "text/css; charset=utf-8"
  }],
  ["/intent-r26/app.js", {
    url: new URL("../../../apps/intent-console/app.js", import.meta.url),
    contentType: "text/javascript; charset=utf-8"
  }]
]);
const intentExampleRecord = JSON.parse(
  readFileSync(
    new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url),
    "utf8"
  )
);

function sendJson(response, statusCode, payload, requestId) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id",
    ...(requestId ? { "X-Request-Id": requestId } : {})
  });
  response.end(body);
}

function sendIntentConsoleAsset(response, requestId, asset) {
  const body = readFileSync(asset.url);
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'self'",
      "img-src 'self' blob: data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId
  });
  response.end(body);
}

function notFound(response, requestId) {
  sendJson(response, 404, { error: "not_found" }, requestId);
}

function capabilityDisabled(response, requestId, capability) {
  sendJson(response, 404, {
    error: "capability_disabled",
    capability,
    profile: config.productProfile
  }, requestId);
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > config.maxRequestBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "payload_too_large";
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

function validateImage(payload) {
  if (!payload?.image || typeof payload.image !== "string") {
    const error = new Error("Field `image` must be a base64-encoded image string.");
    error.statusCode = 400;
    throw error;
  }
}

function validateIntentRecordPayload(payload) {
  if (!payload?.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
    const error = new Error("Field `record` must contain an intent record object.");
    error.statusCode = 400;
    error.code = "invalid_intent_input";
    throw error;
  }
}

function validateMarketObservationPayload(payload) {
  if (!payload?.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
    const error = new Error("Field `record` must contain a market observation object.");
    error.statusCode = 400;
    error.code = "invalid_market_input";
    throw error;
  }
}

function logDescribePilotEvent(event) {
  console.log(JSON.stringify({
    event: "describe_pilot",
    timestamp: new Date().toISOString(),
    profile: config.productProfile,
    ...event
  }));
}

function logIntentEvent(kind, event) {
  console.log(JSON.stringify({
    event: kind,
    timestamp: new Date().toISOString(),
    profile: config.productProfile,
    ...event
  }));
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();

  if (!request.url) {
    return notFound(response, requestId);
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": config.corsOrigin,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Expose-Headers": "X-Request-Id"
    });
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && intentConsoleAssets.has(request.url)) {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }
      return sendIntentConsoleAsset(
        response,
        requestId,
        intentConsoleAssets.get(request.url)
      );
    }

    if (request.method === "GET" && request.url === "/v1/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "visionassist-edge",
        profile: config.productProfile,
        capabilities: config.capabilities,
        models: {
          describe: config.capabilities.describe ? config.describeModel : null,
          intent: config.capabilities.intent ? config.intentModel : null,
          ocr: config.capabilities.ocr ? config.ocrModel : null,
          realtime: config.capabilities.realtime ? config.realtimeModel : null
        }
      }, requestId);
    }

    if (request.method === "GET" && request.url === "/v1/intent/example") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      return sendJson(response, 200, {
        record: intentExampleRecord,
        validation: validateIntentRecord(intentExampleRecord)
      }, requestId);
    }

    if (request.method === "POST" && request.url === "/v1/describe") {
      if (!config.capabilities.describe) {
        return capabilityDisabled(response, requestId, "describe");
      }

      const startedAt = performance.now();
      let statusCode = 200;

      try {
        const payload = await readJsonBody(request);
        validateImage(payload);
        const result = await createSceneDescription({
          imageBase64: payload.image,
          locale: payload.locale ?? "ru-RU"
        });

        logDescribePilotEvent({
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: statusCode,
          hazards_count: Array.isArray(result.hazards) ? result.hazards.length : 0,
          needs_human_review: result.needs_human_review === true,
          error: null
        });

        return sendJson(response, statusCode, result, requestId);
      } catch (error) {
        statusCode = error.statusCode ?? 500;
        logDescribePilotEvent({
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: statusCode,
          hazards_count: 0,
          needs_human_review: false,
          error: error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/intent/validate") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      const startedAt = performance.now();
      try {
        const payload = await readJsonBody(request);
        validateIntentRecordPayload(payload);
        const validation = validateIntentRecord(payload.record);

        logIntentEvent("intent_r26_validate", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: 200,
          fusion_status: validation.fusion_status,
          hypothesis_count: validation.hypothesis_count,
          error: null
        });
        return sendJson(response, 200, validation, requestId);
      } catch (error) {
        logIntentEvent("intent_r26_validate", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: error.statusCode ?? 500,
          fusion_status: null,
          hypothesis_count: 0,
          error: error.code ?? error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/intent/analyze") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      const startedAt = performance.now();
      try {
        const payload = await readJsonBody(request);
        validateImage(payload);
        const result = await createIntentRecord({
          imageBase64: payload.image,
          imageMimeType: payload.image_mime_type,
          source: payload.source,
          humanContext: payload.human_context,
          locale: payload.locale ?? "en-US"
        });

        logIntentEvent("intent_r26_analyze", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: 200,
          fusion_status: result.validation.fusion_status,
          hypothesis_count: result.validation.hypothesis_count,
          error: null
        });
        return sendJson(response, 200, result, requestId);
      } catch (error) {
        logIntentEvent("intent_r26_analyze", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: error.statusCode ?? 500,
          fusion_status: null,
          hypothesis_count: 0,
          error: error.code ?? error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/market/validate") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      const startedAt = performance.now();
      try {
        const payload = await readJsonBody(request);
        validateMarketObservationPayload(payload);
        const validation = validateMarketObservation(payload.record);

        logIntentEvent("market_observation_validate", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: 200,
          quality_status: validation.quality_status,
          observation_count: validation.observation_count,
          hypothesis_count: validation.hypothesis_count,
          error: null
        });
        return sendJson(response, 200, validation, requestId);
      } catch (error) {
        logIntentEvent("market_observation_validate", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: error.statusCode ?? 500,
          quality_status: null,
          observation_count: 0,
          hypothesis_count: 0,
          error: error.code ?? error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/market/detect") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      const startedAt = performance.now();
      try {
        const payload = await readJsonBody(request);
        validateImage(payload);
        validateMarketObservationPayload(payload);
        const marketValidation = validateMarketObservation(payload.record);
        const imageSha256 = sha256Base64Image(payload.image);
        if (imageSha256 !== payload.record.source.image_sha256) {
          const error = new Error("image does not match market observation source binding");
          error.statusCode = 422;
          error.code = "detector_source_binding_mismatch";
          throw error;
        }

        const result = await createMarketDetectorReport({
          imageBase64: payload.image,
          imageMimeType: payload.image_mime_type,
          marketObservation: payload.record,
          locale: payload.locale ?? "en-US"
        });

        logIntentEvent("market_structure_detect", {
          request_id: requestId,
          source_market_request_id: payload.record.request_id,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: 200,
          market_quality_status: marketValidation.quality_status,
          detector_quality_status: result.validation.quality_status,
          detector_count: result.validation.detector_count,
          raw_image_persisted: false,
          error: null
        });
        return sendJson(response, 200, result, requestId);
      } catch (error) {
        logIntentEvent("market_structure_detect", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: error.statusCode ?? 500,
          detector_quality_status: null,
          detector_count: 0,
          raw_image_persisted: false,
          error: error.code ?? error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/market/observe") {
      if (!config.capabilities.intent) {
        return capabilityDisabled(response, requestId, "intent");
      }

      const startedAt = performance.now();
      try {
        const payload = await readJsonBody(request);
        validateImage(payload);
        const result = await createIntentRecord({
          imageBase64: payload.image,
          imageMimeType: payload.image_mime_type,
          source: payload.source,
          humanContext: payload.human_context,
          locale: payload.locale ?? "en-US"
        });
        const record = adaptIntentToMarketObservation(result.record, {
          requestId,
          imageSha256: sha256Base64Image(payload.image),
          marketContext: payload.market_context
        });
        const validation = validateMarketObservation(record);

        logIntentEvent("market_observation_observe", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: 200,
          quality_status: validation.quality_status,
          observation_count: validation.observation_count,
          hypothesis_count: validation.hypothesis_count,
          raw_image_persisted: false,
          error: null
        });
        return sendJson(response, 200, { record, validation }, requestId);
      } catch (error) {
        logIntentEvent("market_observation_observe", {
          request_id: requestId,
          latency_ms: Math.round(performance.now() - startedAt),
          status_code: error.statusCode ?? 500,
          quality_status: null,
          observation_count: 0,
          hypothesis_count: 0,
          raw_image_persisted: false,
          error: error.code ?? error.message ?? "internal_error"
        });
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/v1/ocr") {
      if (!config.capabilities.ocr) {
        return capabilityDisabled(response, requestId, "ocr");
      }

      const payload = await readJsonBody(request);
      validateImage(payload);
      const result = await createOcrText({
        imageBase64: payload.image,
        locale: payload.locale ?? "ru-RU"
      });
      return sendJson(response, 200, result, requestId);
    }

    if (
      request.method === "POST" &&
      (request.url === "/v1/realtime/client-secret" || request.url === "/v1/realtime-session")
    ) {
      if (!config.capabilities.realtime) {
        return capabilityDisabled(response, requestId, "realtime");
      }

      const payload = await readJsonBody(request);
      const result = await createRealtimeClientSecret({
        model: payload.model,
        voice: payload.voice
      });
      return sendJson(response, 200, result, requestId);
    }

    return notFound(response, requestId);
  } catch (error) {
    return sendJson(response, error.statusCode ?? 500, {
      code: error.code ?? "request_failed",
      error: error.message ?? "internal_error",
      details: error.details ?? undefined
    }, requestId);
  }
});

server.listen(config.port, config.listenHost, () => {
  console.log(
    `VisionAssist edge listening on http://${config.listenHost}:${config.port} (profile=${config.productProfile})`
  );
});
