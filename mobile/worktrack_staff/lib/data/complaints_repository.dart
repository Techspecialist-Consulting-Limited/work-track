import 'dart:io';

import '../models/complaint_models.dart';
import 'complaints_api.dart';

abstract class ComplaintsRepository {
  Future<List<ComplaintRecord>> getMyComplaints();
  Future<ComplaintRecord?> getById(String id);
  Future<ComplaintRecord> submitComplaint({
    required String subject,
    required String description,
    List<PendingComplaintAttachment> attachments = const [],
  });
  Future<void> sendStaffMessage({
    required String complaintId,
    required String body,
    List<PendingComplaintAttachment> attachments = const [],
  });
  Future<void> reopenComplaint(String complaintId, {String note = 'Reopened by staff.'});
  Future<void> acknowledgeResolved(String complaintId);
  Future<void> markRead(String complaintId);
  bool get isApiBacked;
}

class PendingComplaintAttachment {
  const PendingComplaintAttachment({
    this.file,
    this.fileName,
    this.mimeType,
    this.sizeBytes,
    this.isImage = false,
  });
  final File? file;
  final String? fileName;
  final String? mimeType;
  final int? sizeBytes;
  final bool isImage;
}

ComplaintsRepository createComplaintsRepository() {
  if (ComplaintsApiConfig.isConfigured) {
    return ApiComplaintsRepository(ComplaintsApiClient());
  }
  return MockComplaintsRepository.instance;
}

class MockComplaintsRepository implements ComplaintsRepository {
  MockComplaintsRepository._() {
    _seed();
  }

  static final MockComplaintsRepository instance = MockComplaintsRepository._();

  final String staffName = 'Sarah Namatovu';
  final String staffEmployeeCode = 'EMP-1001';

  final List<ComplaintRecord> _complaints = [];
  int _seq = 100;

  @override
  bool get isApiBacked => false;

  @override
  Future<List<ComplaintRecord>> getMyComplaints() async {
    final copy = List<ComplaintRecord>.from(_complaints);
    copy.sort((a, b) => b.lastMessageAt.compareTo(a.lastMessageAt));
    return copy;
  }

  @override
  Future<ComplaintRecord?> getById(String id) async {
    for (final c in _complaints) {
      if (c.id == id) return c;
    }
    return null;
  }

  @override
  Future<ComplaintRecord> submitComplaint({
    required String subject,
    required String description,
    List<PendingComplaintAttachment> attachments = const [],
  }) async {
    _seq += 1;
    final now = DateTime.now();
    final ref = 'WT-${_seq.toString().padLeft(4, '0')}';
    final mockAtts = attachments.asMap().entries.map((e) {
      final a = e.value;
      return ComplaintAttachment(
        id: 'local-att-${now.microsecondsSinceEpoch}-${e.key}',
        fileName: a.fileName ?? (a.isImage ? 'photo.jpg' : 'document.pdf'),
        mimeType: a.mimeType ?? (a.isImage ? 'image/jpeg' : 'application/pdf'),
        sizeBytes: a.sizeBytes ?? 0,
        isImage: a.isImage,
      );
    }).toList();
    final message = ComplaintMessage(
      id: 'msg-$_seq-1',
      senderType: SenderType.staff,
      senderName: staffName,
      senderRole: 'Staff',
      body: description.trim(),
      createdAt: now,
      attachments: mockAtts,
    );
    final record = ComplaintRecord(
      id: 'cmp-$_seq',
      reference: ref,
      subject: subject.trim(),
      description: description.trim(),
      submittedAt: now,
      lastMessageAt: now,
      status: ComplaintStatus.newStatus,
      messages: [message],
      statusHistory: [
        StatusHistoryEntry(
          id: 'sh-$_seq-1',
          fromStatus: null,
          toStatus: ComplaintStatus.newStatus,
          changedAt: now,
          changedByName: 'System',
          changedByRole: 'System',
        ),
      ],
    );
    _complaints.insert(0, record);
    return record;
  }

  @override
  Future<void> sendStaffMessage({
    required String complaintId,
    required String body,
    List<PendingComplaintAttachment> attachments = const [],
  }) async {
    final idx = _complaints.indexWhere((c) => c.id == complaintId);
    if (idx < 0) return;
    final now = DateTime.now();
    _seq += 1;
    final mockAtts = attachments.asMap().entries.map((e) {
      final a = e.value;
      return ComplaintAttachment(
        id: 'reply-att-${now.microsecondsSinceEpoch}-${e.key}',
        fileName: a.fileName ?? (a.isImage ? 'evidence.jpg' : 'evidence.pdf'),
        mimeType: a.mimeType ?? (a.isImage ? 'image/jpeg' : 'application/pdf'),
        sizeBytes: a.sizeBytes ?? 0,
        isImage: a.isImage,
      );
    }).toList();
    final msg = ComplaintMessage(
      id: 'msg-$_seq',
      senderType: SenderType.staff,
      senderName: staffName,
      senderRole: 'Staff',
      body: body.trim().isEmpty ? 'Shared attachments.' : body.trim(),
      createdAt: now,
      attachments: mockAtts,
    );
    final c = _complaints[idx];
    _complaints[idx] = c.copyWith(
      lastMessageAt: now,
      messages: [...c.messages, msg],
      unreadByStaff: false,
    );
  }

  @override
  Future<void> reopenComplaint(String complaintId, {String note = 'Reopened by staff.'}) async {
    _changeStatus(complaintId, ComplaintStatus.reopened, byStaff: true, note: note);
  }

  @override
  Future<void> acknowledgeResolved(String complaintId) async {
    final idx = _complaints.indexWhere((c) => c.id == complaintId);
    if (idx < 0) return;
    _complaints[idx] = _complaints[idx].copyWith(unreadByStaff: false);
  }

  @override
  Future<void> markRead(String complaintId) async {
    final idx = _complaints.indexWhere((c) => c.id == complaintId);
    if (idx < 0) return;
    _complaints[idx] = _complaints[idx].copyWith(unreadByStaff: false);
  }

  void simulateManagementReply(String complaintId, String body) {
    final idx = _complaints.indexWhere((c) => c.id == complaintId);
    if (idx < 0) return;
    final now = DateTime.now();
    _seq += 1;
    final msg = ComplaintMessage(
      id: 'msg-$_seq',
      senderType: SenderType.management,
      senderName: 'HR Desk',
      senderRole: 'HR',
      body: body,
      createdAt: now,
    );
    final c = _complaints[idx];
    _complaints[idx] = c.copyWith(
      lastMessageAt: now,
      messages: [...c.messages, msg],
      unreadByStaff: true,
      status: c.status == ComplaintStatus.newStatus ? ComplaintStatus.inProgress : c.status,
    );
  }

  void _changeStatus(
    String complaintId,
    ComplaintStatus to, {
    required bool byStaff,
    String? note,
  }) {
    final idx = _complaints.indexWhere((c) => c.id == complaintId);
    if (idx < 0) return;
    final c = _complaints[idx];
    if (c.status == to) return;
    final now = DateTime.now();
    _seq += 1;
    final history = StatusHistoryEntry(
      id: 'sh-$_seq',
      fromStatus: c.status,
      toStatus: to,
      changedAt: now,
      changedByName: byStaff ? staffName : 'Management',
      changedByRole: byStaff ? 'Staff' : 'HR',
      note: note,
    );
    final sys = ComplaintMessage(
      id: 'msg-$_seq-sys',
      senderType: SenderType.system,
      senderName: 'WorkTrack',
      body: 'Status changed from ${c.status.label} to ${to.label}.',
      createdAt: now,
      isStatusChange: true,
    );
    _complaints[idx] = c.copyWith(
      status: to,
      lastMessageAt: now,
      statusHistory: [...c.statusHistory, history],
      messages: [...c.messages, sys],
      unreadByStaff: false,
    );
  }

  void _seed() {
    final now = DateTime.now();
    _complaints.addAll([
      ComplaintRecord(
        id: 'cmp-seed-1',
        reference: 'WT-0001',
        subject: 'Laptop overheating during client calls',
        description:
            'My assigned laptop has been overheating and shutting down during afternoon calls.',
        submittedAt: now.subtract(const Duration(days: 2)),
        lastMessageAt: now.subtract(const Duration(minutes: 45)),
        status: ComplaintStatus.awaitingStaff,
        unreadByStaff: true,
        messages: [
          ComplaintMessage(
            id: 'm1',
            senderType: SenderType.staff,
            senderName: staffName,
            senderRole: 'Staff',
            body:
                'My assigned laptop has been overheating and shutting down during afternoon calls.',
            createdAt: now.subtract(const Duration(days: 2)),
            attachments: const [
              ComplaintAttachment(
                id: 'a1',
                fileName: 'device-temperature.jpg',
                mimeType: 'image/jpeg',
                sizeBytes: 284120,
                isImage: true,
              ),
            ],
          ),
          ComplaintMessage(
            id: 'm2',
            senderType: SenderType.management,
            senderName: 'Ruth Akello',
            senderRole: 'HR',
            body:
                'We have received your complaint and are investigating the issue. Could you share the asset tag?',
            createdAt: now.subtract(const Duration(days: 1, hours: 20)),
          ),
          ComplaintMessage(
            id: 'm3',
            senderType: SenderType.management,
            senderName: 'Ruth Akello',
            senderRole: 'HR',
            body: 'A temporary replacement device is available at reception if needed.',
            createdAt: now.subtract(const Duration(minutes: 45)),
            attachments: const [
              ComplaintAttachment(
                id: 'a2',
                fileName: 'replacement-device-form.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 96402,
                isImage: false,
              ),
            ],
          ),
        ],
        statusHistory: [
          StatusHistoryEntry(
            id: 'h1',
            fromStatus: null,
            toStatus: ComplaintStatus.newStatus,
            changedAt: now.subtract(const Duration(days: 2)),
            changedByName: 'System',
            changedByRole: 'System',
          ),
          StatusHistoryEntry(
            id: 'h2',
            fromStatus: ComplaintStatus.newStatus,
            toStatus: ComplaintStatus.awaitingStaff,
            changedAt: now.subtract(const Duration(days: 1, hours: 20)),
            changedByName: 'Ruth Akello',
            changedByRole: 'HR',
            note: 'Requested asset tag.',
          ),
        ],
      ),
    ]);
  }
}

class ApiComplaintsRepository implements ComplaintsRepository {
  ApiComplaintsRepository(this._api);
  final ComplaintsApiClient _api;

  @override
  bool get isApiBacked => true;

  @override
  Future<List<ComplaintRecord>> getMyComplaints() async {
    final data = await _api.getJson('/api/complaints');
    final list = (data['complaints'] as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(ComplaintRecord.fromApi).toList();
  }

  @override
  Future<ComplaintRecord?> getById(String id) async {
    final data = await _api.getJson('/api/complaints/$id');
    final c = data['complaint'];
    if (c is Map<String, dynamic>) return ComplaintRecord.fromApi(c);
    return null;
  }

  Future<List<String>> _uploadAll(String complaintId, List<PendingComplaintAttachment> attachments) async {
    final ids = <String>[];
    for (final a in attachments) {
      if (a.file == null) continue;
      final res = await _api.uploadAttachment(
        complaintId: complaintId,
        file: a.file!,
        fileName: a.fileName ?? a.file!.path.split(Platform.pathSeparator).last,
        mimeType: a.mimeType,
      );
      final att = res['attachment'];
      if (att is Map<String, dynamic> && att['id'] != null) ids.add(att['id'].toString());
    }
    return ids;
  }

  @override
  Future<ComplaintRecord> submitComplaint({
    required String subject,
    required String description,
    List<PendingComplaintAttachment> attachments = const [],
  }) async {
    // Create first to get a complaint id, then upload+send? Server create supports attachmentIds only if already uploaded & pending linked to complaint.
    // So: create without attachments, upload attachments to that complaint, then send a follow-up message linking them? Or simpler: upload requires complaintId and creates pending linked to complaint.
    final created = await _api.postJson('/api/complaints', {
      'subject': subject.trim(),
      'description': description.trim(),
      'attachmentIds': <String>[],
    });
    final complaintId = (created['complaintId'] ?? '').toString();
    if (attachments.isNotEmpty && complaintId.isNotEmpty) {
      final ids = await _uploadAll(complaintId, attachments);
      if (ids.isNotEmpty) {
        // link as a follow-up staff message carrying those attachments (keeps initial description intact)
        await _api.postJson('/api/complaints/$complaintId', {
          'type': 'reply',
          'body': 'Shared supporting attachments.',
          'attachmentIds': ids,
        });
      }
    }
    final rec = await getById(complaintId);
    if (rec != null) return rec;
    // fallback minimal
    final now = DateTime.now();
    return ComplaintRecord(
      id: complaintId,
      reference: (created['reference'] ?? '').toString(),
      subject: subject.trim(),
      description: description.trim(),
      submittedAt: now,
      lastMessageAt: now,
      status: ComplaintStatus.newStatus,
      messages: const [],
      statusHistory: const [],
    );
  }

  @override
  Future<void> sendStaffMessage({
    required String complaintId,
    required String body,
    List<PendingComplaintAttachment> attachments = const [],
  }) async {
    final ids = await _uploadAll(complaintId, attachments);
    await _api.postJson('/api/complaints/$complaintId', {
      'type': 'reply',
      'body': body.trim(),
      'attachmentIds': ids,
    });
  }

  @override
  Future<void> reopenComplaint(String complaintId, {String note = 'Reopened by staff.'}) async {
    final trimmedNote = note.trim();
    // Backend requires type=reopen and a reason of at least 5 characters.
    final reason = trimmedNote.length >= 5 ? trimmedNote : 'Reopened by staff.';
    await _api.postJson('/api/complaints/$complaintId', {
      'type': 'reopen',
      'reason': reason,
    });
  }

  @override
  Future<void> acknowledgeResolved(String complaintId) async {
    await _api.postJson('/api/complaints/$complaintId', {'type': 'markRead'});
  }

  @override
  Future<void> markRead(String complaintId) async {
    await _api.postJson('/api/complaints/$complaintId', {'type': 'markRead'});
  }
}
