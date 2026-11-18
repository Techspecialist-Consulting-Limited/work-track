enum ComplaintStatus {
  newStatus('New', 'new'),
  inProgress('In Progress', 'in_progress'),
  awaitingStaff('Awaiting Staff', 'awaiting_staff'),
  resolved('Resolved', 'resolved'),
  reopened('Reopened', 'reopened');

  const ComplaintStatus(this.label, this.apiValue);
  final String label;
  final String apiValue;

  static ComplaintStatus fromApi(String? value) {
    for (final s in ComplaintStatus.values) {
      if (s.apiValue == value) return s;
    }
    return ComplaintStatus.newStatus;
  }
}

enum SenderType { staff, management, system }

SenderType senderTypeFromApi(String? value) {
  switch (value) {
    case 'management':
      return SenderType.management;
    case 'system':
      return SenderType.system;
    case 'staff':
    default:
      return SenderType.staff;
  }
}

class ComplaintAttachment {
  const ComplaintAttachment({
    required this.id,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
    required this.isImage,
    this.downloadPath,
  });

  final String id;
  final String fileName;
  final String mimeType;
  final int sizeBytes;
  final bool isImage;
  /// When backed by the shared API, a relative path like
  /// `/api/complaints/attachments/<id>` that requires authorised access.
  final String? downloadPath;

  factory ComplaintAttachment.fromApi(Map<String, dynamic> json) {
    final id = (json['id'] ?? '').toString();
    final mime = (json['mimeType'] ?? '').toString();
    final isImage = (json['kind'] == 'image') || mime.startsWith('image/');
    return ComplaintAttachment(
      id: id,
      fileName: (json['fileName'] ?? 'Attachment').toString(),
      mimeType: mime,
      sizeBytes: (json['sizeBytes'] is num) ? (json['sizeBytes'] as num).toInt() : 0,
      isImage: isImage,
      downloadPath: id.isEmpty ? null : '/api/complaints/attachments/$id',
    );
  }
}

class ComplaintMessage {
  const ComplaintMessage({
    required this.id,
    required this.senderType,
    required this.senderName,
    this.senderRole,
    required this.body,
    required this.createdAt,
    this.attachments = const [],
    this.isStatusChange = false,
  });

  final String id;
  final SenderType senderType;
  final String senderName;
  final String? senderRole;
  final String body;
  final DateTime createdAt;
  final List<ComplaintAttachment> attachments;
  final bool isStatusChange;

  factory ComplaintMessage.fromApi(Map<String, dynamic> json) {
    final meta = json['meta'] is Map<String, dynamic> ? json['meta'] as Map<String, dynamic> : null;
    final atts = (json['attachments'] as List?) ?? const [];
    final senderType = senderTypeFromApi(json['senderType'] as String?);
    return ComplaintMessage(
      id: (json['id'] ?? '').toString(),
      senderType: senderType,
      senderName: (json['senderName'] ?? 'WorkTrack').toString(),
      senderRole: json['senderRole'] as String?,
      body: (json['body'] ?? '').toString(),
      createdAt: DateTime.tryParse((json['createdAt'] ?? '').toString()) ?? DateTime.now(),
      attachments: atts
          .whereType<Map<String, dynamic>>()
          .map(ComplaintAttachment.fromApi)
          .toList(),
      isStatusChange: senderType == SenderType.system || meta?['type'] == 'status_change',
    );
  }
}

class StatusHistoryEntry {
  const StatusHistoryEntry({
    required this.id,
    required this.fromStatus,
    required this.toStatus,
    required this.changedAt,
    required this.changedByName,
    required this.changedByRole,
    this.note,
  });

  final String id;
  final ComplaintStatus? fromStatus;
  final ComplaintStatus toStatus;
  final DateTime changedAt;
  final String changedByName;
  final String changedByRole;
  final String? note;

  factory StatusHistoryEntry.fromApi(Map<String, dynamic> json) {
    return StatusHistoryEntry(
      id: (json['id'] ?? '').toString(),
      fromStatus: json['fromStatus'] == null
          ? null
          : ComplaintStatus.fromApi(json['fromStatus'] as String?),
      toStatus: ComplaintStatus.fromApi(json['toStatus'] as String?),
      changedAt: DateTime.tryParse((json['changedAt'] ?? '').toString()) ?? DateTime.now(),
      changedByName: (json['changedByName'] ?? 'System').toString(),
      changedByRole: (json['changedByRole'] ?? 'System').toString(),
      note: json['note'] as String?,
    );
  }
}

class ComplaintRecord {
  const ComplaintRecord({
    required this.id,
    required this.reference,
    required this.subject,
    required this.description,
    required this.submittedAt,
    required this.lastMessageAt,
    required this.status,
    required this.messages,
    required this.statusHistory,
    this.unreadByStaff = false,
  });

  final String id;
  final String reference;
  final String subject;
  final String description;
  final DateTime submittedAt;
  final DateTime lastMessageAt;
  final ComplaintStatus status;
  final List<ComplaintMessage> messages;
  final List<StatusHistoryEntry> statusHistory;
  final bool unreadByStaff;

  ComplaintRecord copyWith({
    ComplaintStatus? status,
    DateTime? lastMessageAt,
    List<ComplaintMessage>? messages,
    List<StatusHistoryEntry>? statusHistory,
    bool? unreadByStaff,
  }) {
    return ComplaintRecord(
      id: id,
      reference: reference,
      subject: subject,
      description: description,
      submittedAt: submittedAt,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
      status: status ?? this.status,
      messages: messages ?? this.messages,
      statusHistory: statusHistory ?? this.statusHistory,
      unreadByStaff: unreadByStaff ?? this.unreadByStaff,
    );
  }

  factory ComplaintRecord.fromApi(Map<String, dynamic> json) {
    final messages = (json['messages'] as List?) ?? const [];
    final history = (json['statusHistory'] as List?) ?? const [];
    return ComplaintRecord(
      id: (json['id'] ?? '').toString(),
      reference: (json['reference'] ?? '').toString(),
      subject: (json['subject'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      submittedAt: DateTime.tryParse((json['submittedAt'] ?? '').toString()) ?? DateTime.now(),
      lastMessageAt: DateTime.tryParse((json['lastMessageAt'] ?? '').toString()) ?? DateTime.now(),
      status: ComplaintStatus.fromApi(json['status'] as String?),
      unreadByStaff: json['unreadByStaff'] == true,
      messages: messages.whereType<Map<String, dynamic>>().map(ComplaintMessage.fromApi).toList(),
      statusHistory: history.whereType<Map<String, dynamic>>().map(StatusHistoryEntry.fromApi).toList(),
    );
  }
}
