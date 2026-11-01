
(async function () {
  const db = supabaseClient;

  const button = document.getElementById("loadPriceHistory");
  const container = document.getElementById("priceHistory");

  if (!button || !container) return;

  button.addEventListener("click", loadHistory);

  async function loadHistory() {
    container.textContent = "Загружаем историю...";

    try {
      const { data, error } = await db
        .from("product_price_history")
        .select(`
          id,
          variant_id,
          old_price,
          new_price,
          currency,
          old_availability,
          new_availability,
          changed_at
        `)
        .order("changed_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      if (!data.length) {
        container.textContent = "Изменений пока нет.";
        return;
      }

      const ids = [...new Set(
        data.map(row => row.variant_id).filter(Boolean)
      )];

      const { data: variants, error: variantError } = await db
        .from("product_variants")
        .select("id,product_id,memory,color,sim_type")
        .in("id", ids);

      if (variantError) throw variantError;

      const productIds = [...new Set(
        variants.map(v => v.product_id)
      )];

      const { data: products, error: productError } = await db
        .from("products")
        .select("id,name")
        .in("id", productIds);

      if (productError) throw productError;

      const html = data.map(row => {
        const variant = variants.find(
          v => v.id === row.variant_id
        );

        const product = products.find(
          p => p.id === variant?.product_id
        );

        const date = new Date(row.changed_at)
          .toLocaleString("ru-RU");

        const oldPrice = Number(row.old_price)
          .toLocaleString("ru-RU");

        const newPrice = Number(row.new_price)
          .toLocaleString("ru-RU");

        const name = product?.name || "Удалённый товар";

        const configuration = [
          variant?.memory,
          variant?.color,
          variant?.sim_type
        ].filter(Boolean).join(" · ");

        const currency = row.currency === "RUB"
          ? "₽"
          : row.currency;

        return `
          <div style="
            border:1px solid #eee;
            padding:14px;
            border-radius:14px;
            margin:12px 0;
          ">
            <b>${escapeHTML(name)}</b>
            <p style="font-size:12px;color:#888">
              ${escapeHTML(configuration)}
            </p>
            <p>
              <span style="color:#888">${oldPrice} ${escapeHTML(currency)}</span>
              →
              <b>${newPrice} ${escapeHTML(currency)}</b>
            </p>
            <small style="color:#999">${date}</small>
          </div>
        `;
      }).join("");

      container.innerHTML = html;

    } catch (error) {
      console.error(error);
      container.textContent =
        "Ошибка загрузки: " + error.message;
    }
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
})();
