import 'package:flutter/material.dart';
import 'data/complaints_api.dart';
import 'data/complaints_repository.dart';
import 'screens/support_home_screen.dart';

void main() {
  final repository = createComplaintsRepository();
  runApp(WorkTrackStaffApp(repository: repository));
}

class WorkTrackStaffApp extends StatelessWidget {
  const WorkTrackStaffApp({super.key, required this.repository});
  final ComplaintsRepository repository;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WorkTrack Staff',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF6C45F5)),
        useMaterial3: true,
      ),
      home: StaffHomeShell(repository: repository),
    );
  }
}

class StaffHomeShell extends StatelessWidget {
  const StaffHomeShell({super.key, required this.repository});
  final ComplaintsRepository repository;

  @override
  Widget build(BuildContext context) {
    final apiMode = ComplaintsApiConfig.isConfigured;
    return Scaffold(
      appBar: AppBar(title: const Text('WorkTrack Staff')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.support_agent),
              title: const Text('Support & Complaints'),
              subtitle: Text(
                apiMode
                    ? 'Submit complaints and chat with management through the shared WorkTrack backend.'
                    : 'Submit a complaint, view your cases, and continue the conversation with management.',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => SupportHomeScreen(repository: repository)),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: Icon(apiMode ? Icons.cloud_done_outlined : Icons.info_outline),
              title: Text(apiMode ? 'Connected mode' : 'Prototype note'),
              subtitle: Text(
                apiMode
                    ? 'Using WORKTRACK_API_BASE_URL (${ComplaintsApiConfig.baseUrl}) with bearer auth/role for end-to-end conversation. Ensure the backend, complaints migration, and private Supabase bucket are configured.'
                    : 'This mobile build uses mock data only by default. It does not connect to production employee records or create real complaints. Provide WORKTRACK_API_BASE_URL, WORKTRACK_ACCESS_TOKEN, and WORKTRACK_ROLE at build/run time to use the shared backend.',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
