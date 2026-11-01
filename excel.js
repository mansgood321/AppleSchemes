
const ExcelManager = (() => {
  const db = supabaseClient;

  const columns = [
    "variant_id",
    "category",
    "product",
    "memory",
    "color",
    "sim_type",
    "price",
    "availability"
  ];

  async function getVariants() {
    const { data, error } = await db
      .from("product_variants")
      .select(`
        id,
        product_id,
        memory,
        color,
        sim_type,
        price,
        currency,
        availability
      `);

    if (error) throw error;

    const { data: products, error: productError } = await db
      .from("products")
      .select("id,name,category_id");

    if (productError) throw productError;

    const { data: categories, error: categoryError } = await db
      .from("categories")
      .select("id,name");

    if (categoryError) throw categoryError;

    return data.map(v => {
      const product = products.find(p => p.id === v.product_id);
      const category = categories.find(
        c => c.id === product?.category_id
      );

      return {
        variant_id: v.id,
        category: category?.name || "",
        product: product?.name || "",
        memory: v.memory || "",
        color: v.color || "",
        sim_type: v.sim_type || "",
        price: v.price ?? "",
        availability: v.availability || "in_stock",
        currency: v.currency || "RUB"
      };
    });
  }

  async function exportExcel() {
    const rows = await getVariants();

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [...columns, "currency"]
    });

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Apple Schemes"
    );

    XLSX.writeFile(
      workbook,
      "AppleSchemes_PriceList.xlsx"
    );
  }

  async function importExcel(file) {
    const workbook = XLSX.read(await file.arrayBuffer());

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(worksheet);

    if (!rows.length) {
      throw new Error("Файл пустой");
    }

    const required = [
      "variant_id",
      "price",
      "availability"
    ];

    for (const field of required) {
      if (!Object.hasOwn(rows[0], field)) {
        throw new Error("Нет обязательной колонки: " + field);
      }
    }

    const current = await getVariants();
    const knownIds = new Set(current.map(v => v.variant_id));

    const updates = rows.map(row => {
      if (!knownIds.has(String(row.variant_id))) {
        throw new Error(
          "Неизвестный ID товара: " + row.variant_id
        );
      }

      const price = Number(row.price);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error(
          "Некорректная цена: " + row.variant_id
        );
      }

      const availabilityMap = {
        "В наличии": "in_stock",
        "Под заказ": "on_order",
        "Нет в наличии": "out_of_stock",
        "in_stock": "in_stock",
        "on_order": "on_order",
        "out_of_stock": "out_of_stock"
      };

      const availability =
        availabilityMap[row.availability];

      if (!availability) {
        throw new Error(
          "Некорректное наличие: " + row.variant_id
        );
      }

      return {
        variant_id: String(row.variant_id),
        price,
        availability
      };
    });

    const uniqueIds = new Set(
      updates.map(v => v.variant_id)
    );

    if (uniqueIds.size !== updates.length) {
      throw new Error("В файле повторяются ID товаров");
    }

    const preview = updates.map(update => {
      const old = current.find(
        v => v.variant_id === update.variant_id
      );

      return {
        product: old.product,
        memory: old.memory,
        oldPrice: old.price,
        newPrice: update.price,
        availability: update.availability
      };
    });

    const summary = preview.map(v =>
      `${v.product} ${v.memory}: ${v.oldPrice} → ${v.newPrice}`
    ).join("\n");

    if (!confirm(
      "Проверь изменения:\n\n" + summary +
      "\n\nОбновить " + updates.length + " конфигураций?"
    )) {
      return;
    }

    const { data, error } = await db.rpc(
      "import_prices",
      { rows: updates }
    );

    if (error) throw error;

    alert(
      "Успешно обновлено: " +
      (data.updated ?? updates.length)
    );
  }

  return {
    exportExcel,
    importExcel
  };
})();

window.ExcelManager = ExcelManager;
