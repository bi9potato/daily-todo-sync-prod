import { useEffect, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  type KeyboardEvent,
} from "react-native";

export function useAndroidKeyboardInset() {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") {
      setKeyboardInset(0);
      setKeyboardVisible(false);
      return;
    }

    function updateKeyboardInset(event: KeyboardEvent) {
      const windowHeight = Dimensions.get("window").height;
      const keyboardTop = event.endCoordinates.screenY;
      const overlap = Math.max(0, windowHeight - keyboardTop);
      setKeyboardVisible(true);
      setKeyboardInset(overlap);
    }

    const showSubscription = Keyboard.addListener("keyboardDidShow", updateKeyboardInset);
    const frameSubscription = Keyboard.addListener(
      "keyboardDidChangeFrame",
      updateKeyboardInset,
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
  }, []);

  return { keyboardInset, keyboardVisible };
}
