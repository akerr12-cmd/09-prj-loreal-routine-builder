/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
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

let currentProducts = [];
let selectedProducts = [];
let savedProducts = [];
let expandedProducts = [];
let conversationThreadId = "";
let beautyPreferences = {
  skinType: "",
  sensitivity: false,
  concerns: [],
};

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
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

/* Add editorial micro-accents to AI chat text */
function formatEditorialChatText(text) {
  let formatted = escapeHtml(text).replace(/\n/g, "<br>");
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

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      mode,
      threadId: conversationThreadId,
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
      (product) => `
        <article class="saved-product-card">
          <span class="saved-product-number">${product.id}</span>
          <img src="${product.image}" alt="${product.name}" class="saved-product-image">
          <div class="saved-product-info">
            <h3 class="saved-product-name">${product.name}</h3>
            <p class="saved-product-brand">${product.brand}</p>
          </div>
        </article>
      `
    )
    .join("");
}

/* Save selected products into the curated edit panel */
function saveSelectedProductsToCuratedEdit() {
  if (selectedProducts.length === 0) {
    addChatMessage("ai", "Select products first, then save them to Your Curated Edit.");
    return;
  }

  const savedIds = new Set(savedProducts.map((product) => product.id));
  const additions = selectedProducts.filter((product) => !savedIds.has(product.id));

  if (!additions.length) {
    addChatMessage("ai", "Those products are already in Your Curated Edit.");
    return;
  }

  savedProducts = [...additions, ...savedProducts];
  persistSavedProducts();
  renderSavedProducts();
  addChatMessage("ai", "Your curated edit has been updated.");
}

/* Clear the curated edit panel */
function clearSavedProducts() {
  savedProducts = [];
  persistSavedProducts();
  renderSavedProducts();
  addChatMessage("ai", "Your curated edit has been cleared.");
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
    <article class="routine-step-card">
      <span class="routine-step-number">${stepNumber}</span>
      <div class="routine-step-content">
        <h3 class="routine-step-title">${stepTitle}: ${product.name}</h3>
        <p class="routine-step-brand">${product.brand}</p>
        <p class="routine-step-guidance"><i class="fa-solid ${iconClass} routine-icon" aria-hidden="true"></i>${guidance}</p>
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
    <div class="product-card ${selectedProducts.some((item) => item.id === product.id) ? "selected" : ""} ${expandedProducts.includes(product.id) ? "expanded" : ""}" data-id="${product.id}">
      <span class="editorial-corner" aria-hidden="true"></span>
      <div class="product-main">
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3 class="product-name">${product.name}</h3>
          <p>${product.brand}</p>
        </div>
      </div>
      <div class="product-description-panel">
        <div class="product-description-inner">
          <p class="product-description">${product.description}</p>
        </div>
      </div>
      <span class="selection-dot" aria-hidden="true"></span>
    </div>
  `
    )
    .join("");
}

/* Toggle expandable editorial fold state */
function toggleExpandedProduct(productId) {
  if (expandedProducts.includes(productId)) {
    expandedProducts = expandedProducts.filter((id) => id !== productId);
  } else {
    expandedProducts.push(productId);
  }

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

/* Handle product card click for selecting products */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.id);
  toggleSelectedProduct(productId);
  toggleExpandedProduct(productId);
});

updateSelectedCount();
updateSaveSelectedButtonState();
loadSavedProducts();
renderSavedProducts();

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
