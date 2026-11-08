
const storeDB = supabaseClient;

let storeProducts = [];
let storeCategories = [];
let selectedProduct = null;
let selectedVariant = null;
let storeVariants = [];
let currentAttributeFields = [];
let currentCategoryId = null;

const categoryMenu = document.getElementById("categoryMenu");
const productList = document.getElementById("productList");

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

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

// Получаем характеристики конкретной конфигурации
function getVariantAttributes(variant) {
  let attributes = variant.attributes || {};

  if (typeof attributes === "string") {
    try {
      attributes = JSON.parse(attributes);
    } catch {
      attributes = {};
    }
  }

  return {
    ...attributes,
    memory: attributes.memory ?? variant.memory ?? "",
    color: attributes.color ?? variant.color ?? "",
    sim_type: attributes.sim_type ?? variant.sim_type ?? ""
  };
}

// Получаем настройки характеристик категории
function getCategorySchema(category, variants) {
  let schema = category?.attributes_schema || [];

  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = [];
    }
  }

  if (Array.isArray(schema) && schema.length) {
    return schema
      .filter(field => field && field.key)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  // Совместимость со старыми товарами
  const legacyFields = [
    { key: "memory", label: "Память" },
    { key: "color", label: "Цвет" },
    { key: "sim_type", label: "Тип SIM" }
  ];

  return legacyFields.filter(field =>
    variants.some(variant =>
      getVariantAttributes(variant)[field.key]
    )
  );
}

// Создаём контейнер характеристик
function prepareAttributeContainer() {
  const modal = document.getElementById("productModal");
  if (!modal) return null;

  const content = modal.querySelector(".modal-content");
  if (!content) return null;

  // Удаляем старые жёстко заданные поля
  ["modalMemory", "modalColor", "modalSim"].forEach(id => {
    const element = document.getElementById(id);

    if (element) {
      const label = content.querySelector(`label[for="${id}"]`);
      label?.remove();
      element.remove();
    }
  });

  let container = document.getElementById("modalAttributes");

  if (!container) {
    container = document.createElement("div");
    container.id = "modalAttributes";

    const priceLabel = content.querySelector(".modal-price-label");

    if (priceLabel) {
      content.insertBefore(container, priceLabel);
    } else {
      content.appendChild(container);
    }
  }

  return container;
}

// Загрузка каталога
async function loadStore() {
  if (!categoryMenu || !productList) {
    console.error("Не найдены элементы каталога");
    return;
  }

  productList.innerHTML = `
    <div class="loading-state">Загружаем каталог...</div>
  `;

  try {
    const [
      categoriesResult,
      productsResult,
      variantsResult
    ] = await Promise.all([
      storeDB.from("categories")
        .select("*")
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
  categoryMenu.innerHTML = storeCategories.map(category => `
    <button
      class="category-button ${
        category.id === currentCategoryId ? "active" : ""
      }"
      onclick="renderProducts('${category.id}', this)">
      ${safeText(category.icon || "🍏")}
      ${safeText(category.name)}
    </button>
  `).join("");
}

// Отображение товаров
function renderProducts(categoryId, button) {
  currentCategoryId = categoryId;

  document.querySelectorAll(".category-button")
    .forEach(item => item.classList.remove("active"));

  if (button) {
    button.classList.add("active");
  } else {
    const activeButton = [...document.querySelectorAll(".category-button")]
      .find(item => item.getAttribute("onclick")?.includes(categoryId));

    activeButton?.classList.add("active");
  }

  const products = storeProducts.filter(
    product => product.category_id === categoryId
  );

  if (!products.length) {
    productList.innerHTML = `
      <div class="loading-state">
        В этой категории пока нет товаров.
      </div>
    `;
    return;
  }

  productList.innerHTML = products.map(product => {
    const variants = storeVariants.filter(
      variant =>
        variant.product_id === product.id &&
        variant.availability !== "out_of_stock"
    );

    const availablePrices = variants.filter(
      variant => variant.price !== null
    );

    let priceText = "Цена уточняется";

    if (availablePrices.length) {
      const currency = availablePrices[0].currency || "RUB";

      const sameCurrencyPrices = availablePrices
        .filter(v => (v.currency || "RUB") === currency)
        .map(v => Number(v.price));

      if (sameCurrencyPrices.length) {
        priceText = "от " + formatPrice(
          Math.min(...sameCurrencyPrices),
          currency
        );
      }
    }

    return `
      <article class="store-card">

        <div class="store-photo">
          ${product.image_url
            ? `<img src="${safeText(product.image_url)}"
                    alt="${safeText(product.name)}">`
            : "🍏"}
        </div>

        <h3>${safeText(product.name)}</h3>

        <p>
          ${safeText(product.description || "Выберите конфигурацию")}
        </p>

        <div class="store-price">
          ${priceText}
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
  selectedProduct = storeProducts.find(product => product.id === id);

  if (!selectedProduct) return;

  const variants = storeVariants.filter(
    variant =>
      variant.product_id === id &&
      variant.availability !== "out_of_stock"
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

  const title = document.getElementById("modalTitle");

  if (title) {
    title.textContent = selectedProduct.name;
  }

  modal.classList.remove("hidden");

  selectedVariant = null;

  const category = storeCategories.find(
    item => item.id === selectedProduct.category_id
  );

  currentAttributeFields = getCategorySchema(category, variants);

  const container = prepareAttributeContainer();

  if (!container) return;

  container.innerHTML = "";

  const firstVariantAttributes = getVariantAttributes(variants[0]);

  currentAttributeFields.forEach(field => {
    const key = field.key;
    const label = field.label || key;

    const values = [
      ...new Set(
        variants
          .map(variant => getVariantAttributes(variant)[key])
          .filter(value => value !== null &&
            value !== undefined &&
            String(value).trim() !== "")
          .map(value => String(value))
      )
    ];

    // Если значений нет в вариантах, используем настройки категории
    const options = values.length
      ? values
      : (Array.isArray(field.options) ? field.options : []);

    if (!options.length) return;

    const initialValue = String(
      firstVariantAttributes[key] ?? options[0]
    );

    const wrapper = document.createElement("div");
    wrapper.className = "modal-attribute";

    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = label;

    const select = document.createElement("select");
    select.dataset.attributeKey = key;

    select.innerHTML = options.map(value => `
      <option value="${safeText(value)}"
        ${String(value) === initialValue ? "selected" : ""}>
        ${safeText(value)}
      </option>
    `).join("");

    select.addEventListener("change", updateStoreVariant);

    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  });

  updateStoreVariant();
}

// Читаем выбранные покупателем характеристики
function getSelectedAttributes() {
  const container = document.getElementById("modalAttributes");

  if (!container) return {};

  const attributes = {};

  container.querySelectorAll("select[data-attribute-key]")
    .forEach(select => {
      attributes[select.dataset.attributeKey] = select.value;
    });

  return attributes;
}

// Обновление цены и выбранной конфигурации
function updateStoreVariant() {
  const container = document.getElementById("modalAttributes");
  const priceElement = document.getElementById("modalPrice");
  const orderButton = document.getElementById("modalOrder");

  if (!container) return;

  const attributes = getSelectedAttributes();

  const variants = storeVariants.filter(
    variant =>
      variant.product_id === selectedProduct?.id &&
      variant.availability !== "out_of_stock"
  );

  selectedVariant = variants.find(variant => {
    const variantAttributes = getVariantAttributes(variant);

    return Object.entries(attributes).every(([key, value]) =>
      String(variantAttributes[key] ?? "") === String(value)
    );
  }) || null;

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

  const attributes = getVariantAttributes(selectedVariant);

  const message = {
    product: selectedProduct.name,

    // Старые поля сохраняем для совместимости
    memory: attributes.memory || "—",
    color: attributes.color || "—",
    sim: attributes.sim_type || "—",

    // Новые динамические характеристики
    attributes: attributes,

    price: selectedVariant.price,
    currency: selectedVariant.currency || "RUB",

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
