(function (global) {
  "use strict";

  const LIMITS = Object.freeze({
    MAX_JSON_BYTES: 2 * 1024 * 1024, // 2 MB
    MAX_NODES: 1500,
    MAX_LINKS: 5000,
    MIN_NODE_SIZE: 4,
    MAX_NODE_SIZE: 48,
    DEFAULT_NODE_SIZE: 12,
    MAX_TEXT_LEN: 200,
    MAX_DESC_LEN: 1000
  });

  const STORAGE_KEY = "nexus-graph:state:v1";

  function sanitizeText(value, maxLen) {
    if (value === null || value === undefined) return "";
    const str = String(value).trim();
    return str.length > maxLen ? str.slice(0, maxLen) : str;
  }

  function clampSize(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return LIMITS.DEFAULT_NODE_SIZE;
    return Math.min(LIMITS.MAX_NODE_SIZE, Math.max(LIMITS.MIN_NODE_SIZE, num));
  }

  function extractEndpointId(endpoint) {
    if (endpoint && typeof endpoint === "object") {
      return sanitizeText(endpoint.id, LIMITS.MAX_TEXT_LEN);
    }
    return sanitizeText(endpoint, LIMITS.MAX_TEXT_LEN);
  }

  function validateGraphData(rawData) {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      return { ok: false, error: "JSON должен быть объектом формата {\"nodes\":[...], \"links\":[...]}." };
    }
    if (!Array.isArray(rawData.nodes) || !Array.isArray(rawData.links)) {
      return { ok: false, error: "Поля \"nodes\" и \"links\" должны быть массивами." };
    }
    if (rawData.nodes.length === 0) {
      return { ok: false, error: "Массив \"nodes\" не может быть пустым." };
    }
    if (rawData.nodes.length > LIMITS.MAX_NODES) {
      return { ok: false, error: `Превышен лимит узлов: максимум ${LIMITS.MAX_NODES}.` };
    }
    if (rawData.links.length > LIMITS.MAX_LINKS) {
      return { ok: false, error: `Превышен лимит рёбер: максимум ${LIMITS.MAX_LINKS}.` };
    }

    const seenIds = new Set();
    const nodes = [];
    let droppedInvalidNodes = 0;
    let droppedDuplicateNodes = 0;

    for (let i = 0; i < rawData.nodes.length; i++) {
      const item = rawData.nodes[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        droppedInvalidNodes++;
        continue;
      }
      const id = sanitizeText(item.id, LIMITS.MAX_TEXT_LEN);
      if (!id) {
        droppedInvalidNodes++;
        continue;
      }
      if (seenIds.has(id)) {
        droppedDuplicateNodes++;
        continue;
      }
      seenIds.add(id);

      nodes.push({
        id,
        name: sanitizeText(item.name, LIMITS.MAX_TEXT_LEN) || id,
        group: sanitizeText(item.group, LIMITS.MAX_TEXT_LEN) || "core",
        size: clampSize(item.size),
        desc: sanitizeText(item.desc, LIMITS.MAX_DESC_LEN)
      });
    }

    if (nodes.length === 0) {
      return { ok: false, error: "Не найдено ни одного валидного узла с непустым строковым id." };
    }

    const links = [];
    let droppedOrphanLinks = 0;
    let droppedInvalidLinks = 0;

    for (let i = 0; i < rawData.links.length; i++) {
      const item = rawData.links[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        droppedInvalidLinks++;
        continue;
      }
      const source = extractEndpointId(item.source);
      const target = extractEndpointId(item.target);
      if (!source || !target) {
        droppedInvalidLinks++;
        continue;
      }
      if (!seenIds.has(source) || !seenIds.has(target)) {
        droppedOrphanLinks++;
        continue;
      }

      const cleanLink = { source, target };
      const label = sanitizeText(item.label, LIMITS.MAX_TEXT_LEN);
      if (label) cleanLink.label = label;
      links.push(cleanLink);
    }

    return {
      ok: true,
      data: { nodes, links },
      stats: {
        droppedInvalidNodes,
        droppedDuplicateNodes,
        droppedOrphanLinks,
        droppedInvalidLinks
      }
    };
  }

  function parseAndValidateJson(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) {
      return { ok: false, error: "Вставьте JSON с данными." };
    }
    const byteLength = typeof Blob !== "undefined"
      ? new Blob([rawText]).size
      : rawText.length * 2;
    if (byteLength > LIMITS.MAX_JSON_BYTES) {
      return { ok: false, error: "Размер JSON превышает лимит 2 МБ." };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      return { ok: false, error: "Ошибка JSON: " + err.message };
    }
    return validateGraphData(parsed);
  }

  // Export pure validation helpers for automated tests in Node.js
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { LIMITS, validateGraphData, parseAndValidateJson, clampSize, sanitizeText };
    return;
  }

  // ===== Browser Runtime =====
  if (typeof global.d3 === "undefined") {
    const details = document.getElementById("details-content");
    if (details) {
      const msg = document.createElement("div");
      msg.className = "empty";
      msg.textContent = "Не удалось загрузить D3.js. Проверьте подключение к сети.";
      details.replaceChildren(msg);
    }
    return;
  }

  const d3 = global.d3;

  // ===== Demo data =====
  const demoData = {
    nodes: [
      { id: "hub", name: "Центр", group: "core", size: 22, desc: "Главный хаб" },
      { id: "api", name: "API Gateway", group: "infra", size: 17, desc: "Точка входа" },
      { id: "auth", name: "Auth", group: "security", size: 15, desc: "Авторизация" },
      { id: "users", name: "Users DB", group: "data", size: 15, desc: "База пользователей" },
      { id: "cache", name: "Redis", group: "infra", size: 13, desc: "Кэш" },
      { id: "orders", name: "Orders", group: "business", size: 15, desc: "Заказы" },
      { id: "payments", name: "Payments", group: "business", size: 14, desc: "Платежи" },
      { id: "notify", name: "Notify", group: "infra", size: 12, desc: "Уведомления" },
      { id: "web", name: "Web App", group: "ui", size: 15, desc: "Веб-приложение" },
      { id: "mobile", name: "Mobile", group: "ui", size: 14, desc: "Мобильное приложение" },
      { id: "queue", name: "Queue", group: "infra", size: 13, desc: "Очередь сообщений" },
      { id: "cdn", name: "CDN", group: "infra", size: 11, desc: "Контент" }
    ],
    links: [
      { source: "web", target: "api", label: "HTTPS" },
      { source: "mobile", target: "api", label: "HTTPS" },
      { source: "api", target: "auth", label: "verify" },
      { source: "api", target: "users", label: "CRUD" },
      { source: "api", target: "orders", label: "REST" },
      { source: "api", target: "cache", label: "cache" },
      { source: "auth", target: "users", label: "lookup" },
      { source: "orders", target: "payments", label: "charge" },
      { source: "orders", target: "notify", label: "event" },
      { source: "orders", target: "queue", label: "publish" },
      { source: "hub", target: "api", label: "route" },
      { source: "web", target: "cdn", label: "assets" },
      { source: "mobile", target: "cdn", label: "assets" }
    ]
  };

  function loadStoredGraph() {
    try {
      const saved = global.localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const result = parseAndValidateJson(saved);
      return result.ok ? result.data : null;
    } catch (_) {
      return null;
    }
  }

  function saveStoredGraph(cleanData) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanData));
    } catch (_) {
      // Ignore storage quota or private-mode restrictions
    }
  }

  const groupColor = d3.scaleOrdinal()
    .domain(["core", "infra", "security", "data", "business", "ui"])
    .range(["#f472b6", "#38bdf8", "#a78bfa", "#4ade80", "#fbbf24", "#fb923c"]);

  const svg = d3.select("#graph");
  const canvasWrapEl = document.getElementById("canvas-wrap");
  const detailsEl = document.getElementById("details-content");
  const statNodesEl = document.getElementById("stat-nodes");
  const statLinksEl = document.getElementById("stat-links");
  const statAlphaEl = document.getElementById("stat-alpha");
  const searchEl = document.getElementById("search");
  const dataInputEl = document.getElementById("data-input");
  const btnFreezeEl = document.getElementById("btn-freeze");

  const width = () => Math.max(1, canvasWrapEl.clientWidth);
  const height = () => Math.max(1, canvasWrapEl.clientHeight);
  const g = svg.append("g");

  svg.append("defs").append("marker")
    .attr("id", "arrow").attr("viewBox", "0 -5 10 10").attr("refX", 20).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#64748b");

  const zoom = d3.zoom().scaleExtent([0.12, 5]).on("zoom", e => g.attr("transform", e.transform));
  svg.call(zoom);

  const simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(95).strength(0.55))
    .force("charge", d3.forceManyBody().strength(-340))
    .force("center", d3.forceCenter())
    .force("collide", d3.forceCollide().radius(d => (d.size || 12) + 8).strength(0.85))
    .alphaDecay(0.022).velocityDecay(0.32);

  let frozen = false;
  let lastAlphaRenderTs = 0;
  let current = { nodes: [], links: [], nodeSel: null, linkSel: null, linkLabelSel: null, nodeLabelSel: null };

  const linkGroup = g.append("g").attr("class", "links");
  const linkLabelGroup = g.append("g").attr("class", "link-labels");
  const nodeGroup = g.append("g").attr("class", "nodes");
  const nodeLabelGroup = g.append("g").attr("class", "node-labels");

  function renderAlpha(force) {
    const now = performance.now();
    if (!force && now - lastAlphaRenderTs < 90) return;
    lastAlphaRenderTs = now;
    const val = frozen ? 0 : simulation.alpha();
    statAlphaEl.textContent = val.toFixed(3);
  }

  function renderEmptyDetails() {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty";
    emptyDiv.textContent = "Кликните на узел";
    detailsEl.replaceChildren(emptyDiv);
  }

  function appendDetailRow(fragment, labelText, valueText, isBadge) {
    const labelEl = document.createElement("div");
    labelEl.className = "label";
    labelEl.textContent = labelText;

    const valueEl = document.createElement("div");
    valueEl.className = "value";
    if (isBadge) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = valueText;
      valueEl.appendChild(badge);
    } else {
      valueEl.textContent = valueText;
    }

    fragment.appendChild(labelEl);
    fragment.appendChild(valueEl);
  }

  function selectNode(d) {
    if (current.nodeSel) {
      current.nodeSel.classed("selected", n => n.id === d.id);
    }
    const degree = current.links.filter(
      l => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id
    ).length;

    const fragment = document.createDocumentFragment();
    appendDetailRow(fragment, "ID", d.id, false);
    appendDetailRow(fragment, "Имя", d.name || "—", false);
    appendDetailRow(fragment, "Группа", d.group || "—", true);
    appendDetailRow(fragment, "Связи", String(degree), false);
    appendDetailRow(fragment, "Описание", d.desc || "Нет описания", false);
    detailsEl.replaceChildren(fragment);
  }

  function updateGraph(data) {
    const nodes = data.nodes.map(d => ({ ...d }));
    const links = data.links.map(d => ({ ...d }));

    const linkSel = linkGroup.selectAll("line")
      .data(links, (d, i) => (d.source.id || d.source) + "→" + (d.target.id || d.target) + "#" + i)
      .join(enter => enter.append("line").attr("marker-end", "url(#arrow)"));

    const linkLabelSel = linkLabelGroup.selectAll("text")
      .data(links.filter(d => d.label), (d, i) => (d.source.id || d.source) + "→" + (d.target.id || d.target) + ":" + d.label + "#" + i)
      .join(enter => enter.append("text").text(d => d.label));

    const nodeSel = nodeGroup.selectAll("circle")
      .data(nodes, d => d.id)
      .join(
        enter => enter.append("circle")
          .attr("r", d => d.size || 12)
          .attr("fill", d => groupColor(d.group || "core"))
          .call(drag(simulation))
          .on("click", (e, d) => { e.stopPropagation(); selectNode(d); })
          .on("mouseover", function (e, d) { d3.select(this).attr("r", (d.size || 12) * 1.18); })
          .on("mouseout", function (e, d) { d3.select(this).attr("r", d.size || 12); }),
        update => update.attr("r", d => d.size || 12).attr("fill", d => groupColor(d.group || "core"))
      );

    const nodeLabelSel = nodeLabelGroup.selectAll("text")
      .data(nodes, d => d.id)
      .join(
        enter => enter.append("text").text(d => d.name || d.id).attr("dy", d => (d.size || 12) + 5),
        update => update.text(d => d.name || d.id).attr("dy", d => (d.size || 12) + 5)
      );

    simulation.nodes(nodes);
    simulation.force("link").links(links);
    simulation.force("center").x(width() / 2).y(height() / 2);

    simulation.on("tick", () => {
      linkSel
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      linkLabelSel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2);
      nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
      nodeLabelSel.attr("x", d => d.x).attr("y", d => d.y);
      renderAlpha(false);
    });

    simulation.on("end", () => {
      statAlphaEl.textContent = "0.000";
    });

    current = { nodes, links, nodeSel, linkSel, linkLabelSel, nodeLabelSel };
    statNodesEl.textContent = String(nodes.length);
    statLinksEl.textContent = String(links.length);
    renderEmptyDetails();
    clearHighlight();
  }

  function drag(sim) {
    return d3.drag()
      .on("start", (e, d) => {
        if (!e.active && !frozen) sim.alphaTarget(0.28).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on("end", (e, d) => {
        if (!e.active && !frozen) sim.alphaTarget(0);
        if (!frozen) {
          d.fx = null;
          d.fy = null;
        }
      });
  }

  svg.on("click", () => {
    if (current.nodeSel) current.nodeSel.classed("selected", false);
    renderEmptyDetails();
    clearHighlight();
  });

  function clearHighlight() {
    if (!current.nodeSel) return;
    current.nodeSel.classed("highlight", false).classed("dim", false);
    current.linkSel.classed("highlight", false).classed("dim", false);
    current.linkLabelSel.classed("dim", false);
    current.nodeLabelSel.classed("dim", false);
  }

  function applyHighlight(matchedIds) {
    if (!current.nodeSel || matchedIds.size === 0) {
      clearHighlight();
      return;
    }
    const connected = new Set(matchedIds);
    current.links.forEach(l => {
      const s = l.source.id || l.source;
      const t = l.target.id || l.target;
      if (matchedIds.has(s)) connected.add(t);
      if (matchedIds.has(t)) connected.add(s);
    });
    current.nodeSel.classed("highlight", d => matchedIds.has(d.id)).classed("dim", d => !connected.has(d.id));
    current.nodeLabelSel.classed("dim", d => !connected.has(d.id));
    current.linkSel
      .classed("highlight", l => matchedIds.has(l.source.id || l.source) || matchedIds.has(l.target.id || l.target))
      .classed("dim", l => !connected.has(l.source.id || l.source) || !connected.has(l.target.id || l.target));
    current.linkLabelSel.classed("dim", l => !connected.has(l.source.id || l.source) || !connected.has(l.target.id || l.target));
  }

  searchEl.addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      clearHighlight();
      return;
    }
    const matched = new Set(
      current.nodes.filter(n =>
        (n.name && n.name.toLowerCase().includes(q)) ||
        (n.id && n.id.toLowerCase().includes(q)) ||
        (n.group && n.group.toLowerCase().includes(q)) ||
        (n.desc && n.desc.toLowerCase().includes(q))
      ).map(n => n.id)
    );
    applyHighlight(matched);
  });

  document.getElementById("btn-reheat").onclick = () => {
    if (!frozen) {
      simulation.alpha(0.85).restart();
      renderAlpha(true);
    }
  };

  btnFreezeEl.onclick = function () {
    frozen = !frozen;
    this.classList.toggle("active", frozen);
    this.textContent = frozen ? "▶️ Разморозить" : "❄️ Заморозить";
    if (frozen) {
      simulation.stop();
      simulation.nodes().forEach(d => { d.fx = d.x; d.fy = d.y; });
      statAlphaEl.textContent = "0.000";
    } else {
      simulation.nodes().forEach(d => { d.fx = null; d.fy = null; });
      simulation.alpha(0.45).restart();
      renderAlpha(true);
    }
  };

  document.getElementById("btn-reset").onclick = () => {
    frozen = false;
    btnFreezeEl.classList.remove("active");
    btnFreezeEl.textContent = "❄️ Заморозить";
    simulation.nodes().forEach(d => {
      d.fx = null;
      d.fy = null;
      d.x = width() / 2 + (Math.random() - 0.5) * 220;
      d.y = height() / 2 + (Math.random() - 0.5) * 220;
    });
    simulation.alpha(1).restart();
    renderAlpha(true);
    clearHighlight();
  };

  // Load custom data with strict validation & localStorage persistence
  document.getElementById("btn-load").onclick = () => {
    const result = parseAndValidateJson(dataInputEl.value);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    frozen = false;
    btnFreezeEl.classList.remove("active");
    btnFreezeEl.textContent = "❄️ Заморозить";

    updateGraph(result.data);
    saveStoredGraph(result.data);
    simulation.alpha(0.9).restart();
    renderAlpha(true);

    const { droppedDuplicateNodes, droppedOrphanLinks, droppedInvalidNodes, droppedInvalidLinks } = result.stats;
    const notes = [];
    if (droppedDuplicateNodes > 0) notes.push(`дубликаты узлов: ${droppedDuplicateNodes}`);
    if (droppedInvalidNodes > 0) notes.push(`невалидные узлы: ${droppedInvalidNodes}`);
    if (droppedOrphanLinks > 0) notes.push(`висячие рёбра: ${droppedOrphanLinks}`);
    if (droppedInvalidLinks > 0) notes.push(`невалидные рёбра: ${droppedInvalidLinks}`);
    if (notes.length > 0) {
      alert("Граф загружен. Пропущено при очистке — " + notes.join(", ") + ".");
    }
  };

  // Export PNG with cloned SVG, inlined computed styles, explicit dimensions & HiDPI 2x
  const STYLE_PROPS = [
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "paint-order",
    "filter"
  ];

  function inlineSvgStyles(origSvg, cloneSvg) {
    const origNodes = origSvg.querySelectorAll("line, circle, text, path");
    const cloneNodes = cloneSvg.querySelectorAll("line, circle, text, path");
    const count = Math.min(origNodes.length, cloneNodes.length);

    for (let i = 0; i < count; i++) {
      const computed = global.getComputedStyle(origNodes[i]);
      const target = cloneNodes[i];
      for (let j = 0; j < STYLE_PROPS.length; j++) {
        const prop = STYLE_PROPS[j];
        const val = computed.getPropertyValue(prop);
        if (val && val !== "none" && val !== "normal") {
          target.style.setProperty(prop, val);
        }
      }
      // Preserve explicit stroke: none if element has no stroke
      if (computed.getPropertyValue("stroke") === "none") {
        target.style.setProperty("stroke", "none");
      }
    }
  }

  document.getElementById("btn-export").onclick = () => {
    const svgEl = document.getElementById("graph");
    const w = width();
    const h = height();
    const scale = Math.max(2, Math.min(global.devicePixelRatio || 2, 3));

    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);

    inlineSvgStyles(svgEl, clone);

    const serializer = new XMLSerializer();
    const svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + serializer.serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);

        // Match #canvas-wrap background gradient
        const grad = ctx.createRadialGradient(w * 0.4, h * 0.4, 0, w * 0.4, h * 0.4, Math.max(w, h) * 0.7);
        grad.addColorStop(0, "#0f172a");
        grad.addColorStop(1, "#070b14");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.drawImage(img, 0, 0, w, h);

        const a = document.createElement("a");
        a.download = "nexus-graph.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
      } catch (err) {
        alert("Не удалось экспортировать PNG: " + err.message);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      alert("Не удалось подготовить SVG для экспорта в PNG.");
    };
    img.src = objectUrl;
  };

  let resizeTimer = null;
  function applyResize() {
    const w = width();
    const h = height();
    svg.attr("viewBox", [0, 0, w, h]);
    simulation.force("center").x(w / 2).y(h / 2);
    if (!frozen) {
      simulation.alpha(0.25).restart();
      renderAlpha(true);
    }
  }

  global.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyResize, 150);
  });

  applyResize();
  const initialData = loadStoredGraph() || demoData;
  updateGraph(initialData);
  simulation.alpha(0.9).restart();
  renderAlpha(true);
})(typeof window !== "undefined" ? window : globalThis);
