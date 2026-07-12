import { parseManualAmount } from "./expense-manual-entry";

test.each([
  ["12", 1200],
  ["12.5", 1250],
  ["12.34", 1234],
  ["0.01", 1],
  [" 8 ", 800],
  ["3,5", 350],
])("accepts %s as %i fen", (input, expected) => {
  expect(parseManualAmount(input)).toEqual({
    amountMinor: expected,
    error: null,
  });
});

test.each(["", "abc", "12.345", "-5", "1.2.3", "¥12", "12。5"])(
  "rejects malformed amount %s",
  (input) => {
    const result = parseManualAmount(input);
    expect(result.amountMinor).toBeNull();
    expect(result.error).toBe("请输入正确金额，最多保留两位小数。");
  },
);

test.each(["0", "0.00"])("rejects non-positive amount %s", (input) => {
  const result = parseManualAmount(input);
  expect(result.amountMinor).toBeNull();
  expect(result.error).toBe("金额必须大于 0。");
});

test("rejects amounts beyond the safe integer range", () => {
  const result = parseManualAmount("92233720368547758");
  expect(result.amountMinor).toBeNull();
  expect(result.error).toBe("金额必须大于 0。");
});
