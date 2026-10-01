import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/phone_number.dart';

/// Ficha de emergencia opcional (F5B): introducida por la persona, solo local, cifrada AES-256-GCM,
/// desactivada por defecto. Nunca se sube al servidor ni se registra en logs.
class MedicalCard {
  const MedicalCard({
    this.bloodType = '',
    this.allergies = '',
    this.medications = '',
    this.contactName = '',
    this.contactNumber = '',
  });

  factory MedicalCard.fromJson(Map<String, dynamic> j) => MedicalCard(
        bloodType: _field(j['blood_type'], 8),
        allergies: _field(j['allergies'], 500),
        medications: _field(j['medications'], 500),
        contactName: _field(j['contact_name'], 80),
        contactNumber: _field(j['contact_number'], 16),
      );

  final String bloodType;
  final String allergies;
  final String medications;
  final String contactName;
  final String contactNumber;

  static const maxLengths = (bloodType: 8, text: 500, contactName: 80);

  static String _field(Object? v, int max) {
    if (v is! String || v.length > max) throw const FormatException('medical card field');
    return v;
  }

  /// Contacto llamable solo si el número pasa la allowlist (QA-E1).
  String? get dialableContact => contactNumber.isEmpty ? null : normalizePhoneInput(contactNumber);

  Map<String, String> toJson() => {
        'blood_type': bloodType,
        'allergies': allergies,
        'medications': medications,
        'contact_name': contactName,
        'contact_number': contactNumber,
      };
}

/// Almacén de la clave (Keystore Android / Keychain iOS vía flutter_secure_storage).
abstract interface class KeyStore {
  Future<String?> read();
  Future<void> write(String keyB64);
  Future<void> delete();
}

/// Almacén del texto cifrado (nunca contiene datos en claro).
abstract interface class BlobStore {
  Future<String?> read();
  Future<void> write(String blob);
  Future<void> delete();
}

class SecureKeyStore implements KeyStore {
  const SecureKeyStore([this._storage = const FlutterSecureStorage()]);
  final FlutterSecureStorage _storage;
  static const _key = 'antisismo.medical_card.key.v1';

  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String keyB64) => _storage.write(key: _key, value: keyB64);
  @override
  Future<void> delete() => _storage.delete(key: _key);
}

class PrefsBlobStore implements BlobStore {
  const PrefsBlobStore(this._prefs);
  final SharedPreferences _prefs;
  static const _key = 'antisismo.medical_card.blob.v1';

  @override
  Future<String?> read() async => _prefs.getString(_key);
  @override
  Future<void> write(String blob) => _prefs.setString(_key, blob);
  @override
  Future<void> delete() => _prefs.remove(_key);
}

class VaultCorruptedException implements Exception {
  const VaultCorruptedException();
}

/// Cifrado AES-256-GCM con nonce aleatorio de 96 bits por escritura y AAD de versión.
/// Formato: base64url(0x01 ‖ nonce(12) ‖ ciphertext ‖ mac(16)).
class MedicalCardVault {
  MedicalCardVault({required this.keys, required this.blobs, Random? random}) : _random = random ?? Random.secure();

  final KeyStore keys;
  final BlobStore blobs;
  final Random _random;
  final _aes = AesGcm.with256bits();
  static const _version = 1;
  static final _aad = utf8.encode('antisismo.medical_card.v1');

  Future<SecretKey> _key({required bool create}) async {
    final stored = await keys.read();
    if (stored != null) {
      final bytes = base64Url.decode(stored);
      if (bytes.length != 32) throw const VaultCorruptedException();
      return SecretKey(bytes);
    }
    if (!create) throw const VaultCorruptedException();
    final bytes = List<int>.generate(32, (_) => _random.nextInt(256));
    await keys.write(base64Url.encode(bytes));
    return SecretKey(bytes);
  }

  Future<bool> exists() async => await blobs.read() != null;

  Future<void> save(MedicalCard card) async {
    final key = await _key(create: true);
    final nonce = List<int>.generate(12, (_) => _random.nextInt(256));
    final box = await _aes.encrypt(utf8.encode(jsonEncode(card.toJson())), secretKey: key, nonce: nonce, aad: _aad);
    final out = BytesBuilder(copy: false)
      ..addByte(_version)
      ..add(box.nonce)
      ..add(box.cipherText)
      ..add(box.mac.bytes);
    await blobs.write(base64Url.encode(out.takeBytes()));
  }

  /// `null` si no hay ficha. Lanza [VaultCorruptedException] si el blob o la clave no son válidos
  /// (manipulación, restauración parcial de backup): la UI ofrece borrar, nunca muestra datos dudosos.
  Future<MedicalCard?> load() async {
    final blob = await blobs.read();
    if (blob == null) return null;
    try {
      final b = base64Url.decode(blob);
      if (b.length < 1 + 12 + 16 || b[0] != _version) throw const VaultCorruptedException();
      final box = SecretBox(b.sublist(13, b.length - 16), nonce: b.sublist(1, 13), mac: Mac(b.sublist(b.length - 16)));
      final clear = await _aes.decrypt(box, secretKey: await _key(create: false), aad: _aad);
      final json = jsonDecode(utf8.decode(clear));
      if (json is! Map<String, dynamic>) throw const VaultCorruptedException();
      return MedicalCard.fromJson(json);
    } on VaultCorruptedException {
      rethrow;
    } on Object {
      throw const VaultCorruptedException();
    }
  }

  Future<void> delete() async {
    await blobs.delete();
    await keys.delete();
  }
}
