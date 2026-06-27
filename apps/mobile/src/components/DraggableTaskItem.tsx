import { useMemo, useState, type ReactNode } from "react";
import { Animated, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const ESTIMATED_ROW_HEIGHT = 84;

type DraggableTaskItemProps = {
  children: ReactNode;
  index: number;
  onMove: (fromIndex: number, toIndex: number) => void;
  total: number;
};

export function DraggableTaskItem({
  children,
  index,
  onMove,
  total,
}: DraggableTaskItemProps) {
  const [translateY] = useState(() => new Animated.Value(0));
  const [active, setActive] = useState(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(280)
        .runOnJS(true)
        .onStart(() => {
          setActive(true);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        })
        .onUpdate((event) => {
          translateY.setValue(event.translationY);
        })
        .onEnd((event) => {
          const offset = Math.round(event.translationY / ESTIMATED_ROW_HEIGHT);
          const target = Math.max(0, Math.min(total - 1, index + offset));
          if (target !== index) {
            onMove(index, target);
          }
        })
        .onFinalize(() => {
          Animated.spring(translateY, {
            damping: 18,
            mass: 0.5,
            stiffness: 220,
            toValue: 0,
            useNativeDriver: true,
          }).start(() => setActive(false));
        }),
    [index, onMove, total, translateY],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.item,
          active && styles.active,
          { transform: [{ translateY }, { scale: active ? 1.015 : 1 }] },
        ]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  item: {
    zIndex: 0,
  },
  active: {
    elevation: 12,
    opacity: 0.96,
    zIndex: 20,
  },
});
