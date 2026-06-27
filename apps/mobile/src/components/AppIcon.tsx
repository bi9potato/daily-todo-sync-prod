import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof Ionicons>["name"];

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function AppIcon({ name, size = 22, color }: AppIconProps) {
  return <Ionicons name={name} size={size} color={color} />;
}
