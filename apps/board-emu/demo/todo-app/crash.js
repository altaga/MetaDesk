// Dev-server style crash screen: any uncaught error replaces the page with the
// error and its stack, so a broken build is impossible to miss in a preview.
window.addEventListener("error", (event) => {
  const error = event.error || { name: "Error", message: event.message, stack: "" };
  const screen = document.createElement("section");
  screen.className = "crash";
  screen.innerHTML =
    '<p class="crash__tag">APPLICATION CRASHED</p>' +
    '<h1 class="crash__name"></h1><p class="crash__message"></p><pre class="crash__stack"></pre>';
  screen.querySelector(".crash__name").textContent = error.name || "Error";
  screen.querySelector(".crash__message").textContent = error.message || String(event.message);
  screen.querySelector(".crash__stack").textContent =
    `${error.stack || ""}\n    at ${event.filename || "app.js"}:${event.lineno}:${event.colno}`;
  document.body.replaceChildren(screen);
});
