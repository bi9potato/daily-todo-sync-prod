// expo-speech-recognition events are global: every mounted component that
// registered useSpeechRecognitionEvent hears every session. This flag marks
// a recognition session as belonging to the voice-command overlay so the
// Composer's dictation handler leaves those transcripts alone.
let commandSessionActive = false;

export function setVoiceCommandSessionActive(active: boolean) {
  commandSessionActive = active;
}

export function isVoiceCommandSessionActive() {
  return commandSessionActive;
}
