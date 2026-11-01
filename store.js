
const storeDB = supabaseClient;

let storeProducts = [];
let storeCategories = [];
let selectedProduct = null;
let selectedVariant = null;

const categoryMenu = document.getElementById("categoryMenu");
const productList = document.getElementById("productList");

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
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

// Загрузка каталога
async function loadStore() {
  productList.innerHTML = "<p>Загружаем каталог...</p>";

  try {
    const [categoriesResult, productsResult, variantsResult] =
      await Promise.all([
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

    window.storeVariants = variantsResult.data || [];

    renderCategories();

    if (storeCategories.length > 0) {
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

// Категории
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

// Товары выбранной категории
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
    const variants = window.storeVariants.filter(
      variant => variant.product_id === product.id
    );

    const available = variants.filter(
      variant => variant.availability !== "out_of_stock"
    );

    const prices = available
      .filter(variant => variant.price !== null)
      .map(variant => Number(variant.price));

    const lowestPrice = prices.length
      ? Math.min(...prices)
      : null;

    const currency =
      available.find(v => v.price !== null)?.currency || "RUB";

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

// Открываем товар
function openStoreProduct(id) {
  selectedProduct = storeProducts.find(p => p.id === id);

  if (!selectedProduct) return;

  const variants = window.storeVariants.filter(
    v => v.product_id === id &&
    v.availability !== "out_of_stock"
  );

  if (!variants.length) {
    alert("Нет доступных конфигураций.");
    return;
  }

  const modal = document.getElementById("productModal");
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
    const values = [...new Set(
      variants.map(v => v[field]).filter(Boolean)
    )];

    const element = document.getElementById(elementId);

    element.innerHTML = values.length
      ? values.map(v =>
          `<option value="${safeText(v)}">${safeText(v)}</option>`
        ).join("")
      : '<option value="">Не указано</option>';

    element.onchange = updateStoreVariant;
  });

  updateStoreVariant();
}

// Обновление выбранной конфигурации
function updateStoreVariant() {
  const modal = document.getElementById("productModal");
  const variants = JSON.parse(modal.dataset.variants || "[]");

  const memory = document.getElementById("modalMemory").value;
  const color = document.getElementById("modalColor").value;
  const sim = document.getElementById("modalSim").value;

  selectedVariant = variants.find(v =>
    (v.memory || "") === memory &&
    (v.color || "") === color &&
    (v.sim_type || "") === sim
  );

  document.getElementById("modalPrice").textContent =
    selectedVariant
      ? formatPrice(selectedVariant.price, selectedVariant.currency)
      : "Такая комбинация недоступна";

  document.getElementById("modalOrder").disabled =
    !selectedVariant;
}

function closeStoreProduct() {
  document.getElementById("productModal").classList.add("hidden");
}

// Отправка заявки

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
    if (!data?.success) throw new Error("Заявка не отправлена");

    alert("✅ Заявка успешно отправлена! Менеджер скоро свяжется с вами.");

    closeStoreProduct();

  } catch (error) {
    console.error("Order error:", error);
    alert("Не удалось отправить заявку. Попробуйте ещё раз.");
  }
}
  if (!selectedProduct || !selectedVariant) return;

  const name = prompt("Как вас зовут?");
  if (!name?.trim()) return;

  const contact = prompt("Ваш Telegram или телефон?");
  if (!contact?.trim()) return;

  const message = [
    "НОВАЯ ЗАЯВКА — APPLE SCHEMES",
    "Товар: " + selectedProduct.name,
    "Память: " + (selectedVariant.memory || "—"),
    "Цвет: " + (selectedVariant.color || "—"),
    "SIM: " + (selectedVariant.sim_type || "—"),
    "Цена: " + formatPrice(
      selectedVariant.price,
      selectedVariant.currency
    ),
    "Имя: " + name,
    "Контакт: " + contact
  ].join("\n");

  try {
    await navigator.clipboard.writeText(message);
    alert("Заявка скопирована. Отправьте её менеджеру в Telegram.");
  } catch (error) {
    prompt("Скопируйте текст заявки:", message);
  }

  window.open("https://t.me/burya_24", "_blank");
}

// Запуск
loadStore();
