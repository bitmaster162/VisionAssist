enum VoiceCommand {
  describe,
  details,
  readText,
  repeat,
  louder,
  quieter,
  unsupported
}

VoiceCommand parseVoiceCommand(String rawText) {
  final text = rawText.toLowerCase().trim();

  if (text.contains('опиши') || text.contains('что вокруг') || text.contains('расскажи')) {
    return VoiceCommand.describe;
  }

  if (text.contains('подробнее') || text.contains('продолжай') || text.contains('детали')) {
    return VoiceCommand.details;
  }

  if (text.contains('читай') || text.contains('прочитай') || text.contains('текст')) {
    return VoiceCommand.readText;
  }

  if (text.contains('повтори') || text.contains('еще раз') || text.contains('ещё раз')) {
    return VoiceCommand.repeat;
  }

  if (text.contains('громче') || text.contains('прибавь')) {
    return VoiceCommand.louder;
  }

  if (text.contains('тише') || text.contains('убавь')) {
    return VoiceCommand.quieter;
  }

  return VoiceCommand.unsupported;
}

