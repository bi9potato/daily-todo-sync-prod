import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";

import { AppIcon } from "./AppIcon";
import { getAuthenticatedMediaSource } from "@/lib/api";
import { colors } from "@/theme";

type AuthenticatedImageProps = {
  contentUrl: string;
  style?: StyleProp<ImageStyle>;
};

export function AuthenticatedImage({
  contentUrl,
  style,
}: AuthenticatedImageProps) {
  type MediaSource = Awaited<ReturnType<typeof getAuthenticatedMediaSource>>;
  const [resolved, setResolved] = useState<{
    contentUrl: string;
    source: MediaSource;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = resolved?.contentUrl === contentUrl ? resolved.source : null;
  const failed = failedUrl === contentUrl;

  useEffect(() => {
    let active = true;
    void getAuthenticatedMediaSource(contentUrl)
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
      resizeMode="cover"
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
