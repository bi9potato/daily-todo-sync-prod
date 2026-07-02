import { ScreenEnter } from "@/components/ScreenEnter";
import { ProfileScreen } from "@/screens/ProfileScreen";

export default function ProfileRoute() {
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <ProfileScreen />
    </ScreenEnter>
  );
}
