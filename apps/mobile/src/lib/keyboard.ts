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
  const keyboardWasVisibleRef = useRef(
    Platform.OS === "android" && Boolean(Keyboard.isVisible?.()),
  );
  const isKeyboardHidingRef = useRef(false);
  const suppressCloseUntilRef = useRef(0);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // On Android only (iOS doesn't have this race condition)
    if (Platform.OS !== "android") {
      return;
    }

    const clearSuppressionTimer = () => {
      if (suppressTimerRef.current) {
        clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
    };
    const armCloseSuppression = (duration = 600) => {
      clearSuppressionTimer();
      suppressCloseUntilRef.current = Date.now() + duration;
      suppressTimerRef.current = setTimeout(() => {
        suppressCloseUntilRef.current = 0;
        suppressTimerRef.current = null;
      }, duration);
    };

    const willShowSubscription = KeyboardEvents.addListener("keyboardWillShow", () => {
      clearSuppressionTimer();
      keyboardWasVisibleRef.current = true;
      isKeyboardHidingRef.current = false;
      suppressCloseUntilRef.current = 0;
    });
    const didShowSubscription = KeyboardEvents.addListener("keyboardDidShow", () => {
      keyboardWasVisibleRef.current = true;
      isKeyboardHidingRef.current = false;
    });

    const willHideSubscription = KeyboardEvents.addListener("keyboardWillHide", (event) => {
      // Android can dispatch Modal.onRequestClose at either edge of the IME
      // animation. Keep the last known visible state until keyboardDidHide,
      // and cover the tail of predictive-back animations as well.
      isKeyboardHidingRef.current = true;
      armCloseSuppression(Math.max(600, event.duration + 250));
    });
    const didHideSubscription = KeyboardEvents.addListener("keyboardDidHide", (event) => {
      keyboardWasVisibleRef.current = false;
      isKeyboardHidingRef.current = false;
      armCloseSuppression(Math.max(600, event.duration + 250));
    });

    return () => {
      clearSuppressionTimer();
      willShowSubscription.remove();
      didShowSubscription.remove();
      willHideSubscription.remove();
      didHideSubscription.remove();
    };
  }, []);

  return useCallback(() => {
    if (Platform.OS === "android") {
      const keyboardIsVisible =
        keyboardWasVisibleRef.current || Boolean(Keyboard.isVisible?.());
      if (keyboardIsVisible) {
        Keyboard.dismiss();
        return;
      }
      if (
        isKeyboardHidingRef.current ||
        Date.now() <= suppressCloseUntilRef.current
      ) {
        // This request belongs to the same Android back gesture that just
        // hid the IME. Consume it without dismissing the task editor.
        isKeyboardHidingRef.current = false;
        suppressCloseUntilRef.current = 0;
        if (suppressTimerRef.current) {
          clearTimeout(suppressTimerRef.current);
          suppressTimerRef.current = null;
        }
        return;
      }
    }

    if (Platform.OS === "android" && Keyboard.isVisible?.()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  }, [onClose]);
}
