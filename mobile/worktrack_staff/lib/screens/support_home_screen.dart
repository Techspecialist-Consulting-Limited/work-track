import 'package:flutter/material.dart';
import '../data/complaints_repository.dart';
import '../models/complaint_models.dart';
import 'new_complaint_screen.dart';
import 'complaint_conversation_screen.dart';

class SupportHomeScreen extends StatefulWidget {
  const SupportHomeScreen({super.key, required this.repository});
  final ComplaintsRepository repository;

  @override
  State<SupportHomeScreen> createState() => _SupportHomeScreenState();
}

class _SupportHomeScreenState extends State<SupportHomeScreen> {
  late Future<List<ComplaintRecord>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.repository.getMyComplaints();
  }

  void _reload() {
    setState(() {
      _future = widget.repository.getMyComplaints();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Support & Complaints'),
        actions: [
          IconButton(onPressed: _reload, icon: const Icon(Icons.refresh), tooltip: 'Refresh'),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => NewComplaintScreen(repository: widget.repository)),
          );
          _reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('New complaint'),
      ),
      body: FutureBuilder<List<ComplaintRecord>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _ErrorState(message: snapshot.error.toString(), onRetry: _reload);
          }
          final complaints = snapshot.data ?? const [];
          if (complaints.isEmpty) return const _EmptyState();
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
            itemCount: complaints.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final c = complaints[index];
              return _ComplaintCard(
                complaint: c,
                onTap: () async {
                  await widget.repository.markRead(c.id);
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ComplaintConversationScreen(
                        complaintId: c.id,
                        repository: widget.repository,
                      ),
                    ),
                  );
                  _reload();
                },
              );
            },
          );
        },
      ),
    );
  }
}

class _ComplaintCard extends StatelessWidget {
  const _ComplaintCard({required this.complaint, required this.onTap});
  final ComplaintRecord complaint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Ink(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: theme.colorScheme.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (complaint.unreadByStaff)
                  Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle),
                  ),
                Expanded(
                  child: Text(
                    '${complaint.reference} · ${complaint.subject}',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                _StatusChip(status: complaint.status),
              ],
            ),
            const SizedBox(height: 6),
            Text('Last update: ${_fmt(complaint.lastMessageAt)}',
                style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final ComplaintStatus status;

  @override
  Widget build(BuildContext context) {
    final colors = switch (status) {
      ComplaintStatus.newStatus => (const Color(0xFFEAF2FF), const Color(0xFF1D4ED8)),
      ComplaintStatus.inProgress => (const Color(0xFFFFF4DB), const Color(0xFF9A6200)),
      ComplaintStatus.awaitingStaff => (const Color(0xFFF3E8FF), const Color(0xFF7E22CE)),
      ComplaintStatus.resolved => (const Color(0xFFEAF8F0), const Color(0xFF15803D)),
      ComplaintStatus.reopened => (const Color(0xFFFDEEEE), const Color(0xFFB43A3A)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: colors.$1, borderRadius: BorderRadius.circular(999)),
      child: Text(status.label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: colors.$2)),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.support_agent, size: 48, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text('No complaints yet', style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              'Submit a complaint to start a conversation with management. You can only view your own complaints.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 40),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

String _fmt(DateTime dt) {
  final d = '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  final t = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  return '$d $t';
}
