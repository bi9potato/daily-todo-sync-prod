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
import {
  clearCachedAuthenticatedMedia,
  getCachedAuthenticatedMediaUri,
} from "@/lib/media";
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
    attempt: number;
    contentUrl: string;
    source: ImageSourcePropType;
  } | null>(null);
  const [failed, setFailed] = useState<{
    attempt: number;
    contentUrl: string;
  } | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const source =
    resolved?.contentUrl === contentUrl && resolved.attempt === reloadAttempt
      ? resolved.source
      : null;
  const hasFailed =
    failed?.contentUrl === contentUrl && failed.attempt === reloadAttempt;

  useEffect(() => {
    let active = true;
    void getCachedAuthenticatedMediaUri(contentUrl)
      .then((nextSource) => {
        if (active) {
          setResolved({ attempt: reloadAttempt, contentUrl, source: nextSource });
        }
      })
      .catch(() => {
        if (active) {
          setFailed({ attempt: reloadAttempt, contentUrl });
        }
      });
    return () => {
      active = false;
    };
  }, [contentUrl, reloadAttempt]);

  if (hasFailed) {
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

  async function retryAfterRenderError() {
    if (reloadAttempt >= 1) {
      setFailed({ attempt: reloadAttempt, contentUrl });
      return;
    }
    await clearCachedAuthenticatedMedia(contentUrl);
    setReloadAttempt((current) => current + 1);
  }

  return (
    <Image
      onError={() => {
        void retryAfterRenderError();
      }}
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
