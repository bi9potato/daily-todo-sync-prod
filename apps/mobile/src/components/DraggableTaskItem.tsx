import { useMemo, useState, type ReactNode } from "react";
import { Animated, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const ESTIMATED_ROW_HEIGHT = 84;

type DraggableTaskItemProps = {
  children: ReactNode;
  id: string;
  index: number;
  onDrop: () => void;
  onPreviewMove: (id: string, toIndex: number) => void;
  total: number;
};

export function DraggableTaskItem({
  children,
  id,
  index,
  onDrop,
  onPreviewMove,
  total,
}: DraggableTaskItemProps) {
  const [translateY] = useState(() => new Animated.Value(0));
  const [active, setActive] = useState(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(220)
        .averageTouches(true)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onStart(() => {
          setActive(true);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        })
        .onUpdate((event) => {
          translateY.setValue(event.translationY);
          const offset = Math.round(event.translationY / ESTIMATED_ROW_HEIGHT);
          const target = Math.max(0, Math.min(total - 1, index + offset));
          if (target !== index) {
            onPreviewMove(id, target);
          }
        })
        .onEnd(() => {
          onDrop();
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
    [id, index, onDrop, onPreviewMove, total, translateY],
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
