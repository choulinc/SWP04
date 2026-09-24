const STORAGE_KEY = "swp04-sticky-notes-v1";
const COLORS = new Set([
  "yellow",
  "pink",
  "blue",
  "green",
  "lavender",
  "peach",
]);
const $ = (selector) => document.querySelector(selector);
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateText = (timestamp) =>
  new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(
    new Date(timestamp),
  );
let notes = loadNotes();
let activeColor = "all";
let editingId = null;
let undoSnapshot = null;
let toastTimer = null;

function normalizeNote(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.content !== "string" ||
    !value.content.trim()
  )
    return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid(),
    title:
      typeof value.title === "string" ? value.title.trim().slice(0, 80) : "",
    content: value.content.trim().slice(0, 2000),
    color: COLORS.has(value.color) ? value.color : "yellow",
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
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
  const previous = notes.map((note) => ({ ...note }));
  if (!persist(next)) return false;
  render();
  showToast(message, undo ? previous : null);
  return true;
}
function visibleNotes() {
  const query = $("#search-input").value.trim().toLocaleLowerCase();
  return notes.filter(
    (note) =>
      (activeColor === "all" || note.color === activeColor) &&
      (!query ||
        `${note.title} ${note.content}`.toLocaleLowerCase().includes(query)),
  );
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
function makeNote(note, visible, index) {
  const card = document.createElement("article");
  card.className = `sticky-note note-${note.color}`;
  card.dataset.id = note.id;
  card.draggable = true;
  card.setAttribute(
    "aria-label",
    `${note.title || "無標題便利貼"}：${note.content}`,
  );
  const top = document.createElement("div");
  top.className = "note-top";
  const date = document.createElement("span");
  date.className = "note-date";
  date.textContent = dateText(note.updatedAt);
  const controls = document.createElement("div");
  controls.className = "note-controls";
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
  prev.disabled = index === 0;
  next.disabled = index === visible.length - 1;
  controls.append(handle, prev, next);
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
  const bottom = document.createElement("div");
  bottom.className = "note-bottom";
  const edit = actionButton(
    "編輯便利貼",
    "edit",
    note.id,
    '<path d="m15 5 4 4M4 20l4.5-.9L19 8.6 15.4 5 4.9 15.5 4 20Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  );
  const remove = actionButton(
    "刪除便利貼",
    "delete",
    note.id,
    '<path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  );
  bottom.append(edit, remove);
  card.append(top, body, bottom);
  return card;
}
function render() {
  const visible = visibleNotes();
  $("#notes-grid").replaceChildren(
    ...visible.map((note, index) => makeNote(note, visible, index)),
  );
  $("#note-count").textContent = notes.length;
  $("#board-subtitle").textContent = notes.length
    ? `這裡存著 ${notes.length} 個想法。`
    : "所有靈感，都有自己的位置。";
  $("#empty-state").hidden = visible.length > 0;
  $("#board-tip").hidden = notes.length < 2;
  if (!visible.length) {
    const empty = notes.length === 0;
    $("#empty-title").textContent = empty
      ? "這裡等著你的第一個想法"
      : "沒有找到符合的便利貼";
    $("#empty-copy").textContent = empty
      ? "在左側寫下內容，選個顏色，就能把它貼上看板。"
      : "換個關鍵字，或選擇其他顏色看看。";
  }
  document.querySelectorAll(".color-filter").forEach((button) => {
    const active = button.dataset.color === activeColor;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function openEditor(note) {
  editingId = note.id;
  $("#edit-note-title").value = note.title;
  $("#edit-note-content").value = note.content;
  $(`#edit-color-picker input[value="${note.color}"]`).checked = true;
  $("#edit-error").hidden = true;
  $("#edit-dialog").showModal();
  $("#edit-note-content").focus();
}
function moveNote(id, direction) {
  const visible = visibleNotes();
  const current = visible.findIndex((note) => note.id === id);
  const other = visible[current + direction];
  if (!other) return;
  const first = notes.findIndex((note) => note.id === id);
  const second = notes.findIndex((note) => note.id === other.id);
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
  if (!sourceId || sourceId === targetId) return;
  const source = notes.find((note) => note.id === sourceId);
  const target = notes.find((note) => note.id === targetId);
  if (!source || !target) return;
  const next = notes.filter((note) => note.id !== sourceId);
  const index = next.findIndex((note) => note.id === targetId);
  next.splice(index + Number(after), 0, source);
  if (next.every((note, index) => note.id === notes[index].id)) return;
  commit(next, "已儲存便利貼的新順序");
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
    color: $('input[name="new-color"]:checked').value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (commit([note, ...notes], "便利貼已貼上看板")) {
    $("#note-form").reset();
    $("#search-input").value = "";
    activeColor = "all";
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
  if (button.dataset.action === "edit") openEditor(note);
  else if (button.dataset.action === "delete")
    commit(
      notes.filter((item) => item.id !== note.id),
      "便利貼已刪除",
      true,
    );
  else if (button.dataset.action === "move-prev") moveNote(note.id, -1);
  else if (button.dataset.action === "move-next") moveNote(note.id, 1);
});
$("#notes-grid").addEventListener("dragstart", (event) => {
  const card = event.target.closest(".sticky-note");
  if (!card || event.target.closest("button")) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", card.dataset.id);
  card.classList.add("is-dragging");
});
$("#notes-grid").addEventListener("dragover", (event) => {
  const card = event.target.closest(".sticky-note");
  if (!card || card.classList.contains("is-dragging")) return;
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
  const id = event.dataTransfer.getData("text/plain");
  reorderByDrop(id, card.dataset.id, card.classList.contains("drop-after"));
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
  const next = notes.map((note) =>
    note.id === editingId
      ? {
          ...note,
          title: $("#edit-note-title").value.trim(),
          content,
          color: $('input[name="edit-color"]:checked').value,
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
$("#search-input").addEventListener("input", render);
document.querySelectorAll(".color-filter").forEach((button) =>
  button.addEventListener("click", () => {
    activeColor = button.dataset.color;
    render();
  }),
);
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
$("#today-date").textContent = new Intl.DateTimeFormat("zh-TW", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
render();
