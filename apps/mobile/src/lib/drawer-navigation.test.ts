import { navigateFromDrawer } from "./drawer-navigation";

test.each([
  "today",
  "long-term",
  "low-priority",
  "mobility",
  "device-timeline",
  "expenses",
  "timeline",
  "services",
  "profile",
] as const)("opens the %s drawer module through the navigator", (section) => {
  const navigate = jest.fn();
  navigateFromDrawer({ navigate }, section);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(section);
});
