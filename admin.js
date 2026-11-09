
const db = supabaseClient;

const $ = id => document.getElementById(id);

let categories = [];
let products = [];
let variants = [];
let editingCategoryId = null;
// Draft definitions are local to the editor until used in a saved variant.
// Supabase has no product-level attribute-definition column.
const productDraftFields = new Map();
const ATTRIBUTE_NAMES = {memory:'Память',color:'Цвет',sim_type:'Тип SIM',screen_size:'Диагональ',chip:'Процессор',ram:'ОЗУ',storage:'Накопитель',case_size:'Размер корпуса',band:'Ремешок'};
function productFields(product) {
    const category = getCategory(product.category_id);
    const configured = safeJSON(category?.attributes_schema);
    const used = new Map();
    const currentVariants = variants.filter(v => v.product_id === product.id);
    // Once variants exist, keep only fields used by THIS model, not every field
    // defined for the whole category. New models start from category defaults.
    for (const field of configured) if (field?.key && (!currentVariants.length || currentVariants.some(v => String(getAttributes(v)[field.key] ?? '').trim())))
        used.set(field.key, {...field});
    for (const variant of variants.filter(v => v.product_id === product.id)) {
        for (const [key,value] of Object.entries(getAttributes(variant))) {
            if (String(value ?? '').trim() && !used.has(key))
                used.set(key, {key,label:ATTRIBUTE_NAMES[key] || key,type:'text',options:[]});
        }
    }
    for (const field of productDraftFields.get(product.id) || []) used.set(field.key,field);
    return [...used.values()];
}
function attributeInput(field, value, prefix) {
    const key = escapeHTML(field.key), val = escapeHTML(value ?? '');
    // Free typing is required: category options may not cover this product.
    // datalist offers suggestions without constraining values.
    const options = Array.isArray(field.options) ? field.options : [];
    const listId = `${prefix}-${key.replace(/[^a-z0-9_]/gi,'')}`;
    return `<label>${escapeHTML(field.label || field.key)}</label>
      <input data-${prefix === 'new' ? 'new-attribute' : 'attribute'}="${key}" value="${val}" list="${listId}" placeholder="Введите значение">
      <datalist id="${listId}">${options.map(o=>`<option value="${escapeHTML(o)}"></option>`).join('')}</datalist>`;
}
function attrSignature(attrs) {
    return JSON.stringify(Object.entries(attrs).filter(([,v])=>String(v??'').trim()).map(([k,v])=>[k,String(v).trim().normalize('NFKC').toLowerCase()]).sort(([a],[b])=>a.localeCompare(b)));
}
function duplicateVariant(productId, attributes, excludeId=null) {
    return variants.some(v => v.product_id === productId && v.id !== excludeId && attrSignature(getAttributes(v)) === attrSignature(attributes));
}


// --------------------------------------------------
// ОБЩИЕ ФУНКЦИИ
// --------------------------------------------------

function notify(message, error = false) {
    const box = $("message");
    if (!box) return;

    box.textContent = message;
    box.style.background = error ? "#fff0ef" : "#edf3fa";
    box.style.color = error ? "#bd3e35" : "#315b83";

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function safeJSON(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function getAttributes(variant) {
    const attributes = variant.attributes && typeof variant.attributes === "object" ? variant.attributes : {};

    return {
        ...attributes,
        memory: attributes.memory ?? variant.memory ?? "",
        color: attributes.color ?? variant.color ?? "",
        sim_type: attributes.sim_type ?? variant.sim_type ?? ""
    };
}

function getCategory(id) {
    return categories.find(category => category.id === id);
}

// --------------------------------------------------
// АВТОРИЗАЦИЯ
// --------------------------------------------------

async function checkAdmin() {
    try {
        const { data: sessionData, error: sessionError } =
            await db.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData.session;

        if (!session) {
            $("login")?.classList.remove("hidden");
            $("dashboard")?.classList.add("hidden");
            $("logout")?.classList.add("hidden");
            return;
        }

        const { data, error } = await db.rpc("is_admin");

        if (error || data !== true) {
            await db.auth.signOut();
            notify("У этой учётной записи нет прав администратора.", true);
            return;
        }

        $("login")?.classList.add("hidden");
        $("dashboard")?.classList.remove("hidden");
        $("logout")?.classList.remove("hidden");

        await loadAll();

    } catch (error) {
        notify("Ошибка авторизации: " + error.message, true);
    }
}

$("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("email").value.trim();
    const password = $("password").value;

    const { error } = await db.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        notify("Ошибка входа: " + error.message, true);
        return;
    }

    await checkAdmin();
});

$("logout")?.addEventListener("click", async () => {
    await db.auth.signOut();
    location.reload();
});

$("refresh")?.addEventListener("click", loadAll);

// --------------------------------------------------
// ЗАГРУЗКА ДАННЫХ
// --------------------------------------------------

async function loadAll() {
    // Сначала категории, затем товары.
    // Так характеристики доступны при отображении конфигураций.
    await loadCategories();
    await loadProducts();
}

async function loadCategories() {
    const { data, error } = await db
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        notify("Ошибка загрузки категорий: " + error.message, true);
        return;
    }

    categories = data || [];

    renderCategories();
    fillCategorySelect();
}

async function loadProducts() {
    const { data, error } = await db
        .from("products")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        notify("Ошибка загрузки товаров: " + error.message, true);
        return;
    }

    products = data || [];

    const { data: variantData, error: variantError } = await db
        .from("product_variants")
        .select("*")
        .order("created_at", { ascending: true });

    if (variantError) {
        notify("Ошибка загрузки конфигураций: " + variantError.message, true);
        return;
    }

    variants = variantData || [];

    renderProducts();
}

// --------------------------------------------------
// ФОТОГРАФИИ И STORAGE
// --------------------------------------------------

async function uploadImage(file, folder = "products") {
    if (!file) return null;

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ];

    if (!allowedTypes.includes(file.type)) {
        throw new Error("Поддерживаются JPG, PNG, WEBP и GIF.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Размер фотографии не должен превышать 5 МБ.");
    }

    const { data: userData } = await db.auth.getUser();
    const user = userData.user;

    if (!user) throw new Error("Необходимо войти в аккаунт.");

    const extension = file.name.split(".").pop().toLowerCase();

    const path =
        `${folder}/${user.id}/${crypto.randomUUID()}.${extension}`;

    const { error } = await db.storage
        .from("product-images")
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false
        });

    if (error) throw error;

    const { data } = db.storage
        .from("product-images")
        .getPublicUrl(path);

    return data.publicUrl;
}

function getStoragePath(url) {
    if (!url) return null;

    const marker = "/storage/v1/object/public/product-images/";

    if (!url.includes(marker)) return null;

    return decodeURIComponent(url.split(marker)[1]);
}

async function deleteOldImage(url) {
    const path = getStoragePath(url);

    if (!path) return;

    const { error } = await db.storage
        .from("product-images")
        .remove([path]);

    if (error) console.warn("Не удалось удалить старую фотографию:", error);
}

// --------------------------------------------------
// КАТЕГОРИИ
// --------------------------------------------------

function fillCategorySelect() {
    const select = $("productCategory");
    if (!select) return;

    const currentValue = select.value;

    select.innerHTML = `
        <option value="">Выбери категорию</option>

        ${categories.map(category => `
            <option value="${category.id}"
                ${!category.active ? "disabled" : ""}>
                ${escapeHTML(category.name)}
                ${category.active ? "" : " (скрыта)"}
            </option>
        `).join("")}
    `;

    if (currentValue) select.value = currentValue;
}

function renderCategories() {
    const container = $("categoriesList");
    if (!container) return;

    if (!categories.length) {
        container.innerHTML = `
            <div class="empty-state">Категорий пока нет.</div>
        `;
        return;
    }

    container.innerHTML = categories.map(category => `
        <div class="category-item">
            <div class="topline">
                <div>
                    <strong>
                        ${escapeHTML(category.icon || "🍏")}
                        ${escapeHTML(category.name)}
                    </strong>

                    <div class="small">
                        ${escapeHTML(category.slug)}
                        · ${category.active ? "В магазине" : "Скрыта"}
                    </div>
                </div>

                <button class="secondary"
                    data-edit-category="${category.id}">
                    Настроить
                </button>
            </div>
        </div>
    `).join("");

    container.querySelectorAll("[data-edit-category]").forEach(button => {
        button.addEventListener("click", () => {
            openCategoryEditor(button.dataset.editCategory);
        });
    });
}

$("categoryForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const name = $("categoryName").value.trim();
        const slug = $("categorySlug").value.trim().toLowerCase();
        const icon = $("categoryIcon").value.trim();
        const file = $("categoryImage")?.files[0];

        if (!name || !slug) {
            notify("Заполни название и идентификатор.", true);
            return;
        }

        let imageUrl = null;

        if (file) {
            imageUrl = await uploadImage(file, "categories");
        }

        const { error } = await db
            .from("categories")
            .insert({
                name,
                slug,
                icon: icon || null,
                image_url: imageUrl
            });

        if (error) throw error;

        $("categoryForm").reset();

        notify("Категория создана.");

        await loadAll();

    } catch (error) {
        notify("Ошибка создания категории: " + error.message, true);
    }
});

// --------------------------------------------------
// РЕДАКТОР КАТЕГОРИИ
// --------------------------------------------------

function openCategoryEditor(id) {
    const category = getCategory(id);
    if (!category) return;

    editingCategoryId = id;

    const schema = safeJSON(category.attributes_schema);

    $("categoryEditor").classList.remove("hidden");

    $("categoryEditorContent").innerHTML = `
        <form id="editCategoryForm">

            <label>Название</label>
            <input id="editCategoryName"
                value="${escapeHTML(category.name)}" required>

            <label>Идентификатор</label>
            <input id="editCategorySlug"
                value="${escapeHTML(category.slug)}" required>

            <label>Иконка</label>
            <input id="editCategoryIcon"
                value="${escapeHTML(category.icon || "")}">

            <label>Изображение категории</label>
            <input id="editCategoryImage" type="file" accept="image/*">

            <label>Порядок отображения</label>
            <input id="editCategoryOrder" type="number"
                value="${category.sort_order ?? 0}">

            <label>
                <input id="editCategoryActive" type="checkbox"
                    style="width:auto;margin-right:8px"
                    ${category.active ? "checked" : ""}>
                Показывать категорию в магазине
            </label>

            <button type="submit">Сохранить категорию</button>

            <button type="button" class="danger"
                id="deleteCategoryButton">
                Удалить категорию
            </button>
        </form>

        <hr>

        <h3>Характеристики категории</h3>

        <p class="small">
            Добавь параметры, которые будут доступны у товаров
            этой категории. Например, для MacBook — процессор,
            оперативная память и накопитель.
        </p>

        <div id="schemaFields"></div>

        <button type="button" class="secondary" id="addSchemaField">
            ＋ Добавить характеристику
        </button>

        <button type="button" id="saveSchema">
            Сохранить характеристики
        </button>
    `;

    renderSchemaFields(schema);

    $("editCategoryForm").addEventListener("submit", saveCategory);

    $("deleteCategoryButton").addEventListener("click", deleteCategory);

    $("addSchemaField").addEventListener("click", addSchemaField);

    $("saveSchema").addEventListener("click", saveCategorySchema);

    $("categoryEditor").scrollIntoView({ behavior: "smooth" });
}

// --------------------------------------------------
// КОНСТРУКТОР ХАРАКТЕРИСТИК
// --------------------------------------------------

function renderSchemaFields(schema) {
    const container = $("schemaFields");

    if (!schema.length) {
        container.innerHTML = `
            <div class="empty-state">
                Характеристики ещё не добавлены.
            </div>
        `;
        return;
    }

    container.innerHTML = schema.map((field, index) => `
        <div class="schema-field" data-schema-index="${index}">

            <div class="row">
                <div>
                    <label>Название характеристики</label>
                    <input data-field="label"
                        value="${escapeHTML(field.label || "")}"
                        placeholder="Например, Оперативная память">
                </div>

                <div>
                    <label>Ключ на английском</label>
                    <input data-field="key"
                        value="${escapeHTML(field.key || "")}"
                        placeholder="Например, ram">
                </div>
            </div>

            <label>Варианты значений через запятую</label>
            <input data-field="options"
                value="${escapeHTML((field.options || []).join(", "))}"
                placeholder="8 ГБ, 16 ГБ, 24 ГБ">

            <label>Тип характеристики</label>
            <select data-field="type">
                <option value="select"
                    ${field.type === "select" ? "selected" : ""}>
                    Выбор из списка
                </option>

                <option value="text"
                    ${field.type === "text" ? "selected" : ""}>
                    Свободный текст
                </option>
            </select>

            <label>
                <input data-field="required" type="checkbox"
                    style="width:auto;margin-right:8px"
                    ${field.required ? "checked" : ""}>
                Обязательная характеристика
            </label>

            <button type="button" class="danger"
                data-remove-schema="${index}">
                Удалить характеристику
            </button>
        </div>
    `).join("");

    container.querySelectorAll("[data-remove-schema]").forEach(button => {
        button.addEventListener("click", () => {
            const schema = readSchemaFields();
            schema.splice(Number(button.dataset.removeSchema), 1);
            renderSchemaFields(schema);
        });
    });
}

function readSchemaFields() {
    return [...document.querySelectorAll(".schema-field")].map((element, index) => {
        const get = name =>
            element.querySelector(`[data-field="${name}"]`);

        return {
            key: get("key").value.trim(),
            label: get("label").value.trim(),
            type: get("type").value,
            options: get("options").value
                .split(",")
                .map(value => value.trim())
                .filter(Boolean),
            required: get("required").checked,
            sort_order: index + 1
        };
    });
}

function addSchemaField() {
    const schema = readSchemaFields();

    schema.push({
        key: "",
        label: "",
        type: "select",
        options: [],
        required: false,
        sort_order: schema.length + 1
    });

    renderSchemaFields(schema);
}

async function saveCategorySchema() {
    const schema = readSchemaFields();

    for (const field of schema) {
        if (!field.key || !field.label) {
            notify("Заполни название и ключ каждой характеристики.", true);
            return;
        }

        if (!/^[a-z][a-z0-9_]*$/.test(field.key)) {
            notify("Ключ должен быть латиницей, например ram или storage.", true);
            return;
        }

        if (field.type === "select" && field.options.length === 0) {
            notify(`Добавь варианты значений для «${field.label}».`, true);
            return;
        }
    }

    const keys = schema.map(field => field.key);

    if (new Set(keys).size !== keys.length) {
        notify("Ключи характеристик не должны повторяться.", true);
        return;
    }

    const { error } = await db
        .from("categories")
        .update({ attributes_schema: schema })
        .eq("id", editingCategoryId);

    if (error) {
        notify("Ошибка сохранения характеристик: " + error.message, true);
        return;
    }

    notify("Характеристики категории сохранены.");

    await loadCategories();
    await loadProducts();

    openCategoryEditor(editingCategoryId);
}

// --------------------------------------------------
// СОХРАНЕНИЕ КАТЕГОРИИ
// --------------------------------------------------

async function saveCategory(event) {
    event.preventDefault();

    try {
        const category = getCategory(editingCategoryId);
        if (!category) return;

        const file = $("editCategoryImage").files[0];
        let imageUrl = category.image_url;

        if (file) {
            imageUrl = await uploadImage(file, "categories");
        }

        const updates = {
            name: $("editCategoryName").value.trim(),
            slug: $("editCategorySlug").value.trim().toLowerCase(),
            icon: $("editCategoryIcon").value.trim() || null,
            image_url: imageUrl,
            sort_order: Number($("editCategoryOrder").value) || 0,
            active: $("editCategoryActive").checked
        };

        const { error } = await db
            .from("categories")
            .update(updates)
            .eq("id", editingCategoryId);

        if (error) throw error;

        if (file && category.image_url) {
            await deleteOldImage(category.image_url);
        }

        notify("Категория обновлена.");

        await loadAll();
        openCategoryEditor(editingCategoryId);

    } catch (error) {
        notify("Ошибка обновления категории: " + error.message, true);
    }
}

// --------------------------------------------------
// УДАЛЕНИЕ КАТЕГОРИИ С СОХРАНЕНИЕМ ТОВАРОВ
// --------------------------------------------------

async function deleteCategory() {
    const category = getCategory(editingCategoryId);
    if (!category) return;

    const { count, error: countError } = await db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("category_id", category.id);

    if (countError) {
        notify("Не удалось проверить товары категории.", true);
        return;
    }

    const productCount = count || 0;

    const message = productCount > 0
        ? `В категории «${category.name}» находится ${productCount} товаров.\n\nКатегория будет удалена, но сами товары сохранятся без категории. Продолжить?`
        : `Удалить категорию «${category.name}»?`;

    if (!confirm(message)) return;

    const { error } = await db
        .from("categories")
        .delete()
        .eq("id", category.id);

    if (error) {
        notify("Ошибка удаления категории: " + error.message, true);
        return;
    }

    $("categoryEditor").classList.add("hidden");
    editingCategoryId = null;

    notify("Категория удалена. Товары сохранены.");

    await loadAll();
}

// --------------------------------------------------
// СОЗДАНИЕ ТОВАРА
// --------------------------------------------------

$("productForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const file = $("productImage").files[0];
        let imageUrl = null;

        if (file) {
            imageUrl = await uploadImage(file);
        }

        const product = {
            category_id: $("productCategory").value || null,
            name: $("productName").value.trim(),
            model: $("productModel").value.trim() || null,
            description: $("productDescription").value.trim() || null,
            image_url: imageUrl
        };

        const { error } = await db
            .from("products")
            .insert(product);

        if (error) throw error;

        $("productForm").reset();

        notify("Товар создан. Теперь добавь его конфигурации.");

        await loadProducts();

    } catch (error) {
        notify("Ошибка создания товара: " + error.message, true);
    }
});

// --------------------------------------------------
// ОТОБРАЖЕНИЕ ТОВАРОВ
// --------------------------------------------------

function renderProducts() {
    const container = $("productsList");
    if (!container) return;
    const expanded = new Set([...container.querySelectorAll('details[data-config-editor][open]')].map(el => el.dataset.configEditor));

    if (!products.length) {
        container.innerHTML = `
            <div class="empty-state">Товаров пока нет.</div>
        `;
        return;
    }

    container.innerHTML = products.map(product => {
        const category = getCategory(product.category_id);

        const productVariants = variants.filter(
            variant => variant.product_id === product.id
        );

        return `
            <div class="product" data-product="${product.id}">

                <div class="row" style="align-items:flex-start">

                    ${product.image_url ? `
                        <img class="preview-image"
                            src="${escapeHTML(product.image_url)}"
                            alt="">
                    ` : ""}

                    <div>
                        <h3>${escapeHTML(product.name)}</h3>

                        <div class="small">
                            ${escapeHTML(category?.name || "Без категории")}
                            · ${escapeHTML(product.model || "")}
                        </div>

                        <div class="small">
                            ${product.active ? "В магазине" : "Скрыт"}
                        </div>
                    </div>
                </div>

                <details>
                    <summary>Редактировать товар</summary>

                    <label>Название</label>
                    <input data-product-edit="name"
                        value="${escapeHTML(product.name)}">

                    <label>Модель</label>
                    <input data-product-edit="model"
                        value="${escapeHTML(product.model || "")}">

                    <label>Категория</label>
                    <select data-product-edit="category">
                        <option value="">Без категории</option>

                        ${categories.map(categoryItem => `
                            <option value="${categoryItem.id}"
                                ${categoryItem.id === product.category_id ? "selected" : ""}>
                                ${escapeHTML(categoryItem.name)}
                            </option>
                        `).join("")}
                    </select>

                    <label>Описание</label>
                    <textarea data-product-edit="description" rows="3">${escapeHTML(product.description || "")}</textarea>

                    <label>Порядок отображения</label>
                    <input data-product-edit="sort_order" type="number"
                        value="${product.sort_order ?? 0}">

                    <label>
                        <input data-product-edit="active" type="checkbox"
                            style="width:auto;margin-right:8px"
                            ${product.active ? "checked" : ""}>
                        Показывать товар
                    </label>

                    <label>Заменить фотографию</label>
                    <input data-product-edit="image" type="file" accept="image/*">

                    <button type="button" data-save-product="${product.id}">
                        Сохранить товар
                    </button>
                </details>

                <details class="config-editor" data-config-editor="${product.id}">
                  <summary>Характеристики и цены · ${productVariants.length} конфигураций</summary>
                  <div class="field-builder">
                    <h4>Характеристики этой модели</h4>
                    <p class="small">Добавьте название и ключ характеристики. Поле появится в конфигурациях этой модели. Оно сохранится в Supabase после сохранения хотя бы одной конфигурации с заполненным значением.</p>
                    <div class="attribute-chips">${productFields(product).map(f=>`<span class="attribute-chip">${escapeHTML(f.label||f.key)}</span>`).join('')}</div>
                    <div class="row"><input data-field-label="${product.id}" placeholder="Например, Цвет" aria-label="Название характеристики">
                    <input data-field-key="${product.id}" placeholder="Например, color" aria-label="Ключ характеристики">
                    <button type="button" data-add-product-field="${product.id}">Добавить поле</button></div>
                  </div>
                  <h3>Конфигурации (${productVariants.length})</h3>

                ${productVariants.map(variant =>
                    renderVariant(product, variant)
                ).join("")}

                <details>
                    <summary>＋ Добавить конфигурацию</summary>
                    ${renderAddVariantForm(product)}
                </details>

                </details>
                <hr>

                <button type="button" class="danger"
                    data-delete-product="${product.id}">
                    Удалить товар
                </button>
            </div>
        `;
    }).join("");

    container.querySelectorAll('details[data-config-editor]').forEach(el => {
        if (expanded.has(el.dataset.configEditor)) el.open = true;
    });
    container.querySelectorAll("[data-add-product-field]").forEach(button => {
        button.addEventListener("click", () => {
            const id = button.dataset.addProductField;
            const card = button.closest('[data-product]');
            const key = card.querySelector('[data-field-key]').value.trim();
            const label = card.querySelector('[data-field-label]').value.trim();
            if (!/^[a-z][a-z0-9_]*$/.test(key) || !label) {
                notify('Укажите название и ключ латиницей (например, memory или screen_size).',true);return;
            }
            const product = products.find(p=>p.id===id);
            if (productFields(product).some(f=>f.key===key)) {
                notify('Такая характеристика уже существует.',true);return;
            }
            productDraftFields.set(id,[...(productDraftFields.get(id)||[]),{key,label,type:'text',options:[]}]);
            renderProducts();
            const editor = document.querySelector(`[data-config-editor="${id}"]`);
            if(editor){editor.open=true;editor.scrollIntoView({block:'nearest'});}
            notify('Поле добавлено. Заполните его в конфигурации и сохраните конфигурацию.');
        });
    });
    container.querySelectorAll("[data-save-product]").forEach(button => {
        button.addEventListener("click", () =>
            saveProduct(button.dataset.saveProduct)
        );
    });

    container.querySelectorAll("[data-save-variant]").forEach(button => {
        button.addEventListener("click", () =>
            saveVariant(button.dataset.saveVariant)
        );
    });

    container.querySelectorAll("[data-delete-variant]").forEach(button => {
        button.addEventListener("click", () =>
            deleteVariant(button.dataset.deleteVariant)
        );
    });

    container.querySelectorAll("[data-add-variant]").forEach(button => {
        button.addEventListener("click", () =>
            addVariant(button.dataset.addVariant)
        );
    });

    container.querySelectorAll("[data-delete-product]").forEach(button => {
        button.addEventListener("click", () =>
            deleteProduct(button.dataset.deleteProduct)
        );
    });
}

// --------------------------------------------------
// ОТОБРАЖЕНИЕ КОНФИГУРАЦИЙ
// --------------------------------------------------

function renderVariant(product, variant) {
    const category = getCategory(product.category_id);
    const schema = productFields(product);
    const attributes = getAttributes(variant);

    return `
        <div class="variant" data-variant="${variant.id}">

            <strong>Конфигурация</strong>

            ${schema.map(field => attributeInput(field, attributes[field.key] || "", "existing")).join("")}

            <label>Цена</label>
            <input data-variant-price type="number" min="0" step="0.01"
                value="${variant.price ?? ""}">

            <label>Валюта</label>
            <select data-variant-currency>
                <option value="AMD" ${variant.currency === "AMD" ? "selected" : ""}>AMD</option>
                <option value="RUB" ${variant.currency === "RUB" ? "selected" : ""}>RUB</option>
            </select>

            <label>Наличие</label>
            <select data-variant-availability>
                <option value="in_stock" ${variant.availability === "in_stock" ? "selected" : ""}>В наличии</option>
                <option value="on_order" ${variant.availability === "on_order" ? "selected" : ""}>Под заказ</option>
                <option value="out_of_stock" ${variant.availability === "out_of_stock" ? "selected" : ""}>Нет в наличии</option>
            </select>

            <button type="button" data-save-variant="${variant.id}">
                Сохранить конфигурацию
            </button>

            <button type="button" class="danger"
                data-delete-variant="${variant.id}">
                Удалить конфигурацию
            </button>
        </div>
    `;
}

// --------------------------------------------------
// ФОРМА ДОБАВЛЕНИЯ КОНФИГУРАЦИИ
// --------------------------------------------------

function renderAddVariantForm(product) {
    const category = getCategory(product.category_id);
    const schema = productFields(product);

    return `
        <div class="variant">

            ${schema.map(field => attributeInput(field, "", "new")).join("")}

            <label>Цена</label>
            <input data-new-price type="number" min="0" step="0.01">

            <label>Валюта</label>
            <select data-new-currency>
                <option value="AMD">AMD</option>
                <option value="RUB" selected>RUB</option>
            </select>

            <label>Наличие</label>
            <select data-new-availability>
                <option value="in_stock">В наличии</option>
                <option value="on_order">Под заказ</option>
                <option value="out_of_stock">Нет в наличии</option>
            </select>

            <button type="button" data-add-variant="${product.id}">
                Создать конфигурацию
            </button>
        </div>
    `;
}

// --------------------------------------------------
// СОХРАНЕНИЕ ТОВАРА
// --------------------------------------------------

async function saveProduct(id) {
    const product = products.find(item => item.id === id);
    const card = document.querySelector(`[data-product="${id}"]`);

    if (!product || !card) return;

    try {
        const file = card.querySelector('[data-product-edit="image"]').files[0];

        let imageUrl = product.image_url;

        if (file) imageUrl = await uploadImage(file);

        const updates = {
            name: card.querySelector('[data-product-edit="name"]').value.trim(),
            model: card.querySelector('[data-product-edit="model"]').value.trim() || null,
            category_id: card.querySelector('[data-product-edit="category"]').value || null,
            description: card.querySelector('[data-product-edit="description"]').value.trim() || null,
            sort_order: Number(card.querySelector('[data-product-edit="sort_order"]').value) || 0,
            active: card.querySelector('[data-product-edit="active"]').checked,
            image_url: imageUrl
        };

        if (!updates.name) {
            notify("Название товара не может быть пустым.", true);
            return;
        }

        const { error } = await db
            .from("products")
            .update(updates)
            .eq("id", id);

        if (error) throw error;

        if (file && product.image_url) {
            await deleteOldImage(product.image_url);
        }

        notify("Товар обновлён.");

        await loadAll();

    } catch (error) {
        notify("Ошибка сохранения товара: " + error.message, true);
    }
}

// --------------------------------------------------
// СОХРАНЕНИЕ СУЩЕСТВУЮЩЕЙ КОНФИГУРАЦИИ
// --------------------------------------------------

async function saveVariant(id) {
    const variant = variants.find(item => item.id === id);

    const element = document.querySelector(`[data-variant="${id}"]`);

    if (!variant || !element) return;

    const attributes = {};

    element.querySelectorAll("[data-attribute]").forEach(input => {
        if (input.value.trim() !== "") {
            attributes[input.dataset.attribute] = input.value.trim();
        }
    });

    const priceValue = element.querySelector("[data-variant-price]").value;

    const price = priceValue === "" ? null : Number(priceValue);

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
        notify("Укажи корректную цену.", true);
        return;
    }

    if (duplicateVariant(variant.product_id, attributes, id)) {
        notify('Эта комбинация характеристик уже существует у товара.',true); return;
    }
    const updates = {
        attributes,
        memory: attributes.memory || null,
        color: attributes.color || null,
        sim_type: attributes.sim_type || null,
        price,
        currency: element.querySelector("[data-variant-currency]").value,
        availability: element.querySelector("[data-variant-availability]").value
    };

    const { error } = await db
        .from("product_variants")
        .update(updates)
        .eq("id", id);

    if (error) {
        notify("Ошибка сохранения конфигурации: " + error.message, true);
        return;
    }

    notify("Конфигурация сохранена.");

    await loadProducts();
}

// --------------------------------------------------
// ДОБАВЛЕНИЕ КОНФИГУРАЦИИ
// --------------------------------------------------

async function addVariant(productId) {
    const button = document.querySelector(`[data-add-variant="${productId}"]`);
    const element = button?.closest(".variant");

    if (!element) return;

    const product = products.find(item => item.id === productId);
    const category = getCategory(product?.category_id);
    const schema = safeJSON(category?.attributes_schema);

    const attributes = {};

    element.querySelectorAll("[data-new-attribute]").forEach(input => {
        if (input.value.trim() !== "") {
            attributes[input.dataset.newAttribute] = input.value.trim();
        }
    });

    for (const field of schema) {
        if (field.required && !attributes[field.key]) {
            notify(`Заполни обязательное поле «${field.label}».`, true);
            return;
        }
    }

    const priceValue = element.querySelector("[data-new-price]").value;
    const price = priceValue === "" ? null : Number(priceValue);

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
        notify("Укажи корректную цену.", true);
        return;
    }

    if (duplicateVariant(productId, attributes)) {
        notify('Такая конфигурация уже существует. Откройте её и измените цену.',true);return;
    }
    const { error } = await db
        .from("product_variants")
        .insert({
            product_id: productId,
            attributes,
            memory: attributes.memory || null,
            color: attributes.color || null,
            sim_type: attributes.sim_type || null,
            price,
            currency: element.querySelector("[data-new-currency]").value,
            availability: element.querySelector("[data-new-availability]").value
        });

    if (error) {
        notify("Ошибка создания конфигурации: " + error.message, true);
        return;
    }

    notify("Конфигурация добавлена.");

    await loadProducts();
}

// --------------------------------------------------
// УДАЛЕНИЕ КОНФИГУРАЦИИ
// --------------------------------------------------

async function deleteVariant(id) {
    if (!confirm("Удалить эту конфигурацию?")) return;

    const { error } = await db
        .from("product_variants")
        .delete()
        .eq("id", id);

    if (error) {
        notify("Ошибка удаления: " + error.message, true);
        return;
    }

    notify("Конфигурация удалена.");

    await loadProducts();
}

// --------------------------------------------------
// УДАЛЕНИЕ ТОВАРА
// --------------------------------------------------

async function deleteProduct(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;

    if (!confirm(
        `Удалить товар «${product.name}» и все его конфигурации?`
    )) {
        return;
    }

    const { data: images, error: imagesError } = await db
        .from("product_images")
        .select("image_url")
        .eq("product_id", id);

    if (imagesError) {
        notify("Не удалось получить фотографии товара.", true);
        return;
    }

    const { error } = await db
        .from("products")
        .delete()
        .eq("id", id);

    if (error) {
        notify("Ошибка удаления товара: " + error.message, true);
        return;
    }

    await deleteOldImage(product.image_url);

    for (const image of images || []) {
        await deleteOldImage(image.image_url);
    }

    notify("Товар удалён.");

    await loadProducts();
}

// --------------------------------------------------
// ЗАПУСК
// --------------------------------------------------

checkAdmin();

