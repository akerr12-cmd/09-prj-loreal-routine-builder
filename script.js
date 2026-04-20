/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const productsCarouselPrev = document.getElementById("productsCarouselPrev");
const productsCarouselNext = document.getElementById("productsCarouselNext");
const selectedCountText = document.getElementById("selectedCountText");
const saveSelectedProductsButton = document.getElementById("saveSelectedProductsBtn");
const generateRoutineButton = document.getElementById("generateRoutine");
const menuButton = document.getElementById("menuButton");
const menuPanel = document.getElementById("menuPanel");
const newRoutineMenuBtn = document.getElementById("newRoutineMenuBtn");
const downloadRoutineMenuBtn = document.getElementById("downloadRoutineMenuBtn");
const downloadAtelierMenuBtn = document.getElementById("downloadAtelierMenuBtn");
const instructionsMenuBtn = document.getElementById("instructionsMenuBtn");
const instructionsPanel = document.getElementById("instructionsPanel");
const routineOutput = document.getElementById("routineOutput");
const saveRoutineButton = document.getElementById("saveRoutineBtn");
const savedProductsGrid = document.getElementById("savedProductsGrid");
const clearSavedProductsButton = document.getElementById("clearSavedProductsBtn");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const apiUrl = typeof OPENAI_API_URL === "string" ? OPENAI_API_URL : "";

const savedProductsStorageKey = "loreal-curated-edit";
const selectedProductsStorageKey = "loreal-selected-products";

const rtlLanguagePrefixes = ["ar", "he", "fa", "ur"];

function initializeTextDirection() {
  if (document.documentElement.getAttribute("dir")) {
    return;
  }

  const browserLanguage = (navigator.language || navigator.userLanguage || "").toLowerCase();
  const isRtlLanguage = rtlLanguagePrefixes.some((prefix) => browserLanguage.startsWith(prefix));

  if (isRtlLanguage) {
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", browserLanguage.split("-")[0] || "ar");
  }
}

initializeTextDirection();

let currentProducts = [];
let productCatalog = [];
let selectedProducts = [];
let savedProducts = [];
let suggestedRoutineProducts = [];
let expandedProducts = [];
let conversationThreadId = "";
let hasGeneratedRoutine = false;
let beautyPreferences = {
  skinType: "",
  sensitivity: false,
  concerns: [],
};
let searchQuery = "";
let isCarouselDragging = false;
let carouselDragStartX = 0;
let carouselDragStartScrollLeft = 0;
let carouselPointerId = null;
let suppressProductClickOnce = false;
let hasCarouselDragMoved = false;
let isMenuOpen = false;
let isInstructionsOpen = false;

/* Scroll product carousel by one card track */
function scrollProductCarousel(direction) {
  if (!productsContainer) {
    return;
  }

  const firstCard = productsContainer.querySelector(".product-card");
  const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : 280;
  const carouselGap = 20;
  const step = cardWidth + carouselGap;
  const isRtl = document.documentElement.getAttribute("dir") === "rtl";
  const signedDirection = isRtl ? -direction : direction;

  productsContainer.scrollBy({
    left: signedDirection * step,
    behavior: "smooth",
  });
}

/* Start carousel drag interaction for touch and mouse */
function handleCarouselPointerDown(event) {
  if (!productsContainer || productsContainer.querySelectorAll(".product-card").length === 0) {
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  isCarouselDragging = true;
  carouselPointerId = event.pointerId;
  carouselDragStartX = event.clientX;
  carouselDragStartScrollLeft = productsContainer.scrollLeft;
  hasCarouselDragMoved = false;
}

/* Move carousel while dragging */
function handleCarouselPointerMove(event) {
  if (!isCarouselDragging || carouselPointerId !== event.pointerId || !productsContainer) {
    return;
  }

  const deltaX = event.clientX - carouselDragStartX;
  const hasMovedEnough = Math.abs(deltaX) > 8;

  if (hasMovedEnough) {
    hasCarouselDragMoved = true;
    productsContainer.classList.add("is-dragging");
    productsContainer.scrollLeft = carouselDragStartScrollLeft - deltaX;
    event.preventDefault();
  }
}

/* End carousel drag interaction */
function handleCarouselPointerUp(event) {
  if (!productsContainer || carouselPointerId !== event.pointerId) {
    return;
  }

  isCarouselDragging = false;
  carouselPointerId = null;
  productsContainer.classList.remove("is-dragging");
  suppressProductClickOnce = hasCarouselDragMoved;
  hasCarouselDragMoved = false;

  updateCarouselControlsState();
}

/* Show/hide and enable/disable carousel controls based on card availability */
function updateCarouselControlsState() {
  if (!productsCarouselPrev || !productsCarouselNext || !productsContainer) {
    return;
  }

  const hasCards = productsContainer.querySelectorAll(".product-card").length > 0;
  const hasOverflow = productsContainer.scrollWidth > productsContainer.clientWidth + 4;
  const shouldShowControls = hasCards;

  productsCarouselPrev.hidden = !shouldShowControls;
  productsCarouselNext.hidden = !shouldShowControls;
  productsCarouselPrev.disabled = !hasOverflow;
  productsCarouselNext.disabled = !hasOverflow;
}

function setMenuOpen(nextIsOpen) {
  isMenuOpen = nextIsOpen;

  if (menuButton) {
    menuButton.setAttribute("aria-expanded", String(nextIsOpen));
  }

  if (menuPanel) {
    menuPanel.hidden = !nextIsOpen;
  }
}

function toggleMenu() {
  setMenuOpen(!isMenuOpen);
}

function closeMenu() {
  setMenuOpen(false);
  setInstructionsOpen(false);
}

function setInstructionsOpen(nextIsOpen) {
  isInstructionsOpen = nextIsOpen;

  if (instructionsMenuBtn) {
    instructionsMenuBtn.setAttribute("aria-expanded", String(nextIsOpen));
  }

  if (instructionsPanel) {
    instructionsPanel.hidden = !nextIsOpen;
  }
}

function toggleInstructions() {
  setInstructionsOpen(!isInstructionsOpen);
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  if (productCatalog.length) {
    return productCatalog;
  }

  const response = await fetch("products.json");
  const data = await response.json();
  productCatalog = Array.isArray(data.products) ? data.products : [];
  return productCatalog;
}

/* Get the full catalog payload for the assistant */
function getProductCatalogPayload() {
  return productCatalog.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));
}

/* Load saved curated edit items from localStorage */
function loadSavedProducts() {
  try {
    const storedValue = localStorage.getItem(savedProductsStorageKey);
    savedProducts = storedValue ? JSON.parse(storedValue) : [];
  } catch (error) {
    savedProducts = [];
  }

  if (!Array.isArray(savedProducts)) {
    savedProducts = [];
  }
}

/* Save curated edit items to localStorage */
function persistSavedProducts() {
  localStorage.setItem(savedProductsStorageKey, JSON.stringify(savedProducts));
}

/* Load active selected products from localStorage */
function loadSelectedProducts() {
  try {
    const storedValue = localStorage.getItem(selectedProductsStorageKey);
    selectedProducts = storedValue ? JSON.parse(storedValue) : [];
  } catch (error) {
    selectedProducts = [];
  }

  if (!Array.isArray(selectedProducts)) {
    selectedProducts = [];
    return;
  }

  selectedProducts = uniqueProducts(selectedProducts)
    .map((product) => ({
      id: product?.id,
      name: String(product?.name || "").trim(),
      brand: String(product?.brand || "").trim(),
      category: String(product?.category || "").trim(),
      description: String(product?.description || "").trim(),
      image: String(product?.image || "").trim(),
    }))
    .filter((product) => product.name);
}

/* Save active selected products to localStorage */
function persistSelectedProducts() {
  localStorage.setItem(selectedProductsStorageKey, JSON.stringify(selectedProducts));
}

/* Create a stable key so the atelier can avoid duplicate products */
function getProductDedupKey(product) {
  if (!product) {
    return "";
  }

  const id = String(product.id || "").trim();
  if (id) {
    return `id:${id}`;
  }

  const name = String(product.name || "").toLowerCase().trim();
  const brand = String(product.brand || "").toLowerCase().trim();
  return name ? `name:${name}|brand:${brand}` : "";
}

/* Remove duplicate products while keeping the first copy */
function uniqueProducts(products) {
  const unique = [];
  const seen = new Set();

  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const key = getProductDedupKey(product);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(product);
  }

  return unique;
}

/* Escape user-facing text before inserting in HTML */
function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Build a product lookup URL for links shown in The Product Atelier */
function getProductAtelierLink(product) {
  const explicitUrl = String(product?.url || product?.link || "").trim();

  if (explicitUrl) {
    return explicitUrl;
  }

  const brand = String(product?.brand || "").trim();
  const name = String(product?.name || "").trim();
  const query = [brand, name, "product"].filter(Boolean).join(" ");

  if (!query) {
    return "";
  }

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/* Normalize product text for search matching */
function getProductSearchText(product) {
  return `${product.name} ${product.brand} ${product.description} ${product.category}`.toLowerCase();
}

/* Determine whether a product matches the current search query */
function isProductSearchMatch(product) {
  if (!searchQuery.trim()) {
    return true;
  }

  return getProductSearchText(product).includes(searchQuery.trim().toLowerCase());
}

/* Add editorial micro-accents to AI chat text */
function formatEditorialChatText(text) {
  let formatted = escapeHtml(text);
  formatted = formatted.replace(
    /(https?:\/\/[^\s<]+)/gi,
    '<a class="source-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  formatted = formatted.replace(/\n/g, "<br>");
  const ingredientPatterns = [
    "hyaluronic acid",
    "niacinamide",
    "ceramides",
    "retinol",
    "salicylic acid",
    "vitamin c",
    "peptides",
    "glycolic acid",
    "lactic acid",
    "squalane",
    "aha",
    "bha",
  ];

  ingredientPatterns.forEach((ingredient) => {
    const regex = new RegExp(`\\b(${ingredient.replace(/\s+/g, "\\s+")})\\b`, "gi");
    formatted = formatted.replace(regex, '<span class="ingredient-accent">$1</span>');
  });

  formatted = formatted.replace(/\b(Apply|Avoid|Layer)\b/gi, '<span class="action-accent">$1</span>');
  return formatted;
}

/* Add a styled chat bubble to the chat window */
function addChatMessage(sender, message) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;

  if (sender === "ai") {
    bubble.innerHTML = formatEditorialChatText(message);
  } else {
    bubble.textContent = message;
  }

  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Show subtle gold thinking dots while waiting for AI reply */
function showThinkingIndicator() {
  removeThinkingIndicator();
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble ai thinking-bubble";
  bubble.id = "thinkingBubble";
  bubble.setAttribute("aria-label", "Assistant is thinking");
  bubble.innerHTML = `
    <span class="thinking-dot"></span>
    <span class="thinking-dot"></span>
    <span class="thinking-dot"></span>
  `;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Remove temporary thinking indicator */
function removeThinkingIndicator() {
  const thinkingBubble = document.getElementById("thinkingBubble");
  if (thinkingBubble) {
    thinkingBubble.remove();
  }
}

/* Store lightweight preference memory from user wording */
function updateBeautyPreferencesFromMessage(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("dry skin")) {
    beautyPreferences.skinType = "dry";
  }
  if (text.includes("oily skin")) {
    beautyPreferences.skinType = "oily";
  }
  if (text.includes("combination skin")) {
    beautyPreferences.skinType = "combination";
  }
  if (text.includes("sensitive")) {
    beautyPreferences.sensitivity = true;
  }

  const concernKeywords = [
    "acne",
    "dark spots",
    "hydration",
    "fine lines",
    "frizz",
    "dullness",
    "redness",
    "anti-aging",
  ];

  concernKeywords.forEach((keyword) => {
    if (text.includes(keyword) && !beautyPreferences.concerns.includes(keyword)) {
      beautyPreferences.concerns.push(keyword);
    }
  });
}

/* Convert stored preferences into a concise context string */
function getPreferenceSummary() {
  const parts = [];

  if (beautyPreferences.skinType) {
    parts.push(`skin type: ${beautyPreferences.skinType}`);
  }
  if (beautyPreferences.sensitivity) {
    parts.push("sensitive skin");
  }
  if (beautyPreferences.concerns.length) {
    parts.push(`key concerns: ${beautyPreferences.concerns.join(", ")}`);
  }

  return parts.join(" | ");
}

/* Convert selected product objects into a clean API payload */
function getSelectedProductsPayload() {
  return selectedProducts.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));
}

/* Build conversation history from chat bubbles for follow-up context */
function getConversationPayload() {
  const bubbles = chatWindow.querySelectorAll(".chat-bubble");

  return Array.from(bubbles)
    .filter((bubble) => !bubble.classList.contains("thinking-bubble"))
    .map((bubble) => ({
      role: bubble.classList.contains("user") ? "user" : "assistant",
      content: bubble.textContent ? bubble.textContent.trim() : "",
    }))
    .filter((message) => message.content);
}

/* Keep follow-up chat focused on routine and beauty-related topics */
function isAllowedFollowUpTopic(message, conversationHistory = []) {
  const normalizedMessage = String(message || "").toLowerCase();

  if (!normalizedMessage.trim()) {
    return false;
  }

  // Allow the assistant to start a conversation even before products are selected.
  if (!hasGeneratedRoutine && selectedProducts.length === 0) {
    return true;
  }

  if (hasGeneratedRoutine && conversationHistory.length > 0 && /\b(this|that|it|they|them|these|those)\b/.test(normalizedMessage)) {
    return true;
  }

  const allowedKeywords = [
    "routine",
    "step",
    "order",
    "how",
    "tips",
    "application",
    "apply",
    "morning",
    "night",
    "am",
    "pm",
    "product",
    "cleanser",
    "serum",
    "moisturizer",
    "sunscreen",
    "spf",
    "toner",
    "treatment",
    "mask",
    "exfol",
    "skin",
    "skincare",
    "hair",
    "haircare",
    "scalp",
    "shampoo",
    "conditioner",
    "makeup",
    "foundation",
    "concealer",
    "eyeliner",
    "eye pencil",
    "pencil",
    "liner",
    "mascara",
    "eyeshadow",
    "brow",
    "lip",
    "blush",
    "fragrance",
    "perfume",
    "scent",
    "sensitive",
    "acne",
    "hydration",
  ];

  const hasKeyword = allowedKeywords.some((keyword) => normalizedMessage.includes(keyword));

  if (hasKeyword) {
    return true;
  }

  const knownProducts = [...selectedProducts, ...savedProducts, ...suggestedRoutineProducts];

  return knownProducts.some((product) => {
    const name = String(product?.name || "").toLowerCase().trim();
    return name && normalizedMessage.includes(name);
  });
}

/* Send message context to Cloudflare Worker and return assistant response */
async function sendToRoutineAdvisor(mode, message) {
  // Step 1: Make sure the Worker URL is configured in the frontend secrets file.
  if (!apiUrl) {
    throw new Error("Missing OPENAI_API_URL in secrets.js");
  }

  // Step 2: Ensure product catalog is loaded before building payload context.
  if (!productCatalog.length) {
    await loadProducts();
  }

  // Step 3: Send one complete request object (message, mode, catalog, selected products, chat history, preferences).
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      mode,
      threadId: conversationThreadId,
      catalog: getProductCatalogPayload(),
      products: getSelectedProductsPayload(),
      conversation: getConversationPayload(),
      preferences: getPreferenceSummary(),
    }),
  });

  const data = await response.json();

  // Step 4: Surface backend errors with the exact message when available.
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to reach routine advisor.");
  }

  // Step 5: Keep thread id so follow-up messages stay in one conversation context.
  if (typeof data.threadId === "string" && data.threadId) {
    conversationThreadId = data.threadId;
  }

  // Step 6: Return normalized Worker response to the caller.
  return data;
}

/* Add the AI-generated routine summary below the visual timeline */
function stripSuggestedProductsFromRoutineText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const headingRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:suggested|recommended)\s+products?\s*:?\s*(?:\*\*)?\s*\n([\s\S]*)/i;
  const headingMatch = normalized.match(headingRegex);

  if (headingMatch) {
    const headingIndex = normalized.indexOf(headingMatch[0]);
    return normalized.slice(0, headingIndex).trim();
  }

  return normalized.trim();
}

function renderRoutineEditorialSummary(summaryText) {
  const placeholder = routineOutput.querySelector(".routine-placeholder");
  if (placeholder) {
    placeholder.remove();
  }

  const note = document.createElement("article");
  note.className = "routine-ai-note";
  note.textContent = stripSuggestedProductsFromRoutineText(summaryText);
  routineOutput.appendChild(note);
}

/* Keep the user's last question visible in the routine panel during mid-conversation updates */
function renderRoutineQuestionContext() {
  const bubbles = chatWindow.querySelectorAll(".chat-bubble.user");
  const lastUserBubble = bubbles.length ? bubbles[bubbles.length - 1] : null;
  const questionText = lastUserBubble ? lastUserBubble.textContent.trim() : "";

  if (!questionText) {
    return;
  }

  const existingQuestion = routineOutput.querySelector(".routine-user-question");
  if (existingQuestion) {
    existingQuestion.remove();
  }

  const question = document.createElement("article");
  question.className = "routine-user-question";
  question.innerHTML = `
    <p class="routine-user-question-label">Previous Question</p>
    <p class="routine-user-question-text">${escapeHtml(questionText)}</p>
  `;
  routineOutput.appendChild(question);
}

/* Normalize names so routine suggestions can be matched against selected products */
function normalizeProductNameForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Check whether a suggested product is already part of the current routine */
function isProductAlreadySelectedByName(productName) {
  const normalizedName = normalizeProductNameForMatch(productName);

  if (!normalizedName) {
    return false;
  }

  return selectedProducts.some((product) => normalizeProductNameForMatch(product.name) === normalizedName);
}

/* Find the closest catalog product so the added suggestion uses real product metadata */
function findProductByName(productName) {
  const normalizedName = normalizeProductNameForMatch(productName);

  if (!normalizedName) {
    return null;
  }

  return productCatalog.find((product) => normalizeProductNameForMatch(product.name) === normalizedName) || null;
}

/* Add a suggested product into the active routine */
async function addSuggestedProductToRoutine(productName) {
  const normalizedName = normalizeProductNameForMatch(productName);

  if (!normalizedName) {
    return;
  }

  if (!productCatalog.length) {
    await loadProducts();
  }

  if (isProductAlreadySelectedByName(normalizedName)) {
    addChatMessage("ai", `${productName} is already in your routine.`);
    return;
  }

  const catalogMatch = findProductByName(productName);
  const productToAdd = catalogMatch || {
    id: `suggested-${Date.now()}-${selectedProducts.length + 1}`,
    name: productName,
    brand: "L'Oréal suggested option",
    category: "suggested",
    description: "Suggested by the chatbot based on your request.",
  };

  selectedProducts.push(productToAdd);
  persistSelectedProducts();
  displayProducts(currentProducts);
  updateSelectedCount();
  updateSaveSelectedButtonState();
  renderSavedProducts();

  addChatMessage("ai", `${productToAdd.name} has been added to your routine.`);
  await generatePersonalizedRoutine();
  renderRoutineQuestionContext();
}

/* Add all currently suggested products to the active routine at once */
async function addAllSuggestedProductsToRoutine() {
  const addableProductNames = suggestedRoutineProducts
    .map((product) => String(product?.name || "").trim())
    .filter((name) => name && !isProductAlreadySelectedByName(name));

  if (!addableProductNames.length) {
    addChatMessage("ai", "All suggested products are already in your routine.");
    return;
  }

  if (!productCatalog.length) {
    await loadProducts();
  }

  let addedCount = 0;

  for (let i = 0; i < addableProductNames.length; i += 1) {
    const productName = addableProductNames[i];

    if (isProductAlreadySelectedByName(productName)) {
      continue;
    }

    const catalogMatch = findProductByName(productName);
    const productToAdd = catalogMatch || {
      id: `suggested-${Date.now()}-${selectedProducts.length + addedCount + 1}`,
      name: productName,
      brand: "L'Oréal suggested option",
      category: "suggested",
      description: "Suggested by the chatbot based on your request.",
    };

    selectedProducts.push(productToAdd);
    addedCount += 1;
  }

  if (!addedCount) {
    addChatMessage("ai", "All suggested products are already in your routine.");
    return;
  }

  persistSelectedProducts();
  displayProducts(currentProducts);
  updateSelectedCount();
  updateSaveSelectedButtonState();
  renderSavedProducts();

  addChatMessage(
    "ai",
    `${addedCount} suggested product${addedCount === 1 ? "" : "s"} ${addedCount === 1 ? "was" : "were"} added to your routine.`
  );
  await generatePersonalizedRoutine();
  renderRoutineQuestionContext();
}

/* Keep selected count visible in the unified products area */
function updateSelectedCount() {
  if (!selectedCountText) {
    return;
  }

  const count = selectedProducts.length;
  selectedCountText.textContent = `Selected: ${count} product${count === 1 ? "" : "s"}`;
}

/* Keep the save button aligned with selection state */
function updateSaveSelectedButtonState() {
  if (!saveSelectedProductsButton) {
    return;
  }

  saveSelectedProductsButton.disabled = selectedProducts.length === 0;
}

/* Render saved products in the curated edit panel */
function renderSavedProducts() {
  if (!savedProductsGrid) {
    return;
  }

  const savedProductsOnly = uniqueProducts(savedProducts);
  const selectedProductsOnly = uniqueProducts(
    selectedProducts.filter((product) => {
      const selectedKey = getProductDedupKey(product);
      return selectedKey && !savedProductsOnly.some((savedProduct) => getProductDedupKey(savedProduct) === selectedKey);
    })
  );

  const selectedMarkup = selectedProductsOnly.length
    ? `
        <section class="atelier-selected-section">
          <h3 class="atelier-suggested-title">Current Selection</h3>
          <p class="atelier-suggested-intro">These products are added to The Product Atelier now and will save when you generate a routine.</p>
          <ul class="saved-products-list">
            ${selectedProductsOnly
              .map(
                (product, index) => `
                  <li class="saved-product-item">
                    <span class="saved-product-line">${index + 1}. ${escapeHtml(product.name)} - ${escapeHtml(product.brand || "")}</span>
                    <span class="atelier-status-badge">Not saved yet</span>
                  </li>
                `
              )
              .join("")}
          </ul>
        </section>
      `
    : "";

  const savedMarkup = savedProductsOnly.length
    ? `
        <section class="atelier-saved-section">
          <h3 class="atelier-suggested-title">Saved Products</h3>
          <p class="atelier-suggested-intro">These items stay in The Product Atelier after you generate a routine.</p>
          <ul class="saved-products-list">
            ${savedProductsOnly
              .map((product, index) => {
                const productLabel = `${index + 1}. ${product.name} - ${product.brand || ""}`;
                const productLink = getProductAtelierLink(product);

                return `
                  <li class="saved-product-item">
                    ${productLink
                      ? `<a class="saved-product-line saved-product-link" href="${escapeHtml(productLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(productLabel)}</a>`
                      : `<span class="saved-product-line">${escapeHtml(productLabel)}</span>`}
                    <button class="saved-product-remove-btn" type="button" data-id="${product.id}" aria-label="Remove ${product.name} from saved products">Remove</button>
                  </li>
                `;
              })
              .join("")}
          </ul>
        </section>
      `
    : `<p class="curated-edit-empty">Selected products will appear here and save after you generate a routine.</p>`;

  const suggestedMarkup = suggestedRoutineProducts.length
    ? (() => {
        const addableSuggestedCount = suggestedRoutineProducts.filter((product) => {
          const productName = String(product?.name || "").trim();
          return productName && !isProductAlreadySelectedByName(productName);
        }).length;

        return `
        <section class="atelier-suggested-section">
          <h3 class="atelier-suggested-title">Suggested Products</h3>
          <p class="atelier-suggested-intro">Add these AI suggestions to your routine with one click.</p>
          <div class="atelier-suggested-actions">
            <button class="atelier-suggested-add-all-btn" type="button" ${addableSuggestedCount === 0 ? "disabled" : ""}>${addableSuggestedCount === 0 ? "All Added" : `Add All (${addableSuggestedCount})`}</button>
          </div>
          <ul class="atelier-suggested-list">
            ${suggestedRoutineProducts
              .map((product, index) => {
                const productName = String(product?.name || "").trim();
                const isAdded = isProductAlreadySelectedByName(productName);
                return `
                  <li class="atelier-suggested-item">
                    <span class="atelier-suggested-line">${index + 1}. ${escapeHtml(productName)}</span>
                    <button class="atelier-suggested-add-btn" type="button" data-product-name="${escapeHtml(productName)}" ${isAdded ? "disabled" : ""}>${isAdded ? "Added to Routine" : "Add to Routine"}</button>
                  </li>
                `;
              })
              .join("")}
          </ul>
        </section>
      `;
      })()
    : "";

  savedProductsGrid.innerHTML = `${selectedMarkup}${savedMarkup}${suggestedMarkup}`;
}

/* Update the atelier preview without writing to storage yet */
function saveSelectedProductsToCuratedEdit() {
  if (selectedProducts.length === 0) {
    addChatMessage("ai", "Select products first, then update The Product Atelier.");
    return;
  }

  renderSavedProducts();
  addChatMessage("ai", "Your selection is now visible in The Product Atelier. It will save when you generate your routine.");
}

/* Save the current selection into the persistent atelier after routine generation */
function commitSelectedProductsToCuratedEdit() {
  const savedKeys = new Set(savedProducts.map((product) => getProductDedupKey(product)));
  const additions = selectedProducts.filter((product) => {
    const key = getProductDedupKey(product);
    return key && !savedKeys.has(key);
  });

  if (!additions.length) {
    return;
  }

  savedProducts = uniqueProducts([...additions, ...savedProducts]);
  persistSavedProducts();
}

/* Clear the curated edit panel */
function clearSavedProducts() {
  savedProducts = [];
  persistSavedProducts();
  renderSavedProducts();
  addChatMessage("ai", "The Product Atelier has been cleared.");
}

/* Remove one saved product from the curated edit */
function removeSavedProduct(productId) {
  const nextSavedProducts = savedProducts.filter((product) => product.id !== productId);

  if (nextSavedProducts.length === savedProducts.length) {
    return;
  }

  savedProducts = nextSavedProducts;
  persistSavedProducts();
  renderSavedProducts();
  addChatMessage("ai", "A product has been removed from The Product Atelier.");
}

/* Build routine text for download */
function getRoutineTextForSave() {
  const aiSummary = routineOutput.querySelector(".routine-ai-note")?.textContent?.trim() || "";

  if (!aiSummary) {
    return "";
  }

  const lines = [
    "L'Oreal Personalized Routine",
    `Saved on: ${new Date().toLocaleString()}`,
    "",
    "Selected Products",
  ];

  selectedProducts.forEach((product, index) => {
    lines.push(`${index + 1}. ${product.name} - ${product.brand}`);
  });
  lines.push("");

  if (suggestedRoutineProducts.length) {
    lines.push("Suggested Products");
    suggestedRoutineProducts.forEach((item, index) => {
      const name = String(item?.name || "").trim();
      if (name) {
        lines.push(`${index + 1}. ${name}`);
      }
    });
    lines.push("");
  }

  lines.push("AI Notes");
  lines.push(aiSummary);

  return lines.join("\n").trim();
}

/* Download the generated routine as a text file */
function saveRoutineToFile() {
  const routineText = getRoutineTextForSave();

  if (!routineText) {
    addChatMessage("ai", "Generate a routine first, then you can save it.");
    return;
  }

  const blob = new Blob([routineText], { type: "text/plain;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = `loreal-routine-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);

  addChatMessage("ai", "Your routine has been saved as a text file.");
}

function getAtelierTextForSave() {
  const lines = [
    "L'Oreal Product Atelier",
    `Saved on: ${new Date().toLocaleString()}`,
    "",
  ];

  const savedProductsOnly = uniqueProducts(savedProducts);
  const selectedProductsOnly = uniqueProducts(selectedProducts);

  if (selectedProductsOnly.length) {
    lines.push("Current Selection");
    selectedProductsOnly.forEach((product, index) => {
      lines.push(`${index + 1}. ${product.name} - ${product.brand}`);
    });
    lines.push("");
  }

  if (savedProductsOnly.length) {
    lines.push("Saved Products");
    savedProductsOnly.forEach((product, index) => {
      lines.push(`${index + 1}. ${product.name} - ${product.brand}`);
    });
    lines.push("");
  }

  if (suggestedRoutineProducts.length) {
    lines.push("Suggested Products");
    suggestedRoutineProducts.forEach((product, index) => {
      const productName = String(product?.name || "").trim();
      if (productName) {
        lines.push(`${index + 1}. ${productName}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n").trim();
}

function saveAtelierToFile() {
  const atelierText = getAtelierTextForSave();

  if (!atelierText) {
    addChatMessage("ai", "Add or save products to The Product Atelier before downloading it.");
    return;
  }

  const blob = new Blob([atelierText], { type: "text/plain;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = `loreal-product-atelier-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);

  addChatMessage("ai", "The Product Atelier has been saved as a text file.");
}

function startNewRoutine() {
  selectedProducts = [];
  persistSelectedProducts();
  savedProducts = [];
  persistSavedProducts();
  expandedProducts = [];
  suggestedRoutineProducts = [];
  conversationThreadId = "";
  hasGeneratedRoutine = false;
  beautyPreferences = {
    skinType: "",
    sensitivity: false,
    concerns: [],
  };
  searchQuery = "";

  if (categoryFilter) {
    categoryFilter.value = "";
  }

  if (productSearch) {
    productSearch.value = "";
  }

  if (currentProducts.length > 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category to view products
      </div>
    `;
  }

  routineOutput.innerHTML = `
    <p class="routine-placeholder">Select products and generate your routine to see your editorial flow.</p>
  `;

  chatWindow.innerHTML = "";
  addChatMessage("ai", "Welcome. Select products and generate your personalized beauty routine.");

  saveRoutineButton.disabled = true;
  updateSelectedCount();
  updateSaveSelectedButtonState();
  updateCarouselControlsState();
  renderSavedProducts();
  closeMenu();
}

/* Render personalized routine as AI note only */
async function generatePersonalizedRoutine() {
  // Step 1: Require at least one selected product before generating a routine.
  if (selectedProducts.length === 0) {
    routineOutput.innerHTML = `
      <p class="routine-placeholder">Select at least one product to generate your personalized routine.</p>
    `;
    saveRoutineButton.disabled = true;
    addChatMessage("ai", "Select a few products first and I will build your personalized routine flow.");
    return;
  }

  // Step 2: Prepare UI state for a fresh routine generation pass.
  const placeholder = routineOutput.querySelector(".routine-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
  suggestedRoutineProducts = [];
  renderSavedProducts();
  hasGeneratedRoutine = true;
  saveRoutineButton.disabled = false;

  try {
    // Step 3: Show loading feedback while waiting for AI response.
    showThinkingIndicator();
    const routineResponse = await sendToRoutineAdvisor(
      "generate_routine",
      "Please generate my personalized routine using only my selected products."
    );
    removeThinkingIndicator();

    // Step 4: Commit selected products to saved list after successful generation.
    const advisorText = routineResponse.content || "Your personalized routine note is ready.";
    commitSelectedProductsToCuratedEdit();
    renderSavedProducts();

    // Step 5: Update both chat and routine panel with the new AI output.
    addChatMessage("ai", advisorText);
    renderRoutineQuestionContext();
    renderRoutineEditorialSummary(advisorText);
  } catch (error) {
    // Step 6: Provide a friendly error if generation fails.
    removeThinkingIndicator();
    addChatMessage(
      "ai",
      `I couldn't generate the AI routine details right now. ${error.message}`
    );
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  // Step 1: Rebuild the full product card grid using current selection/search/expanded states.
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card ${selectedProducts.some((item) => item.id === product.id) ? "selected" : ""} ${expandedProducts.includes(product.id) ? "expanded" : ""} ${isProductSearchMatch(product) ? "search-match" : "search-dim"}" data-id="${product.id}">
      <span class="editorial-corner" aria-hidden="true"></span>
      ${isProductSearchMatch(product)
        ? `
      <div class="product-main product-main-search-match">
        <div class="product-info product-info-search-match">
          <h3 class="product-name">${product.name}</h3>
        </div>
        <img src="${product.image}" alt="${product.name}">
        <p class="product-brand">${product.brand}</p>
        <button class="product-description-trigger" type="button" data-id="${product.id}" aria-label="Open description for ${escapeHtml(product.name)}">
          Product Description
        </button>
      </div>
      `
        : `
      <div class="product-main">
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3 class="product-name">${product.name}</h3>
          <p>${product.brand}</p>
          <button class="product-description-trigger" type="button" data-id="${product.id}" aria-label="Open description for ${escapeHtml(product.name)}">
            Product Description
          </button>
        </div>
      </div>
      `}
      <div class="product-description-popout" ${expandedProducts.includes(product.id) ? "" : "hidden"}>
        <button class="product-description-close" type="button" data-id="${product.id}" aria-label="Close description for ${escapeHtml(product.name)}">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
        <p class="product-description-popout-title">${product.name}</p>
        <p class="product-description-popout-text">${product.description}</p>
      </div>
      <span class="selection-dot" aria-hidden="true"></span>
    </div>
  `
    )
    .join("");

  // Step 2: Reset carousel position and update arrow enabled/disabled state.
  productsContainer.scrollTo({ left: 0, behavior: "auto" });
  updateCarouselControlsState();
}

/* Update search query and re-render product cards */
function handleProductSearch(value) {
  searchQuery = value || "";
  displayProducts(currentProducts);
}

/* Toggle side description popout for a product card */
function toggleExpandedProduct(productId) {
  if (expandedProducts.includes(productId)) {
    expandedProducts = [];
  } else {
    expandedProducts = [productId];
  }

  displayProducts(currentProducts);
}

/* Close side description popout for a specific product */
function closeExpandedProduct(productId) {
  expandedProducts = expandedProducts.filter((id) => id !== productId);

  displayProducts(currentProducts);
}

/* Toggle selected state for product cards */
function toggleSelectedProduct(productId) {
  const selectedIndex = selectedProducts.findIndex(
    (product) => product.id === productId
  );

  if (selectedIndex >= 0) {
    selectedProducts.splice(selectedIndex, 1);
  } else {
    const productToAdd = currentProducts.find((product) => product.id === productId);
    if (productToAdd) {
      selectedProducts.push(productToAdd);
    }
  }

  persistSelectedProducts();
  displayProducts(currentProducts);
  updateSelectedCount();
  updateSaveSelectedButtonState();
  renderSavedProducts();
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  currentProducts = filteredProducts;
  displayProducts(currentProducts);
  updateSelectedCount();
  updateSaveSelectedButtonState();
});

/* Live search for product cards */
productSearch.addEventListener("input", (e) => {
  handleProductSearch(e.target.value);
});

/* Carousel controls */
if (productsCarouselPrev && productsCarouselNext) {
  productsCarouselPrev.addEventListener("click", () => {
    scrollProductCarousel(-1);
  });

  productsCarouselNext.addEventListener("click", () => {
    scrollProductCarousel(1);
  });
}

/* Drag to scroll carousel on touch and mouse */
if (productsContainer) {
  productsContainer.addEventListener("pointerdown", handleCarouselPointerDown);
  productsContainer.addEventListener("pointermove", handleCarouselPointerMove);
  document.addEventListener("pointerup", handleCarouselPointerUp);
  document.addEventListener("pointercancel", handleCarouselPointerUp);
  productsContainer.addEventListener("scroll", updateCarouselControlsState, { passive: true });
}

window.addEventListener("resize", () => {
  updateCarouselControlsState();
});

/* Handle product card click for selecting products */
productsContainer.addEventListener("click", (e) => {
  // Step 1: Ignore the synthetic click that can happen after drag scrolling.
  if (suppressProductClickOnce) {
    suppressProductClickOnce = false;
    return;
  }

  // Step 2: If user clicked "Product Description", open that card's detail popout.
  const descriptionTrigger = e.target.closest(".product-description-trigger");
  if (descriptionTrigger) {
    const productId = Number(descriptionTrigger.dataset.id);
    toggleExpandedProduct(productId);
    return;
  }

  // Step 3: If user clicked the close icon, collapse that popout.
  const descriptionClose = e.target.closest(".product-description-close");
  if (descriptionClose) {
    const productId = Number(descriptionClose.dataset.id);
    closeExpandedProduct(productId);
    return;
  }

  // Step 4: Otherwise toggle card selected/unselected state.
  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.id);
  toggleSelectedProduct(productId);
});

loadSelectedProducts();
loadSavedProducts();
updateSelectedCount();
updateSaveSelectedButtonState();
renderSavedProducts();
updateCarouselControlsState();

addChatMessage("ai", "Welcome. Select products and generate your personalized beauty routine.");

if (menuButton && menuPanel) {
  menuButton.addEventListener("click", () => {
    toggleMenu();
  });

  newRoutineMenuBtn?.addEventListener("click", () => {
    closeMenu();
    startNewRoutine();
  });

  instructionsMenuBtn?.addEventListener("click", () => {
    toggleInstructions();
  });

  downloadRoutineMenuBtn?.addEventListener("click", () => {
    closeMenu();
    saveRoutineToFile();
  });

  downloadAtelierMenuBtn?.addEventListener("click", () => {
    closeMenu();
    saveAtelierToFile();
  });

  document.addEventListener("click", (event) => {
    if (!isMenuOpen) {
      return;
    }

    const clickedInsideMenu = menuPanel.contains(event.target) || menuButton.contains(event.target);
    if (!clickedInsideMenu) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

/* Generate button creates an editorial routine timeline */
generateRoutineButton.addEventListener("click", () => {
  generatePersonalizedRoutine();
});

/* Save selected products to curated edit */
saveSelectedProductsButton.addEventListener("click", () => {
  saveSelectedProductsToCuratedEdit();
});

/* Clear curated edit */
clearSavedProductsButton.addEventListener("click", () => {
  clearSavedProducts();
});

/* Handle individual remove button clicks in curated edit */
savedProductsGrid.addEventListener("click", (e) => {
  const removeButton = e.target.closest(".saved-product-remove-btn");
  if (removeButton) {
    const productId = Number(removeButton.dataset.id);
    removeSavedProduct(productId);
    return;
  }

  const addAllButton = e.target.closest(".atelier-suggested-add-all-btn");
  if (addAllButton) {
    addAllSuggestedProductsToRoutine();
    return;
  }

  const addButton = e.target.closest(".atelier-suggested-add-btn");

  if (!addButton) {
    return;
  }

  const productName = addButton.dataset.productName || "";
  addSuggestedProductToRoutine(productName);
});

/* Save button downloads current routine */
saveRoutineButton.addEventListener("click", () => {
  saveRoutineToFile();
});

/* Chat form submission handler connected to Cloudflare Worker */
chatForm.addEventListener("submit", async (e) => {
  // Step 1: Prevent full page reload and read user text.
  e.preventDefault();
  const message = userInput.value.trim();

  if (!message) {
    return;
  }

  // Step 2: Render user bubble immediately for a responsive chat feel.
  addChatMessage("user", message);
  updateBeautyPreferencesFromMessage(message);
  userInput.value = "";

  try {
    // Step 3: Request follow-up answer from Worker and show loading state.
    showThinkingIndicator();
    const chatResponse = await sendToRoutineAdvisor("follow_up", message);
    removeThinkingIndicator();

    // Step 4: Sync suggested products shown in The Product Atelier.
    if (Array.isArray(chatResponse.products) && chatResponse.products.length > 0) {
      suggestedRoutineProducts = chatResponse.products;
    } else {
      suggestedRoutineProducts = [];
    }

    // Step 5: Render assistant answer in both chat stream and routine panel summary.
    renderSavedProducts();
    addChatMessage("ai", chatResponse.content || "I can help refine your beauty routine.");
    renderRoutineEditorialSummary(chatResponse.content || "I can help refine your beauty routine.");
  } catch (error) {
    // Step 6: Show a clear fallback message if the request fails.
    removeThinkingIndicator();
    addChatMessage("ai", `I couldn't connect to the routine advisor right now. ${error.message}`);
  }
});
