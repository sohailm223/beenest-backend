function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const FREE_ORDER_LIMIT = toPositiveInt(
  process.env.SUBSCRIPTION_FREE_ORDER_LIMIT,
  2
);

export const FREE_DIGITAL_LIMIT = toPositiveInt(
  process.env.SUBSCRIPTION_FREE_DIGITAL_LIMIT,
  2
);

