import Core from "./core.mjs";

(() => {
  "use strict";
  const TEST_MODE = window.__CHECKOUT_REPORTER_TEST_MODE__ === true && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const ON_ASSIGNMENTS = TEST_MODE || (/admin\.usefull\.us$/i.test(location.hostname) && /\/assignments/i.test(location.pathname));
  const PAGE_SIZE = 1000;
  const ACTIVE_PAGE_SIZE = TEST_MODE ? 2 : PAGE_SIZE;
  const MAX_PAGES = 50;
  const CAPTURE_TIMEOUT_MS = 180000;
  const REQUEST_TIMEOUT_MS = 90000;
  const DB_NAME = TEST_MODE ? "checkout-reporter-test-v1" : "checkout-reporter-v1";
  const DB_VERSION = 1;
  const ROOT_ID = "checkout-reporter-root";

  if (window.__CHECKOUT_REPORTER_PANEL__) {
    window.__CHECKOUT_REPORTER_PANEL__.toggle();
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const safeJson = (value) => {
    try { return JSON.parse(value); } catch { return null; }
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("assignments")) {
          const assignments = db.createObjectStore("assignments", { keyPath: "id" });
          assignments.createIndex("assignedMs", "assignedMs");
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeRows(rows) {
    const db = await openDb();
    const known = await new Promise((resolve, reject) => {
      const request = db.transaction("assignments").objectStore("assignments").getAllKeys();
      request.onsuccess = () => resolve(new Set(request.result.map(String)));
      request.onerror = () => reject(request.error);
    });
    let added = 0;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["assignments", "meta"], "readwrite");
      const assignments = tx.objectStore("assignments");
      for (const row of rows) {
        if (!known.has(String(row.id))) added += 1;
        assignments.put(row);
      }
      const newest = rows.reduce((max, row) => Math.max(max, row.assignedMs), 0);
      if (newest) tx.objectStore("meta").put(newest, "newestAssignedMs");
      tx.objectStore("meta").put(new Date().toISOString(), "lastRunAt");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { added, duplicates: rows.length - added };
  }

  async function getStoredRows() {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction("assignments").objectStore("assignments").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return Core.dedupeAssignments(rows);
  }

  async function getLastRun() {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("meta").objectStore("meta").get("lastRunAt");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }

  async function clearStoredRows() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["assignments", "meta"], "readwrite");
      tx.objectStore("assignments").clear();
      tx.objectStore("meta").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .panel{position:fixed;z-index:2147483647;right:16px;top:16px;width:min(410px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#f8faf9;color:#173331;border:1px solid rgba(18,62,58,.18);border-radius:12px;box-shadow:0 18px 50px rgba(10,35,33,.24);font:13px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 13px;border-bottom:1px solid rgba(18,62,58,.12)}
      h1{font-size:17px;line-height:1.15;margin:0;letter-spacing:-.01em}
      button{font:inherit}
      .close{border:0;background:transparent;color:#6d807e;font-size:20px;line-height:1;padding:2px 4px;cursor:pointer}
      main{padding:16px 18px 18px}
      .receipt{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px;background:#edf3f1;border:1px solid rgba(18,62,58,.1);border-radius:8px;margin-bottom:12px}
      .metric span,.checkpoint span,.section-label{display:block;color:#667c79;font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.08em}
      .metric b{display:block;margin-top:2px;font-size:17px;font-variant-numeric:tabular-nums}
      .checkpoint{padding:11px 12px;margin-bottom:12px;background:#fff;border:1px solid rgba(18,62,58,.1);border-radius:7px}
      .checkpoint b{display:block;margin-top:3px;font-size:13px;font-variant-numeric:tabular-nums}
      .checkpoint small{display:block;margin-top:3px;color:#667c79;font-size:11px}
      .scope{display:block;margin-top:7px;color:#205a55;font-weight:700}
      .status{min-height:54px;margin:0 0 12px;padding:11px 12px;border-left:3px solid #16877e;background:#fff;color:#425a57}
      .status.error{border-color:#b34a3b;background:#fff7f5;color:#702b22}
      .controls{display:grid;gap:10px;margin-bottom:12px}
      label{display:block;color:#596f6c;font-size:11px;font-weight:700}
      .helper{display:block;margin-top:3px;color:#718481;font-size:10.5px;font-weight:400}
      input{width:100%;margin-top:5px;padding:8px 9px;border:1px solid rgba(18,62,58,.22);border-radius:6px;background:#edf3f1;color:#173331;font:inherit;font-variant-numeric:tabular-nums}
      .primary,.secondary,.danger{width:100%;border-radius:7px;padding:9px 11px;cursor:pointer;font-weight:750}
      .primary{border:1px solid #106f68;background:#106f68;color:#fff}
      .primary:disabled{opacity:.55;cursor:wait}
      .section-label{margin:15px 0 7px}
      .exports{display:grid;gap:8px}
      .secondary{border:1px solid #8aa19e;background:#fff;color:#205a55;text-align:left}
      details{margin-top:13px;padding-top:11px;border-top:1px solid rgba(18,62,58,.12);color:#647875;font-size:11px}
      summary{cursor:pointer;color:#425a57;font-weight:700}
      details p{margin:7px 0 0}
      .danger{margin-top:8px;border:0;background:transparent;color:#8a3d33;font-size:11px;padding:5px}
      [hidden]{display:none!important}
    </style>
    <section class="panel" role="dialog" aria-label="Checkout Reporter">
      <header><h1>Checkout Reporter</h1><button class="close" aria-label="Close">×</button></header>
      <main>
        <div class="receipt">
          <div class="metric"><span>Rows on file</span><b id="stored">—</b></div>
          <div class="metric"><span>New this sync</span><b id="added">—</b></div>
          <div class="metric"><span>Duplicates skipped</span><b id="skipped">—</b></div>
        </div>
        <div class="checkpoint">
          <span>Newest checkout on file</span>
          <b id="newest">None yet</b>
          <small id="checkpoint-note">Choose how much history to collect on the first sync.</small>
          <span class="scope" id="scope" hidden></span>
        </div>
        <p class="status" id="status">Ready to sync checkout assignments.</p>
        <div class="controls">
          <label id="initial-field">Initial history
            <input id="days" type="number" min="1" max="90" value="14">
            <span class="helper">Only used when there is no saved report data.</span>
          </label>
          <label>Transaction grouping window
            <input id="gap" type="number" min="0" max="300" value="30">
            <span class="helper">Same user and location, with no more than this many seconds between containers.</span>
          </label>
        </div>
        <button class="primary" id="sync">Sync new checkouts</button>
        <div class="section-label">Downloads</div>
        <div class="exports">
          <button class="secondary" id="daily">↓ Download Daily by Location (.csv)</button>
          <button class="secondary" id="detail">↓ Download Transaction Log (.csv)</button>
        </div>
        <details>
          <summary>Where is this data saved?</summary>
          <p>Report data is saved in this Chrome profile and survives page refreshes and browser restarts. It is not uploaded or stored in cookies. It is removed if you clear this site’s data, use Clear Report Data, or close an Incognito session. Other profiles, browsers, and computers have separate data.</p>
        </details>
        <button class="danger" id="clear">Clear Report Data</button>
      </main>
    </section>
  `;

  const $ = (selector) => shadow.querySelector(selector);
  const panel = $(".panel");
  const status = $("#status");
  const syncButton = $("#sync");
  let visible = true;
  let running = false;
  const api = {
    toggle() {
      visible = !visible;
      panel.hidden = !visible;
    },
  };
  window.__CHECKOUT_REPORTER_PANEL__ = api;
  $(".close").onclick = () => api.toggle();

  function say(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function readableTime(value) {
    if (!value) return "None yet";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "None yet";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function clientNames(rows) {
    return [...new Set(rows.map((row) => String(row.clientName || "").trim()).filter(Boolean))].sort();
  }

  async function refreshState() {
    const [rows, lastRun] = await Promise.all([getStoredRows(), getLastRun()]);
    $("#stored").textContent = rows.length.toLocaleString();
    const newest = rows.reduce((max, row) => Math.max(max, row.assignedMs || 0), 0);
    $("#newest").textContent = readableTime(newest);
    $("#checkpoint-note").textContent = rows.length
      ? "Future syncs will pick up any checkouts after this time."
      : "Choose how much history to collect on the first sync.";
    $("#initial-field").hidden = rows.length > 0;
    const names = clientNames(rows);
    $("#scope").hidden = names.length !== 1;
    $("#scope").textContent = names.length === 1 ? `Reporting for: ${names[0]}` : "";
    if (lastRun && rows.length) $("#checkpoint-note").title = `Last synced ${readableTime(lastRun)}`;
    return rows;
  }

  function download(name, csv) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function capturedRequest(input, init = {}) {
    const requestLike = input && typeof input === "object" && "url" in input;
    const url = requestLike ? input.url : String(input);
    const body = typeof init.body === "string" ? init.body : null;
    if (!body || !/assignment/i.test(body)) return null;
    const json = safeJson(body);
    if (!json?.query || !/listAssignment/i.test(json.query)) return null;
    const headers = {};
    const collect = (source) => {
      if (!source) return;
      if (typeof source.forEach === "function") source.forEach((value, key) => { headers[String(key).toLowerCase()] = value; });
      else Object.entries(source).forEach(([key, value]) => { headers[key.toLowerCase()] = value; });
    };
    if (requestLike) collect(input.headers);
    collect(init.headers);
    return {
      url: new URL(url, location.href).href,
      method: init.method || (requestLike ? input.method : "POST") || "POST",
      headers,
      credentials: init.credentials || (requestLike ? input.credentials : "same-origin") || "same-origin",
      body: json,
    };
  }

  function sortState(header) {
    const aria = String(header?.getAttribute("aria-sort") || "").toLowerCase();
    if (aria === "ascending" || aria === "descending") return aria;
    const classes = String(header?.className || "").toLowerCase();
    if (/descend/.test(classes)) return "descending";
    if (/ascend/.test(classes)) return "ascending";
    return "";
  }

  async function triggerAssignmentsRefresh() {
    const header = [...document.querySelectorAll("th")].find((node) =>
      /assigned\s+on/i.test(String(node.textContent || "").replace(/\s+/g, " ").trim())
    );
    if (!header) return false;
    const target = header.querySelector('[class*="column-sorters"],button,[role="button"]') || header;
    const before = sortState(header);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    await sleep(450);
    const after = sortState(header);
    if (before === "descending" || (after && after !== "descending")) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await sleep(350);
    }
    return true;
  }

  async function waitForAssignmentsRequest() {
    if (window.__CHECKOUT_REPORTER_CAPTURE__) return window.__CHECKOUT_REPORTER_CAPTURE__;
    const originalFetch = window.fetch;
    let match = null;
    window.fetch = function(input, init) {
      try {
        match ||= capturedRequest(input, init);
        if (match) window.__CHECKOUT_REPORTER_CAPTURE__ = match;
      } catch {}
      return originalFetch.apply(this, arguments);
    };
    say("Connecting to the Assignments table…");
    try {
      const triggered = await triggerAssignmentsRefresh();
      const started = Date.now();
      let fallbackShown = false;
      while (!match && Date.now() - started < CAPTURE_TIMEOUT_MS) {
        if (!fallbackShown && Date.now() - started > 6000) {
          fallbackShown = true;
          say(triggered
            ? "The table did not refresh automatically. Click the Assigned On heading once."
            : "Could not find the Assigned On heading. Click it once to continue.");
        }
        await sleep(200);
      }
      if (!match) throw new Error("No Assignments request was detected. Refresh the page and try again.");
      return match;
    } finally {
      window.fetch = originalFetch;
    }
  }

  const SLIM_QUERY = `query CheckoutReport($where: WhereAssignmentInput, $pagination: PaginationInput, $order: [OrderInput!]) {
    listAssignment(where: $where, pagination: $pagination, order: $order) {
      list {
        assignment_id
        assigned_on
        user { full_name }
        container { unique_name corporateClient { name } }
        from_location { pretty_name }
      }
    }
  }`;

  function reportWhere(capture) {
    const clientFilter = capture.body?.variables?.where?.container?.corporate_client_id;
    return clientFilter ? { container: { corporate_client_id: clone(clientFilter) } } : {};
  }

  async function fetchPage(capture, page) {
    const body = clone(capture.body);
    body.operationName = "CheckoutReport";
    body.query = SLIM_QUERY;
    body.variables ||= {};
    body.variables.where = reportWhere(capture);
    body.variables.pagination = { page, size: ACTIVE_PAGE_SIZE };
    body.variables.order = [{ field: "assigned_on", order: "DESC" }];
    const headers = {};
    for (const [key, value] of Object.entries(capture.headers)) {
      if (!["content-length", "host", "origin", "referer"].includes(key)) headers[key] = value;
    }
    headers["content-type"] ||= "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(capture.url, {
        method: capture.method,
        headers,
        credentials: capture.credentials,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await response.json();
      if (!response.ok || json.errors?.length) {
        throw new Error(json.errors?.[0]?.message || `Request failed (${response.status})`);
      }
      return json?.data?.listAssignment?.list || [];
    } finally {
      clearTimeout(timer);
    }
  }

  async function sync() {
    if (running) return;
    running = true;
    syncButton.disabled = true;
    $("#added").textContent = "—";
    $("#skipped").textContent = "—";
    try {
      const existing = await getStoredRows();
      const newestStored = existing.reduce((max, row) => Math.max(max, row.assignedMs || 0), 0);
      const days = Math.min(90, Math.max(1, Number($("#days").value) || 14));
      const cutoff = newestStored ? newestStored - 120000 : Date.now() - days * 86400000;
      const capture = await waitForAssignmentsRequest();
      const pulled = [];
      let reachedCutoff = false;
      let page = 1;
      while (page <= MAX_PAGES && !reachedCutoff) {
        say(`Fetching page ${page}… ${pulled.length.toLocaleString()} rows received.`);
        const rawRows = await fetchPage(capture, page);
        if (!rawRows.length) break;
        for (const raw of rawRows) {
          const row = Core.normalizeApiRow(raw);
          if (!row) continue;
          if (row.assignedMs < cutoff) {
            reachedCutoff = true;
            break;
          }
          pulled.push(row);
        }
        if (rawRows.length < ACTIVE_PAGE_SIZE) break;
        page += 1;
      }
      if (page > MAX_PAGES && !reachedCutoff) {
        throw new Error("Stopped at the 50-page safety limit before reaching the saved checkpoint.");
      }
      const normalized = Core.dedupeAssignments(pulled);
      const names = clientNames([...existing, ...normalized]);
      if (!names.length && normalized.length) {
        throw new Error("Could not verify the Corporate Client for these assignments. No data was saved.");
      }
      if (names.length > 1) {
        throw new Error("Assignments from more than one Corporate Client were found. Select one Corporate Client filter in the table, then sync again. No data was saved.");
      }
      const receipt = await storeRows(normalized);
      const all = await refreshState();
      $("#added").textContent = receipt.added.toLocaleString();
      $("#skipped").textContent = receipt.duplicates.toLocaleString();
      const tx = Core.groupTransactions(all, Number($("#gap").value) || 30);
      say(`Sync complete. ${receipt.added.toLocaleString()} new rows added; ${tx.length.toLocaleString()} transactions are ready to download.`);
    } catch (error) {
      say(error?.message || String(error), true);
    } finally {
      running = false;
      syncButton.disabled = false;
    }
  }

  if (ON_ASSIGNMENTS) {
    syncButton.onclick = sync;
  } else {
    syncButton.textContent = "Open Assignments";
    say("Open the Assignments page, then click the Checkout Reporter bookmark again.");
    syncButton.onclick = () => { location.href = "https://admin.usefull.us/assignments"; };
  }

  $("#daily").onclick = async () => {
    const rows = await refreshState();
    if (!rows.length) return say("Sync at least once before downloading a report.", true);
    const stamp = Core.timestampParts(Date.now()).date;
    download(`daily-by-location-${stamp}.csv`, Core.dailyCsv(rows, Number($("#gap").value) || 30));
    say("Daily by Location downloaded.");
  };
  $("#detail").onclick = async () => {
    const rows = await refreshState();
    if (!rows.length) return say("Sync at least once before downloading a report.", true);
    const stamp = Core.timestampParts(Date.now()).date;
    download(`transaction-log-${stamp}.csv`, Core.transactionsCsv(rows, Number($("#gap").value) || 30));
    say("Transaction Log downloaded.");
  };
  $("#clear").onclick = async () => {
    if (!confirm("Clear all checkout report rows saved in this browser?")) return;
    await clearStoredRows();
    $("#added").textContent = "—";
    $("#skipped").textContent = "—";
    await refreshState();
    say("Saved report data cleared.");
  };
  refreshState().catch((error) => say("Could not open browser storage: " + error.message, true));
})();
