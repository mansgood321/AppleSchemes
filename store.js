(function () {
  const db = supabaseClient;

  let categories = [];
  let products = [];
  let variants = [];

  let currentCategory = null;
  let currentProduct = null;
  let selectedAttributes = {};

  function safeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function normalize(value) {
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

  function parseJSON(value, fallback = {}) {
    if (!value) return fallback;

    if (typeof value === "object") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function formatPrice(price, currency = "RUB") {
    if (!hasValue(price)) {
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
    const status = normalize(variant.availability);

    return ![
      "out_of_stock",
      "out-of-stock",
      "sold_out",
      "нет в наличии"
    ].includes(status);
  }

  function getVariantAttributes(variant) {
    const attributes = parseJSON(variant.attributes, {});

    const result = {
      ...attributes
    };

    ["memory", "color", "sim_type"].forEach(key => {
      if (!hasValue(result[key]) && hasValue(variant[key])) {
        result[key] = variant[key];
      }
    });

    return result;
  }

  function getCategorySchema(category, categoryVariants) {
    const schema = parseJSON(
      category?.attributes_schema,
      []
    );

    if (Array.isArray(schema) && schema.length) {
      return schema
        .filter(field => field && field.key)
        .sort((a, b) =>
          (a.sort_order || 0) - (b.sort_order || 0)
        );
    }

    const keys = new Set();

    categoryVariants.forEach(variant => {
      Object.keys(getVariantAttributes(variant))
        .forEach(key => keys.add(key));
    });

    const labels = {
      memory: "Память",
      color: "Цвет",
      sim_type: "Тип SIM",
      ram: "Оперативная память",
      storage: "Накопитель",
      chip: "Процессор"
    };

    return [...keys].map((key, index) => ({
      key,
      label: labels[key] || key,
      sort_order: index
    }));
  }

  async function loadStore() {
    const categoryMenu = document.getElementById("categoryMenu");
    const productList = document.getElementById("productList");

    if (!categoryMenu || !productList) return;

    productList.innerHTML = `
      <div class="category-empty-state">
        Загружаем каталог...
      </div>
    `;

    try {
      const [
        categoriesResult,
        productsResult,
        variantsResult
      ] = await Promise.all([
        db.from("categories")
          .select("*")
          .eq("active", true)
          .order("sort_order"),

        db.from("products")
          .select("*")
          .eq("active", true)
          .order("sort_order"),

        db.from("product_variants")
          .select("*")
      ]);

      if (categoriesResult.error) throw categoriesResult.error;
      if (productsResult.error) throw productsResult.error;
      if (variantsResult.error) throw variantsResult.error;

      categories = categoriesResult.data || [];
      products = productsResult.data || [];
      variants = variantsResult.data || [];

      renderCategories();

      if (categories.length) {
        renderProducts(categories[0].id);
      } else {
        productList.innerHTML = `
          <div class="category-empty-state">
            Категорий пока нет.
          </div>
        `;
      }

    } catch (error) {
      console.error("Store loading error:", error);

      productList.innerHTML = `
        <div class="category-empty-state">
          Не удалось загрузить каталог.
          <p>${safeText(error.message)}</p>
          <button type="button" onclick="loadStore()">
            Повторить
          </button>
        </div>
      `;
    }
  }

  function renderCategories() {
    const categoryMenu = document.getElementById("categoryMenu");

    categoryMenu.innerHTML = categories.map(category => `
      <button
        type="button"
        class="category-button ${
          category.id === currentCategory ? "active" : ""
        }"
        data-category-id="${safeText(category.id)}"
      >
        ${safeText(category.icon || "🍏")}
        ${safeText(category.name)}
      </button>
    `).join("");

    categoryMenu.querySelectorAll("[data-category-id]")
      .forEach(button => {
        button.addEventListener("click", () => {
          renderProducts(button.dataset.categoryId);
        });
      });
  }

  function renderProducts(categoryId) {
    currentCategory = categoryId;
    currentProduct = null;
    selectedAttributes = {};

    document.querySelectorAll(".category-button")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.categoryId === categoryId
        );
      });

    const category = categories.find(
      item => item.id === categoryId
    );

    if (!category) return;

    const categoryProducts = products.filter(
      product => product.category_id === categoryId
    );

    const productList = document.getElementById("productList");

    if (!categoryProducts.length) {
      productList.innerHTML = `
        <div class="category-empty-state">
          В этой категории пока нет товаров.
        </div>
      `;
      return;
    }

    productList.innerHTML = `
      <h2 class="store-section-title">
        ${safeText(category.name)}
      </h2>

      <div class="store-model-grid">
        ${categoryProducts.map(product => `
          <article class="store-model-card">
            <div class="store-model-image">
              ${
                product.image_url
                  ? `<img src="${safeText(product.image_url)}"
                          alt="${safeText(product.name)}">`
                  : `<span>🍏</span>`
              }
            </div>

            <h3>${safeText(product.name)}</h3>

            <button
              type="button"
              data-open-product="${safeText(product.id)}"
            >
              Выбрать модель
            </button>
          </article>
        `).join("")}
      </div>
    `;

    productList.querySelectorAll("[data-open-product]")
      .forEach(button => {
        button.addEventListener("click", () => {
          openStoreProduct(button.dataset.openProduct);
        });
      });
  }

  function openStoreProduct(productId) {
    const product = products.find(
      item => item.id === productId
    );

    if (!product) return;

    currentProduct = product;
    selectedAttributes = {};

    const productVariants = variants.filter(
      variant =>
        variant.product_id === productId &&
        isAvailable(variant)
    );

    const category = categories.find(
      item => item.id === product.category_id
    );

    const fields = getCategorySchema(
      category,
      productVariants
    );

    renderProductOptions(product, productVariants, fields);
  }

  function renderProductOptions(product, productVariants, fields) {
    const productList = document.getElementById("productList");

    if (!productVariants.length) {
      productList.innerHTML = `
        <div class="category-empty-state">
          Сейчас нет доступных конфигураций этой модели.

          <button type="button" id="backToProducts">
            Назад к моделям
          </button>
        </div>
      `;

      document.getElementById("backToProducts")
        ?.addEventListener("click", () => {
          renderProducts(currentCategory);
        });

      return;
    }

    const fieldsHTML = fields.map(field => {
      const values = new Map();

      productVariants.forEach(variant => {
        const attributes = getVariantAttributes(variant);
        const value = attributes[field.key];

        if (hasValue(value)) {
          const normalized = normalize(value);

          if (!values.has(normalized)) {
            values.set(normalized, String(value).trim());
          }
        }
      });

      const options = [...values.values()];

      if (!options.length) return "";

      return `
        <div class="store-option-field">
          <label>${safeText(field.label || field.key)}</label>

          <select data-product-field="${safeText(field.key)}">
            <option value="">Выберите значение</option>

            ${options.map(value => `
              <option value="${safeText(value)}">
                ${safeText(value)}
              </option>
            `).join("")}
          </select>
        </div>
      `;
    }).join("");

    productList.innerHTML = `
      <div class="store-product-detail">

        <button
          type="button"
          class="store-back-button"
          id="backToProducts"
        >
          ← Назад к моделям
        </button>

        <div class="store-detail-image">
          ${
            product.image_url
              ? `<img src="${safeText(product.image_url)}"
                      alt="${safeText(product.name)}">`
              : `<span>🍏</span>`
          }
        </div>

        <h2>${safeText(product.name)}</h2>

        <div class="store-options">
          ${fieldsHTML}
        </div>

        <div id="selectedVariantInfo">
          <p>Выберите характеристики товара.</p>
        </div>

      </div>
    `;

    document.getElementById("backToProducts")
      ?.addEventListener("click", () => {
        renderProducts(currentCategory);
      });

    productList.querySelectorAll("[data-product-field]")
      .forEach(select => {
        select.addEventListener("change", () => {
          selectedAttributes[select.dataset.productField] =
            select.value;

          updateStoreVariant();
        });
      });
  }

  function findSelectedVariant() {
    if (!currentProduct) return null;

    const productVariants = variants.filter(
      variant =>
        variant.product_id === currentProduct.id &&
        isAvailable(variant)
    );

    const fields = getCategorySchema(
      categories.find(
        item => item.id === currentProduct.category_id
      ),
      productVariants
    );

    if (!fields.length) {
      return productVariants[0] || null;
    }

    const allSelected = fields.every(field =>
      hasValue(selectedAttributes[field.key])
    );

    if (!allSelected) return null;

    return productVariants.find(variant => {
      const attributes = getVariantAttributes(variant);

      return fields.every(field =>
        normalize(attributes[field.key]) ===
        normalize(selectedAttributes[field.key])
      );
    }) || null;
  }

  function updateStoreVariant() {
    const info = document.getElementById("selectedVariantInfo");

    if (!info) return;

    const variant = findSelectedVariant();

    if (!variant) {
      info.innerHTML = `
        <p>Выберите все характеристики товара.</p>
      `;
      return;
    }

    const attributes = getVariantAttributes(variant);

    const details = Object.entries(attributes)
      .filter(([, value]) => hasValue(value))
      .map(([key, value]) => `
        <span class="store-selected-attribute">
          ${safeText(key)}: ${safeText(value)}
        </span>
      `).join("");

    info.innerHTML = `
      <div class="store-selected-details">
        ${details}
      </div>

      <div class="store-selected-price">
        ${formatPrice(
          variant.price,
          variant.currency || "RUB"
        )}
      </div>

      <div class="store-selected-status">
        ${
          normalize(variant.availability) === "preorder"
            ? "Предзаказ"
            : "В наличии"
        }
      </div>

      <button type="button" id="orderSelectedVariant">
        Заказать
      </button>
    `;

    document.getElementById("orderSelectedVariant")
      ?.addEventListener("click", () => {
        orderVariant(variant.id);
      });
  }

  async function orderVariant(variantId) {
    const variant = variants.find(
      item => item.id === variantId
    );

    if (!variant || !isAvailable(variant)) {
      alert("Эта конфигурация больше недоступна.");
      return;
    }

    const product = products.find(
      item => item.id === variant.product_id
    );

    if (!product) {
      alert("Товар не найден.");
      return;
    }

    const customer = prompt("Как вас зовут?");
    if (!customer?.trim()) return;

    const contact = prompt("Ваш Telegram или телефон?");
    if (!contact?.trim()) return;

    const attributes = getVariantAttributes(variant);

    const message = {
      product: product.name,

      memory: attributes.memory || "—",
      color: attributes.color || "—",
      sim: attributes.sim_type || "—",

      attributes: attributes,

      price: variant.price,
      currency: variant.currency || "RUB",

      customer: customer.trim(),
      contact: contact.trim()
    };

    try {
      const { data, error } = await db.functions.invoke(
        "telegram-order",
        { body: message }
      );

      if (error) throw error;

      if (data && data.success === false) {
        throw new Error("Заявка не отправлена");
      }

      alert("✅ Заявка успешно отправлена!");

    } catch (error) {
      console.error("Order error:", error);

      alert(
        "Не удалось отправить заявку: " + error.message
      );
    }
  }

  function closeStoreProduct() {
    renderProducts(currentCategory);
  }

  window.loadStore = loadStore;
  window.renderProducts = renderProducts;
  window.openStoreProduct = openStoreProduct;
  window.closeStoreProduct = closeStoreProduct;
  window.orderVariant = orderVariant;
  window.updateStoreVariant = updateStoreVariant;

  loadStore();
})();
