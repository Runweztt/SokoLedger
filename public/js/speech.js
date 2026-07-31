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

  // Separate from the recognizer above on purpose: SpeechRecognition never
  // exposes raw audio, so the only way to draw a real waveform (not a fake
  // canned animation) is a second, silent getUserMedia stream feeding an
  // AnalyserNode. Same-origin mic permission is shared, so this doesn't
  // prompt the user twice.
  function createVisualizer({ onLevel }) {
    let audioCtx = null;
    let stream = null;
    let raf = null;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        onLevel(Math.min(1, (sum / data.length / 255) * 3.2));
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
      stream = null;
      audioCtx = null;
    }

    return { start, stop };
  }

  return { isSupported, createRecognizer, createVisualizer };
})();
