import { Keyboard } from "react-native";

// Android delivers the back gesture that should collapse the soft keyboard
// to the hosting Modal as well (predictive back / OnBackInvokedCallback
// races the IME for it), so onRequestClose would tear down the dialog
// mid-typing and drop unsaved input. Swallow that close into a keyboard
// dismiss; only a back with the keyboard already hidden actually closes.
//
// The race has two orderings and we have to survive both: sometimes the back
// reaches onRequestClose while Keyboard.isVisible() still reads true, but
// often the IME has *already* processed the same back and hidden the keyboard
// first, so by the time our callback runs isVisible() is false and the guard
// used to close the card anyway. We therefore also track when the keyboard
// last hid and treat a back arriving right after that as the keyboard-dismiss
// half of the same gesture.
let keyboardVisible = false;
let keyboardHiddenAt = 0;
let listenersAttached = false;

// A back that lands within this window of the keyboard hiding is treated as
// the tail of the collapse gesture, not a request to close the dialog.
const RECENTLY_HIDDEN_MS = 450;

function ensureKeyboardListeners() {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;
  Keyboard.addListener("keyboardDidShow", () => {
    keyboardVisible = true;
  });
  Keyboard.addListener("keyboardDidHide", () => {
    keyboardVisible = false;
    keyboardHiddenAt = Date.now();
  });
}

export function closeUnlessTypingGuard(onClose: () => void) {
  ensureKeyboardListeners();
  return () => {
    if (Keyboard.isVisible() || keyboardVisible) {
      Keyboard.dismiss();
      return;
    }
    if (Date.now() - keyboardHiddenAt < RECENTLY_HIDDEN_MS) {
      // The IME already consumed this back to collapse the keyboard; don't
      // also tear down the dialog behind it.
      return;
    }
    onClose();
  };
}
