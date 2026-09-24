const STORAGE_KEY = "swp04-sticky-notes-v1";
const THEME_KEY = "swp04-theme-v1";
const VIEW_KEY = "swp04-view-v1";
const COLORS = new Set([
  "yellow",
  "pink",
  "blue",
  "green",
  "lavender",
  "peach",
  "custom",
]);
const PRIORITIES = new Set(["none", "low", "medium", "high"]);
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 };
const PRIORITY_LABEL = { high: "高優先", medium: "中優先", low: "低優先" };
const $ = (selector) => document.querySelector(selector);
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateText = (timestamp) =>
  new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(
    new Date(timestamp),
  );
let notes = loadNotes();
let activeColor = "all";
let editingId = null;
let draftChecklist = [];
let selected = new Set();
let selectionMode = false;
let undoSnapshot = null;
let toastTimer = null;
let view = readPreference(VIEW_KEY, "board");

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function validDate(value) {
  if (typeof value !== "string") return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return "";
  const [year, month, day] = parts.slice(1).map(Number);
  return year >= 1900 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(year, month, 0).getDate()
    ? value
    : "";
}
function normalizeNote(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.content !== "string" ||
    !value.content.trim()
  )
    return null;
  const color = COLORS.has(value.color) ? value.color : "yellow";
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid(),
    title:
      typeof value.title === "string" ? value.title.trim().slice(0, 80) : "",
    content: value.content.trim().slice(0, 2000),
    color,
    customColor:
      typeof value.customColor === "string" &&
      /^#[\da-fA-F]{6}$/.test(value.customColor)
        ? value.customColor
        : "#d8e8ff",
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    tags: Array.isArray(value.tags)
      ? [
          ...new Set(
            value.tags
              .filter((tag) => typeof tag === "string")
              .map((tag) => tag.trim().slice(0, 24))
              .filter(Boolean),
          ),
        ].slice(0, 8)
      : [],
    checklist: Array.isArray(value.checklist)
      ? value.checklist
          .filter(
            (item) => item && typeof item.text === "string" && item.text.trim(),
          )
          .map((item) => ({
            id: typeof item.id === "string" ? item.id : uid(),
            text: item.text.trim().slice(0, 100),
            done: item.done === true,
          }))
          .slice(0, 30)
      : [],
    dueDate: validDate(value.dueDate),
    priority: PRIORITIES.has(value.priority) ? value.priority : "none",
    pinned: value.pinned === true,
    favorite: value.favorite === true,
    archived: value.archived === true,
  };
}
function loadNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const ids = new Set();
    return parsed.map(normalizeNote).filter((note) => {
      if (!note || ids.has(note.id)) return false;
      ids.add(note.id);
      return true;
    });
  } catch {
    return [];
  }
}
function persist(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notes = next;
    $("#form-error").hidden = true;
    return true;
  } catch {
    $("#form-error").textContent = "儲存失敗，請檢查瀏覽器是否允許本機儲存。";
    $("#form-error").hidden = false;
    showToast("儲存失敗，變更尚未套用。");
    return false;
  }
}
function announce(message) {
  $("#live-status").textContent = message;
}
function showToast(message, snapshot = null) {
  clearTimeout(toastTimer);
  undoSnapshot = snapshot;
  $("#toast-message").textContent = message;
  $("#undo-delete").hidden = !snapshot;
  $("#toast").hidden = false;
  announce(message);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
    undoSnapshot = null;
  }, 8000);
}
function commit(next, message, undo = false) {
  const previous = notes.map((note) => ({
    ...note,
    tags: [...note.tags],
    checklist: note.checklist.map((item) => ({ ...item })),
  }));
  if (!persist(next)) return false;
  render();
  showToast(message, undo ? previous : null);
  return true;
}
function isOverdue(note) {
  return note.dueDate && note.dueDate < today() && !note.archived;
}
function visibleNotes() {
  const query = $("#search-input").value.trim().toLocaleLowerCase();
  const state = $("#state-filter").value;
  const sort = $("#sort-select").value;
  const visible = notes.filter((note) => {
    if (state === "archived" ? !note.archived : note.archived) return false;
    if (state === "favorite" && !note.favorite) return false;
    if (state === "overdue" && !isOverdue(note)) return false;
    if (activeColor !== "all" && note.color !== activeColor) return false;
    if (
      query &&
      !`${note.title} ${note.content} ${note.tags.join(" ")} ${note.checklist.map((item) => item.text).join(" ")}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    return true;
  });
  visible.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "newest") return b.createdAt - a.createdAt;
    if (sort === "oldest") return a.createdAt - b.createdAt;
    if (sort === "updated") return b.updatedAt - a.updatedAt;
    if (sort === "due")
      return (
        (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
        b.createdAt - a.createdAt
      );
    if (sort === "priority")
      return (
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        b.createdAt - a.createdAt
      );
    return 0;
  });
  return visible;
}
function icon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths;
  return svg;
}
function actionButton(label, action, id, paths) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `note-action ${action}`;
  button.dataset.action = action;
  button.dataset.id = id;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(paths));
  return button;
}
function textButton(label, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `text-note-action ${action}`;
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}
function makeNote(note, visible, index) {
  const card = document.createElement("article");
  card.className = `sticky-note note-${note.color}${note.pinned ? " is-pinned" : ""}`;
  card.dataset.id = note.id;
  card.draggable = $("#sort-select").value === "manual";
  card.setAttribute(
    "aria-label",
    `${note.title || "無標題便利貼"}：${note.content}`,
  );
  if (note.color === "custom") {
    card.style.backgroundColor = note.customColor;
    const rgb = [1, 3, 5].map((pos) =>
      parseInt(note.customColor.slice(pos, pos + 2), 16),
    );
    const dark = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 140;
    card.style.setProperty("--note-ink", dark ? "#fff" : "#283649");
  }
  if (selectionMode) {
    const select = document.createElement("input");
    select.type = "checkbox";
    select.className = "note-select";
    select.dataset.id = note.id;
    select.checked = selected.has(note.id);
    select.setAttribute(
      "aria-label",
      `選取：${note.title || note.content.slice(0, 20)}`,
    );
    card.append(select);
  }
  const top = document.createElement("div");
  top.className = "note-top";
  const date = document.createElement("span");
  date.className = "note-date";
  date.textContent = dateText(note.updatedAt);
  const controls = document.createElement("div");
  controls.className = "note-controls";
  const pin = actionButton(
    note.pinned ? "取消置頂" : "置頂",
    "pin",
    note.id,
    '<path d="m8 4 8 0-1 6 3 3v2H6v-2l3-3-1-6ZM12 15v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  );
  pin.setAttribute("aria-pressed", String(note.pinned));
  const favorite = actionButton(
    note.favorite ? "取消收藏" : "收藏",
    "favorite",
    note.id,
    '<path d="M12 3.5 14.8 9l6.2.9-4.5 4.4 1.1 6.2L12 17.6l-5.6 2.9 1.1-6.2L3 9.9 9.2 9 12 3.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  );
  favorite.setAttribute("aria-pressed", String(note.favorite));
  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.title = "拖曳調整順序";
  handle.setAttribute("aria-hidden", "true");
  handle.append(
    icon(
      '<path d="M8 5h1M8 12h1M8 19h1M15 5h1M15 12h1M15 19h1" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    ),
  );
  const prev = actionButton(
    "向前移動",
    "move-prev",
    note.id,
    '<path d="m14.5 5-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  );
  const next = actionButton(
    "向後移動",
    "move-next",
    note.id,
    '<path d="m9.5 5 7 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  );
  prev.disabled =
    index === 0 ||
    $("#sort-select").value !== "manual" ||
    visible[index - 1]?.pinned !== note.pinned;
  next.disabled =
    index === visible.length - 1 ||
    $("#sort-select").value !== "manual" ||
    visible[index + 1]?.pinned !== note.pinned;
  handle.hidden = $("#sort-select").value !== "manual";
  controls.append(pin, favorite, handle, prev, next);
  top.append(date, controls);
  const body = document.createElement("button");
  body.type = "button";
  body.className = "note-body";
  body.dataset.action = "edit";
  body.dataset.id = note.id;
  body.setAttribute(
    "aria-label",
    `編輯：${note.title || note.content.slice(0, 30)}`,
  );
  if (note.title) {
    const title = document.createElement("h3");
    title.textContent = note.title;
    body.append(title);
  }
  const content = document.createElement("p");
  content.textContent = note.content;
  body.append(content);
  const meta = document.createElement("span");
  meta.className = "note-meta";
  const badge = (text, className = "") => {
    const span = document.createElement("span");
    span.className = `note-badge ${className}`;
    span.textContent = text;
    meta.append(span);
  };
  if (note.dueDate)
    badge(
      `${isOverdue(note) ? "逾期 " : ""}${note.dueDate.slice(5).replace("-", "/")}`,
      isOverdue(note) ? "badge-overdue" : "",
    );
  if (note.priority !== "none")
    badge(PRIORITY_LABEL[note.priority], `badge-${note.priority}`);
  if (note.checklist.length)
    badge(
      `清單 ${note.checklist.filter((item) => item.done).length}/${note.checklist.length}`,
    );
  note.tags.forEach((tag) => badge(`#${tag}`));
  if (meta.childElementCount) body.append(meta);
  const bottom = document.createElement("div");
  bottom.className = "note-bottom";
  bottom.append(
    textButton("複製", "duplicate", note.id),
    textButton(note.archived ? "還原" : "封存", "archive", note.id),
    actionButton(
      "編輯便利貼",
      "edit",
      note.id,
      '<path d="m15 5 4 4M4 20l4.5-.9L19 8.6 15.4 5 4.9 15.5 4 20Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
    actionButton(
      "刪除便利貼",
      "delete",
      note.id,
      '<path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
  );
  card.append(top, body, bottom);
  return card;
}
function render() {
  const visible = visibleNotes();
  $("#notes-grid").replaceChildren(
    ...visible.map((note, index) => makeNote(note, visible, index)),
  );
  $("#notes-grid").classList.toggle("is-list-view", view === "list");
  const archivedView = $("#state-filter").value === "archived";
  const count = notes.filter((note) => note.archived === archivedView).length;
  $("#note-count").textContent = count;
  $("#board-subtitle").textContent = archivedView
    ? `已封存 ${count} 張便利貼。`
    : count
      ? `這裡存著 ${count} 個想法。`
      : "所有靈感，都有自己的位置。";
  $("#empty-state").hidden = visible.length > 0;
  $("#board-tip").hidden = visible.length < 2;
  $("#board-tip").textContent =
    $("#sort-select").value === "manual"
      ? "拖曳便利貼調整順序，也可以用每張貼紙上的箭頭移動。"
      : "切換到「手動排列」即可拖曳或使用箭頭調整順序。";
  if (!visible.length) {
    const empty = notes.length === 0;
    $("#empty-title").textContent = empty
      ? "這裡等著你的第一個想法"
      : archivedView && count === 0
        ? "封存區是空的"
        : "沒有找到符合的便利貼";
    $("#empty-copy").textContent = empty
      ? "在左側寫下內容，選個顏色，就能把它貼上看板。"
      : archivedView && count === 0
        ? "封存的便利貼會出現在這裡。"
        : "換個篩選條件或搜尋關鍵字看看。";
  }
  document.querySelectorAll(".color-filter").forEach((button) => {
    const active = button.dataset.color === activeColor;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#batch-bar").hidden = !selectionMode;
  $("#select-mode").textContent = selectionMode ? "完成多選" : "多選";
  $("#select-mode").setAttribute("aria-pressed", String(selectionMode));
  $("#selected-count").textContent = `已選 ${selected.size} 張`;
  $("#batch-delete").disabled = selected.size === 0;
  $("#batch-recolor").disabled = selected.size === 0;
  $("#view-toggle").textContent = view === "list" ? "看板視圖" : "清單視圖";
  $("#view-toggle").setAttribute("aria-pressed", String(view === "list"));
}
function renderChecklist() {
  const list = $("#checklist-items");
  list.replaceChildren();
  draftChecklist.forEach((item) => {
    const row = document.createElement("li");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.id = item.id;
    check.checked = item.done;
    check.setAttribute("aria-label", `完成：${item.text}`);
    const label = document.createElement("span");
    label.textContent = item.text;
    if (item.done) label.className = "is-done";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.id = item.id;
    remove.dataset.action = "remove";
    remove.setAttribute("aria-label", `刪除：${item.text}`);
    remove.textContent = "×";
    row.append(check, label, remove);
    list.append(row);
  });
  $("#checklist-progress").textContent =
    `${draftChecklist.filter((item) => item.done).length} / ${draftChecklist.length}`;
}
function openEditor(note) {
  editingId = note.id;
  draftChecklist = note.checklist.map((item) => ({ ...item }));
  $("#edit-note-title").value = note.title;
  $("#edit-note-content").value = note.content;
  $("#edit-use-custom").checked = note.color === "custom";
  $("#edit-custom-color").value = note.customColor;
  $(
    `#edit-color-picker input[value="${note.color === "custom" ? "yellow" : note.color}"]`,
  ).checked = true;
  $("#edit-due-date").value = note.dueDate;
  $("#edit-priority").value = note.priority;
  $("#edit-tags").value = note.tags.join(", ");
  $("#checklist-input").value = "";
  $("#edit-error").hidden = true;
  renderChecklist();
  $("#edit-dialog").showModal();
  $("#edit-note-content").focus();
}
function moveNote(id, direction) {
  if ($("#sort-select").value !== "manual") return;
  const visible = visibleNotes();
  const current = visible.findIndex((note) => note.id === id);
  const other = visible[current + direction];
  if (!other || other.pinned !== visible[current].pinned) return;
  const first = notes.findIndex((note) => note.id === id),
    second = notes.findIndex((note) => note.id === other.id);
  const next = [...notes];
  [next[first], next[second]] = [next[second], next[first]];
  if (commit(next, "已調整便利貼順序")) {
    const action = direction < 0 ? "move-prev" : "move-next";
    [...document.querySelectorAll(`[data-action="${action}"]`)]
      .find((button) => button.dataset.id === id)
      ?.focus();
  }
}
function reorderByDrop(sourceId, targetId, after) {
  if (
    $("#sort-select").value !== "manual" ||
    !sourceId ||
    sourceId === targetId
  )
    return;
  const source = notes.find((note) => note.id === sourceId),
    target = notes.find((note) => note.id === targetId);
  if (!source || !target || source.pinned !== target.pinned) return;
  const next = notes.filter((note) => note.id !== sourceId);
  const index = next.findIndex((note) => note.id === targetId);
  next.splice(index + Number(after), 0, source);
  if (next.every((note, index) => note.id === notes[index].id)) return;
  commit(next, "已儲存便利貼的新順序");
}
function changeNote(note, changes, message) {
  commit(
    notes.map((item) =>
      item.id === note.id
        ? { ...item, ...changes, updatedAt: Date.now() }
        : item,
    ),
    message,
  );
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "dark" ? "淺色模式" : "深色模式";
  $("#theme-toggle").setAttribute(
    "aria-label",
    `切換${theme === "dark" ? "淺色" : "深色"}模式`,
  );
  $('meta[name="theme-color"]').content =
    theme === "dark" ? "#172439" : "#eaf0f6";
}

$("#note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const content = $("#note-content").value.trim();
  if (!content) {
    $("#form-error").textContent = "請先寫下便利貼內容。";
    $("#form-error").hidden = false;
    $("#note-content").focus();
    return;
  }
  const note = normalizeNote({
    id: uid(),
    title: $("#note-title").value,
    content,
    color: $("#new-use-custom").checked
      ? "custom"
      : $('input[name="new-color"]:checked').value,
    customColor: $("#new-custom-color").value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (commit([note, ...notes], "便利貼已貼上看板")) {
    $("#note-form").reset();
    $("#search-input").value = "";
    activeColor = "all";
    $("#state-filter").value = "active";
    render();
    $("#note-content").focus();
  }
});
$("#note-content").addEventListener("input", () => {
  $("#form-error").hidden = true;
});
$("#notes-grid").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const note = notes.find((item) => item.id === button.dataset.id);
  if (!note) return;
  const action = button.dataset.action;
  if (action === "edit") openEditor(note);
  else if (action === "delete")
    commit(
      notes.filter((item) => item.id !== note.id),
      "便利貼已刪除",
      true,
    );
  else if (action === "move-prev") moveNote(note.id, -1);
  else if (action === "move-next") moveNote(note.id, 1);
  else if (action === "pin")
    changeNote(
      note,
      { pinned: !note.pinned },
      note.pinned ? "已取消置頂" : "已置頂",
    );
  else if (action === "favorite")
    changeNote(
      note,
      { favorite: !note.favorite },
      note.favorite ? "已取消收藏" : "已收藏",
    );
  else if (action === "archive")
    changeNote(
      note,
      { archived: !note.archived },
      note.archived ? "已還原到貼板" : "已封存便利貼",
    );
  else if (action === "duplicate") {
    const copy = {
      ...note,
      id: uid(),
      title: note.title ? `${note.title.slice(0, 76)}（複製）` : "",
      archived: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [...note.tags],
      checklist: note.checklist.map((item) => ({ ...item, id: uid() })),
    };
    if (commit([copy, ...notes], "已複製便利貼")) {
      $("#state-filter").value = "active";
      render();
    }
  }
});
$("#notes-grid").addEventListener("change", (event) => {
  if (!event.target.matches(".note-select")) return;
  if (event.target.checked) selected.add(event.target.dataset.id);
  else selected.delete(event.target.dataset.id);
  $("#selected-count").textContent = `已選 ${selected.size} 張`;
  $("#batch-delete").disabled = selected.size === 0;
  $("#batch-recolor").disabled = selected.size === 0;
});
$("#notes-grid").addEventListener("dragstart", (event) => {
  const card = event.target.closest(".sticky-note");
  if (
    !card ||
    event.target.closest("button") ||
    $("#sort-select").value !== "manual"
  ) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", card.dataset.id);
  card.classList.add("is-dragging");
});
$("#notes-grid").addEventListener("dragover", (event) => {
  const card = event.target.closest(".sticky-note");
  if (
    !card ||
    card.classList.contains("is-dragging") ||
    $("#sort-select").value !== "manual"
  )
    return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  document
    .querySelectorAll(".drop-before,.drop-after")
    .forEach((item) => item.classList.remove("drop-before", "drop-after"));
  const after =
    event.clientX >=
    card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2;
  card.classList.add(after ? "drop-after" : "drop-before");
});
$("#notes-grid").addEventListener("drop", (event) => {
  const card = event.target.closest(".sticky-note");
  if (!card) return;
  event.preventDefault();
  reorderByDrop(
    event.dataTransfer.getData("text/plain"),
    card.dataset.id,
    card.classList.contains("drop-after"),
  );
  document
    .querySelectorAll(".drop-before,.drop-after")
    .forEach((item) => item.classList.remove("drop-before", "drop-after"));
});
$("#notes-grid").addEventListener("dragend", () =>
  document
    .querySelectorAll(".is-dragging,.drop-before,.drop-after")
    .forEach((item) =>
      item.classList.remove("is-dragging", "drop-before", "drop-after"),
    ),
);
$("#edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const content = $("#edit-note-content").value.trim();
  if (!content) {
    $("#edit-error").textContent = "請先寫下便利貼內容。";
    $("#edit-error").hidden = false;
    $("#edit-note-content").focus();
    return;
  }
  const tags = [
    ...new Set(
      $("#edit-tags")
        .value.split(/[,，]/)
        .map((tag) => tag.trim().slice(0, 24))
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const next = notes.map((note) =>
    note.id === editingId
      ? {
          ...note,
          title: $("#edit-note-title").value.trim(),
          content,
          color: $("#edit-use-custom").checked
            ? "custom"
            : $('input[name="edit-color"]:checked').value,
          customColor: $("#edit-custom-color").value,
          dueDate: $("#edit-due-date").value,
          priority: $("#edit-priority").value,
          tags,
          checklist: draftChecklist.map((item) => ({ ...item })),
          updatedAt: Date.now(),
        }
      : note,
  );
  if (commit(next, "便利貼已更新")) $("#edit-dialog").close();
});
$("#edit-note-content").addEventListener("input", () => {
  $("#edit-error").hidden = true;
});
$("#close-dialog").addEventListener("click", () => $("#edit-dialog").close());
$("#cancel-dialog").addEventListener("click", () => $("#edit-dialog").close());
$("#edit-dialog").addEventListener("click", (event) => {
  if (event.target === $("#edit-dialog")) $("#edit-dialog").close();
});
$("#add-checklist-item").addEventListener("click", () => {
  const text = $("#checklist-input").value.trim();
  if (!text || draftChecklist.length >= 30) return;
  draftChecklist.push({ id: uid(), text, done: false });
  $("#checklist-input").value = "";
  renderChecklist();
  $("#checklist-input").focus();
});
$("#checklist-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#add-checklist-item").click();
  }
});
$("#checklist-items").addEventListener("change", (event) => {
  const item = draftChecklist.find(
    (item) => item.id === event.target.dataset.id,
  );
  if (item) {
    item.done = event.target.checked;
    renderChecklist();
  }
});
$("#checklist-items").addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="remove"]');
  if (button) {
    draftChecklist = draftChecklist.filter(
      (item) => item.id !== button.dataset.id,
    );
    renderChecklist();
  }
});
$("#search-input").addEventListener("input", () => {
  selected.clear();
  render();
});
document.querySelectorAll(".color-filter").forEach((button) =>
  button.addEventListener("click", () => {
    activeColor = button.dataset.color;
    selected.clear();
    render();
  }),
);
["#state-filter", "#sort-select"].forEach((selector) =>
  $(selector).addEventListener("change", () => {
    selected.clear();
    render();
  }),
);
$("#select-mode").addEventListener("click", () => {
  selectionMode = !selectionMode;
  selected.clear();
  render();
});
$("#select-all").addEventListener("click", () => {
  visibleNotes().forEach((note) => selected.add(note.id));
  render();
});
$("#batch-delete").addEventListener("click", () => {
  const count = selected.size;
  if (!count) return;
  if (
    commit(
      notes.filter((note) => !selected.has(note.id)),
      `已刪除 ${count} 張便利貼`,
      true,
    )
  ) {
    selected.clear();
    selectionMode = false;
    render();
  }
});
$("#batch-recolor").addEventListener("click", () => {
  const color = $("#batch-color").value;
  if (!selected.size || !COLORS.has(color) || color === "custom") return;
  const count = selected.size;
  if (
    commit(
      notes.map((note) =>
        selected.has(note.id)
          ? { ...note, color, updatedAt: Date.now() }
          : note,
      ),
      `已替 ${count} 張便利貼換色`,
    )
  ) {
    selected.clear();
    selectionMode = false;
    $("#batch-color").value = "";
    render();
  }
});
$("#view-toggle").addEventListener("click", () => {
  view = view === "list" ? "board" : "list";
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {}
  render();
});
$("#theme-toggle").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
});
$("#export-button").addEventListener("click", () => {
  const data = JSON.stringify(
    { app: "貼一下", version: 2, exportedAt: new Date().toISOString(), notes },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `sticky-notes-backup-${today()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已匯出 ${notes.length} 張便利貼`);
});
$("#import-button").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error("檔案超過 5 MB");
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : parsed.notes;
    if (!Array.isArray(source)) throw new Error("找不到便利貼資料");
    const ids = new Set(notes.map((note) => note.id));
    const imported = source.map(normalizeNote).filter((note) => {
      if (!note || ids.has(note.id)) return false;
      ids.add(note.id);
      return true;
    });
    if (commit([...imported, ...notes], `已匯入 ${imported.length} 張便利貼`)) {
      $("#state-filter").value = "active";
      activeColor = "all";
      $("#search-input").value = "";
      render();
    }
  } catch (error) {
    showToast(`匯入失敗：${error.message}`);
  }
  event.target.value = "";
});
$("#print-button").addEventListener("click", () => window.print());
$("#undo-delete").addEventListener("click", () => {
  if (undoSnapshot && persist(undoSnapshot)) {
    clearTimeout(toastTimer);
    undoSnapshot = null;
    $("#toast").hidden = true;
    render();
    announce("已復原便利貼");
  }
});
$("#dismiss-toast").addEventListener("click", () => {
  clearTimeout(toastTimer);
  undoSnapshot = null;
  $("#toast").hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Escape" && selectionMode) {
    selectionMode = false;
    selected.clear();
    render();
    return;
  }
  if (event.target.matches("input,textarea,select") || $("#edit-dialog").open)
    return;
  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    $("#note-content").focus();
  } else if (event.key === "/") {
    event.preventDefault();
    $("#search-input").focus();
  }
});
$("#today-date").textContent = new Intl.DateTimeFormat("zh-TW", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
applyTheme(readPreference(THEME_KEY, "light") === "dark" ? "dark" : "light");
if (view !== "list") view = "board";
render();
