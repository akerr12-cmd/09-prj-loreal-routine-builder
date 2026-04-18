/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

let currentProducts = [];
let selectedProducts = [];

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
    <div class="product-card ${selectedProducts.some((item) => item.id === product.id) ? "selected" : ""}" data-id="${product.id}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
      </div>
      <span class="selection-dot" aria-hidden="true"></span>
    </div>
  `
    )
    .join("");
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

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
});
