import { Keyboard } from "react-native";

// Android delivers the back gesture that should collapse the soft keyboard
// to the hosting Modal as well (predictive back / OnBackInvokedCallback
// races the IME for it), so onRequestClose would tear down the dialog
// mid-typing and drop unsaved input. Swallow that close into a keyboard
// dismiss; only a back with the keyboard already hidden actually closes.
export function closeUnlessTypingGuard(onClose: () => void) {
  return () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };
}
