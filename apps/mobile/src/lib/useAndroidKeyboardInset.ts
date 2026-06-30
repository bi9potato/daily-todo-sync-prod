import { useEffect, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  type KeyboardEvent,
  type KeyboardMetrics,
} from "react-native";

export function useAndroidKeyboardInset(bottomSafeAreaInset: number) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    function updateKeyboardInset(
      coordinates: KeyboardEvent["endCoordinates"] | KeyboardMetrics,
    ) {
      const windowHeight = Dimensions.get("window").height;
      const overlap = Math.max(
        0,
        windowHeight - coordinates.screenY - bottomSafeAreaInset,
      );
      setKeyboardVisible(true);
      setKeyboardInset(overlap);
    }

    const currentMetrics = Keyboard.metrics();
    if (Keyboard.isVisible() && currentMetrics) {
      updateKeyboardInset(currentMetrics);
    }

    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) =>
      updateKeyboardInset(event.endCoordinates),
    );
    const frameSubscription = Keyboard.addListener(
      "keyboardDidChangeFrame",
      (event) => updateKeyboardInset(event.endCoordinates),
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
      setKeyboardInset(0);
    });

    return () => {
      showSubscription.remove();
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, [bottomSafeAreaInset]);

  return { keyboardInset, keyboardVisible };
}
