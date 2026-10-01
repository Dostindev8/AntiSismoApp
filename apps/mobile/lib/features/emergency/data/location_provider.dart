import 'package:geolocator/geolocator.dart';

sealed class LocationResult {
  const LocationResult();
}

class LocationFix extends LocationResult {
  const LocationFix({required this.lat, required this.lon, required this.accuracyM});
  final double lat;
  final double lon;
  final double accuracyM;
}

class LocationDenied extends LocationResult {
  const LocationDenied();
}

class LocationUnavailable extends LocationResult {
  const LocationUnavailable();
}

/// Ubicación calculada y mostrada en el dispositivo; nunca se envía a ningún servidor.
abstract interface class LocationProvider {
  Future<LocationResult> current();
}

class GeolocatorLocationProvider implements LocationProvider {
  const GeolocatorLocationProvider({this.timeout = const Duration(seconds: 10)});

  final Duration timeout;

  bool _valid(Position p) => p.latitude.abs() <= 90 && p.longitude.abs() <= 180;

  @override
  Future<LocationResult> current() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return const LocationUnavailable();
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return const LocationDenied();
      Position? p;
      try {
        p = await Geolocator.getCurrentPosition(
          locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
        );
      } on Exception {
        p = await Geolocator.getLastKnownPosition();
      }
      if (p == null || !_valid(p)) return const LocationUnavailable();
      return LocationFix(lat: p.latitude, lon: p.longitude, accuracyM: p.accuracy);
    } on Exception {
      return const LocationUnavailable();
    }
  }
}
