import { useCallback, useEffect, useRef } from "react";
import { Keyboard, Platform } from "react-native";

// Guard for Modal onRequestClose that survives the Android IME + back gesture
// race condition.
//
// History: this originally listened to react-native-keyboard-controller's
// KeyboardEvents, but that library only emits after its KeyboardProvider is
// mounted at the app root — which this app never does (mounting it takes over
// window inset animation app-wide and risks layout regressions). Every
// listener was silently dead, the guard never armed, and dismissing the IME
// with the back gesture closed the whole editor. React Native core's Keyboard
// events fire unconditionally on Android, so the guard is built on those.
//
// Usage: bind this to Modal.onRequestClose.
//   const guard = useBackPressKeyboardGuard(onClose);
//   <Modal onRequestClose={guard} />
//
// Logic when the back gesture arrives:
// - If the keyboard is (or just was) visible, this back press belongs to the
//   IME: dismiss it if still up and consume the event (don't close the Modal)
// - Otherwise, close the Modal
//
// Android core has no keyboardWillHide (iOS-only), so the post-hide grace
// window uses a fixed duration generous enough to cover the IME hide
// animation plus the predictive-back tail on slow devices.
const CLOSE_SUPPRESSION_MS = 800;

export function useBackPressKeyboardGuard(onClose: () => void) {
  const keyboardVisibleRef = useRef(
    Platform.OS === "android" && Boolean(Keyboard.isVisible?.()),
  );
  const suppressCloseUntilRef = useRef(0);

  useEffect(() => {
    // On Android only (iOS doesn't have this race condition)
    if (Platform.OS !== "android") {
      return;
    }

    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
      suppressCloseUntilRef.current = 0;
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
      // The back press that hid the IME can dispatch Modal.onRequestClose
      // either before or after this event lands; cover the "after" side.
      suppressCloseUntilRef.current = Date.now() + CLOSE_SUPPRESSION_MS;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return useCallback(() => {
    if (Platform.OS === "android") {
      if (keyboardVisibleRef.current || Boolean(Keyboard.isVisible?.())) {
        Keyboard.dismiss();
        return;
      }
      if (Date.now() <= suppressCloseUntilRef.current) {
        // Same back gesture that just hid the IME - consume it without
        // closing the editor.
        suppressCloseUntilRef.current = 0;
        return;
      }
    }
    onClose();
  }, [onClose]);
}
