import 'package:flutter/material.dart';

class AppRecordList extends StatelessWidget {
  const AppRecordList({
    super.key,
    required this.items,
    this.compact = false,
  });

  final List<AppRecordItem> items;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final item = items[index];
          return ListTile(
            dense: compact,
            leading: item.icon == null
                ? null
                : CircleAvatar(child: Icon(item.icon, size: 20)),
            title:
                Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: item.subtitle == null
                ? null
                : Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(item.subtitle!),
                        ...item.meta.map(
                          (value) => Text(
                            value,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ),
            trailing: item.trailing,
            onTap: item.onTap,
          );
        },
      ),
    );
  }
}

class AppRecordItem {
  const AppRecordItem({
    required this.title,
    this.subtitle,
    this.meta = const [],
    this.icon,
    this.trailing,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final List<String> meta;
  final IconData? icon;
  final Widget? trailing;
  final VoidCallback? onTap;
}
