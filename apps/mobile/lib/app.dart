import 'package:flutter/material.dart';

import 'features/home/home_screen.dart';

class VisionAssistApp extends StatelessWidget {
  const VisionAssistApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFFE3A72F);
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark
    ).copyWith(
      surface: const Color(0xFF171A1D)
    );

    return MaterialApp(
      title: 'VisionAssist',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFF101214),
        textTheme: const TextTheme(
          headlineMedium: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, height: 1.15),
          titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          bodyLarge: TextStyle(fontSize: 18, height: 1.35),
          bodyMedium: TextStyle(fontSize: 16, height: 1.4)
        )
      ),
      home: const HomeScreen()
    );
  }
}
