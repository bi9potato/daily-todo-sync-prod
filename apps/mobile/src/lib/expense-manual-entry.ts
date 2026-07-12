// Validation for the manual "记一笔" amount field. Amounts are stored in
// minor units (fen); the UI accepts yuan with up to two decimals and a
// comma as a tolerated decimal separator (common on some keyboards).
export type ManualAmountResult =
  | { amountMinor: number; error: null }
  | { amountMinor: null; error: string };

export function parseManualAmount(input: string): ManualAmountResult {
  const normalized = input.replace(",", ".").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { amountMinor: null, error: "请输入正确金额，最多保留两位小数。" };
  }
  const amountMinor = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { amountMinor: null, error: "金额必须大于 0。" };
  }
  return { amountMinor, error: null };
}
