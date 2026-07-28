import 'dart:async';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../config/product_profile.dart';
import '../../models/vision_models.dart';
import '../../services/narrator_service.dart';
import '../../services/vision_api.dart';
import '../../services/voice_command_parser.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final NarratorService _narrator = NarratorService();
  final VisionApi _visionApi = VisionApi();
  final SpeechToText _speechToText = SpeechToText();

  CameraController? _cameraController;
  SceneDescribeResponse? _lastScene;
  String _status = 'Инициализация...';
  bool _isBusy = false;
  bool _isListening = false;

  bool get _isCameraReady => _cameraController?.value.isInitialized ?? false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await _narrator.initialize();
      await _visionApi.verifyProfile();
      await _requestPermissions();
      await _initializeCamera();

      if (!mounted) {
        return;
      }

      setState(() {
        _status = ProductProfile.enableOcr
            ? 'Готово. Нажмите "Опиши" или удерживайте для чтения.'
            : 'Готово. Нажмите "Опиши".';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _status = 'Ошибка запуска: $error';
      });
    }
  }

  Future<void> _requestPermissions() async {
    final requestedPermissions = <Permission>[Permission.camera];
    if (ProductProfile.enableVoiceCommands) {
      requestedPermissions.addAll([Permission.microphone, Permission.speech]);
    }

    final statuses = await requestedPermissions.request();

    final denied = statuses.entries.where((entry) => !entry.value.isGranted).map((entry) => entry.key).toList();
    if (denied.isNotEmpty) {
      throw Exception('Не выданы обязательные разрешения: ${denied.join(", ")}');
    }
  }

  Future<void> _initializeCamera() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      throw Exception('Камера не найдена.');
    }

    final selectedCamera = cameras.firstWhere(
      (camera) => camera.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first
    );

    final controller = CameraController(
      selectedCamera,
      ResolutionPreset.medium,
      enableAudio: false
    );

    await controller.initialize();
    await controller.setFlashMode(FlashMode.auto);

    if (!mounted) {
      await controller.dispose();
      return;
    }

    setState(() {
      _cameraController = controller;
    });
  }

  Future<void> _describeScene() async {
    if (!_isCameraReady || _isBusy) {
      return;
    }

    setState(() {
      _isBusy = true;
      _status = 'Снимаю кадр и отправляю описание...';
    });

    try {
      final imageBytes = await _captureStill();
      final response = await _visionApi.describeScene(imageBytes);
      _lastScene = response;

      await _narrator.speak(response.summary, interrupt: true);

      final urgentHazards = response.hazards.where((hazard) => hazard.confidence >= 0.7).toList();
      if (urgentHazards.isNotEmpty) {
        final warningText = urgentHazards.map((hazard) => hazard.text).join('. ');
        await _narrator.speak('Внимание. $warningText', interrupt: true);
      }

      if (response.needsHumanReview) {
        await _narrator.speak(
          'Я не до конца уверен. Лучше уточнить у человека рядом, если это важно для безопасности.',
          interrupt: false
        );
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _status = '${response.summary} Уверенность: ${(response.confidence * 100).round()}%. ${response.followUpPrompt}';
      });
    } catch (error) {
      await _narrator.speak('Не удалось описать сцену. Проверьте сеть и edge.', interrupt: true);

      if (!mounted) {
        return;
      }

      setState(() {
        _status = 'Ошибка описания: $error';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isBusy = false;
        });
      }
    }
  }

  Future<void> _readText() async {
    if (!_isCameraReady || _isBusy) {
      return;
    }

    setState(() {
      _isBusy = true;
      _status = 'Считываю текст...';
    });

    try {
      final imageBytes = await _captureStill();
      final response = await _visionApi.recognizeText(imageBytes);
      final text = response.text.trim().isEmpty ? 'Текст не найден.' : response.text.trim();

      await _narrator.speak(text, interrupt: true);

      if (!mounted) {
        return;
      }

      setState(() {
        _status = text;
      });
    } catch (error) {
      await _narrator.speak('Не удалось прочитать текст. Попробуйте ещё раз.', interrupt: true);

      if (!mounted) {
        return;
      }

      setState(() {
        _status = 'Ошибка OCR: $error';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isBusy = false;
        });
      }
    }
  }

  Future<void> _handleDetailsRequest() async {
    final details = _lastScene?.details?.trim();
    if (details == null || details.isEmpty) {
      await _narrator.speak('Подробностей пока нет.', interrupt: true);
      return;
    }

    await _narrator.speak(details, interrupt: true);
  }

  Future<void> _listenForCommand() async {
    if (_isListening) {
      return;
    }

    final available = await _speechToText.initialize(
      onError: (error) {
        if (!mounted) {
          return;
        }

        setState(() {
          _status = 'Ошибка распознавания речи: ${error.errorMsg}';
          _isListening = false;
        });
      },
      onStatus: (status) {
        if (status == 'done' && mounted) {
          setState(() {
            _isListening = false;
          });
        }
      }
    );

    if (!available) {
      await _narrator.speak('Распознавание речи недоступно.', interrupt: true);
      return;
    }

    setState(() {
      _isListening = true;
      _status = 'Слушаю команду...';
    });

    await _speechToText.listen(
      localeId: 'ru_RU',
      listenFor: const Duration(seconds: 4),
      pauseFor: const Duration(seconds: 2),
      onResult: (result) async {
        if (!result.finalResult) {
          return;
        }

        await _speechToText.stop();
        final command = parseVoiceCommand(result.recognizedWords);
        await _dispatchVoiceCommand(command);
      }
    );
  }

  Future<void> _dispatchVoiceCommand(VoiceCommand command) async {
    switch (command) {
      case VoiceCommand.describe:
        await _describeScene();
        return;
      case VoiceCommand.details:
        await _handleDetailsRequest();
        return;
      case VoiceCommand.readText:
        if (!ProductProfile.enableOcr) {
          await _narrator.speak('Чтение текста не включено в этой сборке.', interrupt: true);
          return;
        }
        await _readText();
        return;
      case VoiceCommand.repeat:
        if (!ProductProfile.enableRepeat) {
          await _narrator.speak('Повтор не включён в этой сборке.', interrupt: true);
          return;
        }
        await _narrator.repeatLast();
        return;
      case VoiceCommand.louder:
        await _narrator.speak('Изменение громкости пока оставлено системе.', interrupt: true);
        return;
      case VoiceCommand.quieter:
        await _narrator.speak('Изменение громкости пока оставлено системе.', interrupt: true);
        return;
      case VoiceCommand.unsupported:
        await _narrator.speak('Команда не распознана.', interrupt: true);
        return;
    }
  }

  Future<Uint8List> _captureStill() async {
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized) {
      throw Exception('Камера ещё не готова.');
    }

    final picture = await controller.takePicture();
    return picture.readAsBytes();
  }

  @override
  void dispose() {
    unawaited(_speechToText.cancel());
    _visionApi.dispose();
    _narrator.dispose();
    unawaited(_cameraController?.dispose() ?? Future<void>.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primaryButton = SizedBox(
      height: 110,
      child: FilledButton(
        onPressed: _isBusy ? null : _describeScene,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFE3A72F),
          foregroundColor: const Color(0xFF111111),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28))
        ),
        child: Text(
          _isBusy ? 'Обработка...' : 'Опиши',
          style: theme.textTheme.titleLarge?.copyWith(
            color: const Color(0xFF111111),
            fontWeight: FontWeight.w800
          )
        )
      )
    );

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('VisionAssist', style: theme.textTheme.headlineMedium),
              const SizedBox(height: 10),
              Text(
                ProductProfile.isAndroidPilot
                    ? 'Пилот: одно действие для описания сцены голосом.'
                    : 'Одна большая кнопка для быстрого описания мира голосом.',
                style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white70)
              ),
              const SizedBox(height: 18),
              Expanded(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(28),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF232A31), Color(0xFF15181C)]
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x22000000),
                        blurRadius: 28,
                        offset: Offset(0, 14)
                      )
                    ]
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(28),
                    child: _isCameraReady
                        ? CameraPreview(_cameraController!)
                        : const Center(child: CircularProgressIndicator()),
                  )
                )
              ),
              const SizedBox(height: 18),
              _StatusCard(status: _status, isBusy: _isBusy, isListening: _isListening),
              const SizedBox(height: 18),
              Semantics(
                label: ProductProfile.enableOcr
                    ? 'Опиши сцену. Долгое удержание читает текст.'
                    : 'Опиши сцену.',
                button: true,
                child: ProductProfile.enableOcr
                    ? GestureDetector(onLongPress: _readText, child: primaryButton)
                    : primaryButton
              ),
              if (ProductProfile.enableVoiceCommands || ProductProfile.enableRepeat) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    if (ProductProfile.enableVoiceCommands)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _isListening ? null : _listenForCommand,
                          icon: const Icon(Icons.mic_rounded),
                          label: const Text('Слушать')
                        )
                      ),
                    if (ProductProfile.enableVoiceCommands && ProductProfile.enableRepeat)
                      const SizedBox(width: 12),
                    if (ProductProfile.enableRepeat)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _narrator.repeatLast(),
                          icon: const Icon(Icons.replay_rounded),
                          label: const Text('Повтори')
                        )
                      )
                  ]
                )
              ]
            ]
          )
        )
      )
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.status,
    required this.isBusy,
    required this.isListening
  });

  final String status;
  final bool isBusy;
  final bool isListening;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = isListening
        ? const Color(0xFF46C58C)
        : isBusy
            ? const Color(0xFFE3A72F)
            : const Color(0xFF84A8FF);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFF171A1D),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: accent.withOpacity(0.45))
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: accent,
                shape: BoxShape.circle
              )
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                status,
                style: theme.textTheme.bodyMedium
              )
            )
          ]
        )
      )
    );
  }
}
