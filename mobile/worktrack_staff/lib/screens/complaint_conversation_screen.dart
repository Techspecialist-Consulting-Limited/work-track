import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../data/complaints_api.dart';
import '../data/complaints_repository.dart';
import '../models/complaint_models.dart';

class ComplaintConversationScreen extends StatefulWidget {
  const ComplaintConversationScreen({super.key, required this.complaintId, required this.repository});
  final String complaintId;
  final ComplaintsRepository repository;

  @override
  State<ComplaintConversationScreen> createState() => _ComplaintConversationScreenState();
}

class _ComplaintConversationScreenState extends State<ComplaintConversationScreen> {
  final _reply = TextEditingController();
  final List<PendingComplaintAttachment> _pendingAttachments = [];
  bool _sending = false;
  bool _loading = true;
  String? _error;
  ComplaintRecord? _complaint;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.repository.isApiBacked) {
      // Keep the shared conversation fresh while staff wait for management replies.
      _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load(silent: true));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final c = await widget.repository.getById(widget.complaintId);
      if (mounted) setState(() => _complaint = c);
    } catch (e) {
      if (mounted && !silent) setState(() => _error = e.toString());
    } finally {
      if (mounted && !silent) setState(() => _loading = false);
    }
  }

  Future<void> _pick({required bool imageOnly}) async {
    if (!widget.repository.isApiBacked) {
      setState(() {
        _pendingAttachments.add(PendingComplaintAttachment(
          fileName: imageOnly ? 'evidence_${_pendingAttachments.length + 1}.jpg' : 'evidence_${_pendingAttachments.length + 1}.pdf',
          mimeType: imageOnly ? 'image/jpeg' : 'application/pdf',
          sizeBytes: imageOnly ? 180000 : 99000,
          isImage: imageOnly,
        ));
      });
      return;
    }
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: imageOnly ? FileType.image : FileType.custom,
      allowedExtensions: imageOnly ? null : ['pdf', 'doc', 'docx', 'txt', 'xlsx', 'xls', 'csv', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'webp'],
      withData: false,
    );
    if (result == null) return;
    setState(() {
      for (final f in result.files) {
        if (f.path == null) continue;
        final name = f.name;
        final ext = name.split('.').last.toLowerCase();
        final isImage = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) || imageOnly;
        _pendingAttachments.add(PendingComplaintAttachment(file: File(f.path!), fileName: name, sizeBytes: f.size, isImage: isImage));
      }
    });
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty && _pendingAttachments.isEmpty) return;
    setState(() => _sending = true);
    try {
      await widget.repository.sendStaffMessage(
        complaintId: widget.complaintId,
        body: text,
        attachments: List.unmodifiable(_pendingAttachments),
      );
      _reply.clear();
      setState(() => _pendingAttachments.clear());
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not send: $e')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _complaint == null) {
      return Scaffold(appBar: AppBar(title: const Text('Complaint')), body: const Center(child: CircularProgressIndicator()));
    }
    if (_error != null && _complaint == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Complaint')),
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!), const SizedBox(height: 12), FilledButton(onPressed: _load, child: const Text('Retry'))]))),
      );
    }
    final complaint = _complaint;
    if (complaint == null) {
      return Scaffold(appBar: AppBar(title: const Text('Complaint')), body: const Center(child: Text('Complaint not found.')));
    }

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(complaint.reference, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            Text(complaint.status.label, style: const TextStyle(fontSize: 12)),
          ],
        ),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'Refresh conversation'),
          if (!widget.repository.isApiBacked)
            IconButton(
              tooltip: 'Simulate management reply (prototype)',
              icon: const Icon(Icons.mark_chat_unread_outlined),
              onPressed: () {
                (widget.repository as MockComplaintsRepository).simulateManagementReply(
                  complaint.id,
                  'This is a simulated management reply appearing in the same conversation.',
                );
                _load();
              },
            ),
        ],
      ),
      body: Column(
        children: [
          _Header(complaint: complaint, apiBacked: widget.repository.isApiBacked),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                itemCount: complaint.messages.length,
                itemBuilder: (context, i) => _MessageBubble(message: complaint.messages[i]),
              ),
            ),
          ),
          if (complaint.status == ComplaintStatus.resolved)
            _ResolvedActions(
              onAcknowledge: () async { await widget.repository.acknowledgeResolved(complaint.id); await _load(); },
              onReopen: () async { await widget.repository.reopenComplaint(complaint.id); await _load(); },
            ),
          _Composer(
            controller: _reply,
            pending: _pendingAttachments,
            sending: _sending,
            onAddImage: () => _pick(imageOnly: true),
            onAddDocument: () => _pick(imageOnly: false),
            onRemove: (i) => setState(() => _pendingAttachments.removeAt(i)),
            onSend: _send,
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.complaint, required this.apiBacked});
  final ComplaintRecord complaint;
  final bool apiBacked;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLowest,
        border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(complaint.subject, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('Submitted ${_fmt(complaint.submittedAt)}', style: theme.textTheme.bodySmall),
          const SizedBox(height: 4),
          Text(
            apiBacked
                ? 'Connected to the shared WorkTrack conversation. Replies and status updates stay in sync with web admin.'
                : 'Prototype: you only see your own complaints. Replies from management appear in this same conversation.',
            style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});
  final ComplaintMessage message;

  @override
  Widget build(BuildContext context) {
    if (message.senderType == SenderType.system) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(999)),
            child: Text('${message.body} · ${_fmt(message.createdAt)}', textAlign: TextAlign.center, style: Theme.of(context).textTheme.labelSmall),
          ),
        ),
      );
    }
    final mine = message.senderType == SenderType.staff;
    final theme = Theme.of(context);
    final bg = mine ? theme.colorScheme.primaryContainer : theme.colorScheme.surface;
    final align = mine ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(
        crossAxisAlignment: align,
        children: [
          Container(
            constraints: const BoxConstraints(maxWidth: 320),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(16),
              border: mine ? null : Border.all(color: theme.colorScheme.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${mine ? "You" : "Management"} · ${message.senderName}${message.senderRole != null ? " (${message.senderRole})" : ""}',
                  style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(message.body, style: theme.textTheme.bodyMedium),
                if (message.attachments.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ...message.attachments.map((a) => _AttachmentTile(att: a)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 2),
          Text(_fmt(message.createdAt), style: theme.textTheme.labelSmall),
        ],
      ),
    );
  }
}

class _AttachmentTile extends StatelessWidget {
  const _AttachmentTile({required this.att});
  final ComplaintAttachment att;

  @override
  Widget build(BuildContext context) {
    final configured = ComplaintsApiConfig.isConfigured;
    final url = (configured && att.downloadPath != null)
        ? '${ComplaintsApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '')}${att.downloadPath}'
        : null;
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(att.isImage ? Icons.image_outlined : Icons.description_outlined, size: 18),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(att.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                Text(
                  '${att.isImage ? "Image" : "Document"} · ${(att.sizeBytes / 1024).toStringAsFixed(1)} KB${url != null ? " · authorised link" : ""}',
                  style: const TextStyle(fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          const Icon(Icons.lock_outline, size: 14, semanticLabel: 'Private, authorised access'),
        ],
      ),
    );
  }
}

class _ResolvedActions extends StatelessWidget {
  const _ResolvedActions({required this.onAcknowledge, required this.onReopen});
  final VoidCallback onAcknowledge;
  final VoidCallback onReopen;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLowest,
        border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
      ),
      child: Row(
        children: [
          Expanded(child: OutlinedButton.icon(onPressed: onAcknowledge, icon: const Icon(Icons.check_circle_outline), label: const Text('Acknowledge'))),
          const SizedBox(width: 8),
          Expanded(child: FilledButton.tonalIcon(onPressed: onReopen, icon: const Icon(Icons.refresh), label: const Text('Reopen'))),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.pending,
    required this.sending,
    required this.onAddImage,
    required this.onAddDocument,
    required this.onRemove,
    required this.onSend,
  });

  final TextEditingController controller;
  final List<PendingComplaintAttachment> pending;
  final bool sending;
  final VoidCallback onAddImage;
  final VoidCallback onAddDocument;
  final void Function(int) onRemove;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (pending.isNotEmpty)
              SizedBox(
                height: 38,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: pending.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 6),
                  itemBuilder: (context, i) {
                    final a = pending[i];
                    return InputChip(
                      avatar: Icon(a.isImage ? Icons.image : Icons.description, size: 16),
                      label: Text(a.fileName ?? 'Attachment', overflow: TextOverflow.ellipsis),
                      onDeleted: sending ? null : () => onRemove(i),
                    );
                  },
                ),
              ),
            const SizedBox(height: 6),
            Row(
              children: [
                IconButton(onPressed: sending ? null : onAddImage, icon: const Icon(Icons.image_outlined), tooltip: 'Attach image'),
                IconButton(onPressed: sending ? null : onAddDocument, icon: const Icon(Icons.attach_file), tooltip: 'Attach document'),
                Expanded(
                  child: TextField(
                    controller: controller,
                    minLines: 1,
                    maxLines: 4,
                    decoration: const InputDecoration(hintText: 'Reply or share more information…', border: OutlineInputBorder(), isDense: true),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(onPressed: sending ? null : onSend, icon: sending ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send), tooltip: 'Send'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _fmt(DateTime dt) {
  final d = '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
  final t = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  return '$d $t';
}
