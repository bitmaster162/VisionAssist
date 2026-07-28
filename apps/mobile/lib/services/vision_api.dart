import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/product_profile.dart';
import '../models/vision_models.dart';

const _defaultEdgeBaseUrl = String.fromEnvironment(
  'VISIONASSIST_EDGE_BASE_URL',
  defaultValue: 'http://127.0.0.1:8787'
);

class VisionApi {
  VisionApi({
    http.Client? client,
    String? baseUrl
  })  : _client = client ?? http.Client(),
        baseUrl = (baseUrl ?? _defaultEdgeBaseUrl).replaceAll(RegExp(r'\/+$'), '');

  final http.Client _client;
  final String baseUrl;

  Future<void> verifyProfile() async {
    final response = await _client.get(Uri.parse('$baseUrl/v1/health'));
    if (response.statusCode != 200) {
      throw Exception('Edge health check failed: ${response.statusCode}');
    }

    final health = jsonDecode(response.body) as Map<String, dynamic>;
    final edgeProfile = health['profile'] as String?;
    final capabilities = health['capabilities'] as Map<String, dynamic>? ??
        const <String, dynamic>{};
    final isExpectedPilot = ProductProfile.isAndroidPilot &&
        edgeProfile == 'android-pilot' &&
        capabilities['describe'] == true &&
        capabilities['ocr'] == false &&
        capabilities['realtime'] == false;
    final isExpectedDevelopment = ProductProfile.isProductDevelopment &&
        edgeProfile == 'product-dev';

    if (!isExpectedPilot && !isExpectedDevelopment) {
      throw StateError(
        'Profile mismatch: mobile=${ProductProfile.name}, edge=${edgeProfile ?? "unknown"}.'
      );
    }
  }

  Future<SceneDescribeResponse> describeScene(Uint8List imageBytes, {String locale = 'ru-RU'}) async {
    final stopwatch = Stopwatch()..start();
    http.Response? response;

    try {
      response = await _client.post(
        Uri.parse('$baseUrl/v1/describe'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({
          'image': base64Encode(imageBytes),
          'locale': locale
        })
      );
      stopwatch.stop();

      final requestId = response.headers['x-request-id'] ?? 'unavailable';
      if (response.statusCode < 200 || response.statusCode >= 300) {
        _logDescribePilot(
          requestId: requestId,
          latencyMs: stopwatch.elapsedMilliseconds,
          statusCode: response.statusCode,
          error: 'http_error'
        );
        throw Exception('Describe request failed: ${response.statusCode}');
      }

      final result = SceneDescribeResponse.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>
      );
      _logDescribePilot(
        requestId: requestId,
        latencyMs: stopwatch.elapsedMilliseconds,
        statusCode: response.statusCode,
        hazardsCount: result.hazards.length,
        needsHumanReview: result.needsHumanReview
      );

      return result;
    } catch (error) {
      if (stopwatch.isRunning) {
        stopwatch.stop();
      }

      if (response == null) {
        _logDescribePilot(
          requestId: 'unavailable',
          latencyMs: stopwatch.elapsedMilliseconds,
          statusCode: 0,
          error: error.runtimeType.toString()
        );
      }
      rethrow;
    }
  }

  Future<OcrResponse> recognizeText(Uint8List imageBytes, {String locale = 'ru-RU'}) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/v1/ocr'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({
        'image': base64Encode(imageBytes),
        'locale': locale
      })
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('OCR request failed: ${response.statusCode} ${response.body}');
    }

    return OcrResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  void dispose() {
    _client.close();
  }

  void _logDescribePilot({
    required String requestId,
    required int latencyMs,
    required int statusCode,
    int hazardsCount = 0,
    bool needsHumanReview = false,
    String? error
  }) {
    debugPrint(jsonEncode({
      'event': 'describe_pilot_mobile',
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'profile': ProductProfile.name,
      'request_id': requestId,
      'latency_ms': latencyMs,
      'status_code': statusCode,
      'hazards_count': hazardsCount,
      'needs_human_review': needsHumanReview,
      'error': error
    }));
  }
}
