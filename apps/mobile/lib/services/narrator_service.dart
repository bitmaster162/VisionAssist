import 'dart:collection';

import 'package:flutter_tts/flutter_tts.dart';

class NarratorService {
  final FlutterTts _tts = FlutterTts();
  final Queue<String> _queue = Queue<String>();

  bool _isSpeaking = false;
  String? _lastMessage;

  String? get lastMessage => _lastMessage;

  Future<void> initialize() async {
    await _tts.awaitSpeakCompletion(true);
    await _tts.setLanguage('ru-RU');
    await _tts.setSpeechRate(0.48);

    _tts.setCompletionHandler(() {
      _isSpeaking = false;
      _pump();
    });

    _tts.setCancelHandler(() {
      _isSpeaking = false;
      _pump();
    });
  }

  Future<void> speak(String message, {bool interrupt = false}) async {
    final trimmed = message.trim();
    if (trimmed.isEmpty) {
      return;
    }

    _lastMessage = trimmed;

    if (interrupt) {
      _queue.clear();
      _isSpeaking = false;
      await _tts.stop();
    }

    _queue.add(trimmed);
    await _pump();
  }

  Future<void> repeatLast() async {
    final message = _lastMessage;
    if (message == null || message.isEmpty) {
      return;
    }

    await speak(message, interrupt: true);
  }

  Future<void> stop() async {
    _queue.clear();
    _isSpeaking = false;
    await _tts.stop();
  }

  void dispose() {
    _queue.clear();
    _isSpeaking = false;
    _tts.stop();
  }

  Future<void> _pump() async {
    if (_isSpeaking || _queue.isEmpty) {
      return;
    }

    _isSpeaking = true;
    final nextMessage = _queue.removeFirst();
    await _tts.speak(nextMessage);
  }
}
