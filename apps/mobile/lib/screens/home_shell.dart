import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../models.dart';
import '../widgets/brand_mark.dart';
import 'portal_screens.dart';
import 'staff_screens.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.api,
    required this.user,
    required this.tenant,
    required this.onSignOut,
  });

  final WaslApi api;
  final SessionUser user;
  final TenantBranding tenant;
  final Future<void> Function() onSignOut;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  late final PortalStore _portalStore;
  int _selectedIndex = 0;
  late final bool _staffMode;

  @override
  void initState() {
    super.initState();
    _staffMode = widget.user.hasStaffRole;
    _portalStore = PortalStore(widget.api, widget.user);
    if (!_staffMode || widget.user.hasPortalRole) _portalStore.load();
  }

  @override
  Widget build(BuildContext context) {
    final labels = _staffMode
        ? const ['Home', 'Students', 'Fees', 'Profile']
        : const ['Home', 'Attendance', 'Fees', 'Profile'];
    final icons = _staffMode
        ? const [
            Icons.space_dashboard_outlined,
            Icons.groups_2_outlined,
            Icons.payments_outlined,
            Icons.person_outline_rounded,
          ]
        : const [
            Icons.home_outlined,
            Icons.event_available_outlined,
            Icons.receipt_long_outlined,
            Icons.person_outline_rounded,
          ];
    final selectedIcons = _staffMode
        ? const [
            Icons.space_dashboard_rounded,
            Icons.groups_2_rounded,
            Icons.payments_rounded,
            Icons.person_rounded,
          ]
        : const [
            Icons.home_rounded,
            Icons.event_available_rounded,
            Icons.receipt_long_rounded,
            Icons.person_rounded,
          ];
    final pages = _staffMode
        ? <Widget>[
            StaffHomeScreen(
              api: widget.api,
              user: widget.user,
              tenant: widget.tenant,
              openStudents: () => setState(() => _selectedIndex = 1),
            ),
            StudentSearchScreen(api: widget.api, user: widget.user),
            StaffFeeCenterScreen(api: widget.api, user: widget.user),
            AccountScreen(
              user: widget.user,
              tenant: widget.tenant,
              onSignOut: widget.onSignOut,
            ),
          ]
        : <Widget>[
            PortalHomeScreen(store: _portalStore, tenant: widget.tenant),
            const AttendanceUnavailableScreen(),
            PortalFeesScreen(
              api: widget.api,
              store: _portalStore,
              user: widget.user,
              tenant: widget.tenant,
            ),
            PortalProfileScreen(
              store: _portalStore,
              user: widget.user,
              tenant: widget.tenant,
              onSignOut: widget.onSignOut,
            ),
          ];

    return Scaffold(
      body: IndexedStack(index: _selectedIndex, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (value) =>
            setState(() => _selectedIndex = value),
        destinations: List.generate(
          labels.length,
          (index) => NavigationDestination(
            icon: Icon(icons[index]),
            selectedIcon: Icon(selectedIcons[index]),
            label: labels[index],
          ),
        ),
      ),
    );
  }
}

class AccountScreen extends StatelessWidget {
  const AccountScreen({
    super.key,
    required this.user,
    required this.tenant,
    required this.onSignOut,
  });

  final SessionUser user;
  final TenantBranding tenant;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(20, 56, 20, 32),
        children: [
          const Text(
            'Your account',
            style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text(
            'Account access follows your Wasl role and permissions.',
            style: TextStyle(color: Color(0xFF737373)),
          ),
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      BrandMark(tenant: tenant),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user.displayName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              user.email,
                              style: const TextStyle(
                                color: Color(0xFF737373),
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 28),
                  _KeyValue(label: 'Workspace', value: tenant.displayName),
                  const SizedBox(height: 13),
                  _KeyValue(
                    label: 'Role',
                    value: user.roles.map(_prettyRole).join(', '),
                  ),
                  if (user.phone?.isNotEmpty == true) ...[
                    const SizedBox(height: 13),
                    _KeyValue(label: 'Phone', value: user.phone!),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => onSignOut(),
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Sign out'),
          ),
        ],
      );
}

class _KeyValue extends StatelessWidget {
  const _KeyValue({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFF737373), fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
          ),
        ],
      );
}

String _prettyRole(String role) => role
    .toLowerCase()
    .split('_')
    .map(
      (word) =>
          word.isEmpty ? word : '${word[0].toUpperCase()}${word.substring(1)}',
    )
    .join(' ');
