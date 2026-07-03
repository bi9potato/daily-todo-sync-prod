import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

// Wrapper that provides the same interface as the old useAndroidKeyboardInset,
// now powered by react-native-keyboard-controller events under the hood.
// The library handles OS differences; we just provide the same API surface.
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
