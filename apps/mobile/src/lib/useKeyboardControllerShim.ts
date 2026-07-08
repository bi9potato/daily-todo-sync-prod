import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

// Tracks the IME's current height/visibility from React Native core Keyboard
// events (which fire unconditionally on Android - no provider setup needed,
// unlike react-native-keyboard-controller, which this app used to depend on).
//
// Returns { keyboardInset, keyboardVisible } compatible with Composer, etc.
export function useKeyboardControllerShim(bottomSafeAreaInset: number) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    let mostRecentHeight = 0;

    const updateKeyboardState = () => {
      const currentInset = Math.max(0, mostRecentHeight - bottomSafeAreaInset);
      setKeyboardInset(currentInset);
      setKeyboardVisible(mostRecentHeight > 0);
    };

    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      mostRecentHeight = event.endCoordinates.height;
      updateKeyboardState();
    });

    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      mostRecentHeight = 0;
      updateKeyboardState();
    });

    const frameSubscription = Keyboard.addListener("keyboardDidChangeFrame", (event) => {
      mostRecentHeight = event.endCoordinates.height;
      updateKeyboardState();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      frameSubscription.remove();
    };
  }, [bottomSafeAreaInset]);

  return {
    keyboardInset,
    keyboardVisible,
  };
}
