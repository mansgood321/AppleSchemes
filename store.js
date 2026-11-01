
const storeDB = supabaseClient;

let storeProducts = [];
let storeCategories = [];
let selectedProduct = null;
let selectedVariant = null;

const store = document.getElementById("store");
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

function formatPrice(price, currency) {
  if (price === null || price === undefined) {
    return "Цена уточняется";
  }

  const symbols = {RUB:"₽", AMD:"֏", USD:"$"};
  return Number(price).toLocaleString("ru-RU") +
    " " + (symbols[currency] || currency);
}

async function loadStore() {
  store.textContent = "Загружаем каталог...";

  const [categoriesResult, productsResult] = await Promise.all([
    storeDB.from("categories")
      .select("id,name,slug,icon")
      .eq("active",true)
      .order("sort_order"),

    storeDB.from("products")
      .select("id,name,description,image_url,category_id,categories(name)")
      .eq("active",true)
      .order("sort_order")
  ]);

  if (categoriesResult.error || productsResult.error) {
    store.textContent = "Не удалось загрузить каталог. Проверь подключение.";
    return;
  }

  storeCategories = categoriesResult.data || [];
  storeProducts = productsResult.data || [];

  renderCategories();

  if (storeCategories.length) {
    renderProducts(storeCategories[0].id);
  } else {
    store.innerHTML = "Каталог пока пуст.";
  }
}

function renderCategories() {
  categoryMenu.innerHTML = storeCategories.map((c,i) => `
    <button class="category-button ${i===0?"active":""}"
      onclick="renderProducts('${c.id}',this)">
      ${safeText(c.icon || "🍏")} ${safeText(c.name)}
    </button>
  `).join("");
}

async function renderProducts(categoryId, button) {
  document.querySelectorAll(".category-button")
    .forEach(b=>b.classList.remove("active"));

  if (button) button.classList.add("active");
  else document.querySelector(".category-button")?.classList.add("active");

  const {data,error} = await storeDB
    .from("product_variants")
    .select("*");

  if (error) {
    productList.textContent = "Ошибка загрузки товаров.";
    return;
  }

  const products = storeProducts.filter(p =>
    p.category_id === categoryId
  );

  productList.innerHTML = products.map(p => {
    const variants = data.filter(v =>
      v.product_id === p.id
    );

    const prices = variants
      .filter(v => v.price !== null && v.availability !== "out_of_stock")
      .map(v => Number(v.price));

    const lowestPrice = prices.length
      ? Math.min(...prices)
      : null;

    return `
      <article class="store-card">
        <div class="store-photo">
          ${p.image_url
            ? `<img src="${safeText(p.image_url)}" alt="${safeText(p.name)}">`
            : "🍏"}
        </div>
        <h3>${safeText(p.name)}</h3>
        <p>${safeText(p.description || "Выберите конфигурацию")}</p>
        <div class="store-price">
          ${lowestPrice !== null
            ? "от " + formatPrice(lowestPrice,variants[0]?.currency || "RUB")
            : "Цена уточняется"}
        </div>
        <button onclick="openStoreProduct('${p.id}')">
          Выбрать модель
        </button>
      </article>
    `;
  }).join("") || "<p>В этой категории пока нет товаров.</p>";
}

async function openStoreProduct(id) {
  selectedProduct = storeProducts.find(p => p.id === id);

  const {data,error} = await storeDB
    .from("product_variants")
    .select("*")
    .eq("product_id",id);

  if (error || !data.length) {
    alert("У этого товара пока нет конфигураций.");
    return;
  }

  const variants = data.filter(v => v.availability !== "out_of_stock");

  if (!variants.length) {
    alert("Сейчас товара нет в наличии.");
    return;
  }

  selectedVariant = variants[0];

  const modal = document.getElementById("productModal");

  modal.classList.remove("hidden");

  document.getElementById("modalTitle").textContent =
    selectedProduct.name;

  document.getElementById("modalMemory").innerHTML =
    [...new Set(variants.map(v=>v.memory).filter(Boolean))]
      .map(v=>`<option>${safeText(v)}</option>`).join("");

  document.getElementById("modalColor").innerHTML =
    [...new Set(variants.map(v=>v.color).filter(Boolean))]
      .map(v=>`<option>${safeText(v)}</option>`).join("");

  document.getElementById("modalSim").innerHTML =
    [...new Set(variants.map(v=>v.sim_type).filter(Boolean))]
      .map(v=>`<option>${safeText(v)}</option>`).join("");

  modal.dataset.variants = JSON.stringify(variants);

  ["modalMemory","modalColor","modalSim"].forEach(id => {
    document.getElementById(id).onchange = updateStoreVariant;
  });

  updateStoreVariant();
}

function updateStoreVariant() {
  const variants = JSON.parse(
    document.getElementById("productModal").dataset.variants
  );

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
      ? formatPrice(selectedVariant.price,selectedVariant.currency)
      : "Такой комбинации нет";

  document.getElementById("modalOrder").disabled =
    !selectedVariant;
}

function closeStoreProduct() {
  document.getElementById("productModal").classList.add("hidden");
}

async function submitStoreOrder() {
  if (!selectedProduct || !selectedVariant) return;

  const name = prompt("Как вас зовут?");
  if (!name) return;

  const contact = prompt("Ваш Telegram или телефон?");
  if (!contact) return;

  const message = [
    "НОВАЯ ЗАЯВКА — APPLE STORE",
    "Товар: " + selectedProduct.name,
    "Память: " + (selectedVariant.memory || "—"),
    "Цвет: " + (selectedVariant.color || "—"),
    "SIM: " + (selectedVariant.sim_type || "—"),
    "Цена: " + formatPrice(selectedVariant.price,selectedVariant.currency),
    "Имя: " + name,
    "Контакт: " + contact
  ].join("\n");

  try {
    await navigator.clipboard.writeText(message);
    alert("Заявка скопирована. Вставьте её в чат менеджера.");
  } catch(e) {
    prompt("Скопируйте заявку:",message);
  }

  window.open("https://t.me/burya_24","_blank");
}

loadStore();
