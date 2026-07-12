// Layout flags derived from the widget's current cell size, so shrinking or
// stretching the widget on the launcher re-lays it out instead of clipping:
// short widgets drop the reminder-time line and tighten rows, narrow ones
// shorten the header caption. Recomputed on every WIDGET_RESIZED render.
export type TodayWidgetLayout = {
  dense: boolean;
  narrow: boolean;
};

export function layoutForWidgetSize(size: {
  height: number;
  width: number;
}): TodayWidgetLayout {
  return {
    dense: size.height > 0 && size.height < 150,
    narrow: size.width > 0 && size.width < 240,
  };
}
