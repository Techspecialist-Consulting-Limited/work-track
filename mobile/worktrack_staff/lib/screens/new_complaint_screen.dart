import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../data/complaints_repository.dart';

class NewComplaintScreen extends StatefulWidget {
  const NewComplaintScreen({super.key, required this.repository});
  final ComplaintsRepository repository;

  @override
  State<NewComplaintScreen> createState() => _NewComplaintScreenState();
}

class _NewComplaintScreenState extends State<NewComplaintScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _description = TextEditingController();
  final List<PendingComplaintAttachment> _attachments = [];
  bool _submitting = false;

  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pick({required bool imageOnly}) async {
    if (!widget.repository.isApiBacked) {
      setState(() {
        _attachments.add(PendingComplaintAttachment(
          fileName: imageOnly ? 'photo_${_attachments.length + 1}.jpg' : 'document_${_attachments.length + 1}.pdf',
          mimeType: imageOnly ? 'image/jpeg' : 'application/pdf',
          sizeBytes: imageOnly ? 245000 : 120000,
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
        _attachments.add(PendingComplaintAttachment(
          file: File(f.path!),
          fileName: name,
          sizeBytes: f.size,
          isImage: isImage,
        ));
      }
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      await widget.repository.submitComplaint(
        subject: _subject.text,
        description: _description.text,
        attachments: List.unmodifiable(_attachments),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.repository.isApiBacked ? 'Complaint submitted.' : 'Complaint submitted (prototype mock data).')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not submit: $e')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Submit a complaint')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _subject,
              decoration: const InputDecoration(labelText: 'Subject', border: OutlineInputBorder()),
              validator: (v) => (v == null || v.trim().length < 3) ? 'Enter a subject' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _description,
              minLines: 5,
              maxLines: 8,
              decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true, border: OutlineInputBorder()),
              validator: (v) => (v == null || v.trim().length < 10) ? 'Describe the issue' : null,
            ),
            const SizedBox(height: 16),
            Text('Attachments', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              widget.repository.isApiBacked
                  ? 'Images and common documents upload to private, authorised storage and are shared in the same conversation.'
                  : 'Prototype placeholders. In production these upload to private, authorised storage.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(onPressed: _submitting ? null : () => _pick(imageOnly: true), icon: const Icon(Icons.image_outlined), label: const Text('Add image')),
                OutlinedButton.icon(onPressed: _submitting ? null : () => _pick(imageOnly: false), icon: const Icon(Icons.attach_file), label: const Text('Add document')),
              ],
            ),
            if (_attachments.isNotEmpty) ...[
              const SizedBox(height: 10),
              ..._attachments.asMap().entries.map((e) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(e.value.isImage ? Icons.image : Icons.description_outlined),
                    title: Text(e.value.fileName ?? 'Attachment'),
                    subtitle: Text('${e.value.isImage ? 'Image' : 'Document'} · ${((e.value.sizeBytes ?? 0) / 1024).toStringAsFixed(1)} KB'),
                    trailing: IconButton(icon: const Icon(Icons.close), onPressed: _submitting ? null : () => setState(() => _attachments.removeAt(e.key))),
                  )),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
              label: Text(_submitting ? 'Submitting…' : 'Submit complaint'),
            ),
          ],
        ),
      ),
    );
  }
}
