const state = {
  activeCase: "MKT-R50-001",
  cases: [],
  captureTemplate: null
};

const elements = {
  runtime: document.querySelector("#runtime-state"),
  caseList: document.querySelector("#case-list"),
  activeCase: document.querySelector("#active-case"),
  activePhase: document.querySelector("#active-phase"),
  startPanel: document.querySelector("#start-panel"),
  evidencePanel: document.querySelector("#evidence-panel"),
  priorPanel: document.querySelector("#prior-panel"),
  exportPanel: document.querySelector("#export-panel"),
  startStatus: document.querySelector("#start-status"),
  evidenceStatus: document.querySelector("#evidence-status"),
  priorStatus: document.querySelector("#prior-status"),
  exportStatus: document.querySelector("#export-status"),
  captureJson: document.querySelector("#capture-json"),
  evidenceResult: document.querySelector("#evidence-result"),
  priorResult: document.querySelector("#prior-result"),
  exportResult: document.querySelector("#export-result")
};

document.querySelector("#open-slot").addEventListener("click", openSlot);
document.querySelector("#load-template").addEventListener("click", loadTemplate);
document.querySelector("#download-template").addEventListener("click", downloadTemplate);
document.querySelector("#capture-file").addEventListener("change", loadCaptureFile);
document.querySelector("#capture-json").addEventListener("input", updateEvidenceMeter);
document.querySelector("#validate-evidence").addEventListener("click", validateEvidence);
document.querySelector("#freeze-evidence").addEventListener("click", freezeEvidence);
document.querySelector("#validate-prior").addEventListener("click", validatePrior);
document.querySelector("#freeze-prior").addEventListener("click", freezePrior);
document.querySelector("#export-packet").addEventListener("click", exportPacket);
document.querySelector("#prior-confidence").addEventListener("input", (event) => {
  document.querySelector("#confidence-output").value =
    Number(event.target.value).toFixed(2);
});
document.querySelector("#abstain").addEventListener("change", (event) => {
  document.querySelector("#abstain-fields").hidden = !event.target.checked;
  for (const id of ["prob-up", "prob-down", "prob-range"]) {
    document.querySelector(`#${id}`).disabled = event.target.checked;
  }
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function refresh() {
  try {
    const status = await api("/api/status");
    state.cases = status.cases;
    elements.runtime.textContent = `${status.runtime} · ${status.profile}`;
    elements.runtime.className = "runtime-state ready";
    renderCases();
    renderActiveCase();
  } catch (error) {
    elements.runtime.textContent = error.message;
    elements.runtime.className = "runtime-state error";
  }
}

function renderCases() {
  elements.caseList.replaceChildren();
  for (const item of state.cases) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `case-button${item.case_id === state.activeCase ? " active" : ""}`;
    button.dataset.caseId = item.case_id;
    const id = document.createElement("strong");
    id.textContent = item.case_id;
    const phase = document.createElement("span");
    phase.textContent = item.phase;
    button.append(id, phase);
    button.addEventListener("click", () => {
      state.activeCase = item.case_id;
      state.captureTemplate = null;
      elements.captureJson.value = "";
      renderCases();
      renderActiveCase();
    });
    elements.caseList.append(button);
  }
}

function currentCase() {
  return state.cases.find((item) => item.case_id === state.activeCase) || {
    case_id: state.activeCase,
    phase: "EMPTY"
  };
}

function phaseAtLeast(phase, target) {
  const order = [
    "EMPTY",
    "CAPTURE_OPEN",
    "EVIDENCE_FROZEN",
    "HUMAN_PRIOR_FROZEN",
    "AI_PACKET_EXPORTED"
  ];
  return order.indexOf(phase) >= order.indexOf(target);
}

function renderActiveCase() {
  const item = currentCase();
  elements.activeCase.textContent = item.case_id;
  elements.activePhase.textContent = item.phase;
  elements.activePhase.dataset.phase = item.phase;

  const opened = phaseAtLeast(item.phase, "CAPTURE_OPEN");
  const evidenceFrozen = phaseAtLeast(item.phase, "EVIDENCE_FROZEN");
  const priorFrozen = phaseAtLeast(item.phase, "HUMAN_PRIOR_FROZEN");
  const packetExported = phaseAtLeast(item.phase, "AI_PACKET_EXPORTED");

  setLocked(elements.startPanel, opened);
  document.querySelector("#open-slot").disabled = opened;
  document.querySelector("#derivatives-applicable").disabled = opened;
  document.querySelector("#token-applicable").disabled = opened;
  elements.startStatus.textContent = opened ? "Матрица frozen" : "Ожидает";

  setLocked(elements.evidencePanel, !opened);
  elements.evidenceStatus.textContent = evidenceFrozen
    ? "EVIDENCE_FROZEN"
    : opened ? "Готов к вводу" : "Заблокирован";
  document.querySelector("#freeze-evidence").disabled = !opened || evidenceFrozen;
  document.querySelector("#validate-evidence").disabled = !opened || evidenceFrozen;

  setLocked(elements.priorPanel, !evidenceFrozen);
  elements.priorStatus.textContent = priorFrozen
    ? "HUMAN_PRIOR_FROZEN"
    : evidenceFrozen ? "Окно prior открыто" : "Заблокирован";
  document.querySelector("#freeze-prior").disabled = !evidenceFrozen || priorFrozen;
  document.querySelector("#validate-prior").disabled = !evidenceFrozen || priorFrozen;

  setLocked(elements.exportPanel, !priorFrozen);
  elements.exportStatus.textContent = packetExported
    ? "PACKET EXPORTED"
    : priorFrozen ? "Готов к экспорту" : "Заблокирован";
  document.querySelector("#export-packet").disabled = !priorFrozen;
}

function setLocked(panel, locked) {
  panel.classList.toggle("is-locked", locked);
}

async function openSlot() {
  setResult(elements.evidenceResult, "Открываю слот...", "neutral");
  try {
    await api(`/api/cases/${state.activeCase}/start`, {
      method: "POST",
      body: JSON.stringify({
        applicability: {
          derivatives: document.querySelector("#derivatives-applicable").checked,
          token_metrics: document.querySelector("#token-applicable").checked,
          event_search: true
        }
      })
    });
    await refresh();
    await loadTemplate();
    setResult(
      elements.evidenceResult,
      "Слот открыт. Матрица применимости зафиксирована.",
      "pass"
    );
  } catch (error) {
    renderApiError(elements.evidenceResult, error);
  }
}

async function loadTemplate() {
  try {
    const payload = await api(`/api/cases/${state.activeCase}/template`);
    state.captureTemplate = payload.template;
    elements.captureJson.value = JSON.stringify(payload.template, null, 2);
    updateEvidenceMeter();
  } catch (error) {
    renderApiError(elements.evidenceResult, error);
  }
}

function downloadTemplate() {
  const text = elements.captureJson.value.trim();
  if (!text) {
    setResult(elements.evidenceResult, "Сначала получите пустой шаблон.", "fail");
    return;
  }
  downloadJson(`${state.activeCase}-capture-input.json`, JSON.parse(text));
}

async function loadCaptureFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  elements.captureJson.value = await file.text();
  updateEvidenceMeter();
}

function parsedCapture() {
  try {
    return JSON.parse(elements.captureJson.value);
  } catch {
    throw new Error("Capture input содержит невалидный JSON.");
  }
}

function updateEvidenceMeter() {
  let capture;
  try {
    capture = parsedCapture();
  } catch {
    setText("#timeline-meter", "JSON error");
    setText("#ohlcv-meter", "0 rows");
    setText("#derivatives-meter", "—");
    setText("#events-meter", "0 / 0");
    return;
  }
  const timeline = [capture.cutoff_at, capture.prior_deadline, capture.horizon_start_at]
    .every(Boolean);
  setText("#timeline-meter", timeline ? "3 timestamps" : "incomplete");
  setText("#ohlcv-meter", `${capture.ohlcv_rows?.length || 0} rows`);
  setText(
    "#derivatives-meter",
    capture.derivatives?.applicable === true
      ? (Number.isFinite(capture.derivatives.open_interest) ? "OI present" : "OI missing")
      : capture.derivatives?.applicable === false ? "N/A declared" : "—"
  );
  setText(
    "#events-meter",
    `${capture.event_search?.articles?.length || 0} / ${capture.event_search?.scheduled_events?.length || 0}`
  );
}

async function validateEvidence() {
  await evidenceAction("validate");
}

async function freezeEvidence() {
  await evidenceAction("freeze");
}

async function evidenceAction(action) {
  setResult(elements.evidenceResult, "Проверяю chronology, hashes и context...", "neutral");
  try {
    const capture = parsedCapture();
    const payload = await api(
      `/api/cases/${state.activeCase}/evidence/${action}`,
      {
        method: "POST",
        body: JSON.stringify({ capture })
      }
    );
    if (payload.status === "FAIL") {
      renderViolations(elements.evidenceResult, payload.violations);
      return;
    }
    const receipt = payload.receipt || payload;
    setResult(
      elements.evidenceResult,
      action === "freeze"
        ? `EVIDENCE_FROZEN · ${shortHash(receipt.receipt_sha256 || receipt.receipt?.canonical_bundle_sha256)}`
        : "PASS · комплект можно заморозить.",
      "pass"
    );
    if (action === "freeze") await refresh();
  } catch (error) {
    renderApiError(elements.evidenceResult, error);
  }
}

function humanPriorPayload() {
  const hypotheses = [...document.querySelectorAll("[data-hypothesis]")].map(
    (fieldset) => Object.fromEntries(
      [...fieldset.querySelectorAll("[data-field]")].map((input) => [
        input.dataset.field,
        input.value
      ])
    )
  );
  const abstain = document.querySelector("#abstain").checked;
  return {
    interpretation: document.querySelector("#interpretation").value,
    competing_hypotheses: hypotheses,
    outcome_forecast: abstain
      ? {
          abstain: true,
          probabilities: null,
          abstention_reason_code: document.querySelector("#abstention-code").value,
          abstention_reason: document.querySelector("#abstention-reason").value
        }
      : {
          abstain: false,
          probabilities: {
            up: Number(document.querySelector("#prob-up").value),
            down: Number(document.querySelector("#prob-down").value),
            range: Number(document.querySelector("#prob-range").value)
          },
          abstention_reason_code: null,
          abstention_reason: null
        },
    confidence: Number(document.querySelector("#prior-confidence").value),
    outcome_unseen_attestation: document.querySelector("#outcome-unseen").checked,
    ai_unseen_attestation: document.querySelector("#ai-unseen").checked
  };
}

async function validatePrior() {
  await priorAction("validate");
}

async function freezePrior() {
  await priorAction("freeze");
}

async function priorAction(action) {
  setResult(elements.priorResult, "Проверяю human prior...", "neutral");
  try {
    const payload = await api(`/api/cases/${state.activeCase}/prior/${action}`, {
      method: "POST",
      body: JSON.stringify({ prior: humanPriorPayload() })
    });
    if (payload.status === "FAIL") {
      renderViolations(elements.priorResult, payload.violations);
      return;
    }
    const receipt = payload.receipt;
    setResult(
      elements.priorResult,
      action === "freeze"
        ? `HUMAN_PRIOR_FROZEN · ${shortHash(receipt.chain_sha256)}`
        : "PASS · prior заполнен и готов к freeze.",
      "pass"
    );
    if (action === "freeze") await refresh();
  } catch (error) {
    renderApiError(elements.priorResult, error);
  }
}

async function exportPacket() {
  setResult(elements.exportResult, "Формирую отделённый packet...", "neutral");
  try {
    const payload = await api(`/api/cases/${state.activeCase}/ai-packet`, {
      method: "POST",
      body: "{}"
    });
    const packet = await api(`/api/cases/${state.activeCase}/ai-packet`);
    downloadJson(`${state.activeCase}-ai-runner-packet.json`, packet);
    setResult(
      elements.exportResult,
      `PACKET EXPORTED · prior excluded · ${shortHash(payload.receipt.packet_sha256)}`,
      "pass"
    );
    await refresh();
  } catch (error) {
    renderApiError(elements.exportResult, error);
  }
}

function renderApiError(target, error) {
  const violations = error.payload?.violations || [];
  if (violations.length === 0) {
    setResult(target, error.message, "fail");
    return;
  }
  renderViolations(target, violations);
}

function renderViolations(target, violations) {
  target.className = "result-card fail";
  target.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = `${violations.length} блокирующих пунктов`;
  const list = document.createElement("ol");
  for (const violation of violations.slice(0, 50)) {
    const item = document.createElement("li");
    const path = document.createElement("code");
    path.textContent = violation.path;
    item.append(path, document.createTextNode(` — ${violation.message}`));
    list.append(item);
  }
  target.append(heading, list);
}

function setResult(target, message, status) {
  target.className = `result-card ${status}`;
  target.textContent = message;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function shortHash(value) {
  return value ? value.slice(0, 12) : "receipt ready";
}

function downloadJson(fileName, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

refresh();
