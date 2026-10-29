(() => {
  "use strict";
  const shopOrigin = "https://epistemic.co.za";
  let shopApiBase = shopOrigin;
  let shopApiBaseLoading = null;
  const form = document.getElementById("shopForm");
  const status = document.getElementById("shopStatus");
  const send = document.getElementById("shopSend");
  const resultLink = document.getElementById("shopResult");
  let robot = null;
  let rows = [];
  let robotSignature = "";
  let busy = false;
  const products = new Map();
  let catalogLoading = null;
  let catalogLoaded = false;

  async function getShopApiBase() {
    if (!shopApiBaseLoading) {
      shopApiBaseLoading = (async () => {
        try {
          const response = await fetch("/api/devserver", { cache: "no-store", signal: AbortSignal.timeout(1500) });
          if (response.ok && (await response.json()).shopProxy === true) shopApiBase = "";
        } catch (_) { /* Non-devserver hosts use the online shop directly. */ }
      })();
    }
    await shopApiBaseLoading;
    return shopApiBase;
  }

  function updateThumbnail(row) {
    row.photo.replaceChildren();
    const product = products.get(row.id.value.trim());
    if (product?.imageUrl) {
      try {
        const url = new URL(product.imageUrl, shopOrigin);
        if (url.protocol !== "https:") throw new Error("Invalid image URL");
        const image = document.createElement("img");
        image.className = "shop-thumbnail";
        image.alt = product.name || row.label;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => { row.photo.textContent = "Image unavailable"; }, { once: true });
        image.src = url.href;
        row.photo.append(image);
        return;
      } catch (_) { /* Invalid image URLs use the text fallback. */ }
    }
    row.photo.textContent = "No image";
  }

  async function loadCatalog() {
    if (catalogLoaded || catalogLoading) return catalogLoading;
    const message = document.getElementById("shopImagesStatus");
    message.textContent = "Loading product images…";
    catalogLoading = (async () => {
      try {
        const response = await fetch(await getShopApiBase() + "/api/shop", { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("HTTP " + response.status);
        
        const result = await response.json();
        console.log(result);
        if (!Array.isArray(result.products)) throw new Error("Invalid catalogue response");
        for (const product of result.products) if (typeof product.id === "string") products.set(product.id, product);
        catalogLoaded = true;
        rows.forEach(updateThumbnail);
        message.textContent = "";
      } catch (_) {
        message.textContent = "Product images could not be loaded. You can still review and send parts. Reload the parts list to retry.";
      } finally { catalogLoading = null; }
    })();
    return catalogLoading;
  }
  const integrated = Boolean(document.getElementById("shopPanel"));
  document.addEventListener("shop:robot", event => {
    if (busy) return;
    const signature = JSON.stringify(event.detail);
    if (signature === robotSignature) { send.disabled = rows.length === 0; return; }
    showRobot(event.detail);
    robotSignature = signature;
  });

  function showRobot(value) {
    if (!value?.definition || !Array.isArray(value.definition.components)) throw new Error("Robot has no component list.");
    robot = value;
    document.getElementById("shopRobotName").value = robot.name || "Robot";
    const groups = new Map();
    for (const component of robot.definition.components) {
      const type = component.objectType ?? "Servo";
      if (["Null", "Target"].includes(type)) continue;
      const id = component.shopProductId || "";
      // Keep legacy model keys compatible while showing the actual hardware name.
      const servoNames = { standard: "TD-7120MG", micro: "SG90" };
      const hardwareType = component.type?.trim();
      const label = type === "Servo"
        ? hardwareType && !["Servo", "standard", "micro", "MicroServo 9g"].includes(hardwareType)
          ? hardwareType : servoNames[component.model ?? "standard"] || component.model
        : type + (component.model ? " (" + component.model + ")" : "");
      const key = JSON.stringify([type, label, id]);
      if (!groups.has(key)) groups.set(key, { label, id, quantity: 0, components: [] });
      groups.get(key).quantity++;
      groups.get(key).components.push(component);
    }
    const controller = robot.definition.servoController;
    if (controller?.shopProductId) groups.set("servoController", {
      label: controller.name || "PCA9685", id: controller.shopProductId, quantity: 1, components: [controller]
    });
    const body = document.getElementById("shopParts");
    body.replaceChildren();
    rows = Array.from(groups.values()).map(group => {
      const row = document.createElement("tr");
      const include = document.createElement("input");
      include.type = "checkbox"; include.checked = true;
      include.setAttribute("aria-label", "Include " + group.label);
      const label = document.createElement("span"); label.textContent = group.label;
      const photo = document.createElement("span"); photo.className = "shop-thumbnail-cell";
      const id = document.createElement("input"); id.value = group.id;
      id.placeholder = "Catalogue ID"; id.required = true;
      id.setAttribute("aria-label", group.label + " product ID");
      const quantity = document.createElement("input");
      quantity.type = "number"; quantity.min = "1"; quantity.max = "99"; quantity.step = "1";
      quantity.required = true; quantity.value = group.quantity;
      quantity.setAttribute("aria-label", group.label + " quantity");
      include.addEventListener("change", () => { id.disabled = quantity.disabled = !include.checked; });
      for (const element of [include, photo, label, id, quantity]) {
        const cell = document.createElement("td"); cell.append(element); row.append(cell);
      }
      body.append(row);
      const entry = { include, id, quantity, photo, label: group.label };
      
      id.addEventListener("input", () => {        
        group.components.forEach(component => { component.shopProductId = id.value.trim() || null; });
        updateThumbnail(entry);
        resultLink.hidden = true;
      });
      updateThumbnail(entry);
      return entry;
    });
    send.disabled = rows.length === 0;
    resultLink.hidden = true;
    status.textContent = rows.length ? "Review the product IDs and quantities before sending." : "No purchasable components in this robot.";
    loadCatalog();
  }

  async function loadSaved() {
    send.disabled = true;
    robot = null;
    resultLink.hidden = true;
    status.textContent = "Loading saved robot…";
    try {
      const response = await fetch("/config.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load saved configuration (HTTP " + response.status + ").");
      const definition = await response.json();
      delete definition.camera;
      showRobot({ name: definition.components?.find(component => component.objectType === "Robot")?.name || "Robot", definition });
    } catch (error) { status.textContent = error.message; }
  }

  document.getElementById("shopReload").addEventListener("click", () => {
    if (integrated) { robotSignature = ""; document.dispatchEvent(new CustomEvent("shop:refresh")); }
    else loadSaved();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!robot || send.disabled || !form.reportValidity()) return;
    const controls = Array.from(form.querySelectorAll("input, button"));
    const disabled = controls.map(control => control.disabled);
    try {
      const items = new Map();
      for (const row of rows.filter(row => row.include.checked)) {
        const id = row.id.value.trim();
        const quantity = Number(row.quantity.value);
        if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Enter a product ID and quantity from 1 to 99 for each included part.");
        items.set(id, (items.get(id) || 0) + quantity);
        if (items.get(id) > 99) throw new Error("Combined quantity exceeds 99 for " + id + ".");
      }
      if (!items.size || items.size > 1000) throw new Error("Select between 1 and 1,000 different products.");
      const name = document.getElementById("shopRobotName").value.trim();
      if (!name || name.length > 200) throw new Error("Enter a robot name of 1–200 characters.");
      const body = JSON.stringify({ robot: { ...robot, name }, items: Array.from(items, ([id, quantity]) => ({ id, quantity })) });
      if (new TextEncoder().encode(body).length > 128 * 1024) throw new Error("Robot data exceeds the API limit of 128 KiB.");
      busy = true;
      controls.forEach(control => { control.disabled = true; });
      resultLink.hidden = true;
      status.textContent = "Preparing parts in the online shop…";
      const response = await fetch(await getShopApiBase() + "/api/shop-init", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        signal: AbortSignal.timeout(30000)
      });
      let result;
      try { result = await response.json(); }
      catch (_) { throw new Error("Shop returned an unreadable response (HTTP " + response.status + ")."); }
      if (!response.ok || !result.ok) throw new Error((result.error || "Shop request failed (HTTP " + response.status + ").") +
        (Array.isArray(result.missingProductIds) ? " Unknown IDs: " + result.missingProductIds.join(", ") : ""));
      if (typeof result.shopUrl !== "string") throw new Error("Shop response has no parts-list URL.");
      const url = new URL(result.shopUrl, shopOrigin);
      if (url.origin !== shopOrigin || url.pathname !== "/shop/") throw new Error("Shop returned an unexpected parts-list URL.");
      resultLink.href = url.href;
      resultLink.hidden = false;
      status.textContent = "Parts list ready. Open it below to review and purchase in the online shop.";
    } catch (error) {
      status.textContent = "Could not prepare parts: " + error.message + (error instanceof TypeError ? " Check your connection and that the shop allows cross-origin API requests." : "");
    } finally { busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; }); }
  });

  if (integrated) return;
  try {
    const cached = sessionStorage.getItem("ghostShopRobot");
    if (cached) { sessionStorage.removeItem("ghostShopRobot"); showRobot(JSON.parse(cached)); }
    else loadSaved();
  } catch (_) { loadSaved(); }
})();
