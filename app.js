const MAP_WIDTH = 1000;
const MAP_HEIGHT = 520;
const MAX_LIST_ITEMS = 240;
const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const THEME_STORAGE_KEY = "cenozoic-fauna-theme";

const manifest = window.CENOZOIC_FAUNA_DATA;
const world = window.CENOZOIC_FAUNA_WORLD;

let species = [];

const state = {
  loading: true,
  error: null,
  search: "",
  group: "all",
  className: "all",
  order: "all",
  epoch: "all",
  sort: "alpha",
  selectedId: null,
  clusterFocus: null,
  mapTransform: { scale: 1, tx: 0, ty: 0 },
  drag: null,
  lastMapBounds: null,
  theme: "light",
};

const elements = {
  heroStats: document.querySelector("#hero-stats"),
  themeToggleButton: document.querySelector("#theme-toggle-button"),
  searchInput: document.querySelector("#search-input"),
  groupFilter: document.querySelector("#group-filter"),
  classFilter: document.querySelector("#class-filter"),
  orderFilter: document.querySelector("#order-filter"),
  epochFilter: document.querySelector("#epoch-filter"),
  sortSelect: document.querySelector("#sort-select"),
  speciesCountHeading: document.querySelector("#species-count-heading"),
  speciesCaption: document.querySelector("#species-caption"),
  speciesList: document.querySelector("#species-list"),
  detailPanel: document.querySelector("#detail-panel"),
  sourcesPanel: document.querySelector("#sources-panel"),
  mapHeading: document.querySelector("#map-heading"),
  atlasMap: document.querySelector("#atlas-map"),
  mapTooltip: document.querySelector("#map-tooltip"),
  clearSelectionButton: document.querySelector("#clear-selection-button"),
  resetMapButton: document.querySelector("#reset-map-button"),
  zoomSelectionButton: document.querySelector("#zoom-selection-button"),
};

let mapScene;
let mapGridLayer;
let mapLandLayer;
let mapPointLayer;
const activeMapPointers = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMa(value) {
  return value == null ? "Unknown" : `${value.toFixed(2)} Ma`;
}

function formatCoordinates(lat, lng) {
  return `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
}

function formatTimeLabel(specimen) {
  const { temporalRange } = specimen;
  if (temporalRange.label && temporalRange.epoch && temporalRange.label !== temporalRange.epoch) {
    return `${temporalRange.label} (${temporalRange.epoch})`;
  }
  return temporalRange.label || temporalRange.epoch || temporalRange.era || "Unknown";
}

function getStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch (error) {
    return null;
  }
}

function getPreferredTheme() {
  const stored = getStoredTheme();
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getThemeColor(token, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

function getMapThemeColors() {
  return {
    landFill: getThemeColor("--map-land", "#9eb6a1"),
    landStroke: getThemeColor("--map-stroke", "rgba(34,29,22,0.18)"),
    gridStroke: getThemeColor("--map-grid", "rgba(34,29,22,0.1)"),
    pointFill: getThemeColor("--map-point", "rgba(139,79,43,0.62)"),
    pointSelectedFill: getThemeColor("--map-point-selected", "#18120e"),
    pointRing: getThemeColor("--map-point-ring", "rgba(255,255,255,0.88)"),
    emptyText: getThemeColor("--map-empty-text", "rgba(34,29,22,0.66)"),
  };
}

function syncThemeToggle() {
  const isDark = state.theme === "dark";
  elements.themeToggleButton.textContent = `Dark mode: ${isDark ? "On" : "Off"}`;
  elements.themeToggleButton.setAttribute("aria-pressed", String(isDark));
}

function applyTheme(nextTheme, { persist = true, rebuildMap = true } = {}) {
  state.theme = nextTheme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, state.theme);
    } catch (error) {
      // Ignore storage failures.
    }
  }
  syncThemeToggle();
  if (rebuildMap && mapScene) {
    renderMapBase();
    render();
  }
}

function project(lng, lat) {
  return {
    x: ((lng + 180) / 360) * MAP_WIDTH,
    y: ((90 - lat) / 180) * MAP_HEIGHT,
  };
}

function geometryToPath(geometry) {
  if (!geometry) return "";
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  return polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map(([lng, lat], index) => {
              const point = project(lng, lat);
              return `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
            })
            .join(" ") + " Z"
        )
        .join(" ")
    )
    .join(" ");
}

function createSvgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function populateFilterSelect(select, label, values) {
  select.innerHTML = [
    `<option value="all">All ${escapeHtml(label)}</option>`,
    ...values.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    ),
  ].join("");
  select.disabled = false;
}

function buildHeroStats(filteredSpecies) {
  if (state.loading || state.error) {
    const cards = [
      ["Species", formatNumber(manifest.metadata.speciesCount)],
      ["Mapped species", formatNumber(manifest.metadata.mappedSpeciesCount)],
      ["Localities", formatNumber(manifest.metadata.localityCount)],
      ["Chunk files", formatNumber(manifest.metadata.chunkCount)],
    ];
    elements.heroStats.innerHTML = cards
      .map(
        ([label, value]) => `
          <article class="stat-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </article>
        `
      )
      .join("");
    return;
  }

  const mappedSpecies = filteredSpecies.filter((item) => item.localityCount > 0).length;
  const localityCount = filteredSpecies.reduce((sum, item) => sum + item.localityCount, 0);
  const faunaGroups = new Set(filteredSpecies.map((item) => item.faunaGroup).filter(Boolean)).size;

  const cards = [
    ["Filtered species", formatNumber(filteredSpecies.length)],
    ["Mappable species", formatNumber(mappedSpecies)],
    ["Visible localities", formatNumber(localityCount)],
    ["Fauna groups", formatNumber(faunaGroups)],
  ];

  elements.heroStats.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
}

function hydrateSpecies(records) {
  return records.map((entry) => ({
    ...entry,
    searchBlob: [
      entry.scientificName,
      entry.genus,
      entry.family,
      entry.order,
      entry.className,
      entry.faunaGroup,
      entry.temporalRange?.epoch,
      entry.temporalRange?.label,
      entry.description?.summary,
      ...(entry.taxonomyPath || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  }));
}

async function loadChunk(chunkInfo) {
  const url = new URL(`./data/${chunkInfo.file}`, window.location.href);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${chunkInfo.file} (${response.status})`);
  }
  return response.json();
}

async function loadSpeciesData() {
  const chunks = await Promise.all(manifest.chunks.map(loadChunk));
  return hydrateSpecies(chunks.flatMap((chunk) => chunk.species || []));
}

function getDistinctValues(extractor) {
  return Array.from(new Set(species.map(extractor).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function getFilteredSpecies() {
  const query = state.search.trim().toLowerCase();
  const filtered = species.filter((item) => {
    if (state.group !== "all" && item.faunaGroup !== state.group) return false;
    if (state.className !== "all" && item.className !== state.className) return false;
    if (state.order !== "all" && item.order !== state.order) return false;
    if (state.epoch !== "all" && item.temporalRange.epoch !== state.epoch) return false;
    if (query && !item.searchBlob.includes(query)) return false;
    return true;
  });

  const sorted = [...filtered];
  sorted.sort((left, right) => {
    if (state.sort === "localities") {
      return (
        right.localityCount - left.localityCount ||
        left.scientificName.localeCompare(right.scientificName)
      );
    }
    if (state.sort === "oldest") {
      return (
        (right.temporalRange.startMa || 0) - (left.temporalRange.startMa || 0) ||
        left.scientificName.localeCompare(right.scientificName)
      );
    }
    return left.scientificName.localeCompare(right.scientificName);
  });
  return sorted;
}

function syncClusterFocus(filtered) {
  if (!state.clusterFocus) return;
  const validIds = new Set(filtered.map((item) => item.id));
  const remainingIds = state.clusterFocus.speciesIds.filter((id) => validIds.has(id));
  if (!remainingIds.length) {
    state.clusterFocus = null;
    return;
  }
  state.clusterFocus = {
    ...state.clusterFocus,
    speciesIds: remainingIds,
    sampleSpecies: filtered
      .filter((item) => remainingIds.includes(item.id))
      .slice(0, 6)
      .map((item) => item.scientificName),
  };
}

function getActiveSpecies(filtered) {
  if (!state.clusterFocus) return filtered;
  const allowedIds = new Set(state.clusterFocus.speciesIds);
  return filtered.filter((item) => allowedIds.has(item.id));
}

function getSelectedSpecies(filtered) {
  return filtered.find((item) => item.id === state.selectedId) || null;
}

function syncSelection(filtered) {
  if (!state.selectedId) return;
  if (!filtered.some((item) => item.id === state.selectedId)) {
    state.selectedId = null;
  }
}

function renderSpeciesList(filtered) {
  if (state.loading) {
    elements.speciesCountHeading.textContent = "Loading species";
    elements.speciesCaption.textContent = `Loading ${formatNumber(
      manifest.metadata.speciesCount
    )} species from ${formatNumber(manifest.metadata.chunkCount)} chunk files.`;
    elements.speciesList.innerHTML = `
      <div class="empty-state">
        Atlas data is loading. The species browser will appear as soon as the chunk files finish downloading.
      </div>
    `;
    return;
  }

  if (state.error) {
    elements.speciesCountHeading.textContent = "Load failed";
    elements.speciesCaption.textContent = "The atlas could not load its chunked species data.";
    elements.speciesList.innerHTML = `
      <div class="empty-state">
        ${escapeHtml(state.error)}
      </div>
    `;
    return;
  }

  const visible = filtered.slice(0, MAX_LIST_ITEMS);
  elements.speciesCountHeading.textContent = `${formatNumber(filtered.length)} species`;

  if (!filtered.length) {
    elements.speciesCaption.textContent =
      "No species match the current filters. Try widening the search or clearing one of the dropdowns.";
    elements.speciesList.innerHTML = `
      <div class="empty-state">
        No Cenozoic taxa match this filter set right now.
      </div>
    `;
    return;
  }

  elements.speciesCaption.textContent =
    state.clusterFocus
      ? `Cluster focus near ${formatCoordinates(
          state.clusterFocus.lat,
          state.clusterFocus.lng
        )}. Showing taxa represented in that locality cluster.`
      : filtered.length > MAX_LIST_ITEMS
        ? `Showing the first ${formatNumber(MAX_LIST_ITEMS)} matches. Use search or filters to narrow the list.`
        : "Select a species to isolate its fossil localities and inspect its taxonomy and age.";

  elements.speciesList.innerHTML = visible
    .map(
      (item) => `
        <button
          class="species-item ${item.id === state.selectedId ? "is-selected" : ""}"
          type="button"
          data-species-id="${item.id}"
        >
          <div class="species-item-copy">
            <h3>${escapeHtml(item.scientificName)}</h3>
            <div class="chips">
              <span class="chip">${escapeHtml(item.faunaGroup || "Unknown group")}</span>
              <span class="chip">${escapeHtml(item.className || "Unknown class")}</span>
            </div>
            <div class="species-meta">
              <div class="meta-row">
                <span>Family</span>
                <span>${escapeHtml(item.family || "Unspecified")}</span>
              </div>
              <div class="meta-row">
                <span>Age</span>
                <span>${escapeHtml(formatTimeLabel(item))}</span>
              </div>
              <div class="meta-row">
                <span>Localities</span>
                <span>${escapeHtml(String(item.localityCount))}</span>
              </div>
            </div>
          </div>
        </button>
      `
    )
    .join("");

  elements.speciesList.querySelectorAll("[data-species-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = Number(button.dataset.speciesId);
      render();
    });
  });
}

function renderDetailPanel(filtered, selected) {
  if (state.loading) {
    elements.detailPanel.innerHTML = `
      <p class="panel-label">Species Detail</p>
      <h2>Loading atlas</h2>
      <p class="detail-copy">
        Pulling ${escapeHtml(formatNumber(manifest.metadata.speciesCount))} species from ${escapeHtml(
          formatNumber(manifest.metadata.chunkCount)
        )} chunk files so the atlas can search, filter, and map them in the browser.
      </p>
    `;
    return;
  }

  if (state.error) {
    elements.detailPanel.innerHTML = `
      <p class="panel-label">Species Detail</p>
      <h2>Atlas failed to load</h2>
      <div class="empty-state">${escapeHtml(state.error)}</div>
    `;
    return;
  }

  if (!filtered.length) {
    elements.detailPanel.innerHTML = `
      <p class="panel-label">Species Detail</p>
      <div class="empty-state">
        Adjust the search or filters to restore matching species.
      </div>
    `;
    return;
  }

  if (!selected) {
    if (state.clusterFocus) {
      const clusterTaxaMarkup = filtered
        .slice(0, 18)
        .map(
          (item) =>
            `<button class="chip chip-button" type="button" data-cluster-species-id="${item.id}">${escapeHtml(
              item.scientificName
            )}</button>`
        )
        .join("");

      elements.detailPanel.innerHTML = `
        <p class="panel-label">Cluster Focus</p>
        <h2>${escapeHtml(formatNumber(filtered.length))} taxa in this map cluster</h2>
        <p class="detail-copy">
          This cluster is centered near ${escapeHtml(
            formatCoordinates(state.clusterFocus.lat, state.clusterFocus.lng)
          )} and currently groups ${escapeHtml(
            formatNumber(state.clusterFocus.localityCount)
          )} locality points across ${escapeHtml(
            formatNumber(state.clusterFocus.occurrenceCount)
          )} filtered occurrences.
        </p>
        <div class="fact-grid">
          <article class="fact-card">
            <span>Cluster taxa</span>
            <strong>${escapeHtml(formatNumber(filtered.length))}</strong>
          </article>
          <article class="fact-card">
            <span>Locality points</span>
            <strong>${escapeHtml(formatNumber(state.clusterFocus.localityCount))}</strong>
          </article>
          <article class="fact-card">
            <span>Total occurrences</span>
            <strong>${escapeHtml(formatNumber(state.clusterFocus.occurrenceCount))}</strong>
          </article>
          <article class="fact-card">
            <span>Map center</span>
            <strong>${escapeHtml(
              formatCoordinates(state.clusterFocus.lat, state.clusterFocus.lng)
            )}</strong>
          </article>
        </div>
        <h3 style="margin-top: 20px;">Taxa in this cluster</h3>
        <div class="chips">${clusterTaxaMarkup}</div>
      `;

      elements.detailPanel.querySelectorAll("[data-cluster-species-id]").forEach((button) => {
        button.addEventListener("click", () => {
          state.selectedId = Number(button.dataset.clusterSpeciesId);
          render();
        });
      });
      return;
    }

    const faunaCounts = filtered.reduce((map, item) => {
      map.set(item.faunaGroup, (map.get(item.faunaGroup) || 0) + 1);
      return map;
    }, new Map());

    const faunaChips = Array.from(faunaCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(
        ([name, count]) =>
          `<span class="chip">${escapeHtml(name)} · ${escapeHtml(String(count))}</span>`
      )
      .join("");

    elements.detailPanel.innerHTML = `
      <p class="panel-label">Species Detail</p>
      <h2>Explore the atlas</h2>
      <p class="detail-copy">
        Choose a Cenozoic species from the list to highlight its fossil localities. Without a selection,
        the map aggregates all filtered species into regional locality clusters.
      </p>
      <div class="fact-grid">
        <article class="fact-card">
          <span>Filtered species</span>
          <strong>${escapeHtml(formatNumber(filtered.length))}</strong>
        </article>
        <article class="fact-card">
          <span>Species with coordinates</span>
          <strong>${escapeHtml(
            formatNumber(filtered.filter((item) => item.localityCount > 0).length)
          )}</strong>
        </article>
        <article class="fact-card">
          <span>Visible fauna groups</span>
          <strong>${escapeHtml(formatNumber(faunaCounts.size))}</strong>
        </article>
        <article class="fact-card">
          <span>Database generated</span>
          <strong>${escapeHtml(
            new Date(manifest.metadata.generatedAt).toLocaleDateString()
          )}</strong>
        </article>
      </div>
      <div class="chips">${faunaChips}</div>
    `;
    return;
  }

  const taxonomyChips = (selected.taxonomyPath || [])
    .map((value) => `<span class="chip">${escapeHtml(value)}</span>`)
    .join("");

  const localitiesMarkup = selected.localities.length
    ? selected.localities
        .slice(0, 12)
        .map(
          (locality) => `
            <article class="locality-item">
              <strong>${escapeHtml(formatCoordinates(locality.lat, locality.lng))}</strong>
              <div>Interval: ${escapeHtml(
                locality.earlyInterval && locality.lateInterval
                  ? `${locality.earlyInterval} to ${locality.lateInterval}`
                  : locality.earlyInterval || locality.lateInterval || "Unknown"
              )}</div>
              <div>Locality occurrences: ${escapeHtml(String(locality.count))}</div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">No mapped coordinates are attached to this species in the generated atlas.</div>`;

  elements.detailPanel.innerHTML = `
    <p class="panel-label">Species Detail</p>
    <div class="detail-hero">
      <div class="detail-hero-copy">
        <h2>${escapeHtml(selected.scientificName)}</h2>
        <p class="detail-copy">${escapeHtml(selected.description?.summary || "")}</p>
        <div class="source-note">
          <strong>Fauna Group</strong>
          ${escapeHtml(selected.faunaGroup || "Unknown")}
        </div>
      </div>
    </div>
    <div class="fact-grid">
      <article class="fact-card">
        <span>Fauna group</span>
        <strong>${escapeHtml(selected.faunaGroup || "Unknown")}</strong>
      </article>
      <article class="fact-card">
        <span>Class</span>
        <strong>${escapeHtml(selected.className || "Unspecified")}</strong>
      </article>
      <article class="fact-card">
        <span>Order</span>
        <strong>${escapeHtml(selected.order || "Unspecified")}</strong>
      </article>
      <article class="fact-card">
        <span>Family</span>
        <strong>${escapeHtml(selected.family || "Unspecified")}</strong>
      </article>
      <article class="fact-card">
        <span>Geologic range</span>
        <strong>${escapeHtml(formatTimeLabel(selected))}</strong>
      </article>
      <article class="fact-card">
        <span>Age span</span>
        <strong>${escapeHtml(
          `${formatMa(selected.temporalRange.startMa)} to ${formatMa(selected.temporalRange.endMa)}`
        )}</strong>
      </article>
      <article class="fact-card">
        <span>Mapped localities</span>
        <strong>${escapeHtml(formatNumber(selected.localityCount))}</strong>
      </article>
      <article class="fact-card">
        <span>PBDB accepted taxon no.</span>
        <strong>${escapeHtml(formatNumber(selected.pbdb.acceptedNo))}</strong>
      </article>
    </div>
    <div class="chips">${taxonomyChips}</div>
    <h3 style="margin-top: 20px;">Fossil localities</h3>
    <div class="locality-list">${localitiesMarkup}</div>
  `;
}

function renderSourcesPanel() {
  const notes = manifest.metadata.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const sources = manifest.metadata.sources
    .map(
      (source) => `
        <div class="source-item">
          <strong>${escapeHtml(source.name)}</strong>
          <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(
            source.role
          )}</a>
        </div>
      `
    )
    .join("");

  elements.sourcesPanel.innerHTML = `
    <p class="panel-label">Sources and Coverage</p>
    <p>
      The atlas currently includes ${escapeHtml(
        formatNumber(manifest.metadata.speciesCount)
      )} prehistoric vertebrate species, ${escapeHtml(
        formatNumber(manifest.metadata.mappedSpeciesCount)
      )} of which have at least one mapped fossil locality. The public GitHub version is chunked into
      ${escapeHtml(formatNumber(manifest.metadata.chunkCount))} data files so it stays upload-friendly while
      remaining fully searchable in the browser.
    </p>
    <ul>${notes}</ul>
    <div class="source-list">${sources}</div>
  `;
}

function aggregateLocalities(filtered) {
  const binSize = filtered.length > 800 ? 12 : filtered.length > 280 ? 8 : 5;
  const buckets = new Map();

  filtered.forEach((item) => {
    item.localities.forEach((locality) => {
      const latKey = Math.round(locality.lat / binSize) * binSize;
      const lngKey = Math.round(locality.lng / binSize) * binSize;
      const key = `${latKey}:${lngKey}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          latSum: 0,
          lngSum: 0,
          localityCount: 0,
          occurrenceCount: 0,
          speciesNames: new Set(),
          speciesIds: new Set(),
          minLat: locality.lat,
          maxLat: locality.lat,
          minLng: locality.lng,
          maxLng: locality.lng,
        });
      }
      const bucket = buckets.get(key);
      bucket.latSum += locality.lat;
      bucket.lngSum += locality.lng;
      bucket.localityCount += 1;
      bucket.occurrenceCount += locality.count;
      bucket.speciesNames.add(item.scientificName);
      bucket.speciesIds.add(item.id);
      bucket.minLat = Math.min(bucket.minLat, locality.lat);
      bucket.maxLat = Math.max(bucket.maxLat, locality.lat);
      bucket.minLng = Math.min(bucket.minLng, locality.lng);
      bucket.maxLng = Math.max(bucket.maxLng, locality.lng);
    });
  });

  return Array.from(buckets.values()).map((bucket) => ({
    kind: "aggregate",
    key: bucket.key,
    lat: bucket.latSum / bucket.localityCount,
    lng: bucket.lngSum / bucket.localityCount,
    localityCount: bucket.localityCount,
    occurrenceCount: bucket.occurrenceCount,
    speciesCount: bucket.speciesNames.size,
    sampleSpecies: Array.from(bucket.speciesNames).slice(0, 4),
    speciesIds: Array.from(bucket.speciesIds),
    bounds: {
      minLat: bucket.minLat,
      maxLat: bucket.maxLat,
      minLng: bucket.minLng,
      maxLng: bucket.maxLng,
    },
  }));
}

function getBoundsFromPoints(points) {
  if (!points.length) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function renderMapBase() {
  const mapColors = getMapThemeColors();
  elements.atlasMap.innerHTML = "";
  mapScene = createSvgElement("g");
  mapGridLayer = createSvgElement("g");
  mapLandLayer = createSvgElement("g");
  mapPointLayer = createSvgElement("g");

  [-60, -30, 0, 30, 60].forEach((lat) => {
    const start = project(-180, lat);
    const end = project(180, lat);
    mapGridLayer.append(
      createSvgElement("line", {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: mapColors.gridStroke,
        "stroke-width": 1,
        "stroke-dasharray": "6 8",
      })
    );
  });

  [-120, -60, 0, 60, 120].forEach((lng) => {
    const start = project(lng, 80);
    const end = project(lng, -80);
    mapGridLayer.append(
      createSvgElement("line", {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: mapColors.gridStroke,
        "stroke-width": 1,
        "stroke-dasharray": "6 8",
      })
    );
  });

  world.features.forEach((feature) => {
    mapLandLayer.append(
      createSvgElement("path", {
        d: geometryToPath(feature.geometry),
        fill: mapColors.landFill,
        stroke: mapColors.landStroke,
        "stroke-width": 1.1,
        "vector-effect": "non-scaling-stroke",
      })
    );
  });

  mapScene.append(mapGridLayer, mapLandLayer, mapPointLayer);
  elements.atlasMap.append(mapScene);
  applyMapTransform();
}

function getSvgPoint(event) {
  const rect = elements.atlasMap.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * MAP_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT,
  };
}

function screenPointToWorld(point, transform = state.mapTransform) {
  return {
    x: (point.x - transform.tx) / transform.scale,
    y: (point.y - transform.ty) / transform.scale,
  };
}

function getPointerDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function getPointerCenter(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function beginPanGesture(pointerId, point) {
  state.drag = {
    mode: "pan",
    pointerId,
    startPoint: point,
    startTransform: { ...state.mapTransform },
  };
  elements.atlasMap.classList.add("is-dragging");
}

function beginPinchGesture() {
  const [first, second] = Array.from(activeMapPointers.values()).slice(0, 2);
  if (!first || !second) return;
  const startCenter = getPointerCenter(first, second);
  state.drag = {
    mode: "pinch",
    startDistance: Math.max(getPointerDistance(first, second), 1),
    startTransform: { ...state.mapTransform },
    startWorldCenter: screenPointToWorld(startCenter),
  };
  elements.atlasMap.classList.add("is-dragging");
}

function applyMapTransform() {
  const { scale, tx, ty } = state.mapTransform;
  mapScene.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${tx} ${ty})`);
}

function zoomAt(targetPoint, nextScale) {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextScale));
  const { scale, tx, ty } = state.mapTransform;
  const worldX = (targetPoint.x - tx) / scale;
  const worldY = (targetPoint.y - ty) / scale;

  state.mapTransform.scale = clamped;
  state.mapTransform.tx = targetPoint.x - worldX * clamped;
  state.mapTransform.ty = targetPoint.y - worldY * clamped;
  applyMapTransform();
}

function fitBounds(bounds) {
  if (!bounds) return;
  const padding = 54;
  const min = project(bounds.minLng, bounds.maxLat);
  const max = project(bounds.maxLng, bounds.minLat);
  const width = Math.max(max.x - min.x, 42);
  const height = Math.max(max.y - min.y, 42);
  const scale = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, Math.min((MAP_WIDTH - padding * 2) / width, (MAP_HEIGHT - padding * 2) / height))
  );
  const centerX = (min.x + max.x) / 2;
  const centerY = (min.y + max.y) / 2;

  state.mapTransform = {
    scale,
    tx: MAP_WIDTH / 2 - centerX * scale,
    ty: MAP_HEIGHT / 2 - centerY * scale,
  };
  applyMapTransform();
}

function resetMapTransform() {
  state.mapTransform = { scale: 1, tx: 0, ty: 0 };
  applyMapTransform();
}

function hideTooltip() {
  elements.mapTooltip.hidden = true;
}

function showTooltip(event, html) {
  elements.mapTooltip.hidden = false;
  elements.mapTooltip.innerHTML = html;
  const shell = elements.atlasMap.parentElement.getBoundingClientRect();
  elements.mapTooltip.style.left = `${event.clientX - shell.left + 12}px`;
  elements.mapTooltip.style.top = `${event.clientY - shell.top + 12}px`;
}

function renderMapMessage(message) {
  const textNode = createSvgElement("text", {
    x: 500,
    y: 255,
    "text-anchor": "middle",
    fill: getMapThemeColors().emptyText,
    "font-size": 22,
  });
  textNode.textContent = message;
  mapPointLayer.innerHTML = "";
  mapPointLayer.append(textNode);
  state.lastMapBounds = null;
}

function renderMapPoints(filtered, selected) {
  if (state.loading) {
    elements.mapHeading.textContent = "Loading atlas data";
    renderMapMessage("Loading species data...");
    return;
  }

  if (state.error) {
    elements.mapHeading.textContent = "Atlas unavailable";
    renderMapMessage("Could not load atlas data");
    return;
  }

  const mapColors = getMapThemeColors();
  mapPointLayer.innerHTML = "";

  let points = [];
  if (selected && selected.localityCount > 0) {
    elements.mapHeading.textContent = `${selected.scientificName} localities`;
    points = selected.localities.map((locality) => ({
      kind: "selection",
      lat: locality.lat,
      lng: locality.lng,
      localityCount: 1,
      occurrenceCount: locality.count,
      locality,
    }));
  } else {
    elements.mapHeading.textContent = state.clusterFocus
      ? `Cluster focus (${formatNumber(filtered.length)} taxa)`
      : filtered.length
        ? `All filtered species (${formatNumber(filtered.length)})`
        : "No matching species";
    points = aggregateLocalities(filtered);
  }

  state.lastMapBounds = getBoundsFromPoints(points);

  if (!points.length) {
    renderMapMessage(
      selected ? "No mapped fossil coordinates for this species" : "No locality points for the current filter set"
    );
    return;
  }

  const renderablePoints = points
    .map((point) => ({
      ...point,
      projected: project(point.lng, point.lat),
      radius:
        point.kind === "selection"
          ? 5 + Math.log2(point.occurrenceCount + 1) * 2
          : 4 + Math.log2(point.localityCount + 1) * 2.4,
    }))
    .sort((left, right) => right.radius - left.radius);

  renderablePoints.forEach((point) => {
    const circle = createSvgElement("circle", {
      cx: point.projected.x,
      cy: point.projected.y,
      r: point.radius.toFixed(2),
      fill: point.kind === "selection" ? mapColors.pointSelectedFill : mapColors.pointFill,
      stroke: mapColors.pointRing,
      "stroke-width": 1.4,
      "vector-effect": "non-scaling-stroke",
    });

    circle.addEventListener("mouseenter", (event) => {
      if (point.kind === "selection") {
        showTooltip(
          event,
          `
            <strong>${escapeHtml(selected.scientificName)}</strong>
            <div>${escapeHtml(formatCoordinates(point.locality.lat, point.locality.lng))}</div>
            <div>${escapeHtml(
              point.locality.earlyInterval && point.locality.lateInterval
                ? `${point.locality.earlyInterval} to ${point.locality.lateInterval}`
                : point.locality.earlyInterval || point.locality.lateInterval || "Unknown interval"
            )}</div>
            <div>${escapeHtml(String(point.occurrenceCount))} occurrences at this locality</div>
          `
        );
      } else {
        showTooltip(
          event,
          `
            <strong>${escapeHtml(String(point.speciesCount))} species cluster</strong>
            <div>${escapeHtml(String(point.localityCount))} locality points</div>
            <div>${escapeHtml(String(point.occurrenceCount))} total occurrences</div>
            <div>${escapeHtml(point.sampleSpecies.join(", "))}</div>
          `
        );
      }
    });

    circle.addEventListener("mousemove", (event) => {
      if (!elements.mapTooltip.hidden) {
        showTooltip(event, elements.mapTooltip.innerHTML);
      }
    });
    circle.addEventListener("mouseleave", hideTooltip);

    if (point.kind === "aggregate") {
      circle.setAttribute("cursor", "pointer");
      circle.addEventListener("click", () => {
        state.clusterFocus = {
          key: point.key,
          lat: point.lat,
          lng: point.lng,
          localityCount: point.localityCount,
          occurrenceCount: point.occurrenceCount,
          speciesIds: point.speciesIds,
          bounds: point.bounds,
          sampleSpecies: point.sampleSpecies,
        };
        state.selectedId = null;
        render();
        fitBounds(point.bounds);
      });
    }

    mapPointLayer.append(circle);
  });
}

function render() {
  if (state.loading || state.error) {
    buildHeroStats([]);
    renderSpeciesList([]);
    renderDetailPanel([], null);
    renderSourcesPanel();
    renderMapPoints([], null);
    elements.clearSelectionButton.disabled = true;
    elements.zoomSelectionButton.disabled = true;
    return;
  }

  const filtered = getFilteredSpecies();
  syncClusterFocus(filtered);
  const activeSpecies = getActiveSpecies(filtered);
  syncSelection(activeSpecies);
  const selected = getSelectedSpecies(activeSpecies);

  buildHeroStats(activeSpecies);
  renderSpeciesList(activeSpecies);
  renderDetailPanel(activeSpecies, selected);
  renderSourcesPanel();
  renderMapPoints(activeSpecies, selected);

  elements.clearSelectionButton.disabled = !(selected || state.clusterFocus);
  elements.clearSelectionButton.textContent = state.clusterFocus ? "Clear focus" : "Clear selection";
  elements.zoomSelectionButton.disabled = !state.lastMapBounds;
}

function attachControlEvents() {
  elements.themeToggleButton.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  elements.groupFilter.addEventListener("change", (event) => {
    state.group = event.target.value;
    render();
  });

  elements.classFilter.addEventListener("change", (event) => {
    state.className = event.target.value;
    render();
  });

  elements.orderFilter.addEventListener("change", (event) => {
    state.order = event.target.value;
    render();
  });

  elements.epochFilter.addEventListener("change", (event) => {
    state.epoch = event.target.value;
    render();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  elements.clearSelectionButton.addEventListener("click", () => {
    state.selectedId = null;
    state.clusterFocus = null;
    render();
  });

  elements.resetMapButton.addEventListener("click", () => {
    resetMapTransform();
  });

  elements.zoomSelectionButton.addEventListener("click", () => {
    if (state.lastMapBounds) {
      fitBounds(state.lastMapBounds);
    }
  });
}

function attachMapEvents() {
  elements.atlasMap.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomAt(getSvgPoint(event), state.mapTransform.scale * factor);
    },
    { passive: false }
  );

  elements.atlasMap.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = getSvgPoint(event);
    activeMapPointers.set(event.pointerId, point);
    elements.atlasMap.setPointerCapture(event.pointerId);
    hideTooltip();
    if (activeMapPointers.size >= 2) {
      beginPinchGesture();
      return;
    }
    beginPanGesture(event.pointerId, point);
  });

  elements.atlasMap.addEventListener("pointermove", (event) => {
    if (!activeMapPointers.has(event.pointerId)) return;
    const point = getSvgPoint(event);
    activeMapPointers.set(event.pointerId, point);

    if (activeMapPointers.size >= 2) {
      if (!state.drag || state.drag.mode !== "pinch") {
        beginPinchGesture();
      }
      const [first, second] = Array.from(activeMapPointers.values()).slice(0, 2);
      const center = getPointerCenter(first, second);
      const distance = Math.max(getPointerDistance(first, second), 1);
      const scaleFactor = distance / state.drag.startDistance;
      const nextScale = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, state.drag.startTransform.scale * scaleFactor)
      );
      state.mapTransform.scale = nextScale;
      state.mapTransform.tx = center.x - state.drag.startWorldCenter.x * nextScale;
      state.mapTransform.ty = center.y - state.drag.startWorldCenter.y * nextScale;
      applyMapTransform();
      return;
    }

    if (!state.drag || state.drag.mode !== "pan" || state.drag.pointerId !== event.pointerId) {
      return;
    }

    state.mapTransform.tx = state.drag.startTransform.tx + (point.x - state.drag.startPoint.x);
    state.mapTransform.ty = state.drag.startTransform.ty + (point.y - state.drag.startPoint.y);
    applyMapTransform();
  });

  const finishPointer = (event) => {
    activeMapPointers.delete(event.pointerId);
    if (!activeMapPointers.size) {
      state.drag = null;
      elements.atlasMap.classList.remove("is-dragging");
      return;
    }
    if (activeMapPointers.size >= 2) {
      beginPinchGesture();
      return;
    }
    const [[pointerId, point]] = activeMapPointers.entries();
    beginPanGesture(pointerId, point);
  };

  ["pointerup", "pointercancel"].forEach((eventName) => {
    elements.atlasMap.addEventListener(eventName, finishPointer);
  });

  elements.atlasMap.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && activeMapPointers.has(event.pointerId)) {
      finishPointer(event);
    }
  });
}

function populateFilters() {
  populateFilterSelect(elements.groupFilter, "groups", getDistinctValues((item) => item.faunaGroup));
  populateFilterSelect(elements.classFilter, "classes", getDistinctValues((item) => item.className));
  populateFilterSelect(elements.orderFilter, "orders", getDistinctValues((item) => item.order));
  populateFilterSelect(elements.epochFilter, "epochs", getDistinctValues((item) => item.temporalRange.epoch));
}

async function init() {
  applyTheme(document.documentElement.dataset.theme || getPreferredTheme(), {
    persist: false,
    rebuildMap: false,
  });
  renderMapBase();
  attachControlEvents();
  attachMapEvents();
  render();

  try {
    species = await loadSpeciesData();
    populateFilters();
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

init();
