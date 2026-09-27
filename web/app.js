const PARTS = [
  { id: "box", title: "Короб" },
  { id: "curtain", title: "Полотно" },
  { id: "guide_left", title: "Левая направляющая" },
  { id: "guide_right", title: "Правая направляющая" },
  { id: "shaft", title: "Вал" },
  { id: "drive", title: "Привод" },
  { id: "end_profile", title: "Концевой профиль" },
  { id: "covers", title: "Крышки" },
];

const state = {
  unitLabels: { 0: "ед. 0", 2: "ед. 2", 3: "ед. 3", 4: "ед. 4" },
  prefixes: {
    box: "SB",
    curtain: "AR",
    guide_left: "GR",
    guide_right: "GR",
    shaft: "RT",
    drive: "AM",
    end_profile: "ES",
    covers: "SF",
  },
  priceLists: [],
  activePriceListId: null,
  estimate: null,
  dirty: false,
  selectedKey: null,
  selectedPart: null,
  tab: "estimate",
  search: { rows: [], total: 0, offset: 0, selectedId: null },
  price: { rows: [], total: 0, offset: 0 },
  openRows: [],
  openSelected: null,
};

let started = false;
let filling = false;
let busy = false;
let lineSeq = 1;
let searchToken = 0;
let priceToken = 0;
let searchTimer = 0;
let priceTimer = 0;
let askResolve = null;
let priceLoaded = false;

let scene3d = null;
let camera = null;
let renderer = null;
let raycaster = null;
let cabinet = null;
let view = null;
let loopOn = false;
const drag = { on: false, x: 0, y: 0, moved: false };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function call(name) {
  const args = Array.prototype.slice.call(arguments, 1);
  try {
    const result = await window.pywebview.api[name].apply(null, args);
    if (!result || result.ok === false) {
      const message = (result && result.error) || "Ошибка";
      setStatus(message);
      return result || { ok: false, error: message };
    }
    return result;
  } catch (err) {
    const message = (err && (err.message || String(err))) || "Ошибка";
    setStatus(message);
    return { ok: false, error: message };
  }
}

function newKey() {
  lineSeq += 1;
  return "k" + lineSeq;
}

function hydrate(estimate) {
  return {
    id: estimate.id == null ? null : estimate.id,
    number: estimate.number || "",
    date: estimate.date || "",
    client: estimate.client || "",
    object_name: estimate.object_name || "",
    comment: estimate.comment || "",
    order_discount: estimate.order_discount || "0",
    lines: (estimate.lines || []).map(function (line) {
      return {
        key: newKey(),
        code: line.code || "",
        name: line.name || "",
        color: line.color || "",
        unit: line.unit === undefined ? null : line.unit,
        width_mm: line.width_mm || "",
        height_mm: line.height_mm || "",
        qty: line.qty || "0",
        price: line.price || "0.00",
        discount: line.discount || "0",
      };
    }),
  };
}

function unitLabel(unit) {
  if (unit === null || unit === undefined || unit === "") return "—";
  const key = String(unit);
  return state.unitLabels[key] || "ед. " + key;
}

function displayNumber(value) {
  if (value == null || value === "") return "";
  return String(value).replace(".", ",");
}

function ruDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return iso || "";
  return match[3] + "." + match[2] + "." + match[1];
}

function stripTrailingSep(value) {
  return String(value).trim().replace(/[.,]$/, "");
}

function normalizeField(field, value) {
  if (field === "qty") return RollMoney.normalizeQty(value);
  if (field === "price") return RollMoney.normalizeMoney(value);
  if (field === "discount" || field === "order_discount") return RollMoney.normalizeDiscount(value);
  if (field === "width_mm" || field === "height_mm") return RollMoney.normalizeMeasure(value);
  return value;
}

function lineByKey(key) {
  return state.estimate.lines.find(function (line) { return line.key === key; });
}

function activeList() {
  return state.priceLists.find(function (item) { return item.id === state.activePriceListId; }) || null;
}

function renderActiveLabel() {
  const list = activeList();
  document.getElementById("active-price").textContent = list ? "Активный прайс: " + list.name : "Прайс не выбран";
  const hint = document.getElementById("price-active-hint");
  hint.textContent = list
    ? "В новую строку сметы берётся активный прайс: " + list.name + ". Здесь можно смотреть и править любой загруженный файл."
    : "Активный прайс не выбран. Импортируйте xlsx ПГИ.";
}

function updateSaveLabel() {
  document.getElementById("btn-save").textContent = state.dirty ? "Сохранить *" : "Сохранить";
}

function fillSelect(select, selectedId) {
  select.innerHTML = state.priceLists.map(function (item) {
    const mark = item.id === state.activePriceListId ? " · активный" : "";
    return '<option value="' + item.id + '">' + esc(item.name) + " (" + item.item_count + ")" + mark + "</option>";
  }).join("");
  if (selectedId) select.value = String(selectedId);
}

function paintActivateButton() {
  const id = Number(document.getElementById("price-select").value);
  const button = document.getElementById("btn-activate");
  const active = id && id === state.activePriceListId;
  button.disabled = !id || active;
  button.textContent = active ? "Активный" : "Сделать активным";
}

function refreshSelects() {
  const priceId = Number(document.getElementById("price-select").value) || state.activePriceListId;
  const settingsId = Number(document.getElementById("settings-active").value) || state.activePriceListId;
  fillSelect(document.getElementById("price-select"), priceId);
  fillSelect(document.getElementById("settings-active"), settingsId);
  paintActivateButton();
}

function renderSettingsForm() {
  document.getElementById("unit-fields").innerHTML = [0, 2, 3, 4].map(function (code) {
    return '<label class="field">Единица ' + code +
      '<input id="unit-' + code + '" data-unit="' + code + '" maxlength="40" value="' +
      esc(state.unitLabels[String(code)] || state.unitLabels[code] || "") + '"></label>';
  }).join("");
  document.getElementById("prefix-fields").innerHTML = PARTS.map(function (part) {
    return '<label class="field">' + esc(part.title) +
      '<input id="prefix-' + part.id + '" data-part="' + part.id + '" maxlength="40" value="' +
      esc(state.prefixes[part.id] || "") + '"></label>';
  }).join("");
  fillSelect(document.getElementById("settings-active"), state.activePriceListId);
}

function renderLegend() {
  document.getElementById("legend").innerHTML = PARTS.map(function (part) {
    const active = state.selectedPart === part.id ? " active" : "";
    return '<button type="button" data-part="' + part.id + '" class="' + active + '">' +
      esc(part.title) + "<small>" + esc(state.prefixes[part.id] || "—") + "</small></button>";
  }).join("");
}

function paintHint() {
  const hint = document.getElementById("view3d-hint");
  const part = PARTS.find(function (item) { return item.id === state.selectedPart; });
  if (!part) {
    hint.textContent = "Левая кнопка — вращение, колесо — масштаб, клик — поиск группы.";
    return;
  }
  const prefix = state.prefixes[part.id] || "без группы";
  hint.textContent = part.title + " · поиск «" + prefix + "». Клик открывает прайс и сам артикул не ставит.";
}

function updateTotals() {
  let sum = 0n;
  for (const line of state.estimate.lines) {
    sum += RollMoney.lineSumCents(line.qty, line.price, line.discount);
  }
  const total = RollMoney.orderTotalCents(sum, state.estimate.order_discount);
  document.getElementById("sum-lines").textContent = RollMoney.formatGrouped(sum);
  document.getElementById("sum-total").textContent = RollMoney.formatGrouped(total);
}

function paintLineSum(line) {
  const cell = document.querySelector('#estimate-body tr[data-key="' + line.key + '"] .sum');
  if (cell) cell.textContent = RollMoney.formatGrouped(RollMoney.lineSumCents(line.qty, line.price, line.discount));
}

function paintSelection() {
  document.querySelectorAll("#estimate-body tr").forEach(function (row) {
    row.classList.toggle("selected", row.dataset.key === state.selectedKey);
  });
}

function renderLines() {
  const body = document.getElementById("estimate-body");
  if (!state.estimate.lines.length) {
    body.innerHTML = '<tr class="empty"><td colspan="12">В смете нет позиций. Кликните деталь на модели или нажмите «Добавить позицию».</td></tr>';
    return;
  }
  body.innerHTML = state.estimate.lines.map(function (line, index) {
    const selected = line.key === state.selectedKey ? " selected" : "";
    return '<tr data-key="' + line.key + '" class="' + selected + '">' +
      "<td>" + (index + 1) + "</td>" +
      "<td>" + esc(line.code) + "</td>" +
      '<td class="name" title="' + esc(line.name) + '">' + esc(line.name) + "</td>" +
      "<td>" + esc(line.color) + "</td>" +
      "<td>" + esc(unitLabel(line.unit)) + "</td>" +
      '<td><input data-field="width_mm" inputmode="decimal" value="' + esc(displayNumber(line.width_mm)) + '"></td>' +
      '<td><input data-field="height_mm" inputmode="decimal" value="' + esc(displayNumber(line.height_mm)) + '"></td>' +
      '<td><input data-field="qty" inputmode="decimal" value="' + esc(displayNumber(line.qty)) + '"></td>' +
      '<td><input data-field="price" inputmode="decimal" value="' + esc(displayNumber(line.price)) + '"></td>' +
      '<td><input data-field="discount" inputmode="decimal" value="' + esc(displayNumber(line.discount)) + '"></td>' +
      '<td class="num sum">' + esc(RollMoney.formatGrouped(RollMoney.lineSumCents(line.qty, line.price, line.discount))) + "</td>" +
      '<td><button type="button" class="icon-x" data-delete="1" aria-label="Удалить строку">×</button></td>' +
      "</tr>";
  }).join("");
}

function renderEstimate() {
  filling = true;
  const estimate = state.estimate;
  document.getElementById("f-number").value = estimate.number;
  document.getElementById("f-date").value = estimate.date;
  document.getElementById("f-client").value = estimate.client;
  document.getElementById("f-object").value = estimate.object_name;
  document.getElementById("f-comment").value = estimate.comment;
  document.getElementById("f-order-discount").value = displayNumber(estimate.order_discount);
  renderLines();
  filling = false;
  updateTotals();
  updateSaveLabel();
}

function liveHeader(input) {
  if (filling || !state.estimate) return;
  const field = input.dataset.header;
  if (field === "order_discount") {
    const norm = RollMoney.normalizeDiscount(stripTrailingSep(input.value));
    if (norm === null || state.estimate.order_discount === norm) return;
    state.estimate.order_discount = norm;
    state.dirty = true;
    updateTotals();
    updateSaveLabel();
    return;
  }
  if (state.estimate[field] !== input.value) {
    state.estimate[field] = input.value;
    state.dirty = true;
    updateSaveLabel();
  }
}

function commitHeader(input) {
  if (!state.estimate) return;
  const field = input.dataset.header;
  if (field === "order_discount") {
    const norm = RollMoney.normalizeDiscount(input.value);
    if (norm === null) {
      input.value = displayNumber(state.estimate.order_discount);
      return;
    }
    state.estimate.order_discount = norm;
    input.value = displayNumber(norm);
    updateTotals();
    return;
  }
  state.estimate[field] = input.value;
}

function liveLine(input) {
  if (filling) return;
  const line = lineByKey(input.closest("tr").dataset.key);
  if (!line) return;
  const field = input.dataset.field;
  const norm = normalizeField(field, stripTrailingSep(input.value));
  if (norm === null || line[field] === norm) return;
  line[field] = norm;
  state.dirty = true;
  paintLineSum(line);
  updateTotals();
  updateSaveLabel();
}

function commitLine(input) {
  const line = lineByKey(input.closest("tr").dataset.key);
  if (!line) return;
  const field = input.dataset.field;
  const norm = normalizeField(field, input.value);
  if (norm === null) {
    input.value = displayField(field, line[field]);
    return;
  }
  if (line[field] !== norm) {
    line[field] = norm;
    state.dirty = true;
    updateSaveLabel();
  }
  input.value = displayField(field, norm);
  paintLineSum(line);
  updateTotals();
}

function displayField(field, value) {
  if (field === "width_mm" || field === "height_mm") return displayNumber(value);
  return displayNumber(value);
}

function commitAllFields() {
  document.querySelectorAll("#view-estimate input[data-header]").forEach(commitHeader);
  document.querySelectorAll("#estimate-body input[data-field]").forEach(commitLine);
}

function payloadFromState() {
  commitAllFields();
  const estimate = state.estimate;
  return {
    id: estimate.id,
    number: estimate.number,
    date: estimate.date,
    client: estimate.client,
    object_name: estimate.object_name,
    comment: estimate.comment,
    order_discount: estimate.order_discount,
    lines: estimate.lines.map(function (line) {
      return {
        code: line.code,
        name: line.name,
        color: line.color,
        unit: line.unit,
        width_mm: line.width_mm,
        height_mm: line.height_mm,
        qty: line.qty,
        price: line.price,
        discount: line.discount,
      };
    }),
  };
}

function deleteSelected() {
  if (!state.selectedKey || !state.estimate) return;
  const index = state.estimate.lines.findIndex(function (line) { return line.key === state.selectedKey; });
  if (index < 0) return;
  state.estimate.lines.splice(index, 1);
  const next = state.estimate.lines[index] || state.estimate.lines[index - 1];
  state.selectedKey = next ? next.key : null;
  state.dirty = true;
  renderLines();
  updateTotals();
  updateSaveLabel();
  setStatus("Строка удалена");
}

async function saveEstimate() {
  if (!state.estimate || busy) return;
  busy = true;
  try {
    const res = await call("save_estimate", payloadFromState());
    if (!res.ok) return;
    state.estimate = hydrate(res.estimate);
    state.selectedKey = null;
    state.dirty = false;
    renderEstimate();
    setStatus("Смета сохранена");
  } finally {
    busy = false;
  }
}

async function newEstimate() {
  if (state.dirty) {
    const ok = await ask("Новая смета", "Текущая смета не сохранена. Создать новую?", "Создать");
    if (!ok) return;
  }
  const res = await call("next_estimate_defaults");
  if (!res.ok) return;
  state.estimate = hydrate(res.estimate);
  state.selectedKey = null;
  state.dirty = false;
  renderEstimate();
  setStatus("Новая смета");
}

function duplicateEstimate() {
  commitAllFields();
  const source = state.estimate;
  state.estimate = {
    id: null,
    number: source.number ? source.number + " копия" : "копия",
    date: source.date,
    client: source.client,
    object_name: source.object_name,
    comment: source.comment,
    order_discount: source.order_discount,
    lines: source.lines.map(function (line) {
      return Object.assign({}, line, { key: newKey() });
    }),
  };
  state.selectedKey = null;
  state.dirty = true;
  renderEstimate();
  setStatus("Создана копия. Сохраните, чтобы записать её отдельно.");
}

async function exportEstimate() {
  if (busy) return;
  busy = true;
  try {
    const res = await call("export_estimate_dialog", payloadFromState());
    if (!res.ok || res.cancelled) return;
    setStatus("Смета записана: " + res.path);
  } finally {
    busy = false;
  }
}

function ask(title, text, okLabel) {
  return new Promise(function (resolve) {
    if (askResolve) askResolve(false);
    askResolve = resolve;
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-text").textContent = text;
    document.getElementById("confirm-ok").textContent = okLabel || "Да";
    document.getElementById("confirm").hidden = false;
    document.getElementById("confirm-ok").focus();
  });
}

function closeAsk(value) {
  document.getElementById("confirm").hidden = true;
  const resolve = askResolve;
  askResolve = null;
  if (resolve) resolve(value);
}

function closeSearch() {
  document.getElementById("search-modal").hidden = true;
}

function closeOpen() {
  document.getElementById("open-modal").hidden = true;
}

function renderSearchRows(append) {
  const body = document.getElementById("search-body");
  const html = state.search.rows.map(function (item) {
    const selected = item.id === state.search.selectedId ? " selected" : "";
    return '<tr data-id="' + item.id + '" class="' + selected + '">' +
      "<td>" + esc(item.code) + "</td>" +
      '<td class="name" title="' + esc(item.name) + '">' + esc(item.name) + "</td>" +
      "<td>" + esc(item.color) + "</td>" +
      "<td>" + esc(unitLabel(item.unit)) + "</td>" +
      '<td class="num">' + esc(displayNumber(item.price)) + "</td></tr>";
  }).join("");
  if (append) body.insertAdjacentHTML("beforeend", html);
  else body.innerHTML = html || '<tr class="empty"><td colspan="5">Ничего не найдено</td></tr>';
  const shown = body.querySelectorAll("tr[data-id]").length;
  document.getElementById("search-meta").textContent = state.search.total
    ? "Показаны " + shown + " из " + state.search.total
    : "Ничего не найдено";
  document.getElementById("search-more").hidden = shown >= state.search.total;
}

async function runSearch(reset) {
  if (!state.activePriceListId) {
    state.search.rows = [];
    state.search.total = 0;
    document.getElementById("search-body").innerHTML = '<tr class="empty"><td colspan="5">Нет активного прайса.</td></tr>';
    document.getElementById("search-meta").textContent = "Импортируйте xlsx на экране «Прайс».";
    document.getElementById("search-more").hidden = true;
    return;
  }
  const token = ++searchToken;
  if (reset) state.search.offset = 0;
  const res = await call("search_items", {
    price_list_id: state.activePriceListId,
    query: document.getElementById("search-query").value,
    prefix: document.getElementById("search-prefix").value,
    show_zero: document.getElementById("search-zero").checked,
    offset: state.search.offset,
    limit: 200,
  });
  if (token !== searchToken || !res.ok) return;
  if (reset) state.search.rows = res.rows;
  else state.search.rows = state.search.rows.concat(res.rows);
  state.search.total = res.total;
  state.search.offset = state.search.rows.length;
  if (!state.search.rows.some(function (item) { return item.id === state.search.selectedId; })) {
    state.search.selectedId = state.search.rows.length ? state.search.rows[0].id : null;
  }
  renderSearchRows(false);
}

function openSearchModal(prefix) {
  const list = activeList();
  document.getElementById("search-list-name").textContent = list ? "· " + list.name : "";
  document.getElementById("search-prefix").value = prefix || "";
  document.getElementById("search-query").value = "";
  document.getElementById("search-modal").hidden = false;
  document.getElementById("search-query").focus();
  runSearch(true);
}

function moveSearch(step) {
  const rows = state.search.rows;
  if (!rows.length) return;
  let index = rows.findIndex(function (item) { return item.id === state.search.selectedId; });
  index = Math.max(0, Math.min(rows.length - 1, index + step));
  state.search.selectedId = rows[index].id;
  renderSearchRows(false);
  const selected = document.querySelector('#search-body tr[data-id="' + state.search.selectedId + '"]');
  if (selected) selected.scrollIntoView({ block: "nearest" });
}

function addSearchSelection() {
  const item = state.search.rows.find(function (row) { return row.id === state.search.selectedId; });
  if (!item) {
    setStatus("Выберите позицию");
    return;
  }
  const qty = RollMoney.normalizeQty(document.getElementById("search-qty").value);
  if (qty === null) {
    setStatus("Укажите количество");
    return;
  }
  document.getElementById("search-qty").value = displayNumber(qty);
  const line = {
    key: newKey(),
    code: item.code,
    name: item.name,
    color: item.color,
    unit: item.unit,
    width_mm: "",
    height_mm: "",
    qty: qty,
    price: item.price,
    discount: "0",
  };
  state.estimate.lines.push(line);
  state.selectedKey = line.key;
  state.dirty = true;
  renderLines();
  updateTotals();
  updateSaveLabel();
  const row = document.querySelector('#estimate-body tr[data-key="' + line.key + '"]');
  if (row) row.scrollIntoView({ block: "nearest" });
  setStatus("В смету: " + item.code + " " + item.name);
}

async function showOpen() {
  const res = await call("list_estimates");
  if (!res.ok) return;
  state.openRows = res.estimates;
  state.openSelected = res.estimates.length ? res.estimates[0].id : null;
  const body = document.getElementById("open-body");
  if (!res.estimates.length) {
    body.innerHTML = '<tr class="empty"><td colspan="5">Сохранённых смет нет</td></tr>';
  } else {
    body.innerHTML = res.estimates.map(function (item) {
      const selected = item.id === state.openSelected ? " selected" : "";
      return '<tr data-id="' + item.id + '" class="' + selected + '">' +
        "<td>" + esc(item.number) + "</td>" +
        "<td>" + esc(ruDate(item.date)) + "</td>" +
        '<td class="name" title="' + esc(item.client) + '">' + esc(item.client) + "</td>" +
        '<td class="name" title="' + esc(item.object_name) + '">' + esc(item.object_name) + "</td>" +
        '<td class="num">' + esc(RollMoney.formatGrouped(RollMoney.toUnits(item.total, 2) || 0n)) + "</td></tr>";
    }).join("");
  }
  document.getElementById("open-meta").textContent = res.estimates.length
    ? "Смет: " + res.estimates.length
    : "";
  document.getElementById("open-modal").hidden = false;
}

async function openSelectedEstimate() {
  if (!state.openSelected) return;
  if (state.dirty) {
    const ok = await ask("Открыть смету", "Текущая смета не сохранена. Открыть другую?", "Открыть");
    if (!ok) return;
  }
  const res = await call("load_estimate", state.openSelected);
  if (!res.ok) return;
  state.estimate = hydrate(res.estimate);
  state.selectedKey = null;
  state.dirty = false;
  renderEstimate();
  closeOpen();
  setTab("estimate");
  setStatus("Смета открыта");
}

async function deleteOpenEstimate() {
  if (!state.openSelected) return;
  const row = state.openRows.find(function (item) { return item.id === state.openSelected; });
  const name = row && row.number ? "№ " + row.number : "эту смету";
  const ok = await ask("Удалить смету", "Удалить " + name + " из базы? Строки будут удалены.", "Удалить");
  if (!ok) return;
  const res = await call("delete_estimate", state.openSelected);
  if (!res.ok) return;
  if (state.estimate && state.estimate.id === res.deleted) {
    state.estimate.id = null;
    state.dirty = true;
    updateSaveLabel();
  }
  setStatus("Смета удалена из базы");
  showOpen();
}

function renderPriceRows() {
  const body = document.getElementById("price-body");
  if (!state.price.rows.length) {
    body.innerHTML = '<tr class="empty"><td colspan="8">Ничего не найдено</td></tr>';
  } else {
    body.innerHTML = state.price.rows.map(function (item) {
      const edited = item.user_edited ? " edited" : "";
      return '<tr data-id="' + item.id + '" class="' + edited + '">' +
        "<td>" + esc(item.code) + "</td>" +
        '<td class="name" title="' + esc(item.name) + '">' + esc(item.name) + "</td>" +
        "<td>" + esc(item.color) + "</td>" +
        "<td>" + esc(unitLabel(item.unit)) + "</td>" +
        '<td class="num">' + esc(displayNumber(item.file_price)) + "</td>" +
        '<td class="num"><input data-item="' + item.id + '" data-price="' + esc(item.price) + '" value="' +
        esc(displayNumber(item.price)) + '" inputmode="decimal"></td>' +
        "<td>" + (item.user_edited ? "своя" : "") + "</td>" +
        '<td><button type="button" data-reset="' + item.id + '"' + (item.user_edited ? "" : " disabled") +
        '>К цене файла</button></td></tr>';
    }).join("");
  }
  document.getElementById("price-meta").textContent = state.price.total
    ? "Показаны " + state.price.rows.length + " из " + state.price.total
    : "Ничего не найдено";
  document.getElementById("price-more").hidden = state.price.rows.length >= state.price.total;
}

async function refreshPrice(reset) {
  const listId = Number(document.getElementById("price-select").value) || state.activePriceListId;
  if (!listId) {
    state.price.rows = [];
    state.price.total = 0;
    renderPriceRows();
    return;
  }
  const token = ++priceToken;
  if (reset) state.price.offset = 0;
  const res = await call("search_items", {
    price_list_id: listId,
    query: document.getElementById("price-query").value,
    prefix: "",
    show_zero: document.getElementById("price-zero").checked,
    offset: reset ? 0 : state.price.rows.length,
    limit: 200,
  });
  if (token !== priceToken || !res.ok) return;
  state.price.rows = reset ? res.rows : state.price.rows.concat(res.rows);
  state.price.total = res.total;
  priceLoaded = true;
  renderPriceRows();
}

function applyPriceItem(item) {
  const index = state.price.rows.findIndex(function (row) { return row.id === item.id; });
  if (index >= 0) state.price.rows[index] = item;
  renderPriceRows();
}

async function commitPriceInput(input) {
  const norm = RollMoney.normalizeMoney(input.value);
  if (norm === null) {
    input.value = displayNumber(input.dataset.price);
    return;
  }
  if (norm === input.dataset.price) {
    input.value = displayNumber(norm);
    return;
  }
  const res = await call("set_item_price", Number(input.dataset.item), norm);
  if (!res.ok) {
    input.value = displayNumber(input.dataset.price);
    return;
  }
  applyPriceItem(res.item);
  setStatus("Цена " + res.item.code + " записана как своя");
}

async function importPrice() {
  if (busy) return;
  busy = true;
  try {
    const res = await call("import_price_dialog");
    if (!res.ok || res.cancelled) return;
    state.priceLists = res.price_lists;
    state.activePriceListId = res.active_price_list_id;
    refreshSelects();
    document.getElementById("price-select").value = String(res.price_list.id);
    paintActivateButton();
    renderActiveLabel();
    await refreshPrice(true);
    const info = res.price_list;
    setStatus(info.existed
      ? "Прайс «" + info.name + "» обновлён из файла. Ручные цены сохранены: " + info.preserved_user + "."
      : "Добавлен прайс «" + info.name + "», позиций: " + info.added + ".");
  } finally {
    busy = false;
  }
}

async function exportPrice() {
  if (busy) return;
  const id = Number(document.getElementById("price-select").value);
  if (!id) return;
  busy = true;
  try {
    const res = await call("export_price_dialog", id);
    if (!res.ok || res.cancelled) return;
    setStatus("Прайс записан: " + res.path);
  } finally {
    busy = false;
  }
}

async function replacePrices() {
  const id = Number(document.getElementById("price-select").value);
  if (!id) return;
  const ok = await ask(
    "Заменить цены",
    "Заменить все ваши цены в этом прайсе ценами из файла? Ручные правки будут сброшены.",
    "Заменить"
  );
  if (!ok) return;
  const res = await call("replace_user_prices", id);
  if (!res.ok) return;
  await refreshPrice(true);
  setStatus("Ручные цены сброшены: " + res.updated + ".");
}

async function activateViewed() {
  const id = Number(document.getElementById("price-select").value);
  if (!id || id === state.activePriceListId) return;
  const res = await call("set_active_price_list", id);
  if (!res.ok) return;
  state.priceLists = res.price_lists;
  state.activePriceListId = res.active_price_list_id;
  refreshSelects();
  renderActiveLabel();
  const list = activeList();
  setStatus(list ? "Активный прайс: " + list.name : "Прайс выбран");
}

async function saveSettings() {
  const unitLabels = {};
  [0, 2, 3, 4].forEach(function (code) {
    unitLabels[String(code)] = document.getElementById("unit-" + code).value;
  });
  const prefixes = {};
  PARTS.forEach(function (part) {
    prefixes[part.id] = document.getElementById("prefix-" + part.id).value;
  });
  const active = document.getElementById("settings-active").value;
  const res = await call("save_settings", {
    unit_labels: unitLabels,
    part_prefixes: prefixes,
    active_price_list_id: active ? Number(active) : null,
  });
  if (!res.ok) return;
  state.unitLabels = res.unit_labels;
  state.prefixes = res.part_prefixes;
  state.priceLists = res.price_lists;
  state.activePriceListId = res.active_price_list_id;
  renderSettingsForm();
  refreshSelects();
  renderLegend();
  renderActiveLabel();
  renderLines();
  paintHint();
  priceLoaded = false;
  setStatus("Настройки сохранены");
}

function setTab(tab) {
  state.tab = tab;
  ["estimate", "price", "settings"].forEach(function (id) {
    document.getElementById("view-" + id).hidden = id !== tab;
    document.querySelector('[data-tab="' + id + '"]').classList.toggle("active", id === tab);
  });
  if (tab === "estimate") {
    loopOn = true;
    resize3d();
    frame3d();
  } else {
    loopOn = false;
  }
  if (tab === "price" && !priceLoaded) refreshPrice(true);
}

function highlight(partId) {
  if (!cabinet) return;
  Object.keys(cabinet.parts).forEach(function (id) {
    const on = id === partId;
    cabinet.parts[id].traverse(function (obj) {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(function (material) {
        if (!material.emissive || material.userData.baseColor === undefined) return;
        material.color.setHex(on ? 0xf0c36a : material.userData.baseColor);
        material.emissive.setHex(on ? 0x5a3e10 : 0x000000);
      });
    });
  });
}

function selectPart(partId, openSearch) {
  state.selectedPart = partId;
  highlight(partId);
  renderLegend();
  paintHint();
  if (openSearch) openSearchModal(state.prefixes[partId] || "");
}

function resize3d() {
  if (!renderer || !camera) return;
  const host = document.getElementById("view3d");
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width < 2 || height < 2) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
}

function applyView() {
  const target = new THREE.Vector3(view.target[0], view.target[1], view.target[2]);
  RollScene.placeCamera(camera, target, view.azimuth, view.polar, view.radius);
}

function frame3d() {
  if (!loopOn || !renderer) return;
  renderer.render(scene3d, camera);
  requestAnimationFrame(frame3d);
}

function init3d() {
  const error = document.getElementById("view3d-error");
  if (!window.THREE || !window.RollScene) {
    error.hidden = false;
    error.textContent = "Не загрузился Three.js.";
    return;
  }
  try {
  const THREE = window.THREE;
  const host = document.getElementById("view3d");
  const canvas = document.getElementById("cabinet");
  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x0c0e12);
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
  view = {
    azimuth: RollScene.DEFAULT_VIEW.azimuth,
    polar: RollScene.DEFAULT_VIEW.polar,
    radius: RollScene.DEFAULT_VIEW.radius,
    target: RollScene.DEFAULT_VIEW.target.slice(),
  };
  cabinet = RollScene.createCabinet(THREE);
  scene3d.add(cabinet.root);
  scene3d.add(new THREE.HemisphereLight(0xdde3ee, 0x2a241e, 0.7));
  const key = new THREE.DirectionalLight(0xfff4e5, 2.05);
  key.position.set(2.4, 4.6, 3.4);
  scene3d.add(key);
  const fill = new THREE.DirectionalLight(0xc5d0e0, 0.55);
  fill.position.set(-3.2, 2.4, 2.2);
  scene3d.add(fill);
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  raycaster = new THREE.Raycaster();
  applyView();
  resize3d();
  new ResizeObserver(resize3d).observe(host);
  loopOn = true;
  frame3d();

  canvas.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    drag.on = true;
    drag.moved = false;
    drag.x = event.clientX;
    drag.y = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* старый жест */ }
  });
  canvas.addEventListener("pointermove", function (event) {
    if (!drag.on) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const next = RollScene.orbitBy(view.azimuth, view.polar, dx, dy);
    view.azimuth = next.azimuth;
    view.polar = next.polar;
    applyView();
  });
  canvas.addEventListener("pointerup", function (event) {
    const wasDrag = drag.moved;
    drag.on = false;
    if (!wasDrag) pickPart(event);
  });
  canvas.addEventListener("pointercancel", function () { drag.on = false; });
  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    view.radius = RollScene.zoomRadius(view.radius, event.deltaY);
    applyView();
  }, { passive: false });
  } catch (err) {
    error.hidden = false;
    error.textContent = "Не удалось построить модель.";
  }
}

function pickPart(event) {
  const canvas = document.getElementById("cabinet");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(Object.values(cabinet.parts), true);
  if (!hits.length) {
    state.selectedPart = null;
    highlight(null);
    renderLegend();
    paintHint();
    return;
  }
  let obj = hits[0].object;
  while (obj && !obj.userData.part) obj = obj.parent;
  if (!obj) return;
  selectPart(obj.userData.part, true);
}

function typingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function onKey(event) {
  const confirmOpen = !document.getElementById("confirm").hidden;
  const searchOpen = !document.getElementById("search-modal").hidden;
  const openOpen = !document.getElementById("open-modal").hidden;
  if (event.key === "Escape") {
    if (confirmOpen) { closeAsk(false); return; }
    if (searchOpen) { closeSearch(); return; }
    if (openOpen) { closeOpen(); return; }
  }
  if (confirmOpen) return;
  if (searchOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    moveSearch(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (searchOpen && event.key === "Enter" && !event.ctrlKey) {
    if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
    event.preventDefault();
    addSearchSelection();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === "f") {
      event.preventDefault();
      if (state.tab === "price") {
        document.getElementById("price-query").focus();
        document.getElementById("price-query").select();
        return;
      }
      openSearchModal("");
      return;
    }
    if (key === "s") {
      event.preventDefault();
      if (state.tab === "settings") {
        saveSettings();
        if (state.dirty) saveEstimate();
      } else {
        saveEstimate();
      }
      return;
    }
    if (key === "n") {
      event.preventDefault();
      closeSearch();
      newEstimate();
      return;
    }
  }
  if (event.key === "Delete" && !event.repeat && !searchOpen && !openOpen && state.tab === "estimate" && !typingTarget(event.target)) {
    event.preventDefault();
    deleteSelected();
  }
}

function bind() {
  document.querySelectorAll("[data-tab]").forEach(function (button) {
    button.addEventListener("click", function () { setTab(button.dataset.tab); });
  });
  document.getElementById("btn-new").addEventListener("click", newEstimate);
  document.getElementById("btn-open").addEventListener("click", showOpen);
  document.getElementById("btn-save").addEventListener("click", saveEstimate);
  document.getElementById("btn-dup").addEventListener("click", duplicateEstimate);
  document.getElementById("btn-export").addEventListener("click", exportEstimate);
  document.getElementById("btn-add").addEventListener("click", function () { openSearchModal(""); });
  document.getElementById("btn-reset-view").addEventListener("click", function () {
    if (!view) return;
    view.azimuth = RollScene.DEFAULT_VIEW.azimuth;
    view.polar = RollScene.DEFAULT_VIEW.polar;
    view.radius = RollScene.DEFAULT_VIEW.radius;
    applyView();
  });
  document.getElementById("legend").addEventListener("click", function (event) {
    const button = event.target.closest("[data-part]");
    if (!button) return;
    selectPart(button.dataset.part, true);
  });
  document.querySelectorAll("#view-estimate input[data-header]").forEach(function (input) {
    input.addEventListener("input", function () { liveHeader(input); });
    input.addEventListener("focusout", function () { commitHeader(input); });
  });
  const estimateBody = document.getElementById("estimate-body");
  estimateBody.addEventListener("input", function (event) {
    if (event.target.matches("input[data-field]")) liveLine(event.target);
  });
  estimateBody.addEventListener("focusout", function (event) {
    if (event.target.matches("input[data-field]")) commitLine(event.target);
  });
  estimateBody.addEventListener("click", function (event) {
    const row = event.target.closest("tr[data-key]");
    if (!row) return;
    state.selectedKey = row.dataset.key;
    paintSelection();
    if (event.target.closest("[data-delete]")) {
      deleteSelected();
      return;
    }
    if (!event.target.closest("input")) document.getElementById("estimate-table").focus();
  });

  document.getElementById("search-query").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { runSearch(true); }, 150);
  });
  document.getElementById("search-prefix").addEventListener("input", function () { runSearch(true); });
  document.getElementById("search-zero").addEventListener("change", function () { runSearch(true); });
  document.getElementById("search-add").addEventListener("click", addSearchSelection);
  document.getElementById("search-more").addEventListener("click", function () { runSearch(false); });
  document.getElementById("search-body").addEventListener("click", function (event) {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    state.search.selectedId = Number(row.dataset.id);
    renderSearchRows(false);
  });
  document.getElementById("search-body").addEventListener("dblclick", function (event) {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    state.search.selectedId = Number(row.dataset.id);
    addSearchSelection();
  });

  document.getElementById("open-body").addEventListener("click", function (event) {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    state.openSelected = Number(row.dataset.id);
    document.querySelectorAll("#open-body tr").forEach(function (item) {
      item.classList.toggle("selected", Number(item.dataset.id) === state.openSelected);
    });
  });
  document.getElementById("open-body").addEventListener("dblclick", function (event) {
    if (event.target.closest("tr[data-id]")) openSelectedEstimate();
  });
  document.getElementById("open-do").addEventListener("click", openSelectedEstimate);
  document.getElementById("open-delete").addEventListener("click", deleteOpenEstimate);

  document.getElementById("price-select").addEventListener("change", function () {
    paintActivateButton();
    refreshPrice(true);
  });
  document.getElementById("price-query").addEventListener("input", function () {
    clearTimeout(priceTimer);
    priceTimer = setTimeout(function () { refreshPrice(true); }, 150);
  });
  document.getElementById("price-zero").addEventListener("change", function () { refreshPrice(true); });
  document.getElementById("price-more").addEventListener("click", function () { refreshPrice(false); });
  document.getElementById("btn-activate").addEventListener("click", activateViewed);
  document.getElementById("btn-import").addEventListener("click", importPrice);
  document.getElementById("btn-export-price").addEventListener("click", exportPrice);
  document.getElementById("btn-replace").addEventListener("click", replacePrices);
  document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
  const priceBody = document.getElementById("price-body");
  priceBody.addEventListener("mousedown", function (event) {
    if (event.target.closest("[data-reset]")) event.preventDefault();
  });
  priceBody.addEventListener("focusout", function (event) {
    if (event.target.matches("input[data-item]")) commitPriceInput(event.target);
  });
  priceBody.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.matches("input[data-item]")) event.target.blur();
  });
  priceBody.addEventListener("click", function (event) {
    const button = event.target.closest("[data-reset]");
    if (!button) return;
    call("reset_item_price", Number(button.dataset.reset)).then(function (res) {
      if (!res.ok) return;
      applyPriceItem(res.item);
      setStatus("Позиция " + res.item.code + " снова берёт цену файла");
    });
  });

  document.querySelectorAll("[data-close]").forEach(function (node) {
    node.addEventListener("click", function () {
      if (node.dataset.close === "search") closeSearch();
      if (node.dataset.close === "open") closeOpen();
    });
  });
  document.getElementById("confirm-ok").addEventListener("click", function () { closeAsk(true); });
  document.getElementById("confirm-cancel").addEventListener("click", function () { closeAsk(false); });
  document.addEventListener("keydown", onKey);
}

async function start() {
  if (started) return;
  started = true;
  bind();
  renderLegend();
  renderSettingsForm();
  setStatus("Загрузка прайсов…");
  const data = await call("bootstrap");
  if (!data.ok) {
    state.estimate = hydrate({
      id: null, number: "1", date: "", client: "", object_name: "", comment: "",
      order_discount: "0", lines: [],
    });
    renderEstimate();
    init3d();
    return;
  }
  state.unitLabels = data.unit_labels;
  state.prefixes = data.part_prefixes;
  state.priceLists = data.price_lists;
  state.activePriceListId = data.active_price_list_id;
  state.estimate = hydrate(data.estimate);
  state.dirty = false;
  renderSettingsForm();
  refreshSelects();
  renderActiveLabel();
  renderLegend();
  renderEstimate();
  try {
    init3d();
  } catch (err) {
    const error = document.getElementById("view3d-error");
    error.hidden = false;
    error.textContent = "Не удалось построить модель.";
  }
  const seed = data.seed || {};
  if (seed.already) {
    const list = activeList();
    setStatus(list ? "Активный прайс: " + list.name : "Прайс не выбран");
    return;
  }
  const names = (seed.imported || []).map(function (item) { return item.name; }).join(", ");
  const list = activeList();
  let text = names ? "Импортированы прайсы: " + names + "." : "Файлы ПГИ рядом с программой не найдены.";
  if (list) text += " Активный: " + list.name + ".";
  if (seed.errors && seed.errors.length) text += " " + seed.errors.join(" ");
  setStatus(text);
}

window.addEventListener("pywebviewready", start);
