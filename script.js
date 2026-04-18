/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineButton = document.getElementById("generateRoutine");
const routineOutput = document.getElementById("routineOutput");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");

let currentProducts = [];
let selectedProducts = [];
let expandedProducts = [];

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

/* Add a styled chat bubble to the chat window */
function addChatMessage(sender, message) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = message;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
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
function generatePersonalizedRoutine() {
  if (selectedProducts.length === 0) {
    routineOutput.innerHTML = `
      <p class="routine-placeholder">Select at least one product to generate your personalized routine.</p>
    `;
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

  addChatMessage(
    "ai",
    `Your routine is ready with ${orderedProducts.length} curated steps. Follow the order in the editorial timeline.`
  );
}

/* Render selected products as an editorial vertical list */
function renderSelectedProducts() {
  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="selected-empty">No products selected yet</p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product, index) => `
      <div class="selected-item">
        <span class="selected-step">${index + 1}</span>
        <p class="selected-product-name">${product.name}</p>
        <button class="remove-selected-btn" data-id="${product.id}" aria-label="Remove ${product.name}">
          x
        </button>
      </div>
    `
    )
    .join("");
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
  renderSelectedProducts();
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
  renderSelectedProducts();
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

/* Handle remove button click in selected products list */
selectedProductsList.addEventListener("click", (e) => {
  const removeButton = e.target.closest(".remove-selected-btn");
  if (!removeButton) {
    return;
  }

  const productId = Number(removeButton.dataset.id);
  toggleSelectedProduct(productId);
});

renderSelectedProducts();

addChatMessage("ai", "Welcome. Select products and generate your personalized beauty routine.");

/* Generate button creates an editorial routine timeline */
generateRoutineButton.addEventListener("click", () => {
  generatePersonalizedRoutine();
});

/* Chat form submission handler - editorial style placeholder conversation */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = userInput.value.trim();

  if (!message) {
    return;
  }

  addChatMessage("user", message);

  if (message.toLowerCase().includes("routine")) {
    addChatMessage("ai", "Choose your products, then click Generate Routine for a personalized editorial flow.");
  } else if (message.toLowerCase().includes("recommend")) {
    addChatMessage("ai", "I recommend choosing one cleanser, one treatment or moisturizer, and one finishing product for balance.");
  } else {
    addChatMessage("ai", "Tell me your skin or hair goals, and I will guide your next product picks.");
  }

  userInput.value = "";
});
