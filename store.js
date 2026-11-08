
const storeDB = supabaseClient;

let storeProducts = [];
let storeCategories = [];
let storeVariants = [];
let selectedProduct = null;
let selectedVariant = null;
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

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("ru");
}

function hasValue(value) {
  return value !== null &&
    value !== undefined &&
    String(value).trim() !== "";
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

function isAvailable(variant) {
  const status = normalizeValue(variant.availability);

  return ![
    "out_of_stock",
    "out-of-stock",
    "sold_out",
    "нет в наличии"
  ].includes(status);
}

function getAvailableVariants(productId) {
  return storeVariants.filter(variant =>
    variant.product_id === productId && isAvailable(variant)
  );
}

// Получаем характеристики конфигурации
function getVariantAttributes(variant) {
  let attributes = variant.attributes || {};

  if (typeof attributes === "string") {
    try {
      attributes = JSON.parse(attributes);
    } catch {
      attributes = {};
    }
  }

  if (!attributes || typeof attributes !== "object") {
    attributes = {};
  }

  const result = { ...attributes };

  ["memory", "color", "sim_type"].forEach(key => {
    if (!hasValue(result[key]) && hasValue(variant[key])) {
      result[key] = variant[key];
    }
  });

  return result;
}

// Получаем настройки категории
function getCategorySchema(category) {
  let schema = category?.attributes_schema || [];

  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = [];
    }
  }

  if (!Array.isArray(schema)) return [];

  return schema
    .filter(field => field && field.key)
    .sort((a, b) =>
      (a.sort_order || 0) - (b.sort_order || 0)
    );
}

// Получаем варианты значений из админки
function getSchemaOptions(field) {
  let options = field.options || [];

  if (typeof options === "string") {
    options = options.split(",");
  }

  if (!Array.isArray(options)) return [];

  return options
    .map(option => {
      if (typeof option === "object" && option !== null) {
        return option.value ?? option.label ?? "";
      }
      return option;
    })
    .map(option => String(option).trim())
    .filter(Boolean);
}

// Объединяем значения из категории и товара
function getFieldOptions(field, variants) {
  const result = new Map();

  // Сначала значения из настроек категории
  getSchemaOptions(field).forEach(value => {
    result.set(normalizeValue(value), value);
  });

  // Затем реальные значения конфигураций товара
  variants.forEach(variant => {
    const attributes = getVariantAttributes(variant);
    const value = attributes[field.key];

    if (hasValue(value)) {
      const normalized = normalizeValue(value);

      if (!result.has(normalized)) {
        result.set(normalized, String(value).trim());
      }
    }
  });

  return [...result.values()];
}

// Контейнер характеристик
function prepareAttributeContainer() {
  const modal = document.getElementById("productModal");
  if (!modal) return null;

  const content = modal.querySelector(".modal-content");
  if (!content) return null;

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

// Загружаем каталог
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
      <div class="loading-state">
        Не удалось загрузить каталог.
        <p>${safeText(error.message)}</p>
        <button onclick="loadStore()">Повторить</button>
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
    const activeButton = [
      ...document.querySelectorAll(".category-button")
    ].find(item =>
      item.getAttribute("onclick")?.includes(categoryId)
    );

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
    const variants = getAvailableVariants(product.id);
    const pricedVariants = variants.filter(v => v.price !== null);

    let priceText = "Цена уточняется";

    if (pricedVariants.length) {
      const currency = pricedVariants[0].currency || "RUB";

      const prices = pricedVariants
        .filter(v => (v.currency || "RUB") === currency)
        .map(v => Number(v.price));

      if (prices.length) {
        priceText = "от " +
          formatPrice(Math.min(...prices), currency);
      }
    }

    return `
      <article class="store-card">
        <div class="store-photo">
          ${
            product.image_url
              ? `<img src="${safeText(product.image_url)}"
                      alt="${safeText(product.name)}">`
              : "🍏"
          }
        </div>

        <h3>${safeText(product.name)}</h3>

        <p>
          ${safeText(product.description || "Выберите конфигурацию")}
        </p>

        <div class="store-price">${priceText}</div>

        <button onclick="openStoreProduct('${product.id}')">
          Выбрать модель
        </button>
      </article>
    `;
  }).join("");
}

// Открываем товар
function openStoreProduct(id) {
  selectedProduct = storeProducts.find(product => product.id === id);

  if (!selectedProduct) return;

  const variants = getAvailableVariants(id);

  if (!variants.length) {
    alert("У этого товара пока нет доступных конфигураций.");
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

  // Берём ВСЕ характеристики из настроек категории.
  // Не скрываем поля, даже если варианты товара заполнены не полностью.
  currentAttributeFields = getCategorySchema(category);

  const container = prepareAttributeContainer();

  if (!container) return;

  container.innerHTML = "";

  if (!currentAttributeFields.length) {
    container.innerHTML = `
      <p style="color:#888">
        Для этой категории пока не настроены характеристики.
      </p>
    `;
  }

  // Начальная конфигурация
  const initialVariant = variants[0];
  const initialAttributes = getVariantAttributes(initialVariant);

  currentAttributeFields.forEach(field => {
    const key = field.key;
    const options = getFieldOptions(field, variants);

    const wrapper = document.createElement("div");
    wrapper.className = "modal-attribute";

    const label = document.createElement("label");
    label.textContent = field.label || key;

    wrapper.appendChild(label);

    if (options.length) {
      const select = document.createElement("select");
      select.dataset.attributeKey = key;

      const initialValue = initialAttributes[key];

      // Если первая конфигурация не заполнена,
      // выбираем первое значение из настроек категории.
      const selectedValue = hasValue(initialValue)
        ? String(initialValue)
        : options[0];

      select.innerHTML = options.map(value => `
        <option value="${safeText(value)}"
          ${
            normalizeValue(value) === normalizeValue(selectedValue)
              ? "selected"
              : ""
          }>
          ${safeText(value)}
        </option>
      `).join("");

      select.addEventListener("change", updateStoreVariant);

      wrapper.appendChild(select);

    } else {
      const input = document.createElement("input");

      input.type = "text";
      input.dataset.attributeKey = key;
      input.placeholder = "Значение пока не добавлено";
      input.value = initialAttributes[key] || "";

      input.addEventListener("input", updateStoreVariant);

      wrapper.appendChild(input);
    }

    container.appendChild(wrapper);
  });

  updateStoreVariant();
}

// Читаем все выбранные характеристики
function getSelectedAttributes() {
  const container = document.getElementById("modalAttributes");

  if (!container) return {};

  const attributes = {};

  container.querySelectorAll("[data-attribute-key]")
    .forEach(element => {
      attributes[element.dataset.attributeKey] = element.value;
    });

  return attributes;
}

// Находим соответствующую конфигурацию
function updateStoreVariant() {
  const container = document.getElementById("modalAttributes");
  const priceElement = document.getElementById("modalPrice");
  const orderButton = document.getElementById("modalOrder");

  if (!container || !selectedProduct) return;

  const selectedAttributes = getSelectedAttributes();
  const variants = getAvailableVariants(selectedProduct.id);

  selectedVariant = variants.find(variant => {
    const variantAttributes = getVariantAttributes(variant);

    return currentAttributeFields.every(field => {
      const key = field.key;

      return hasValue(selectedAttributes[key]) &&
        normalizeValue(variantAttributes[key]) ===
        normalizeValue(selectedAttributes[key]);
    });
  }) || null;

  if (priceElement) {
    priceElement.textContent = selectedVariant
      ? formatPrice(
          selectedVariant.price,
          selectedVariant.currency || "RUB"
        )
      : "Такая конфигурация пока недоступна";
  }

  if (orderButton) {
    orderButton.disabled = !selectedVariant;
  }
}

// Закрытие окна
function closeStoreProduct() {
  document.getElementById("productModal")?.classList.add("hidden");
}

// Отправка заказа
async function submitStoreOrder() {
  if (!selectedProduct || !selectedVariant) {
    alert("Сначала выберите доступную конфигурацию.");
    return;
  }

  const customer = prompt("Как вас зовут?");
  if (!customer?.trim()) return;

  const contact = prompt("Ваш Telegram или телефон?");
  if (!contact?.trim()) return;

  const attributes = getVariantAttributes(selectedVariant);

  const message = {
    product: selectedProduct.name,
    memory: attributes.memory || "—",
    color: attributes.color || "—",
    sim: attributes.sim_type || "—",
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

    alert("✅ Заявка успешно отправлена!");

    closeStoreProduct();

  } catch (error) {
    console.error("Order error:", error);

    alert("Не удалось отправить заявку. Попробуйте ещё раз.");
  }
}

window.loadStore = loadStore;
window.renderProducts = renderProducts;
window.openStoreProduct = openStoreProduct;
window.updateStoreVariant = updateStoreVariant;
window.closeStoreProduct = closeStoreProduct;
window.submitStoreOrder = submitStoreOrder;

loadStore();
