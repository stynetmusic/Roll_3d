/* Деньги. Алгоритм совпадает с money.py: целые единицы, половина вверх. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.RollMoney = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_MONEY_CENTS = 9999999999n;
  const MAX_QTY_MILLI = 1000000000n;
  const MAX_MEASURE_CENTI = 10000000n;

  function cleanNumber(value) {
    return String(value ?? "")
      .trim()
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(",", ".");
  }

  function toUnits(value, scale) {
    const text = cleanNumber(value);
    if (!text) return null;
    const match = text.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const frac = match[2] || "";
    const head = frac.slice(0, scale);
    const rest = frac.slice(scale);
    const padded = (head + "0".repeat(scale)).slice(0, scale);
    let number = BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(padded || "0");
    if (rest.length && rest[0] >= "5") number += 1n;
    return number;
  }

  function divRoundHalfUp(num, den) {
    if (num < 0n) return -divRoundHalfUp(-num, den);
    return (num + den / 2n) / den;
  }

  function lineSumCents(qty, price, discount) {
    const qtyU = toUnits(qty, 3);
    const priceU = toUnits(price, 2);
    if (qtyU === null || priceU === null) return 0n;
    let disc = toUnits(discount, 2);
    if (disc === null || disc < 0n) disc = 0n;
    if (disc > 10000n) disc = 10000n;
    return divRoundHalfUp(qtyU * priceU * (10000n - disc), 10000000n);
  }

  function orderTotalCents(sumCents, discount) {
    let disc = toUnits(discount, 2);
    if (disc === null || disc < 0n) disc = 0n;
    if (disc > 10000n) disc = 10000n;
    return divRoundHalfUp(BigInt(sumCents) * (10000n - disc), 10000n);
  }

  function stripZeros(text) {
    if (!text.includes(".")) return text;
    const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
    return trimmed || "0";
  }

  function normalizeMoney(value) {
    let units = toUnits(value, 2);
    if (units === null) return null;
    if (units > MAX_MONEY_CENTS) units = MAX_MONEY_CENTS;
    const whole = units / 100n;
    const frac = (units % 100n).toString().padStart(2, "0");
    return whole.toString() + "." + frac;
  }

  function normalizeQty(value) {
    const text = cleanNumber(value);
    if (text === "") return "0";
    let units = toUnits(text, 3);
    if (units === null) return null;
    if (units > MAX_QTY_MILLI) units = MAX_QTY_MILLI;
    const whole = units / 1000n;
    const frac = (units % 1000n).toString().padStart(3, "0");
    return stripZeros(whole.toString() + "." + frac);
  }

  function normalizeDiscount(value) {
    const text = cleanNumber(value);
    if (text === "") return "0";
    let units = toUnits(text, 2);
    if (units === null) return null;
    if (units < 0n) units = 0n;
    if (units > 10000n) units = 10000n;
    const whole = units / 100n;
    const frac = (units % 100n).toString().padStart(2, "0");
    return stripZeros(whole.toString() + "." + frac);
  }

  function normalizeMeasure(value) {
    const text = cleanNumber(value);
    if (text === "") return "";
    let units = toUnits(text, 2);
    if (units === null) return null;
    if (units > MAX_MEASURE_CENTI) units = MAX_MEASURE_CENTI;
    const whole = units / 100n;
    const frac = (units % 100n).toString().padStart(2, "0");
    return stripZeros(whole.toString() + "." + frac);
  }

  function formatGrouped(cents) {
    const neg = cents < 0n;
    const n = neg ? -cents : cents;
    const whole = (n / 100n).toString();
    const frac = (n % 100n).toString().padStart(2, "0");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + grouped + "," + frac;
  }

  return {
    toUnits,
    lineSumCents,
    orderTotalCents,
    normalizeMoney,
    normalizeQty,
    normalizeDiscount,
    normalizeMeasure,
    formatGrouped,
  };
});
