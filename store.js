
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

  // Совместимость со старыми конфигурациями
  ["memory", "color", "sim_type"].forEach(key => {
    if (!hasValue(result[key]) && hasValue(variant[key])) {
      result[key] = variant[key];
    }
  });

  return result;
}

// Настройки характеристик категории
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

  // Резервный вариант для старых категорий
  return [
    { key: "memory", label: "Память" },
    { key: "color", label: "Цвет" },
    { key: "sim_type", label: "Тип SIM" }
  ].filter(field =>
    variants.some(variant =>
      hasValue(getVariantAttributes(variant)[field.key])
    )
  );
}

// Контейнер для характеристик
function prepareAttributeContainer() {
  const modal = document.getElementById("productModal");
  if (!modal) return null;

  const content = modal.querySelector(".modal-content");
  if (!content) return null;

  // Убираем прежние статические поля
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

// Категории
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

// Товары категории
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

  const schema = getCategorySchema(category, variants);

  const container = prepareAttributeContainer();

  if (!container) return;

  container.innerHTML = "";
  currentAttributeFields = [];

  // Показываем только поля, заполненные
  // во всех доступных конфигурациях товара.
  const completeFields = schema.filter(field =>
    variants.every(variant =>
      hasValue(getVariantAttributes(variant)[field.key])
    )
  );

  currentAttributeFields = completeFields;

  // Если некоторые поля категории не заполнены
  // в конфигурациях, не показываем их покупателю.
  const hiddenFieldsCount = schema.length - completeFields.length;

  if (hiddenFieldsCount > 0) {
    container.insertAdjacentHTML("beforeend", `
      <p style="font-size:12px;color:#888;margin-bottom:12px">
        Некоторые характеристики этой модели пока не настроены.
      </p>
    `);
  }

  // Выбираем первую реальную конфигурацию
  const initialVariant = variants.find(variant =>
    completeFields.every(field =>
      hasValue(getVariantAttributes(variant)[field.key])
    )
  ) || variants[0];

  const initialAttributes = getVariantAttributes(initialVariant);

  // Создаём поля только с реальными значениями вариантов
  completeFields.forEach(field => {
    const key = field.key;
    const valuesMap = new Map();

    variants.forEach(variant => {
      const value = getVariantAttributes(variant)[key];

      if (hasValue(value)) {
        const normalized = normalizeValue(value);

        if (!valuesMap.has(normalized)) {
          valuesMap.set(normalized, String(value).trim());
        }
      }
    });

    const options = [...valuesMap.values()];

    if (!options.length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "modal-attribute";

    const label = document.createElement("label");
    label.textContent = field.label || key;

    const select = document.createElement("select");
    select.dataset.attributeKey = key;

    const initialValue = String(
      initialAttributes[key] ?? options[0]
    ).trim();

    select.innerHTML = options.map(value => `
      <option value="${safeText(value)}"
        ${
          normalizeValue(value) === normalizeValue(initialValue)
            ? "selected"
            : ""
        }>
        ${safeText(value)}
      </option>
    `).join("");

    select.addEventListener("change", updateStoreVariant);

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  });

  updateStoreVariant();
}

// Получаем выбранные покупателем параметры
function getSelectedAttributes() {
  const container = document.getElementById("modalAttributes");

  if (!container) return {};

  const result = {};

  container.querySelectorAll("select[data-attribute-key]")
    .forEach(select => {
      result[select.dataset.attributeKey] = select.value;
    });

  return result;
}

// Ищем точную конфигурацию
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

      return normalizeValue(variantAttributes[key]) ===
        normalizeValue(selectedAttributes[key]);
    });
  }) || null;

  if (priceElement) {
    priceElement.textContent = selectedVariant
      ? formatPrice(
          selectedVariant.price,
          selectedVariant.currency || "RUB"
        )
      : "Такая комбинация недоступна";
  }

  if (orderButton) {
    orderButton.disabled = !selectedVariant;
  }
}

// Закрываем окно
function closeStoreProduct() {
  document.getElementById("productModal")?.classList.add("hidden");
}

// Отправляем заказ
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

    alert(
      "Не удалось отправить заявку. Попробуйте ещё раз."
    );
  }
}

window.loadStore = loadStore;
window.renderProducts = renderProducts;
window.openStoreProduct = openStoreProduct;
window.updateStoreVariant = updateStoreVariant;
window.closeStoreProduct = closeStoreProduct;
window.submitStoreOrder = submitStoreOrder;

loadStore();

