
const db = supabaseClient;

const $ = id => document.getElementById(id);

function notify(message) {
  $("message").textContent = message;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  })[c]);
}

// Проверка администратора
async function checkAdmin() {
  const {data:{session}} = await db.auth.getSession();

  if (!session) return;

  const {data,error} = await db.rpc("is_admin");

  if (error || data !== true) {
    notify("У этого аккаунта нет прав администратора.");
    await db.auth.signOut();
    return;
  }

  $("login").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("logout").classList.remove("hidden");

  await loadCategories();
  await loadProducts();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  notify("Проверяем данные...");

  const {error} = await db.auth.signInWithPassword({
    email:$("email").value.trim(),
    password:$("password").value
  });

  if (error) {
    notify("Ошибка входа: " + error.message);
    return;
  }

  await checkAdmin();
});

$("logout").onclick = async () => {
  await db.auth.signOut();
  location.reload();
};

$("refresh").onclick = async () => {
  await loadCategories();
  await loadProducts();
  notify("Данные обновлены.");
};

// Категории
async function loadCategories() {
  const {data,error} = await db
    .from("categories")
    .select("*")
    .eq("active",true)
    .order("sort_order");

  if (error) {
    notify(error.message);
    return;
  }

  $("productCategory").innerHTML = data.map(c =>
    `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`
  ).join("");
}

$("categoryForm").onsubmit = async e => {
  e.preventDefault();

  const {error} = await db.from("categories").insert({
    name:$("categoryName").value.trim(),
    slug:$("categorySlug").value.trim().toLowerCase()
  });

  if (error) {
    notify("Не удалось создать категорию: " + error.message);
    return;
  }

  $("categoryForm").reset();
  await loadCategories();
  notify("Категория добавлена.");
};

// Загрузка фотографии в Supabase Storage
async function uploadImage(file) {
  if (!file) return null;

  if (!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)) {
    throw new Error("Используй JPG, PNG, WEBP или GIF.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Размер фотографии должен быть до 5 МБ.");
  }

  const {data:{user},error:userError} = await db.auth.getUser();

  if (userError || !user) {
    throw new Error("Не удалось определить пользователя.");
  }

  const extensions = {
    "image/jpeg":"jpg",
    "image/png":"png",
    "image/webp":"webp",
    "image/gif":"gif"
  };

  const path = user.id + "/" + crypto.randomUUID() + "." + extensions[file.type];

  const {error} = await db.storage
    .from("product-images")
    .upload(path,file,{
      upsert:false,
      contentType:file.type
    });

  if (error) throw error;

  return db.storage
    .from("product-images")
    .getPublicUrl(path).data.publicUrl;
}

// Получение пути старой фотографии в Storage
function getStoragePath(imageUrl) {
  if (!imageUrl) return null;

  try {
    const url = new URL(imageUrl);
    const marker = "/storage/v1/object/public/product-images/";

    const index = url.pathname.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(
      url.pathname.slice(index + marker.length)
    );
  } catch {
    return null;
  }
}

// Удаление старой фотографии
async function deleteOldImage(imageUrl) {
  const path = getStoragePath(imageUrl);

  if (!path) return;

  const {error} = await db.storage
    .from("product-images")
    .remove([path]);

  if (error) {
    console.warn("Старая фотография не удалена:", error.message);
  }
}

// Предпросмотр фотографии в админке
$("productsList").addEventListener("change", event => {
  const input = event.target;

  if (!input.matches(".product-image-input")) return;

  const file = input.files[0];
  if (!file) return;

  const preview = $("preview-" + input.dataset.productId);

  if (!preview) return;

  if (!file.type.startsWith("image/")) {
    notify("Выбери файл изображения.");
    input.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    notify("Размер фотографии должен быть до 5 МБ.");
    input.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    preview.src = reader.result;
  };

  reader.readAsDataURL(file);
});

// Изменение фотографии существующего товара
async function changeProductImage(productId) {
  const input = $("edit-image-" + productId);
  const file = input?.files[0];

  if (!file) {
    notify("Сначала выбери новую фотографию.");
    return;
  }

  const button = $("change-image-" + productId);
  button.disabled = true;
  button.textContent = "Загружаем...";

  try {
    const {data:product,error:findError} = await db
      .from("products")
      .select("id,image_url")
      .eq("id",productId)
      .single();

    if (findError) throw findError;

    const oldImage = product.image_url;

    // Загружаем новое изображение
    const newImage = await uploadImage(file);

    // Сохраняем новую ссылку в базе
    const {error:updateError} = await db
      .from("products")
      .update({image_url:newImage})
      .eq("id",productId);

    if (updateError) {
      await deleteOldImage(newImage);
      throw updateError;
    }

    // Удаляем старую фотографию после успешного обновления
    await deleteOldImage(oldImage);

    notify("Фотография товара успешно обновлена!");

    await loadProducts();

  } catch(error) {
    notify("Ошибка фотографии: " + error.message);

    button.disabled = false;
    button.textContent = "Сохранить новую фотографию";
  }
}

// Создание нового товара
$("productForm").onsubmit = async e => {
  e.preventDefault();

  try {
    notify("Создаём товар...");

    const image = await uploadImage($("productImage").files[0]);

    const {error} = await db.from("products").insert({
      category_id:$("productCategory").value,
      name:$("productName").value.trim(),
      model:$("productModel").value.trim(),
      description:$("productDescription").value.trim(),
      image_url:image
    });

    if (error) {
      if (image) await deleteOldImage(image);
      throw error;
    }

    $("productForm").reset();

    await loadProducts();

    notify("Товар создан. Теперь добавь его конфигурации и цены.");

  } catch(error) {
    notify("Ошибка: " + error.message);
  }
};

// Список товаров
async function loadProducts() {
  $("productsList").textContent = "Загрузка...";

  const {data:products,error} = await db
    .from("products")
    .select("*, categories(name)")
    .order("created_at",{ascending:false});

  if (error) {
    notify(error.message);
    return;
  }

  const {data:variants,error:variantError} = await db
    .from("product_variants")
    .select("*")
    .order("created_at");

  if (variantError) {
    notify(variantError.message);
    return;
  }

  if (!products.length) {
    $("productsList").innerHTML =
      '<p class="small">Пока товаров нет. Добавь первый выше.</p>';
    return;
  }

  $("productsList").innerHTML = products.map(p => {
    const items = variants.filter(v => v.product_id === p.id);

    return `
      <div class="product">

        <h3>${escapeHTML(p.name)}</h3>

        <p class="small">
          ${escapeHTML(p.categories?.name || "Без категории")}
        </p>

        <div style="margin:15px 0;padding:14px;background:#f7f7f5;border-radius:15px">

          <b style="font-size:13px">Фотография товара</b>

          <div style="margin:12px 0">
            <img
              id="preview-${p.id}"
              src="${p.image_url ? escapeHTML(p.image_url) : ""}"
              alt="${escapeHTML(p.name)}"
              style="
                width:150px;
                height:150px;
                object-fit:contain;
                border-radius:12px;
                background:white;
                ${p.image_url ? "" : "display:none"}
              "
            >
            ${p.image_url ? "" : '<p class="small">Фотография пока не загружена.</p>'}
          </div>

          <label>Выбрать новую фотографию</label>

          <input
            type="file"
            id="edit-image-${p.id}"
            class="product-image-input"
            data-product-id="${p.id}"
            accept="image/jpeg,image/png,image/webp,image/gif"
          >

          <p class="small">JPG, PNG или WEBP. Максимум 5 МБ.</p>

          <button
            id="change-image-${p.id}"
            type="button"
            onclick="changeProductImage('${p.id}')"
          >
            Сохранить новую фотографию
          </button>

        </div>

        <div>
          ${items.map(v => `
            <div class="variant">

              <b>
                ${escapeHTML(v.memory || "Без памяти")} ·
                ${escapeHTML(v.color || "Без цвета")}
              </b>

              <p class="small">${escapeHTML(v.sim_type || "")}</p>

              <label>Цена (${escapeHTML(v.currency)})</label>

              <input
                type="number"
                min="0"
                step="0.01"
                id="price-${v.id}"
                value="${v.price ?? ""}"
                placeholder="Введи цену"
              >

              <label>Наличие</label>

              <select id="availability-${v.id}">
                <option value="in_stock" ${v.availability==="in_stock"?"selected":""}>В наличии</option>
                <option value="on_order" ${v.availability==="on_order"?"selected":""}>Под заказ</option>
                <option value="out_of_stock" ${v.availability==="out_of_stock"?"selected":""}>Нет в наличии</option>
              </select>

              <div class="row">
                <button onclick="saveVariant('${v.id}')">Сохранить</button>
                <button class="danger" onclick="deleteVariant('${v.id}')">Удалить</button>
              </div>

            </div>
          `).join("")}

          <details>
            <summary>Добавить конфигурацию</summary>

            <form onsubmit="addVariant(event,'${p.id}')">

              <label>Память</label>
              <input name="memory" placeholder="256 ГБ">

              <label>Цвет</label>
              <input name="color" placeholder="Silver">

              <label>Тип SIM</label>
              <input name="sim" placeholder="SIM + eSIM">

              <label>Цена в рублях</label>
              <input name="price" type="number" min="0" step="0.01" required>

              <button type="submit">Добавить конфигурацию</button>

            </form>
          </details>
        </div>

        <hr style="border:0;border-top:1px solid #eee;margin:15px 0">

        <button class="danger" onclick="deleteProduct('${p.id}')">
          Удалить товар
        </button>

      </div>
    `;
  }).join("");
}

// Сохранение цены и наличия
async function saveVariant(id) {
  const rawPrice = $("price-"+id).value;
  const price = rawPrice === "" ? null : Number(rawPrice);

  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    notify("Проверь цену.");
    return;
  }

  const {error} = await db.from("product_variants")
    .update({
      price,
      availability:$("availability-"+id).value
    })
    .eq("id",id);

  if (error) {
    notify("Ошибка сохранения: " + error.message);
    return;
  }

  notify("Цена и наличие обновлены.");
}

// Добавление конфигурации
async function addVariant(event,productId) {
  event.preventDefault();

  const form = event.currentTarget;
  const data = new FormData(form);

  const {error} = await db.from("product_variants").insert({
    product_id:productId,
    memory:data.get("memory"),
    color:data.get("color"),
    sim_type:data.get("sim"),
    price:Number(data.get("price")),
    currency:"RUB",
    availability:"in_stock"
  });

  if (error) {
    notify("Ошибка: " + error.message);
    return;
  }

  notify("Конфигурация добавлена.");
  await loadProducts();
}

// Удаление конфигурации
async function deleteVariant(id) {
  if (!confirm("Удалить эту конфигурацию?")) return;

  const {error} = await db.from("product_variants")
    .delete().eq("id",id);

  if (error) {
    notify(error.message);
    return;
  }

  await loadProducts();
  notify("Конфигурация удалена.");
}

// Удаление товара
async function deleteProduct(id) {
  if (!confirm("Удалить товар и все его конфигурации?")) return;

  const {data:product,error:findError} = await db
    .from("products")
    .select("image_url")
    .eq("id",id)
    .single();

  if (findError) {
    notify(findError.message);
    return;
  }

  const {error} = await db.from("products")
    .delete().eq("id",id);

  if (error) {
    notify(error.message);
    return;
  }

  await deleteOldImage(product.image_url);

  await loadProducts();
  notify("Товар удалён.");
}

checkAdmin();
