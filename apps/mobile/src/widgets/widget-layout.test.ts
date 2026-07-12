import { layoutForWidgetSize } from "./widget-layout";

test("full-size widgets keep the roomy layout", () => {
  expect(layoutForWidgetSize({ height: 220, width: 320 })).toEqual({
    dense: false,
    narrow: false,
  });
});

test("short widgets tighten rows and drop the time line", () => {
  expect(layoutForWidgetSize({ height: 120, width: 320 })).toEqual({
    dense: true,
    narrow: false,
  });
});

test("narrow widgets shorten the header caption", () => {
  expect(layoutForWidgetSize({ height: 220, width: 180 })).toEqual({
    dense: false,
    narrow: true,
  });
});

test("unknown sizes (0) fall back to the roomy layout", () => {
  expect(layoutForWidgetSize({ height: 0, width: 0 })).toEqual({
    dense: false,
    narrow: false,
  });
});
