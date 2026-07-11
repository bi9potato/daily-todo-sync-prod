import type { AppSection } from "./app-routes";

export type DrawerNavigator = {
  navigate: (section: AppSection) => void;
};

export function navigateFromDrawer(
  navigation: DrawerNavigator,
  section: AppSection,
) {
  navigation.navigate(section);
}
