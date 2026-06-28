import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const ESTIMATED_ROW_HEIGHT = 84;

type DraggableTaskItemProps = {
  children: ReactNode;
  id: string;
  index: number;
  onDragEnd?: () => void;
  onDragStart?: () => void;
  onDrop: () => void;
  onPreviewMove: (id: string, toIndex: number) => void;
  total: number;
};

export function DraggableTaskItem({
  children,
  id,
  index,
  onDragEnd,
  onDragStart,
  onDrop,
  onPreviewMove,
  total,
}: DraggableTaskItemProps) {
  const [translateY] = useState(() => new Animated.Value(0));
  const [active, setActive] = useState(false);
  const startIndexRef = useRef(index);
  const lastTargetRef = useRef(index);
  const latestTranslationRef = useRef(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    translateY.setValue(
      latestTranslationRef.current +
        (startIndexRef.current - index) * ESTIMATED_ROW_HEIGHT,
    );
  }, [active, index, translateY]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(220)
        .averageTouches(true)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        // Gesture callbacks run after activation, not during React render.
        // eslint-disable-next-line react-hooks/refs
        .onStart(() => {
          startIndexRef.current = index;
          lastTargetRef.current = index;
          latestTranslationRef.current = 0;
          translateY.setValue(0);
          setActive(true);
          onDragStart?.();
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        })
        // eslint-disable-next-line react-hooks/refs
        .onUpdate((event) => {
          latestTranslationRef.current = event.translationY;
          translateY.setValue(
            event.translationY +
              (startIndexRef.current - index) * ESTIMATED_ROW_HEIGHT,
          );
          const offset = Math.round(event.translationY / ESTIMATED_ROW_HEIGHT);
          const target = Math.max(
            0,
            Math.min(total - 1, startIndexRef.current + offset),
          );
          if (target !== lastTargetRef.current) {
            lastTargetRef.current = target;
            onPreviewMove(id, target);
          }
        })
        // eslint-disable-next-line react-hooks/refs
        .onFinalize(() => {
          onDrop();
          onDragEnd?.();
          latestTranslationRef.current = 0;
          Animated.spring(translateY, {
            damping: 18,
            mass: 0.5,
            stiffness: 220,
            toValue: 0,
            useNativeDriver: true,
          }).start(() => setActive(false));
        }),
    [id, index, onDragEnd, onDragStart, onDrop, onPreviewMove, total, translateY],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        collapsable={false}
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
