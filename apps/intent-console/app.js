const form = document.querySelector("#intent-form");
const imageInput = document.querySelector("#image-input");
const fileLabel = document.querySelector("#file-label");
const sourceIdInput = document.querySelector("#source-id");
const humanPresentInput = document.querySelector("#human-present");
const humanFields = document.querySelector("#human-fields");
const confidenceInput = document.querySelector("#operator-confidence");
const confidenceOutput = document.querySelector("#confidence-output");
const analyzeButton = document.querySelector("#analyze-button");
const validateSampleButton = document.querySelector("#validate-sample");
const runtimeStatus = document.querySelector("#runtime-status");
const resultContent = document.querySelector("#result-content");

sourceIdInput.value = `r26-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

humanPresentInput.addEventListener("change", () => {
  humanFields.disabled = !humanPresentInput.checked;
});

confidenceInput.addEventListener("input", () => {
  confidenceOutput.value = Number(confidenceInput.value).toFixed(2);
});

imageInput.addEventListener("change", () => {
  const [file] = imageInput.files;
  fileLabel.textContent = file
    ? `${file.name} · ${formatBytes(file.size)}`
    : "JPEG, PNG или WebP · до 10 МБ";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const [file] = imageInput.files;
  if (!file) {
    renderError("Выберите изображение.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    renderError("Файл больше 10 МБ.");
    return;
  }

  setBusy(true, "Анализирую визуальные свидетельства...");
  try {
    const image = await fileToBase64(file);
    const humanPresent = humanPresentInput.checked;
    const body = {
      image,
      image_mime_type: file.type || "image/jpeg",
      locale: document.querySelector("#locale").value,
      source: {
        source_id: sourceIdInput.value.trim(),
        modality: document.querySelector("#modality").value,
        captured_at: new Date().toISOString()
      },
      human_context: humanPresent
        ? {
            present: true,
            operator_goal: document.querySelector("#operator-goal").value.trim(),
            operator_prior: document.querySelector("#operator-prior").value.trim(),
            operator_confidence: Number(confidenceInput.value),
            notes_sha256: null
          }
        : {
            present: false
          }
    };

    const response = await fetch("/v1/intent/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await parseResponse(response);
    renderRecord(payload.record, payload.validation, response.headers.get("x-request-id"));
  } catch (error) {
    renderError(error.message);
  } finally {
    setBusy(false);
  }
});

validateSampleButton.addEventListener("click", async () => {
  setBusy(true, "Проверяю канонический пример...");
  try {
    const exampleResponse = await fetch("/v1/intent/example");
    const example = await parseResponse(exampleResponse);
    const validationResponse = await fetch("/v1/intent/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: example.record })
    });
    const validation = await parseResponse(validationResponse);
    renderRecord(
      example.record,
      validation,
      validationResponse.headers.get("x-request-id")
    );
  } catch (error) {
    renderError(error.message);
  } finally {
    setBusy(false);
  }
});

async function loadRuntime() {
  try {
    const response = await fetch("/v1/health");
    const health = await parseResponse(response);
    if (!health.capabilities?.intent) {
      throw new Error(`Intent отключён в профиле ${health.profile ?? "unknown"}.`);
    }
    runtimeStatus.textContent = `${health.profile} · ${health.models?.intent ?? "model not set"}`;
    runtimeStatus.className = "runtime-copy ready";
  } catch (error) {
    runtimeStatus.textContent = error.message;
    runtimeStatus.className = "runtime-copy error";
    analyzeButton.disabled = true;
  }
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.code || `HTTP ${response.status}`);
  }
  return payload;
}

function setBusy(isBusy, message) {
  analyzeButton.disabled = isBusy;
  validateSampleButton.disabled = isBusy;
  analyzeButton.textContent = isBusy ? "Обработка..." : "Разобрать изображение";
  if (isBusy && message) {
    resultContent.className = "empty-state";
    resultContent.replaceChildren(element("p", message));
  }
}

function renderRecord(record, validation, requestId) {
  resultContent.className = "result-stack";
  resultContent.replaceChildren();

  const summary = element("div", null, "result-summary");
  summary.append(
    element("strong", validation?.fusion_status || record.fusion_status),
    element(
      "span",
      `${validation?.hypothesis_count ?? record.intent_hypotheses.length} гипотез · request ${shortId(requestId)}`
    )
  );
  resultContent.append(summary);

  resultContent.append(
    recordSection(
      "Наблюдения",
      record.observations.map((observation) =>
        recordCard(
          observation.id,
          observation.description,
          `Evidence: ${observation.evidence_refs.join(", ")}`
        )
      )
    )
  );

  resultContent.append(
    recordSection(
      "Конкурирующие гипотезы",
      record.intent_hypotheses.map((hypothesis) => hypothesisCard(hypothesis))
    )
  );

  resultContent.append(
    listSection("Неопределённости", record.uncertainties),
    listSection("Альтернативные объяснения", record.alternative_explanations)
  );

  const permissions = element("div", null, "permission-strip");
  permissions.append(
    element("span", record.action_code),
    element("span", `EXECUTION ${record.execution_permission}`),
    element("span", `CAPITAL ${record.capital_permission}`)
  );
  resultContent.append(permissions);

  const details = document.createElement("details");
  details.append(
    element("summary", "Полная JSON-запись"),
    element("pre", JSON.stringify({ record, validation }, null, 2))
  );
  resultContent.append(details);
}

function recordSection(title, cards) {
  const section = element("section", null, "record-section");
  section.append(element("h3", title), ...cards);
  return section;
}

function listSection(title, items) {
  const list = document.createElement("ul");
  for (const item of items) {
    list.append(element("li", item));
  }
  const card = element("div", null, "record-card");
  card.append(list);
  return recordSection(title, [card]);
}

function recordCard(id, description, evidence) {
  const card = element("article", null, "record-card");
  const meta = element("div", null, "card-meta");
  meta.append(element("span", id), element("span", "OBSERVATION"));
  card.append(meta, element("p", description), element("small", evidence));
  return card;
}

function hypothesisCard(hypothesis) {
  const card = element("article", null, "record-card");
  const meta = element("div", null, "card-meta");
  meta.append(
    element("span", hypothesis.id),
    element("span", `Confidence ${hypothesis.confidence.toFixed(2)}`)
  );
  const track = element("progress", null, "confidence-track");
  track.max = 1;
  track.value = hypothesis.confidence;

  const evidence = document.createElement("ul");
  evidence.append(
    element("li", `Evidence: ${hypothesis.evidence_refs.join(", ")}`),
    element(
      "li",
      `Counterevidence: ${hypothesis.counterevidence_refs.join(", ") || "none recorded"}`
    ),
    element("li", `Invalidation: ${hypothesis.invalidation_conditions.join("; ")}`)
  );
  card.append(meta, element("p", hypothesis.description), track, evidence);
  return card;
}

function renderError(message) {
  resultContent.className = "error-card";
  resultContent.replaceChildren(
    element("strong", "Запись не создана"),
    element("p", message)
  );
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) {
    node.textContent = text;
  }
  if (className) {
    node.className = className;
  }
  return node;
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function shortId(value) {
  return value ? value.slice(0, 8) : "unknown";
}

loadRuntime();
