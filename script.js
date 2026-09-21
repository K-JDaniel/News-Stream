/* =========================================================
   NEWS STREAM — script.js
   Vanilla JavaScript only. No frameworks, no libraries.

   DATA SOURCE: GNews API (top-headlines endpoint) — real data only.
   There is NO demo/mock/sample fallback dataset anywhere in this file.
   If a request fails, the user sees a clear error message and no
   fabricated articles are shown.

   API REQUEST STRATEGY (minimizes GNews free-tier usage):
   - `categoryCache` stores fetched articles PER CATEGORY, keyed by
     category name. Each category is requested from the API AT MOST
     ONCE per browser session — after that it's served from this
     in-memory cache.
   - Initial page load fetches ONLY the currently selected category
     (usually "general") — 1 request, not one per category.
   - Changing category fetches from the API ONLY if that category
     isn't cached yet. Re-selecting an already-visited category costs
     ZERO requests.
   - Typing in the search box NEVER triggers a request — search only
     filters articles already sitting in categoryCache.
   - Clearing the search box NEVER triggers a request either.
   - "All" shows the union of whatever categories have been fetched
     so far this session — it does not force-fetch every category.

   ON CATEGORY HONESTY:
   GNews's top-headlines response does NOT include a per-article
   "category" field. However, the endpoint DOES accept `category` as
   a request parameter and returns articles belonging to that
   category. So tagging a fetched article with the category it was
   requested under is accurate information derived from the API call
   itself — not a guess or a fabricated value. No category is ever
   assigned that the API response didn't effectively provide via the
   request context.
   ========================================================= */

/* -------------------- APPLICATION STATE -------------------- */
let categoryCache = {};       // { technology: [...], sports: [...], ... } — only successfully fetched categories are present
let articles = [];            // Base (pre-search) article list for the CURRENTLY SELECTED category, derived from categoryCache
let selectedCategory = "All"; // Current category filter ("All" = no category filter)
let searchQuery = "";         // Current search text (raw, as typed)

/* -------------------- DOM REFERENCES -------------------- */
let searchInputEl;
let categoryNavEl;
let newsContainerEl;
let loadingMessageEl;
let errorMessageEl;
let emptyMessageEl;

/* -------------------- API CONFIGURATION -------------------- */
/* ⚠️ DEMO / PROJECT USE ONLY ⚠️
   This API key is visible to anyone who inspects the page source or
   the browser's Network tab — there is no way to hide a key in pure
   client-side JavaScript. This is acceptable ONLY for a learning/demo
   project with a free, rate-limited key.
   In a real production app, requests that require a secret key should
   be routed through a backend/server so the key is never sent to the
   browser at all. */
const API_KEY = "YOUR_API_KEY_HERE";
const API_BASE_URL = "https://gnews.io/api/v4/top-headlines";

/* Categories the UI offers. Each is fetched from the API lazily, on
   demand, and cached — see categoryCache above. These must match the
   data-category attributes in index.html and GNews's supported
   category values. */
const CATEGORIES = ["general", "technology", "sports", "business", "entertainment", "health"];

const PLACEHOLDER_IMAGE = "https://via.placeholder.com/400x200?text=No+Image";

/* Category values that mean "don't filter by category at all". */
const NO_CATEGORY_FILTER_VALUES = ["all", "general"];

const STORAGE_KEY_CATEGORY = "newsStream_selectedCategory";
const STORAGE_KEY_SEARCH = "newsStream_searchQuery";

/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeApp() {
  // 1. Get DOM references
  searchInputEl = document.getElementById("searchInput");
  categoryNavEl = document.getElementById("categoryNav");
  newsContainerEl = document.getElementById("newsContainer");
  loadingMessageEl = document.getElementById("loadingMessage");
  errorMessageEl = document.getElementById("errorMessage");
  emptyMessageEl = document.getElementById("emptyMessage");

  // 2. Restore any saved filter state from sessionStorage
  restoreStateFromStorage();

  // 3. Attach event listeners
  searchInputEl.addEventListener("input", handleSearch);
  categoryNavEl.addEventListener("click", handleCategoryChange);

  // 4. Load data for whichever category is currently selected.
  //    This fires exactly ONE API request on a fresh session, not
  //    one request per category.
  loadAndRenderCurrentView();
}

document.addEventListener("DOMContentLoaded", initializeApp);

/* =========================================================
   SESSION STORAGE (persists selectedCategory + searchQuery only —
   never the article data itself)
   ========================================================= */

function saveStateToStorage() {
  sessionStorage.setItem(STORAGE_KEY_CATEGORY, selectedCategory);
  sessionStorage.setItem(STORAGE_KEY_SEARCH, searchQuery);
}

function restoreStateFromStorage() {
  const savedCategory = sessionStorage.getItem(STORAGE_KEY_CATEGORY);
  const savedSearch = sessionStorage.getItem(STORAGE_KEY_SEARCH);

  if (savedCategory !== null) {
    selectedCategory = savedCategory;
  }
  if (savedSearch !== null) {
    searchQuery = savedSearch;
  }

  searchInputEl.value = searchQuery;
  updateActiveCategoryButton();
}

/**
 * Compares two category values for equivalence: identical
 * (case-insensitive), or both fall into the "no filter" bucket
 * (e.g. "All" and "general" mean the same thing).
 */
function categoriesMatch(categoryA, categoryB) {
  const a = categoryA.toLowerCase();
  const b = categoryB.toLowerCase();
  if (a === b) return true;
  return NO_CATEGORY_FILTER_VALUES.includes(a) && NO_CATEGORY_FILTER_VALUES.includes(b);
}

/** Single source of truth for category button active/pressed state. */
function updateActiveCategoryButton() {
  const allButtons = categoryNavEl.querySelectorAll(".category-btn");
  allButtons.forEach((btn) => {
    const isActive = categoriesMatch(btn.dataset.category, selectedCategory);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

/* =========================================================
   DATA FETCHING (API layer — isolated + lazily cached per category)
   ========================================================= */

/**
 * Ensures the given category's articles exist in categoryCache,
 * fetching from the API ONLY if they are not already cached.
 * Returns { success, fromCache } so the caller knows whether a
 * network request actually happened and whether it succeeded.
 */
async function ensureCategoryDataLoaded(category) {
  const isNoFilter = NO_CATEGORY_FILTER_VALUES.includes(category.toLowerCase());
  const cacheKey = isNoFilter ? "general" : category.toLowerCase();

  // Already cached — zero requests needed.
  if (categoryCache[cacheKey]) {
    return { success: true, fromCache: true };
  }

  showLoading();

  try {
    const mappedArticles = await fetchArticlesForCategory(cacheKey);
    categoryCache[cacheKey] = mappedArticles;
    return { success: true, fromCache: false };
  } catch (error) {
    console.error(`Failed to load "${cacheKey}":`, error.message);
    showError(
      `Unable to load ${capitalize(cacheKey)} news right now. Please check your connection and try again later.`
    );
    return { success: false, fromCache: false };
  } finally {
    // Guaranteed to run — the UI can never get stuck on loading.
    loadingMessageEl.hidden = true;
  }
}

/**
 * Fetches and maps articles for a single category from the real
 * GNews API. Throws a descriptive error for each distinct failure
 * type so the user always gets an accurate, non-generic message:
 *   1. Network error        — fetch() itself rejects
 *   2. HTTP error           — response.ok is false
 *   3. Invalid API response — body isn't valid JSON
 *   4. Unexpected structure — valid JSON, wrong shape
 */
async function fetchArticlesForCategory(category) {
  let response;

  try {
    const url = `${API_BASE_URL}?category=${category}&lang=en&apikey=${API_KEY}`;
    response = await fetch(url);
  } catch (networkError) {
    throw new Error(`Network error ("${category}"): ${networkError.message}`);
  }

  // Receiving a Response object does NOT mean success — check response.ok
  if (!response.ok) {
    throw new Error(`HTTP error ("${category}"): status ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error(`Invalid JSON response ("${category}")`);
  }

  if (!data || !Array.isArray(data.articles)) {
    throw new Error(`Unexpected response structure ("${category}")`);
  }

  return mapApiResponseToArticles(data.articles, category);
}

/**
 * Converts raw GNews article objects into our internal shape.
 * The `category` value here is the category this batch was fetched
 * under via the API request — it is accurate information derived
 * from the request itself, not a guess, since GNews's response
 * objects don't carry their own category field.
 */
function mapApiResponseToArticles(rawArticles, category) {
  return rawArticles.map((item) => ({
    title: item.title || "Untitled article",
    description: item.description || "No description available.",
    image: item.image || "",
    url: item.url || "#",
    source: (item.source && item.source.name) || "Unknown source",
    publishedAt: item.publishedAt || "",
    category: category,
  }));
}

/**
 * Builds the base (pre-search) article list for whichever category
 * is currently selected, purely from categoryCache — no network
 * activity here at all.
 *   - "All"/"general" → union of every category cached so far this
 *     session (deduplicated by URL, since a story can appear under
 *     more than one category)
 *   - a specific category → just that category's cached articles
 *     (empty array if it hasn't been fetched yet)
 */
function getBaseArticlesForSelectedCategory() {
  const isNoFilter = NO_CATEGORY_FILTER_VALUES.includes(selectedCategory.toLowerCase());

  if (isNoFilter) {
    const combined = [];
    const seenUrls = new Set();
    Object.values(categoryCache).forEach((categoryArticles) => {
      categoryArticles.forEach((article) => {
        if (!seenUrls.has(article.url)) {
          seenUrls.add(article.url);
          combined.push(article);
        }
      });
    });
    return combined;
  }

  const cacheKey = selectedCategory.toLowerCase();
  return categoryCache[cacheKey] || [];
}

/**
 * Main "load whatever is needed, then display it" entry point.
 * Called on init and every category change. Hits the API ONLY if
 * the selected category isn't already cached.
 */
async function loadAndRenderCurrentView() {
  const result = await ensureCategoryDataLoaded(selectedCategory);

  articles = getBaseArticlesForSelectedCategory();

  // A fresh successful fetch means any stale error banner from a
  // previous failed attempt is no longer relevant.
  if (result.success && !result.fromCache) {
    errorMessageEl.hidden = true;
  }

  const visibleArticles = getFilteredArticles();
  renderArticles(visibleArticles, !result.success);
}

/* =========================================================
   FILTERING (pure function — no side effects, no network activity)

   Category filtering already happened when `articles` was set via
   getBaseArticlesForSelectedCategory(). This function only applies
   the search condition on top of that — so searching NEVER re-fetches
   and always respects whichever category is currently active.
   ========================================================= */

function getFilteredArticles() {
  let result = articles;

  const normalizedQuery = searchQuery.trim().toLowerCase();

  if (normalizedQuery !== "") {
    result = result.filter((article) => articleMatchesSearch(article, normalizedQuery));
  }

  return result; // New array — `articles` itself was never modified
}

/**
 * Checks whether a single article matches the given (already
 * normalized/lowercased) search term. Checks title, description,
 * and source — matching any one of them counts as a match.
 */
function articleMatchesSearch(article, normalizedQuery) {
  const title = (article.title || "").toLowerCase();
  const description = (article.description || "").toLowerCase();
  const source = (article.source || "").toLowerCase();

  return (
    title.includes(normalizedQuery) ||
    description.includes(normalizedQuery) ||
    source.includes(normalizedQuery)
  );
}

/* =========================================================
   RENDERING

   NOTE: this function does NOT touch the error message. The error
   banner is controlled only by the fetch lifecycle (showLoading
   clears it, showError sets it, a fresh success clears it) so it
   persists across re-renders (search typing, etc.) until something
   actually changes it.
   ========================================================= */

function renderArticles(articlesToRender, fetchFailed) {
  newsContainerEl.innerHTML = "";
  loadingMessageEl.hidden = true;
  emptyMessageEl.hidden = true;

  // Base dataset for this category is empty.
  if (articles.length === 0) {
    if (!fetchFailed) {
      // The API succeeded but genuinely returned zero articles.
      showEmpty("No news available right now.");
    }
    // If the fetch failed, the error banner already explains the
    // empty list — no need to also show a conflicting empty message.
    return;
  }

  // Base dataset has data, but the search filter matched nothing.
  if (articlesToRender.length === 0) {
    showEmpty("No articles match your filters.");
    return;
  }

  // Normal case — build and append a card per article
  const cardsFragment = document.createDocumentFragment();
  articlesToRender.forEach((article) => {
    cardsFragment.appendChild(createArticleCard(article));
  });
  newsContainerEl.appendChild(cardsFragment);
}

/**
 * Builds a single article card element.
 * Every field is defended against being missing/undefined so a
 * partial API response can never break rendering.
 */
function createArticleCard(article) {
  const card = document.createElement("article");
  card.className = "news-card";

  // ---- Image (safe fallback + safe failure handling) ----
  const image = document.createElement("img");
  image.className = "news-card-image";
  image.src = article.image || PLACEHOLDER_IMAGE;
  image.alt = article.title || "News article image";
  image.loading = "lazy";
  image.addEventListener("error", function handleImageError() {
    if (image.src !== PLACEHOLDER_IMAGE) {
      image.src = PLACEHOLDER_IMAGE;
    } else {
      image.removeEventListener("error", handleImageError);
    }
  });
  card.appendChild(image);

  const content = document.createElement("div");
  content.className = "news-card-content";

  // ---- Category ----
  const category = document.createElement("p");
  category.className = "news-card-category";
  category.textContent = capitalize(article.category || "general");
  content.appendChild(category);

  // ---- Title (fallback if missing) ----
  const title = document.createElement("h2");
  title.className = "news-card-title";
  title.textContent = article.title && article.title.trim() !== ""
    ? article.title
    : "Untitled article";
  content.appendChild(title);

  // ---- Description (required fallback text) ----
  const description = document.createElement("p");
  description.className = "news-card-description";
  description.textContent = article.description && article.description.trim() !== ""
    ? article.description
    : "No description available.";
  content.appendChild(description);

  // ---- Source + publication date ----
  const meta = document.createElement("div");
  meta.className = "news-card-meta";

  const source = document.createElement("span");
  source.className = "news-card-source";
  source.textContent = article.source && article.source.trim() !== ""
    ? article.source
    : "Unknown source";
  meta.appendChild(source);

  const formattedDate = formatDate(article.publishedAt);
  if (formattedDate) {
    const date = document.createElement("span");
    date.className = "news-card-date";
    date.textContent = formattedDate;
    meta.appendChild(date);
  }

  content.appendChild(meta);

  // ---- Read more link (opens safely in a new tab) ----
  const link = document.createElement("a");
  link.className = "news-card-link";
  link.href = article.url && article.url.trim() !== "" ? article.url : "#";
  link.textContent = "Read more";
  link.target = "_blank";
  link.rel = "noopener noreferrer"; // prevents the new tab from accessing window.opener
  content.appendChild(link);

  card.appendChild(content);

  return card;
}

/* -------------------- SMALL HELPERS -------------------- */

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* =========================================================
   EVENT HANDLERS
   ========================================================= */

/**
 * Handles a click anywhere inside the category nav (event delegation).
 * Flow: detect clicked button -> update selectedCategory -> update
 * active button UI -> save to sessionStorage -> ensure that
 * category's data is loaded (fetches from the API ONLY if it isn't
 * already cached) -> derive filtered articles -> render.
 */
function handleCategoryChange(event) {
  const clickedButton = event.target.closest(".category-btn");
  if (!clickedButton) return;

  selectedCategory = clickedButton.dataset.category;
  updateActiveCategoryButton();
  saveStateToStorage();

  loadAndRenderCurrentView();
}

/**
 * Handles typing in the search input. Runs on every keystroke.
 * Purely client-side: reads input -> stores searchQuery -> saves to
 * sessionStorage -> re-derives visible articles from the ALREADY
 * CACHED data for the current category -> renders.
 * NEVER calls the API — satisfies "no requests on search or clear".
 */
function handleSearch(event) {
  searchQuery = event.target.value;
  saveStateToStorage();

  const visibleArticles = getFilteredArticles();
  renderArticles(visibleArticles, false);
}

/* =========================================================
   UI STATUS STATES (loading / error / empty)
   ========================================================= */

/** Shown immediately before a fetch attempt starts. Clears any
 *  previous error/empty state and the article container. */
function showLoading() {
  loadingMessageEl.textContent = "Loading news...";
  loadingMessageEl.hidden = false;
  errorMessageEl.hidden = true;
  emptyMessageEl.hidden = true;
  newsContainerEl.innerHTML = "";
}

/** Shown when a category fetch fails. Persists as a banner until the
 *  next successful fetch — NOT cleared by renderArticles(). */
function showError(message) {
  errorMessageEl.textContent = message || "Something went wrong while fetching news.";
  errorMessageEl.hidden = false;
}

/** Shown by renderArticles() when there is nothing to display. */
function showEmpty(message) {
  emptyMessageEl.textContent = message || "No articles found.";
  emptyMessageEl.hidden = false;
}