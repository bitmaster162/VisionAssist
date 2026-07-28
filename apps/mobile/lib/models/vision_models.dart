class Hazard {
  const Hazard({
    required this.type,
    required this.confidence,
    required this.text,
    this.bearing,
    this.distanceMeters
  });

  final String type;
  final double confidence;
  final String text;
  final String? bearing;
  final double? distanceMeters;

  factory Hazard.fromJson(Map<String, dynamic> json) {
    return Hazard(
      type: json['type'] as String? ?? 'прочее',
      confidence: (json['conf'] as num?)?.toDouble() ?? 0,
      text: json['text'] as String? ?? '',
      bearing: json['bearing'] as String?,
      distanceMeters: (json['distance_m'] as num?)?.toDouble()
    );
  }
}

class SceneDescribeResponse {
  const SceneDescribeResponse({
    required this.summary,
    required this.confidence,
    required this.followUpPrompt,
    required this.needsHumanReview,
    required this.hazards,
    this.details
  });

  final String summary;
  final double confidence;
  final String followUpPrompt;
  final bool needsHumanReview;
  final String? details;
  final List<Hazard> hazards;

  factory SceneDescribeResponse.fromJson(Map<String, dynamic> json) {
    final hazardsJson = (json['hazards'] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(Hazard.fromJson)
        .toList();

    return SceneDescribeResponse(
      summary: json['summary'] as String? ?? 'Не удалось описать сцену.',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      followUpPrompt: json['follow_up_prompt'] as String? ?? 'Если нужно, скажите: подробнее.',
      needsHumanReview: json['needs_human_review'] as bool? ?? false,
      details: json['details'] as String?,
      hazards: hazardsJson
    );
  }
}

class OcrResponse {
  const OcrResponse({
    required this.text,
    required this.language
  });

  final String text;
  final String language;

  factory OcrResponse.fromJson(Map<String, dynamic> json) {
    return OcrResponse(
      text: json['text'] as String? ?? '',
      language: json['lang'] as String? ?? 'ru-RU'
    );
  }
}
