/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const productsCarouselPrev = document.getElementById("productsCarouselPrev");
const productsCarouselNext = document.getElementById("productsCarouselNext");
const selectedCountText = document.getElementById("selectedCountText");
const saveSelectedProductsButton = document.getElementById("saveSelectedProductsBtn");
const generateRoutineButton = document.getElementById("generateRoutine");
const routineOutput = document.getElementById("routineOutput");
const saveRoutineButton = document.getElementById("saveRoutineBtn");
const savedProductsGrid = document.getElementById("savedProductsGrid");
const clearSavedProductsButton = document.getElementById("clearSavedProductsBtn");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const apiUrl = typeof OPENAI_API_URL === "string" ? OPENAI_API_URL : "";

const savedProductsStorageKey = "loreal-curated-edit";

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
let expandedProducts = [];
let conversationThreadId = "";
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

/* Escape user-facing text before inserting in HTML */
function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/* Send message context to Cloudflare Worker and return assistant response */
async function sendToRoutineAdvisor(mode, message) {
  if (!apiUrl) {
    throw new Error("Missing OPENAI_API_URL in secrets.js");
  }

  if (!productCatalog.length) {
    await loadProducts();
  }

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

  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to reach routine advisor.");
  }

  if (typeof data.threadId === "string" && data.threadId) {
    conversationThreadId = data.threadId;
  }

  return data;
}

/* Add the AI-generated routine summary below the visual timeline */
function renderRoutineEditorialSummary(summaryText) {
  const existingSummary = routineOutput.querySelector(".routine-ai-note");
  if (existingSummary) {
    existingSummary.remove();
  }

  const note = document.createElement("article");
  note.className = "routine-ai-note";
  note.textContent = summaryText;
  routineOutput.appendChild(note);
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

  if (savedProducts.length === 0) {
    savedProductsGrid.innerHTML = `
      <p class="curated-edit-empty">Saved products will appear here.</p>
    `;
    return;
  }

  savedProductsGrid.innerHTML = savedProducts
    .map(
      (product, index) => `
        <li class="saved-product-item">
          <span class="saved-product-line">${index + 1}. ${product.name} - ${product.brand}</span>
          <button class="saved-product-remove-btn" type="button" data-id="${product.id}" aria-label="Remove ${product.name} from saved products">Remove</button>
        </li>
      `
    )
    .join("");

  savedProductsGrid.innerHTML = `<ul class="saved-products-list">${savedProductsGrid.innerHTML}</ul>`;
}

/* Save selected products into the curated edit panel */
function saveSelectedProductsToCuratedEdit() {
  if (selectedProducts.length === 0) {
    addChatMessage("ai", "Select products first, then save them to The Product Atelier.");
    return;
  }

  const savedIds = new Set(savedProducts.map((product) => product.id));
  const additions = selectedProducts.filter((product) => !savedIds.has(product.id));

  if (!additions.length) {
    addChatMessage("ai", "Those products are already in The Product Atelier.");
    return;
  }

  savedProducts = [...additions, ...savedProducts];
  persistSavedProducts();
  renderSavedProducts();
  addChatMessage("ai", "The Product Atelier has been updated.");
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
  const stepCards = routineOutput.querySelectorAll(".routine-step-card");

  if (!stepCards.length) {
    return "";
  }

  const lines = [
    "L'Oreal Personalized Routine",
    `Saved on: ${new Date().toLocaleString()}`,
    "",
    "Routine Steps",
  ];

  stepCards.forEach((card, index) => {
    const title = card.querySelector(".routine-step-title")?.textContent?.trim() || "";
    const brand = card.querySelector(".routine-step-brand")?.textContent?.trim() || "";
    const guidance = card.querySelector(".routine-step-guidance")?.textContent?.trim() || "";

    lines.push(`${index + 1}. ${title}`);
    if (brand) {
      lines.push(`   Brand: ${brand}`);
    }
    if (guidance) {
      lines.push(`   ${guidance}`);
    }
    lines.push("");
  });

  const aiSummary = routineOutput.querySelector(".routine-ai-note")?.textContent?.trim() || "";
  if (aiSummary) {
    lines.push("AI Notes");
    lines.push(aiSummary);
  }

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

/* Infer routine phase so products can be sorted in a practical order */
function getRoutinePhase(product) {
  const category = product.category;

  if (category === "cleanser") {
    return "prep";
  }

  if (category === "moisturizer" || category === "suncare") {
    return "protect";
  }

  if (category === "haircare" || category === "hair styling" || category === "hair color") {
    return "style";
  }

  return "enhance";
}

/* Build each routine step with icon and short editorial guidance */
function buildRoutineStep(product, stepNumber) {
  const phase = getRoutinePhase(product);
  const isActiveStep = stepNumber === 1;

  let stepTitle = "Enhance";
  let iconClass = "fa-sparkles";
  let guidance = `Apply ${product.name} to elevate your look.`;

  if (phase === "prep") {
    stepTitle = "Prep";
    iconClass = "fa-droplet";
    guidance = `Start with ${product.name} to cleanse and refresh your skin.`;
  }

  if (phase === "protect") {
    stepTitle = "Protect";
    iconClass = "fa-shield-heart";
    guidance = `Layer ${product.name} to lock in comfort and hydration.`;
  }

  if (phase === "style") {
    stepTitle = "Style";
    iconClass = "fa-wand-magic-sparkles";
    guidance = `Use ${product.name} to shape your final finish.`;
  }

  return `
    <article class="routine-step-card ${isActiveStep ? "active" : ""}">
      <span class="routine-step-number">${stepNumber}</span>
      <div class="routine-step-content">
        <h3 class="routine-step-title">${stepTitle}: ${product.name}</h3>
        <p class="routine-step-brand">${product.brand}</p>
        <p class="routine-step-guidance"><i class="fa-solid ${iconClass} routine-icon" aria-hidden="true"></i><span class="routine-guidance-text">${guidance}</span></p>
      </div>
    </article>
  `;
}

/* Render personalized routine in editorial timeline format */
async function generatePersonalizedRoutine() {
  if (selectedProducts.length === 0) {
    routineOutput.innerHTML = `
      <p class="routine-placeholder">Select at least one product to generate your personalized routine.</p>
    `;
    saveRoutineButton.disabled = true;
    addChatMessage("ai", "Select a few products first and I will build your personalized routine flow.");
    return;
  }

  const phaseOrder = {
    prep: 1,
    protect: 2,
    style: 3,
    enhance: 4,
  };

  const orderedProducts = [...selectedProducts].sort((a, b) => {
    return phaseOrder[getRoutinePhase(a)] - phaseOrder[getRoutinePhase(b)];
  });

  routineOutput.innerHTML = `
    <div class="routine-timeline">
      ${orderedProducts
        .map((product, index) => buildRoutineStep(product, index + 1))
        .join("")}
    </div>
  `;
  saveRoutineButton.disabled = false;

  try {
    showThinkingIndicator();
    const routineResponse = await sendToRoutineAdvisor(
      "generate_routine",
      "Please generate my personalized routine using only my selected products."
    );
    removeThinkingIndicator();

    const advisorText = routineResponse.content || "Your routine is ready in the editorial timeline above.";
    addChatMessage("ai", advisorText);
    renderRoutineEditorialSummary(advisorText);
  } catch (error) {
    removeThinkingIndicator();
    addChatMessage(
      "ai",
      `I couldn't generate the AI routine details right now. ${error.message}`
    );
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card ${selectedProducts.some((item) => item.id === product.id) ? "selected" : ""} ${expandedProducts.includes(product.id) ? "expanded" : ""} ${isProductSearchMatch(product) ? "search-match" : "search-dim"}" data-id="${product.id}">
      <span class="editorial-corner" aria-hidden="true"></span>
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

  displayProducts(currentProducts);
  updateSelectedCount();
  updateSaveSelectedButtonState();
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
  if (suppressProductClickOnce) {
    suppressProductClickOnce = false;
    return;
  }

  const descriptionTrigger = e.target.closest(".product-description-trigger");
  if (descriptionTrigger) {
    const productId = Number(descriptionTrigger.dataset.id);
    toggleExpandedProduct(productId);
    return;
  }

  const descriptionClose = e.target.closest(".product-description-close");
  if (descriptionClose) {
    const productId = Number(descriptionClose.dataset.id);
    closeExpandedProduct(productId);
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.id);
  toggleSelectedProduct(productId);
});

updateSelectedCount();
updateSaveSelectedButtonState();
loadSavedProducts();
renderSavedProducts();
updateCarouselControlsState();

addChatMessage("ai", "Welcome. Select products and generate your personalized beauty routine.");

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
  if (!removeButton) {
    return;
  }

  const productId = Number(removeButton.dataset.id);
  removeSavedProduct(productId);
});

/* Save button downloads current routine */
saveRoutineButton.addEventListener("click", () => {
  saveRoutineToFile();
});

/* Chat form submission handler connected to Cloudflare Worker */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = userInput.value.trim();

  if (!message) {
    return;
  }

  addChatMessage("user", message);
  updateBeautyPreferencesFromMessage(message);
  userInput.value = "";

  try {
    showThinkingIndicator();
    const chatResponse = await sendToRoutineAdvisor("follow_up", message);
    removeThinkingIndicator();
    addChatMessage("ai", chatResponse.content || "I can help refine your beauty routine.");
  } catch (error) {
    removeThinkingIndicator();
    addChatMessage("ai", `I couldn't connect to the routine advisor right now. ${error.message}`);
  }
});
