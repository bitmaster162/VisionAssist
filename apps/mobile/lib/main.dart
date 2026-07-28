import 'package:flutter/widgets.dart';

import 'app.dart';
import 'config/product_profile.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (!ProductProfile.isSupported) {
    throw UnsupportedError(
      'Unsupported VISIONASSIST_PROFILE "${ProductProfile.name}". '
      'Expected android-pilot or product-dev.'
    );
  }

  runApp(const VisionAssistApp());
}
