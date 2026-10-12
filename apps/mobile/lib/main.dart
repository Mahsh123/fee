import 'package:flutter/material.dart';
import 'package:timezone/data/latest_all.dart' as timezone_data;

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  timezone_data.initializeTimeZones();
  runApp(const WaslMadrasaApp());
}
