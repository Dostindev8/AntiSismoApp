/// Contacto oficial de emergencia verificado (fuente: data/emergency_contacts/{region}.json).
class EmergencyContact {
  const EmergencyContact({
    required this.region,
    required this.service,
    required this.number,
    required this.sourceUrl,
    required this.sourceName,
    required this.verifiedAt,
    required this.version,
  });

  final String region;
  final String service;
  final String number;
  final String sourceUrl;
  final String sourceName;
  final String verifiedAt;
  final int version;
}
