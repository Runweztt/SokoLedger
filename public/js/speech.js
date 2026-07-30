// Wraps the Web Speech API. Safari and several mobile browsers don't
// implement it at all, so every caller must check isSupported() before
// touching the mic button rather than showing a control that silently
// does nothing.
const SokoSpeech = (() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function isSupported() {
    return Boolean(Recognition);
  }

  function createRecognizer({ onInterim, onFinal, onEnd, onError }) {
    if (!isSupported()) return null;

    const recognizer = new Recognition();
    recognizer.lang = 'en-US';
    recognizer.continuous = false;
    recognizer.interimResults = true;

    recognizer.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText && onInterim) onInterim(interimText);
      if (finalText && onFinal) onFinal(finalText.trim());
    };

    recognizer.onerror = (event) => {
      if (onError) onError(event.error);
    };

    recognizer.onend = () => {
      if (onEnd) onEnd();
    };

    return {
      start: () => recognizer.start(),
      stop: () => recognizer.stop(),
    };
  }

  return { isSupported, createRecognizer };
})();
