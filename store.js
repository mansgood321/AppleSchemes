
(function () {
  const db = supabaseClient;

  let categories = [];
  let products = [];
  let variants = [];

  let currentCategory = null;
  let currentCategoryProducts = [];
  let currentCategoryVariants = [];
  let currentFields = [];
  let currentFilters = {};

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

  function parseJSON(value, fallback = []) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
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
    const status = normalize(variant.availability);

    return ![
      "out_of_stock",
      "out-of-stock",
      "sold_out",
      "нет в наличии"
    ].includes(status);
  }

  // Характеристики конкретной конфигурации
  function getVariantAttributes(variant) {
    const attributes = parseJSON(variant.attributes, {});

    const result = {
      ...(attributes && typeof attributes === "object"
        ? attributes
        : {})
    };

    // Совместимость со старыми полями
    ["memory", "color", "sim_type"].forEach(key => {
      if (!hasValue(result[key]) && hasValue(variant[key])) {
        result[key] = variant[key];
      }
    });

    return result;
  }

  // Характеристики категории
  function getCategorySchema(category, categoryVariants) {
    let schema = parseJSON(
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

    // Резервный режим для старых категорий
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

  // Значения характеристики, которые существуют в конфигурациях
  function getFieldOptions(field, categoryVariants) {
    const values = new Map();

    categoryVariants.forEach(variant => {
      const attributes = getVariantAttributes(variant);
      const value = attributes[field.key];

      if (hasValue(value)) {
        const normalized = normalize(value);

        if (!values.has(normalized)) {
          values.set(normalized, String(value).trim());
        }
      }
    });

    // Если конфигурации пока не заполнены,
    // показываем варианты из настроек категории
    let schemaOptions = field.options || [];

    if (typeof schemaOptions === "string") {
      schemaOptions = schemaOptions.split(",");
    }

    if (!values.size && Array.isArray(schemaOptions)) {
      schemaOptions.forEach(option => {
        const value =
          typeof option === "object" && option !== null
            ? option.value ?? option.label
            : option;

        if (hasValue(value)) {
          values.set(normalize(value), String(value).trim());
        }
      });
    }

    return [...values.values()];
  }

  // Добавляем стили нового интерфейса
  function addStoreStyles() {
    if (document.getElementById("category-filter-styles")) return;

    const style = document.createElement("style");
    style.id = "category-filter-styles";

    style.textContent = `
      .category-filter-panel {
        background: #fff;
        border: 1px solid #e9e9e9;
        border-radius: 20px;
        padding: 22px;
        margin-bottom: 24px;
      }

      .category-filter-heading {
        font-size: 20px;
        font-weight: 650;
        margin-bottom: 7px;
      }

      .category-filter-description {
        color: #858585;
        font-size: 13px;
        margin-bottom: 20px;
      }

      .category-filter-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(170px, 1fr)
        );
        gap: 15px;
      }

      .category-filter-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .category-filter-field label {
        font-size: 13px;
        font-weight: 600;
      }

      .category-filter-field select,
      .category-filter-field input {
        width: 100%;
        min-height: 45px;
        padding: 0 12px;
        border: 1px solid #dedede;
        border-radius: 11px;
        background: #fff;
        color: #222;
        font-size: 14px;
      }

      .category-filter-reset {
        margin-top: 17px;
        border: 0;
        background: transparent;
        color: #777;
        cursor: pointer;
        font-size: 13px;
        text-decoration: underline;
      }

      .category-results-heading {
        font-size: 18px;
        font-weight: 650;
        margin: 22px 0 15px;
      }

      .category-results-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(230px, 1fr)
        );
        gap: 16px;
      }

      .variant-result-card {
        background: #fff;
        border: 1px solid #e9e9e9;
        border-radius: 18px;
        padding: 16px;
        overflow: hidden;
      }

      .variant-result-image {
        height: 155px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 12px;
      }

      .variant-result-image img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .variant-result-name {
        font-size: 17px;
        font-weight: 650;
        margin-bottom: 10px;
      }

      .variant-result-attributes {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 14px;
      }

      .variant-result-attribute {
        font-size: 12px;
        background: #f4f4f5;
        border-radius: 7px;
        padding: 6px 9px;
        color: #444;
      }

      .variant-result-price {
        font-size: 19px;
        font-weight: 700;
        margin-bottom: 13px;
      }

      .variant-result-status {
        font-size: 12px;
        color: #777;
        margin-bottom: 12px;
      }

      .variant-result-card button {
        width: 100%;
        min-height: 44px;
        border: 0;
        border-radius: 11px;
        background: #171717;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .variant-result-card button:disabled {
        opacity: .5;
        cursor: not-allowed;
      }

      .category-empty-state {
        background: #fff;
        padding: 25px;
        border-radius: 16px;
        color: #777;
        text-align: center;
      }

      @media (max-width: 600px) {
        .category-filter-panel {
          padding: 16px;
        }

        .category-results-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .variant-result-card {
          padding: 11px;
        }

        .variant-result-image {
          height: 115px;
        }

        .variant-result-name {
          font-size: 14px;
        }

        .variant-result-price {
          font-size: 16px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // Загружаем каталог
  async function loadStore() {
    const categoryMenu = document.getElementById("categoryMenu");
    const productList = document.getElementById("productList");

    if (!categoryMenu || !productList) {
      console.error("Не найдены categoryMenu или productList");
      return;
    }

    addStoreStyles();

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
          <button onclick="loadStore()">Повторить</button>
        </div>
      `;
    }
  }

  // Показываем список категорий
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

  // Открываем категорию и собираем ВСЕ её конфигурации
  function renderProducts(categoryId) {
    currentCategory = categoryId;
    currentFilters = {};

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

    currentCategoryProducts = products.filter(
      product => product.category_id === categoryId
    );

    const productIds = new Set(
      currentCategoryProducts.map(product => product.id)
    );

    currentCategoryVariants = variants.filter(variant =>
      productIds.has(variant.product_id) && isAvailable(variant)
    );

    currentFields = getCategorySchema(
      category,
      currentCategoryVariants
    );

    renderCategoryInterface();
  }

  // Создаём панель фильтров категории
  function renderCategoryInterface() {
    const productList = document.getElementById("productList");

    const category = categories.find(
      item => item.id === currentCategory
    );

    const filterFields = currentFields.map(field => {
      const options = getFieldOptions(
        field,
        currentCategoryVariants
      );

      let control = "";

      if (options.length) {
        control = `
          <select data-filter-key="${safeText(field.key)}">
            <option value="">Любое значение</option>
            ${options.map(option => `
              <option value="${safeText(option)}">
                ${safeText(option)}
              </option>
            `).join("")}
          </select>
        `;
      } else {
        control = `
          <select disabled>
            <option>Пока нет вариантов</option>
          </select>
        `;
      }

      return `
        <div class="category-filter-field">
          <label>${safeText(field.label || field.key)}</label>
          ${control}
        </div>
      `;
    }).join("");

    productList.innerHTML = `
      <section class="category-filter-panel">
        <div class="category-filter-heading">
          ${safeText(category?.name || "Каталог")}
        </div>

        <div class="category-filter-description">
          Выберите характеристики — мы подберём подходящие модели
          и конфигурации из этой категории.
        </div>

        ${
          currentFields.length
            ? `<div class="category-filter-grid">${filterFields}</div>`
            : `<div class="category-filter-description">
                 Для этой категории пока не настроены характеристики.
               </div>`
        }

        <button type="button" class="category-filter-reset"
                id="resetCategoryFilters">
          Сбросить фильтры
        </button>
      </section>

      <div class="category-results-heading" id="categoryResultsHeading">
        Подходящие модели
      </div>

      <div class="category-results-grid" id="categoryResults"></div>
    `;

    const filterContainer = productList.querySelector(
      ".category-filter-panel"
    );

    filterContainer.querySelectorAll("[data-filter-key]")
      .forEach(select => {
        select.addEventListener("change", () => {
          currentFilters[select.dataset.filterKey] = select.value;
          renderCategoryResults();
        });
      });

    document.getElementById("resetCategoryFilters")
      ?.addEventListener("click", () => {
        currentFilters = {};

        filterContainer.querySelectorAll("[data-filter-key]")
          .forEach(select => {
            select.value = "";
          });

        renderCategoryResults();
      });

    renderCategoryResults();
  }

  // Фильтруем конфигурации сразу по всей категории
  function getFilteredVariants() {
    return currentCategoryVariants.filter(variant => {
      const attributes = getVariantAttributes(variant);

      return Object.entries(currentFilters).every(([key, value]) => {
        if (!hasValue(value)) return true;

        return normalize(attributes[key]) === normalize(value);
      });
    });
  }

  // Отображаем подходящие модели
  function renderCategoryResults() {
    const container = document.getElementById("categoryResults");
    const heading = document.getElementById("categoryResultsHeading");

    if (!container) return;

    const matchedVariants = getFilteredVariants();

    if (heading) {
      heading.textContent =
        `Найдено конфигураций: ${matchedVariants.length}`;
    }

    if (!matchedVariants.length) {
      container.innerHTML = `
        <div class="category-empty-state">
          По выбранным характеристикам ничего не найдено.
          Попробуйте изменить параметры.
        </div>
      `;
      return;
    }

    container.innerHTML = matchedVariants.map(variant => {
      const product = currentCategoryProducts.find(
        item => item.id === variant.product_id
      );

      if (!product) return "";

      const attributes = getVariantAttributes(variant);

      const displayFields = new Map();

      currentFields.forEach(field => {
        if (hasValue(attributes[field.key])) {
          displayFields.set(
            field.key,
            {
              label: field.label || field.key,
              value: attributes[field.key]
            }
          );
        }
      });

      // Добавляем характеристики, если они есть в конфигурации,
      // но отсутствуют в схеме категории
      Object.entries(attributes).forEach(([key, value]) => {
        if (hasValue(value) && !displayFields.has(key)) {
          displayFields.set(key, {
            label: key,
            value
          });
        }
      });

      const attributeHTML = [...displayFields.values()]
        .map(item => `
          <span class="variant-result-attribute">
            ${safeText(item.label)}: ${safeText(item.value)}
          </span>
        `).join("");

      const status = normalize(variant.availability);

      const statusText = status === "preorder"
        ? "Предзаказ"
        : "В наличии";

      return `
        <article class="variant-result-card">

          <div class="variant-result-image">
            ${
              product.image_url
                ? `<img src="${safeText(product.image_url)}"
                        alt="${safeText(product.name)}">`
                : "🍏"
            }
          </div>

          <div class="variant-result-name">
            ${safeText(product.name)}
          </div>

          <div class="variant-result-attributes">
            ${attributeHTML}
          </div>

          <div class="variant-result-price">
            ${formatPrice(
              variant.price,
              variant.currency || "RUB"
            )}
          </div>

          <div class="variant-result-status">
            ${statusText}
          </div>

          <button type="button"
            data-order-variant="${safeText(variant.id)}">
            Заказать
          </button>

        </article>
      `;
    }).join("");

    container.querySelectorAll("[data-order-variant]")
      .forEach(button => {
        button.addEventListener("click", () => {
          orderVariant(button.dataset.orderVariant);
        });
      });
  }

  // Заказываем конкретную найденную конфигурацию
  async function orderVariant(variantId) {
    const variant = currentCategoryVariants.find(
      item => item.id === variantId
    );

    if (!variant) {
      alert("Эта конфигурация больше недоступна.");
      return;
    }

    const product = currentCategoryProducts.find(
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

      // Старые поля для совместимости с Telegram-функцией
      memory: attributes.memory || "—",
      color: attributes.color || "—",
      sim: attributes.sim_type || "—",

      // Все характеристики конфигурации
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

  // Совместимость со старыми вызовами
  function openStoreProduct(id) {
    const product = products.find(item => item.id === id);

    if (product) {
      renderProducts(product.category_id);
    }
  }

  function closeStoreProduct() {
    document.getElementById("productModal")
      ?.classList.add("hidden");
  }

  window.loadStore = loadStore;
  window.renderProducts = renderProducts;
  window.openStoreProduct = openStoreProduct;
  window.closeStoreProduct = closeStoreProduct;
  window.orderVariant = orderVariant;

  // Старое имя функции оставляем для совместимости
  window.updateStoreVariant = renderCategoryResults;

  loadStore();
})();
