import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type ImageSourcePropType,
  type ImageResizeMode,
  type StyleProp,
} from "react-native";

import { AppIcon } from "./AppIcon";
import { getCachedAuthenticatedMediaUri } from "@/lib/media";
import { colors } from "@/theme";

type AuthenticatedImageProps = {
  contentUrl: string;
  resizeMode?: ImageResizeMode;
  style?: StyleProp<ImageStyle>;
};

export function AuthenticatedImage({
  contentUrl,
  resizeMode = "cover",
  style,
}: AuthenticatedImageProps) {
  const [resolved, setResolved] = useState<{
    contentUrl: string;
    source: ImageSourcePropType;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source =
    resolved?.contentUrl === contentUrl ? resolved.source : null;
  const failed = failedUrl === contentUrl;

  useEffect(() => {
    let active = true;
    void getCachedAuthenticatedMediaUri(contentUrl)
      .then((nextSource) => {
        if (active) {
          setResolved({ contentUrl, source: nextSource });
        }
      })
      .catch(() => {
        if (active) {
          setFailedUrl(contentUrl);
        }
      });
    return () => {
      active = false;
    };
  }, [contentUrl]);

  if (failed) {
    return (
      <View style={[styles.loading, style]}>
        <AppIcon name="image-outline" color={colors.textMuted} size={20} />
      </View>
    );
  }

  if (!source) {
    return (
      <View style={[styles.loading, style]}>
        <ActivityIndicator color={colors.accent} size="small" />
      </View>
    );
  }

  return (
    <Image
      onError={() => setFailedUrl(contentUrl)}
      resizeMode={resizeMode}
      source={source}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    justifyContent: "center",
  },
});
