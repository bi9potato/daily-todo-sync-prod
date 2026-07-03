import { useCallback, useEffect, useRef } from "react";
import { Keyboard, Platform } from "react-native";
import { KeyboardEvents } from "react-native-keyboard-controller";

// Guard for Modal onRequestClose that survives the Android IME + back gesture
// race condition. Uses react-native-keyboard-controller to track when the
// keyboard hides, replacing the old hand-rolled Keyboard API + timestamp
// tracking that would break on Android version changes.
//
// Usage: bind this to Modal.onRequestClose like before.
//   const guard = useBackPressKeyboardGuard(onClose);
//   <Modal onRequestClose={guard} />
//
// Logic: when the back gesture arrives:
// - If keyboard just hid or is hiding, consume this back (don't close Modal)
// - Otherwise, close the Modal
//
// The library's KeyboardEvents tell us exactly when the keyboard is moving,
// so we can track state more reliably than checking Keyboard.isVisible().
export function useBackPressKeyboardGuard(onClose: () => void) {
  const isKeyboardMovingRef = useRef(false);

  useEffect(() => {
    // On Android only (iOS doesn't have this race condition)
    if (Platform.OS !== "android") {
      return;
    }

    const showSubscription = KeyboardEvents.addListener("keyboardDidShow", () => {
      isKeyboardMovingRef.current = false;
    });

    const hideSubscription = KeyboardEvents.addListener("keyboardDidHide", () => {
      // Mark that the keyboard just hid; the next back gesture is probably
      // the IME's response to that gesture, not a separate request to close.
      isKeyboardMovingRef.current = true;
      // Clear the flag after a short delay so a subsequent back (after pause)
      // is treated as a separate gesture.
      const timer = setTimeout(() => {
        isKeyboardMovingRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return useCallback(() => {
    if (isKeyboardMovingRef.current) {
      // Keyboard just hid; don't close the modal, let this back be consumed
      // by the IME dismiss (if it happens to race the back gesture).
      isKeyboardMovingRef.current = false;
      return;
    }

    if (Platform.OS === "android" && Keyboard.isVisible?.()) {
      // Fallback for older/edge cases: if keyboard is visible, dismiss it
      Keyboard.dismiss();
      return;
    }

    // Keyboard is not visible or moving; close the modal
    onClose();
  }, [onClose]);
}
