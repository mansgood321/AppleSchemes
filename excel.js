
(function () {
  const db = supabaseClient;

  function notify(message, isError = false) {
    const element = document.getElementById("message");

    if (element) {
      element.textContent = message;
      element.style.color = isError ? "#c0392b" : "#16803c";
      element.style.display = "block";
    } else {
      alert(message);
    }
  }

  function parseJSON(value, fallback = {}) {
    if (!value) return fallback;

    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function getAttributes(variant) {
    const attributes = parseJSON(variant.attributes, {});

    return {
      ...attributes,
      memory: attributes.memory ?? variant.memory ?? "",
      color: attributes.color ?? variant.color ?? "",
      sim_type: attributes.sim_type ?? variant.sim_type ?? ""
    };
  }

  function getAttributeLabel(key, categories) {
    for (const category of categories) {
      const schema = parseJSON(category.attributes_schema, []);

      if (!Array.isArray(schema)) continue;

      const field = schema.find(item => item.key === key);

      if (field?.label) return field.label;
    }

    const defaults = {
      memory: "Память",
      color: "Цвет",
      sim_type: "Тип SIM",
      ram: "Оперативная память",
      storage: "Накопитель",
      chip: "Процессор"
    };

    return defaults[key] || key;
  }

  async function getVariants() {
    const [
      variantsResult,
      productsResult,
      categoriesResult
    ] = await Promise.all([
      db.from("product_variants")
        .select("*")
        .order("created_at", { ascending: false }),

      db.from("products")
        .select("id,name,category_id"),

      db.from("categories")
        .select("id,name,attributes_schema")
    ]);

    if (variantsResult.error) throw variantsResult.error;
    if (productsResult.error) throw productsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;

    const products = productsResult.data || [];
    const categories = categoriesResult.data || [];

    const productMap = Object.fromEntries(
      products.map(product => [product.id, product])
    );

    const categoryMap = Object.fromEntries(
      categories.map(category => [category.id, category])
    );

    return (variantsResult.data || []).map(variant => {
      const product = productMap[variant.product_id] || {};
      const category = categoryMap[product.category_id] || {};
      const attributes = getAttributes(variant);

      return {
        ...variant,
        product_name: product.name || "Без названия",
        category_name: category.name || "Без категории",
        attributes,
        category_id: product.category_id || null
      };
    });
  }

  function getAllAttributeKeys(variants, categories) {
    const keys = new Set();

    // Поля из настроек категорий
    categories.forEach(category => {
      const schema = parseJSON(category.attributes_schema, []);

      if (Array.isArray(schema)) {
        schema.forEach(field => {
          if (field?.key) keys.add(field.key);
        });
      }
    });

    // Поля, которые уже заполнены в конфигурациях
    variants.forEach(variant => {
      Object.keys(variant.attributes || {}).forEach(key => {
        if (variant.attributes[key] !== null &&
            variant.attributes[key] !== undefined) {
          keys.add(key);
        }
      });
    });

    return [...keys];
  }

  // Экспорт Excel
  async function exportExcel() {
    try {
      if (typeof XLSX === "undefined") {
        throw new Error("Библиотека Excel не загружена");
      }

      notify("Подготавливаем Excel...");

      const variants = await getVariants();

      const categoriesResult = await db
        .from("categories")
        .select("id,name,attributes_schema");

      if (categoriesResult.error) throw categoriesResult.error;

      const categories = categoriesResult.data || [];

      if (!variants.length) {
        notify("Пока нет конфигураций для выгрузки.", true);
        return;
      }

      const attributeKeys = getAllAttributeKeys(
        variants,
        categories
      );

      const attributeHeaders = attributeKeys.map(key => {
        const label = getAttributeLabel(key, categories);
        return `${label} [${key}]`;
      });

      const headers = [
        "variant_id",
        "category",
        "product",
        ...attributeHeaders,
        "price",
        "currency",
        "availability",
        "sku"
      ];

      const rows = variants.map(variant => {
        const row = {
          variant_id: variant.id,
          category: variant.category_name,
          product: variant.product_name
        };

        attributeKeys.forEach((key, index) => {
          row[attributeHeaders[index]] =
            variant.attributes[key] ?? "";
        });

        row.price = variant.price ?? "";
        row.currency = variant.currency || "RUB";
        row.availability = variant.availability || "in_stock";
        row.sku = variant.sku || "";

        return row;
      });

      const worksheet = XLSX.utils.json_to_sheet(rows, {
        header: headers
      });

      worksheet["!cols"] = headers.map(header => ({
        wch: Math.max(15, Math.min(30, header.length + 3))
      }));

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Apple Schemes"
      );

      const instructions = [
        ["ИНСТРУКЦИЯ"],
        ["variant_id — уникальный ID конфигурации. Не меняйте его."],
        ["price — новая цена."],
        ["currency — RUB или AMD."],
        ["availability — in_stock, out_of_stock или preorder."],
        ["Характеристики приведены для информации."],
        ["Импорт обновляет цену, валюту и наличие, но не характеристики."]
      ];

      const instructionSheet =
        XLSX.utils.aoa_to_sheet(instructions);

      instructionSheet["!cols"] = [{ wch: 90 }];

      XLSX.utils.book_append_sheet(
        workbook,
        instructionSheet,
        "Инструкция"
      );

      XLSX.writeFile(
        workbook,
        "AppleSchemes_PriceList.xlsx"
      );

      notify("Excel успешно выгружен.");

    } catch (error) {
      console.error("Excel export error:", error);
      notify("Ошибка экспорта: " + error.message, true);
    }
  }

  function normalizeHeader(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-()[\]]/g, "");
  }

  function getCell(row, names) {
    const entries = Object.entries(row);

    for (const name of names) {
      const expected = normalizeHeader(name);

      const found = entries.find(
        ([key]) => normalizeHeader(key) === expected
      );

      if (found) return found[1];
    }

    return undefined;
  }

  function parsePrice(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const cleaned = String(value ?? "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");

    if (!cleaned || cleaned === "." || cleaned === "-") {
      return null;
    }

    const number = Number(cleaned);

    return Number.isFinite(number) ? number : null;
  }

  function normalizeCurrency(value, currentValue) {
    if (value === undefined || value === null ||
        String(value).trim() === "") {
      return currentValue || "RUB";
    }

    const currency = String(value).trim().toUpperCase();

    if (!["RUB", "AMD", "USD"].includes(currency)) {
      throw new Error(`Неизвестная валюта: ${value}`);
    }

    return currency;
  }

  function normalizeAvailability(value, currentValue) {
    if (value === undefined || value === null ||
        String(value).trim() === "") {
      return currentValue || "in_stock";
    }

    const status = String(value).trim().toLowerCase();

    const statuses = {
      "in_stock": "in_stock",
      "instock": "in_stock",
      "в наличии": "in_stock",
      "есть": "in_stock",

      "out_of_stock": "out_of_stock",
      "outofstock": "out_of_stock",
      "нет в наличии": "out_of_stock",
      "нет": "out_of_stock",

      "preorder": "preorder",
      "предзаказ": "preorder",
      "под заказ": "preorder"
    };

    const normalized = statuses[status];

    if (!normalized) {
      throw new Error(`Неизвестное наличие: ${value}`);
    }

    return normalized;
  }

  // Импорт Excel
  async function importExcel(file) {
    try {
      if (!file) {
        notify("Сначала выберите Excel-файл.", true);
        return;
      }

      if (typeof XLSX === "undefined") {
        throw new Error("Библиотека Excel не загружена");
      }

      notify("Читаем Excel-файл...");

      const buffer = await file.arrayBuffer();

      const workbook = XLSX.read(buffer, {
        type: "array"
      });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        throw new Error("В файле нет листа с данными");
      }

      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: ""
      });

      if (!rows.length) {
        throw new Error("В Excel нет строк с данными");
      }

      const variantsResult = await db
        .from("product_variants")
        .select("id,price,currency,availability");

      if (variantsResult.error) throw variantsResult.error;

      const variantMap = new Map(
        (variantsResult.data || []).map(variant => [
          String(variant.id),
          variant
        ])
      );

      const updates = [];
      const errors = [];
      const seenIds = new Set();

      rows.forEach((row, index) => {
        const rowNumber = index + 2;

        try {
          const id = getCell(row, [
            "variant_id",
            "variant id",
            "id конфигурации"
          ]);

          if (!id) return;

          const variantId = String(id).trim();

          if (seenIds.has(variantId)) {
            throw new Error("Повторяется ID конфигурации");
          }

          seenIds.add(variantId);

          const existing = variantMap.get(variantId);

          if (!existing) {
            throw new Error("Конфигурация не найдена в базе");
          }

          const priceValue = getCell(row, [
            "price",
            "цена"
          ]);

          const price = parsePrice(priceValue);

          if (price === null || price < 0) {
            throw new Error("Некорректная цена");
          }

          const currency = normalizeCurrency(
            getCell(row, ["currency", "валюта"]),
            existing.currency
          );

          const availability = normalizeAvailability(
            getCell(row, ["availability", "наличие"]),
            existing.availability
          );

          updates.push({
            id: variantId,
            price,
            currency,
            availability
          });

        } catch (error) {
          errors.push(`Строка ${rowNumber}: ${error.message}`);
        }
      });

      if (!updates.length) {
        throw new Error(
          "Не найдено ни одной подходящей строки для импорта. " +
          "Проверьте колонку variant_id и цены."
        );
      }

      let successCount = 0;

      for (const update of updates) {
        const { id, ...values } = update;

        const { error } = await db
          .from("product_variants")
          .update(values)
          .eq("id", id);

        if (error) {
          errors.push(`${id}: ${error.message}`);
        } else {
          successCount++;
        }
      }

      let message =
        `Импорт завершён. Обновлено конфигураций: ${successCount}.`;

      if (errors.length) {
        message +=
          ` Ошибок: ${errors.length}. Первые ошибки: ` +
          errors.slice(0, 5).join("; ");
      }

      if (successCount > 0) {
        message +=
          " История изменений цен обновляется автоматически.";
      }

      notify(message, errors.length > 0 && successCount === 0);

      // Обновляем историю, если она открыта
      if (window.loadPriceHistory) {
        await window.loadPriceHistory();
      }

    } catch (error) {
      console.error("Excel import error:", error);
      notify("Ошибка импорта: " + error.message, true);
    }
  }

  window.ExcelManager = {
    exportExcel,
    importExcel
  };

})();
