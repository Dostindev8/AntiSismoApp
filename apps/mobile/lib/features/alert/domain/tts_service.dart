import 'package:flutter_tts/flutter_tts.dart';

/// TTS en el dispositivo (sin red). La alerta visual nunca depende de que la voz funcione.
abstract interface class TtsService {
  Future<bool> speak(String text, {required String locale});
  Future<void> stop();
}

class FlutterTtsService implements TtsService {
  FlutterTtsService([FlutterTts? tts]) : _tts = tts ?? FlutterTts();
  final FlutterTts _tts;

  @override
  Future<bool> speak(String text, {required String locale}) async {
    try {
      await _tts.setLanguage(locale);
      await _tts.setSpeechRate(0.5);
      await _tts.setVolume(1.0);
      final r = await _tts.speak(text);
      return r == 1;
    } on Exception {
      return false;
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _tts.stop();
    } on Exception {
      // Detener la voz es best-effort: un fallo aquí no afecta a la pantalla de alerta.
    }
  }
}
