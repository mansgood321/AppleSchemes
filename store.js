
const storeDB = supabaseClient;

let storeProducts = [];
let storeCategories = [];
let selectedProduct = null;
let selectedVariant = null;
let storeVariants = [];

// Элементы страницы
const categoryMenu = document.getElementById("categoryMenu");
const productList = document.getElementById("productList");

// Защита текста при отображении
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

// Форматирование цены
function formatPrice(price, currency = "RUB") {
  if (price === null || price === undefined || price === "") {
    return "Цена уточняется";
  }

  const symbols = {
    RUB: "₽",
    AMD: "֏",
    USD: "$"
  };

  return Number(price).toLocaleString("ru-RU") +
    " " + (symbols[currency] || currency);
}

// Загрузка каталога
async function loadStore() {
  if (!categoryMenu || !productList) {
    console.error("Не найдены элементы каталога");
    return;
  }

  productList.innerHTML = "<p>Загружаем каталог...</p>";

  try {
    const [
      categoriesResult,
      productsResult,
      variantsResult
    ] = await Promise.all([

      storeDB.from("categories")
        .select("id,name,slug,icon")
        .eq("active", true)
        .order("sort_order"),

      storeDB.from("products")
        .select("id,name,description,image_url,category_id")
        .eq("active", true)
        .order("sort_order"),

      storeDB.from("product_variants")
        .select("*")
    ]);

    if (categoriesResult.error) throw categoriesResult.error;
    if (productsResult.error) throw productsResult.error;
    if (variantsResult.error) throw variantsResult.error;

    storeCategories = categoriesResult.data || [];
    storeProducts = productsResult.data || [];
    storeVariants = variantsResult.data || [];

    renderCategories();

    if (storeCategories.length) {
      renderProducts(storeCategories[0].id);
    } else {
      productList.innerHTML = "<p>Категорий пока нет.</p>";
    }

  } catch (error) {
    console.error("Store loading error:", error);

    productList.innerHTML = `
      <div style="padding:20px;background:#fff0f0;border-radius:15px">
        <b>Не удалось загрузить каталог</b>
        <p>${safeText(error.message)}</p>
        <button onclick="loadStore()">Повторить загрузку</button>
      </div>
    `;
  }
}

// Отображение категорий
function renderCategories() {
  categoryMenu.innerHTML = storeCategories.map((category, index) => `
    <button
      class="category-button ${index === 0 ? "active" : ""}"
      onclick="renderProducts('${category.id}', this)">
      ${safeText(category.icon || "🍏")}
      ${safeText(category.name)}
    </button>
  `).join("");
}

// Отображение товаров
function renderProducts(categoryId, button) {
  document.querySelectorAll(".category-button")
    .forEach(item => item.classList.remove("active"));

  if (button) {
    button.classList.add("active");
  } else {
    document.querySelector(".category-button")?.classList.add("active");
  }

  const products = storeProducts.filter(
    product => product.category_id === categoryId
  );

  if (!products.length) {
    productList.innerHTML = "<p>В этой категории пока нет товаров.</p>";
    return;
  }

  productList.innerHTML = products.map(product => {
    const variants = storeVariants.filter(
      variant => variant.product_id === product.id &&
        variant.availability !== "out_of_stock"
    );

    const prices = variants
      .filter(variant => variant.price !== null)
      .map(variant => Number(variant.price));

    const lowestPrice = prices.length
      ? Math.min(...prices)
      : null;

    const currency =
      variants.find(v => v.price !== null)?.currency || "RUB";

    return `
      <article class="store-card">

        <div class="store-photo">
          ${product.image_url
            ? `<img src="${safeText(product.image_url)}"
                    alt="${safeText(product.name)}">`
            : "🍏"}
        </div>

        <h3>${safeText(product.name)}</h3>

        <p>${safeText(product.description || "Выберите конфигурацию")}</p>

        <div class="store-price">
          ${lowestPrice !== null
            ? "от " + formatPrice(lowestPrice, currency)
            : "Цена уточняется"}
        </div>

        <button onclick="openStoreProduct('${product.id}')">
          Выбрать модель
        </button>

      </article>
    `;
  }).join("");
}

// Открытие товара
function openStoreProduct(id) {
  selectedProduct = storeProducts.find(p => p.id === id);

  if (!selectedProduct) return;

  const variants = storeVariants.filter(
    v => v.product_id === id &&
      v.availability !== "out_of_stock"
  );

  if (!variants.length) {
    alert("Нет доступных конфигураций.");
    return;
  }

  const modal = document.getElementById("productModal");

  if (!modal) {
    alert("Не найдено окно товара.");
    return;
  }

  modal.classList.remove("hidden");
  document.getElementById("modalTitle").textContent =
    selectedProduct.name;

  modal.dataset.variants = JSON.stringify(variants);

  const fields = [
    ["modalMemory", "memory"],
    ["modalColor", "color"],
    ["modalSim", "sim_type"]
  ];

  fields.forEach(([elementId, field]) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    const values = [...new Set(
      variants.map(v => v[field]).filter(Boolean)
    )];

    element.innerHTML = values.length
      ? values.map(v =>
          `<option value="${safeText(v)}">${safeText(v)}</option>`
        ).join("")
      : '<option value="">Не указано</option>';

    element.onchange = updateStoreVariant;
  });

  updateStoreVariant();
}

// Обновление конфигурации
function updateStoreVariant() {
  const modal = document.getElementById("productModal");
  if (!modal) return;

  const variants = JSON.parse(modal.dataset.variants || "[]");

  const memory = document.getElementById("modalMemory")?.value || "";
  const color = document.getElementById("modalColor")?.value || "";
  const sim = document.getElementById("modalSim")?.value || "";

  selectedVariant = variants.find(v =>
    (v.memory || "") === memory &&
    (v.color || "") === color &&
    (v.sim_type || "") === sim
  );

  const priceElement = document.getElementById("modalPrice");
  const orderButton = document.getElementById("modalOrder");

  if (priceElement) {
    priceElement.textContent = selectedVariant
      ? formatPrice(
          selectedVariant.price,
          selectedVariant.currency
        )
      : "Такая комбинация недоступна";
  }

  if (orderButton) {
    orderButton.disabled = !selectedVariant;
  }
}

// Закрытие окна товара
function closeStoreProduct() {
  document.getElementById("productModal")?.classList.add("hidden");
}

// Отправка заявки через Telegram-бота
async function submitStoreOrder() {
  if (!selectedProduct || !selectedVariant) {
    alert("Сначала выберите товар и конфигурацию");
    return;
  }

  const customer = prompt("Как вас зовут?");
  if (!customer?.trim()) return;

  const contact = prompt("Ваш Telegram или телефон?");
  if (!contact?.trim()) return;

  const message = {
    product: selectedProduct.name,
    memory: selectedVariant.memory || "—",
    color: selectedVariant.color || "—",
    sim: selectedVariant.sim_type || "—",
    price: selectedVariant.price,
    customer: customer.trim(),
    contact: contact.trim()
  };

  try {
    const { data, error } = await storeDB.functions.invoke(
      "telegram-order",
      { body: message }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error("Заявка не отправлена");
    }

    alert(
      "✅ Заявка успешно отправлена! Менеджер скоро свяжется с вами."
    );

    closeStoreProduct();

  } catch (error) {
    console.error("Order error:", error);

    alert(
      "Не удалось отправить заявку. Попробуйте ещё раз."
    );
  }
}

// Делаем функции доступными HTML-кнопкам
window.loadStore = loadStore;
window.renderProducts = renderProducts;
window.openStoreProduct = openStoreProduct;
window.updateStoreVariant = updateStoreVariant;
window.closeStoreProduct = closeStoreProduct;
window.submitStoreOrder = submitStoreOrder;

// Запуск каталога
loadStore();
