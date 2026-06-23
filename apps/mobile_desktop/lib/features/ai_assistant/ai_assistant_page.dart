import 'package:flutter/material.dart';

import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class AiAssistantPage extends StatefulWidget {
  const AiAssistantPage({super.key});

  @override
  State<AiAssistantPage> createState() => _AiAssistantPageState();
}

class _AiAssistantPageState extends State<AiAssistantPage> {
  final _questionController = TextEditingController();
  final List<_ChatMessage> _messages = [
    const _ChatMessage(
      fromUser: true,
      text: '今天销售额是多少？',
    ),
    const _ChatMessage(
      fromUser: false,
      text: '今日出单销售额为 ¥8,650.00，退单金额为 ¥0.00，当前只展示原型假数据。',
    ),
  ];

  @override
  void dispose() {
    _questionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'AI 助手',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      const StatusTag(label: '权限内查询', tone: StatusTone.info),
                    ],
                  ),
                  const SizedBox(height: 16),
                  for (final message in _messages) _MessageBubble(message: message),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _questionController,
                    minLines: 2,
                    maxLines: 4,
                    decoration: InputDecoration(
                      hintText: '输入问题',
                      suffixIcon: IconButton(
                        tooltip: '发送',
                        onPressed: () {
                          if (_questionController.text.trim().isEmpty) {
                            return;
                          }
                          setState(() {
                            _messages.add(_ChatMessage(fromUser: true, text: _questionController.text.trim()));
                            _messages.add(
                              const _ChatMessage(
                                fromUser: false,
                                text: '这里会接后端 AI 查询接口，当前阶段只保留对话路径。',
                              ),
                            );
                            _questionController.clear();
                          });
                        },
                        icon: const Icon(Icons.send_rounded),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          secondary: FormSection(
            title: '常用问题',
            children: [
              for (final prompt in const [
                '本月哪个品鉴师排名第一？',
                '近 10 天打蛋率最高的是谁？',
                '电话 138 开头客户买过什么酒？',
                '本月退单金额是多少？',
              ])
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: OutlinedButton.icon(
                    onPressed: () => setState(() => _questionController.text = prompt),
                    icon: const Icon(Icons.help_outline_rounded),
                    label: Align(alignment: Alignment.centerLeft, child: Text(prompt)),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ChatMessage {
  const _ChatMessage({
    required this.fromUser,
    required this.text,
  });

  final bool fromUser;
  final String text;
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final _ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: message.fromUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: message.fromUser ? scheme.primary : scheme.surfaceContainerHighest.withValues(alpha: 0.55),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: Text(
          message.text,
          style: TextStyle(color: message.fromUser ? scheme.onPrimary : scheme.onSurface),
        ),
      ),
    );
  }
}
