class ProductProfile {
  static const name = String.fromEnvironment(
    'VISIONASSIST_PROFILE',
    defaultValue: 'android-pilot'
  );

  static const _requestedOcr = bool.fromEnvironment(
    'VISIONASSIST_ENABLE_OCR',
    defaultValue: false
  );

  static const _requestedVoiceCommands = bool.fromEnvironment(
    'VISIONASSIST_ENABLE_VOICE_COMMANDS',
    defaultValue: false
  );

  static const _requestedRepeat = bool.fromEnvironment(
    'VISIONASSIST_ENABLE_REPEAT',
    defaultValue: false
  );

  static const isAndroidPilot = name == 'android-pilot';
  static const isProductDevelopment = name == 'product-dev';
  static const isSupported = isAndroidPilot || isProductDevelopment;

  static const enableOcr = isProductDevelopment && _requestedOcr;
  static const enableVoiceCommands = isProductDevelopment && _requestedVoiceCommands;
  static const enableRepeat = isProductDevelopment && _requestedRepeat;
}
