import { memo, useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { getDeviceTimelineAppIcon } from "@/lib/device-timeline-native-service";
import { colors } from "@/theme";

type DeviceTimelineAppIconProps = {
  packageName: string | null;
  size?: number;
};

export const DeviceTimelineAppIcon = memo(function DeviceTimelineAppIcon({
  packageName,
  size = 36,
}: DeviceTimelineAppIconProps) {
  const [resolved, setResolved] = useState<{
    icon: string | null;
    packageName: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (packageName) {
      void getDeviceTimelineAppIcon(packageName).then((result) => {
        if (active) {
          setResolved({ icon: result, packageName });
        }
      });
    }
    return () => {
      active = false;
    };
  }, [packageName]);

  const icon = resolved?.packageName === packageName ? resolved.icon : null;

  if (icon) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="应用图标"
        source={{ uri: icon }}
        style={{ borderRadius: Math.max(6, size * 0.22), height: size, width: size }}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { borderRadius: Math.max(6, size * 0.22), height: size, width: size },
      ]}>
      <AppIcon
        name="apps-outline"
        color={colors.accent}
        size={Math.round(size * 0.5)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    justifyContent: "center",
    overflow: "hidden",
  },
});
