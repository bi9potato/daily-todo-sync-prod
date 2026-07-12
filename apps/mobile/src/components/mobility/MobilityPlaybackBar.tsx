import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";

import { AppIcon } from "@/components/AppIcon";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const PLAYBACK_SPEED_OPTIONS = [1, 2, 5, 10] as const;

export function MobilityPlaybackBar({
  isPlaying,
  onChooseSpeed,
  onSeek,
  onTogglePlayback,
  playbackRatio,
  playbackSpeed,
}: {
  isPlaying: boolean;
  onChooseSpeed: (speed: number) => void;
  onSeek: (ratio: number) => void;
  onTogglePlayback: () => void;
  playbackRatio: number;
  playbackSpeed: number;
}) {
  return (
    <View style={styles.playbackBar}>
      <Pressable
        accessibilityLabel={isPlaying ? "暂停回放" : "回放轨迹"}
        accessibilityRole="button"
        onPress={onTogglePlayback}
        style={({ pressed }) => [
          styles.playbackButton,
          pressed && styles.pressed,
        ]}>
        <AppIcon
          color={colors.white}
          name={isPlaying ? "pause" : "play"}
          size={17}
        />
      </Pressable>
      <Slider
        accessibilityLabel="回放进度"
        maximumTrackTintColor={colors.surfaceMuted}
        maximumValue={1}
        minimumTrackTintColor={colors.accent}
        minimumValue={0}
        onValueChange={onSeek}
        style={styles.scrubber}
        thumbTintColor={colors.accent}
        value={playbackRatio}
      />
      <View style={styles.speedOptions}>
        {PLAYBACK_SPEED_OPTIONS.map((speed) => {
          const active = speed === playbackSpeed;
          return (
            <Pressable
              accessibilityLabel={`${speed} 倍速回放`}
              accessibilityRole="button"
              key={speed}
              onPress={() => onChooseSpeed(speed)}
              style={({ pressed }) => [
                styles.speedChip,
                active && styles.speedChipActive,
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.speedChipText,
                  active && styles.speedChipTextActive,
                ]}>
                {speed}x
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  playbackBar: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  playbackButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  scrubber: {
    flex: 1,
  },
  speedOptions: {
    flexDirection: "row",
    gap: 4,
  },
  speedChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  speedChipActive: {
    backgroundColor: colors.accent,
  },
  speedChipText: {
    ...typography.label,
    color: colors.textMuted,
    fontSize: 11,
  },
  speedChipTextActive: {
    color: colors.white,
  },
  pressed: {
    opacity: 0.68,
  },
});
