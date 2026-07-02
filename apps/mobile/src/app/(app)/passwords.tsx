import { ScreenEnter } from "@/components/ScreenEnter";
import { PasswordsScreen } from "@/screens/PasswordsScreen";

export default function PasswordsRoute() {
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <PasswordsScreen />
    </ScreenEnter>
  );
}
