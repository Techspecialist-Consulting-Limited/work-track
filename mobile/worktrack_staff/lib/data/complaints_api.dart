import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Runtime config for connecting the prototype to a WorkTrack backend.
/// Defaults keep the app in mock-only mode (no real data / production records).
class ComplaintsApiConfig {
  const ComplaintsApiConfig._();

  static const String baseUrl =
      String.fromEnvironment('WORKTRACK_API_BASE_URL', defaultValue: '');
  static const String accessToken =
      String.fromEnvironment('WORKTRACK_ACCESS_TOKEN', defaultValue: '');
  static const String role =
      String.fromEnvironment('WORKTRACK_ROLE', defaultValue: 'staff');

  static bool get isConfigured => baseUrl.trim().isNotEmpty;
}

class ComplaintsApiException implements Exception {
  ComplaintsApiException(this.message, [this.statusCode]);
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class ComplaintsApiClient {
  ComplaintsApiClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  bool get enabled => ComplaintsApiConfig.isConfigured;

  Uri _uri(String path) {
    final base = ComplaintsApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    final p = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$base$p');
  }

  Map<String, String> get _headers => {
        if (ComplaintsApiConfig.accessToken.trim().isNotEmpty)
          'Authorization': 'Bearer ${ComplaintsApiConfig.accessToken.trim()}',
        'x-worktrack-role': ComplaintsApiConfig.role.trim().isEmpty
            ? 'staff'
            : ComplaintsApiConfig.role.trim(),
      };

  Future<Map<String, dynamic>> getJson(String path) async {
    final res = await _client.get(_uri(path), headers: _headers);
    return _decode(res);
  }

  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body) async {
    final res = await _client.post(
      _uri(path),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> uploadAttachment({
    required String complaintId,
    required File file,
    required String fileName,
    String? mimeType,
  }) async {
    final req = http.MultipartRequest('POST', _uri('/api/complaints/attachments'));
    req.headers.addAll(_headers);
    req.fields['complaintId'] = complaintId;
    req.files.add(await http.MultipartFile.fromPath(
      'file',
      file.path,
      filename: fileName,
    ));
    final streamed = await _client.send(req);
    final res = await http.Response.fromStream(streamed);
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> data;
    try {
      final decoded = jsonDecode(res.body);
      data = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{'value': decoded};
    } catch (_) {
      data = <String, dynamic>{'ok': false, 'message': res.body};
    }
    if (res.statusCode >= 400 || data['ok'] == false) {
      throw ComplaintsApiException(
        (data['message'] as String?) ?? 'Request failed (${res.statusCode})',
        res.statusCode,
      );
    }
    return data;
  }
}
