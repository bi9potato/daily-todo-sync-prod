import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { ScreenEnter } from "@/components/ScreenEnter";
import { sectionEnabledOnPlatform } from "@/lib/platform-sections";
import { PasswordsScreen } from "@/screens/PasswordsScreen";

export default function PasswordsRoute() {
  if (!sectionEnabledOnPlatform("passwords", Platform.OS)) {
    return <Redirect href="/today" />;
  }
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <PasswordsScreen />
    </ScreenEnter>
  );
}
