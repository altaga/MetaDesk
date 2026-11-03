// A small todo list that keeps its items in localStorage.
const STORAGE_KEY = "todo-items";

function loadItems() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  return items;
}

let items = saveItems(loadItems());
let filter = "all";

function setItems(next) {
  items = saveItems(next);
  render();
}

function addItem(title) {
  setItems([...items, { id: Date.now(), title, done: false }]);
}

function toggleItem(id) {
  setItems(items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
}

function render() {
  const visible = items.filter((item) =>
    filter === "all" ? true : filter === "done" ? item.done : !item.done,
  );
  const left = items.filter((item) => !item.done).length;
  const app = document.getElementById("app");
  app.innerHTML = `
    <p class="eyebrow">Board demo</p>
    <h1>Todo</h1>
    <p class="muted">A small task list that runs on your machine.</p>
    <form class="add"><input name="title" placeholder="Add a task and press Enter" autocomplete="off" /><button>Add</button></form>
    <div class="filters">
      ${["all", "active", "done"].map((name) => `<button data-filter="${name}" class="${filter === name ? "on" : ""}">${name[0].toUpperCase() + name.slice(1)}</button>`).join("")}
    </div>
    <ul class="list">${visible.map((item) => `<li><label><input type="checkbox" data-id="${item.id}" ${item.done ? "checked" : ""} /> <span class="${item.done ? "done" : ""}"></span></label></li>`).join("") || '<li class="muted">No tasks here yet.</li>'}</ul>
    <p class="muted small">${left} left</p>`;
  app.querySelectorAll(".list span").forEach((span, index) => {
    span.textContent = visible[index].title;
  });
  app.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = event.target.title.value.trim();
    if (title) addItem(title);
  });
  app.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      render();
    }),
  );
  app.querySelectorAll("[data-id]").forEach((box) =>
    box.addEventListener("change", () => toggleItem(Number(box.dataset.id))),
  );
}

render();
