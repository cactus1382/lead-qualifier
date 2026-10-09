// Zero-dependency embeddable widget. No build step, no framework, no globals
// beyond one window.__lq. Drop the script tag on a page and it works.
(function () {
  var script = document.currentScript;
  var SITE = (script && script.getAttribute("data-site")) || "default";
  var BASE = (script && script.getAttribute("data-base")) || "";
  var SESSION = "lq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  var state = { open: false, messages: [], busy: false, contactAsked: false };

  var el = document.createElement("div");
  el.id = "lq-root";
  document.body.appendChild(el);

  var css = document.createElement("style");
  css.textContent =
    "#lq-root{position:fixed;inset:0;pointer-events:none;z-index:99999;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}" +
    "#lq-btn{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;background:#16a34a;color:#fff;border:0;cursor:pointer;pointer-events:auto;font-size:22px;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}" +
    "#lq-panel{position:fixed;right:18px;bottom:86px;width:340px;max-width:calc(100vw - 28px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;pointer-events:auto}" +
    "#lq-panel.lq-open{display:flex}" +
    "#lq-head{background:#16a34a;color:#fff;padding:12px 14px;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center}" +
    "#lq-close{background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1}" +
    "#lq-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f7f8fa}" +
    ".lq-b{max-width:82%;padding:8px 11px;border-radius:11px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}" +
    ".lq-bot{background:#fff;border:1px solid #e2e6eb;align-self:flex-start;border-bottom-left-radius:3px}" +
    ".lq-me{background:#16a34a;color:#fff;align-self:flex-end;border-bottom-right-radius:3px}" +
    ".lq-typ{align-self:flex-start;color:#8a93a0;font-size:12px;padding:4px 2px}" +
    "#lq-form{display:flex;padding:10px;gap:8px;border-top:1px solid #e7ebf0;background:#fff}" +
    "#lq-in{flex:1;border:1px solid #d3d9e0;border-radius:9px;padding:9px 11px;font-size:13.5px;outline:none;font-family:inherit}" +
    "#lq-in:focus{border-color:#16a34a}" +
    "#lq-send{background:#16a34a;color:#fff;border:0;border-radius:9px;padding:0 14px;font-size:14px;cursor:pointer}" +
    "#lq-send:disabled{opacity:.5;cursor:default}" +
    "@media(max-width:480px){#lq-panel{width:calc(100vw - 20px);right:10px;height:calc(100vh - 96px)}}";
  document.head.appendChild(css);

  var btn = document.createElement("button");
  btn.id = "lq-btn";
  btn.textContent = "💬";
  btn.setAttribute("aria-label", "Chat");
  el.appendChild(btn);

  var panel = document.createElement("div");
  panel.id = "lq-panel";
  el.appendChild(panel);

  panel.innerHTML =
    '<div id="lq-head"><span id="lq-title">Chat with us</span><button id="lq-close" aria-label="Close">✕</button></div>' +
    '<div id="lq-log"></div>' +
    '<form id="lq-form"><input id="lq-in" placeholder="Type a message…" autocomplete="off" aria-label="Message"><button id="lq-send" type="submit">Send</button></form>';

  var log = panel.querySelector("#lq-log");
  var input = panel.querySelector("#lq-in");
  var form = panel.querySelector("#lq-form");

  function api(path) {
    return (BASE || "") + "/api/" + SITE + path;
  }

  function bubble(role, text) {
    var d = document.createElement("div");
    d.className = "lq-b " + (role === "assistant" ? "lq-bot" : "lq-me");
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function typing(on, text) {
    var old = panel.querySelector(".lq-typ");
    if (old) old.remove();
    if (!on) return;
    var d = document.createElement("div");
    d.className = "lq-typ";
    d.textContent = text || "typing…";
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function setBusy(b) {
    state.busy = b;
    panel.querySelector("#lq-send").disabled = b;
    input.disabled = b;
  }

  async function send(message) {
    if (state.busy || !message.trim()) return;
    bubble("user", message);
    state.messages.push({ role: "user", content: message });
    input.value = "";
    setBusy(true);
    typing(true);
    try {
      var res = await fetch(api("/chat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message, sessionId: SESSION }),
      });
      var data = await res.json();
      typing(false);
      if (!res.ok) {
        bubble("assistant", "Sorry, something went wrong. Could you try that again?");
      } else {
        bubble("assistant", data.reply);
        state.messages.push({ role: "assistant", content: data.reply });
        if (data.complete && data.lead) {
          askContact(data.lead.tier);
        }
      }
    } catch (e) {
      typing(false);
      bubble("assistant", "Connection trouble — please try once more.");
    } finally {
      setBusy(false);
    }
  }

  function askContact(tier) {
    if (state.contactAsked) return;
    state.contactAsked = true;
    var d = document.createElement("form");
    d.className = "lq-b lq-bot";
    d.style.display = "flex";
    d.style.gap = "6px";
    d.innerHTML =
      '<input placeholder="your@email.com" style="flex:1;border:1px solid #d3d9e0;border-radius:7px;padding:6px 8px;font-size:13px;min-width:0">' +
      '<button type="submit" style="background:#16a34a;color:#fff;border:0;border-radius:7px;padding:6px 10px;font-size:12.5px;cursor:pointer">Send</button>';
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    d.addEventListener("submit", async function (e) {
      e.preventDefault();
      var v = d.querySelector("input").value.trim();
      if (!v) return;
      d.remove();
      bubble("user", v);
      try {
        await fetch(api("/lead"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contact: v, sessionId: SESSION }),
        });
        bubble("assistant", "Got it — we'll be in touch. Thanks!");
      } catch (err) {
        bubble("assistant", "Saved locally; we'll follow up.");
      }
    });
  }

  btn.addEventListener("click", function () {
    state.open = !state.open;
    panel.classList.toggle("lq-open", state.open);
    if (state.open) input.focus();
  });
  panel.querySelector("#lq-close").addEventListener("click", function () {
    state.open = false;
    panel.classList.remove("lq-open");
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });

  // Greet once, then only if the panel has never been opened.
  (async function greet() {
    try {
      var res = await fetch(api("/config"), { method: "GET" });
      if (!res.ok) return;
      var cfg = await res.json();
      panel.querySelector("#lq-title").textContent = cfg.name || "Chat with us";
      var hello =
        "Hi! I can answer questions about " +
        (cfg.name || "us") +
        ". What are you looking for today?";
      bubble("assistant", hello);
      state.messages.push({ role: "assistant", content: hello });
    } catch (e) {}
  })();
})();
