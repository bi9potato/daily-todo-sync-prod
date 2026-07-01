let activationDepth = 0;

export function beginMobilityActivation() {
  activationDepth += 1;
  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    activationDepth = Math.max(0, activationDepth - 1);
  };
}

export function isMobilityActivationInProgress() {
  return activationDepth > 0;
}
