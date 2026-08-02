import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class AiAssistantPage extends StatefulWidget {
  const AiAssistantPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<AiAssistantPage> createState() => _AiAssistantPageState();
}

class _AiAssistantPageState extends State<AiAssistantPage> {
  final _questionController = TextEditingController();
  final List<_ChatMessage> _messages = [];

  late BusinessApi _businessApi;
  late String _conversationId;

  AiCapabilities? _capabilities;
  List<AiChatTemplate> _templates = const <AiChatTemplate>[];
  List<AiChatHistoryItem> _history = const <AiChatHistoryItem>[];
  bool _loadingInitial = true;
  bool _loadingTemplates = false;
  bool _loadingHistory = false;
  bool _sending = false;
  String? _initialError;
  String? _templatesError;
  String? _historyError;
  String? _sendError;
  String? _lastFailedQuestion;

  @override
  void initState() {
    super.initState();
    _configureApi();
    _loadInitial();
  }

  @override
  void didUpdateWidget(covariant AiAssistantPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _configureApi();
      setState(() {
        _capabilities = null;
        _templates = const <AiChatTemplate>[];
        _history = const <AiChatHistoryItem>[];
        _messages.clear();
        _loadingTemplates = false;
        _loadingHistory = false;
        _initialError = null;
        _templatesError = null;
        _historyError = null;
        _sendError = null;
        _lastFailedQuestion = null;
      });
      _loadInitial();
    }
  }

  @override
  void dispose() {
    _questionController.dispose();
    super.dispose();
  }

  void _configureApi() {
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _conversationId = 'flutter-${DateTime.now().microsecondsSinceEpoch}';
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loadingInitial = true;
      _initialError = null;
    });

    try {
      final capabilities = await _businessApi.getAiCapabilities();
      if (!mounted) {
        return;
      }
      setState(() {
        _capabilities = capabilities;
        _loadingInitial = false;
      });
      if (capabilities.canUseAi) {
        await Future.wait([
          _loadTemplates(),
          _loadHistory(silent: true),
        ]);
      } else {
        setState(() {
          _templates = const <AiChatTemplate>[];
          _history = const <AiChatHistoryItem>[];
          _templatesError = null;
          _historyError = null;
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _capabilities = null;
        _loadingTemplates = false;
        _loadingHistory = false;
        _initialError = _friendlyAiError(error);
        _loadingInitial = false;
      });
    }
  }

  Future<void> _loadTemplates() async {
    final capabilities = _capabilities;
    if (capabilities == null || !capabilities.canUseAi || !mounted) {
      return;
    }
    setState(() {
      _loadingTemplates = true;
      _templatesError = null;
    });
    try {
      final templates = await _businessApi.getAiChatTemplates();
      if (!mounted) {
        return;
      }
      setState(() {
        _templates = templates;
        _loadingTemplates = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _templates = const <AiChatTemplate>[];
        _templatesError = _friendlyAiError(error);
        _loadingTemplates = false;
      });
    }
  }

  Future<void> _loadHistory({bool silent = false}) async {
    final capabilities = _capabilities;
    if (capabilities == null || !capabilities.canUseAi) {
      return;
    }

    if (!mounted) {
      return;
    }
    setState(() {
      _loadingHistory = !silent || _history.isEmpty;
      _historyError = null;
    });

    try {
      final page = await _businessApi.getAiChatHistory(page: 1, pageSize: 5);
      if (!mounted) {
        return;
      }
      setState(() {
        _history = page.items;
        _loadingHistory = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _historyError = _friendlyAiError(error);
        _loadingHistory = false;
      });
    }
  }

  bool get _hasQuestion => _questionController.text.trim().isNotEmpty;

  bool get _canSend {
    final capabilities = _capabilities;
    return capabilities != null &&
        !_loadingInitial &&
        !_sending &&
        capabilities.enabled &&
        capabilities.canUseAi &&
        !_modelUnavailable(capabilities);
  }

  Future<void> _sendCurrentQuestion() {
    return _sendQuestion(_questionController.text, clearInput: true);
  }

  Future<void> _sendTemplate(AiChatTemplate template) {
    _questionController.text = template.question;
    return _sendQuestion(template.question, clearInput: true);
  }

  Future<void> _retryLastQuestion() async {
    final question = _lastFailedQuestion;
    if (question == null || question.trim().isEmpty) {
      return;
    }
    await _sendQuestion(question, appendUserMessage: false, clearInput: false);
  }

  Future<void> _sendQuestion(
    String rawQuestion, {
    bool appendUserMessage = true,
    bool clearInput = false,
  }) async {
    final question = rawQuestion.trim();
    if (question.isEmpty) {
      return;
    }

    final unavailableMessage = _availabilityMessage(_capabilities);
    if (!_canSend) {
      setState(() {
        _sendError = unavailableMessage ?? 'AI 助手暂不可用，请稍后重试。';
        _lastFailedQuestion = question;
      });
      return;
    }

    setState(() {
      if (appendUserMessage) {
        _messages.add(_ChatMessage(fromUser: true, text: question));
      }
      _sending = true;
      _sendError = null;
      _lastFailedQuestion = question;
      if (clearInput) {
        _questionController.clear();
      }
    });

    try {
      final response = await _businessApi.sendAiChatMessage(
        AiChatRequest(
          question: question,
          conversationId: _conversationId,
        ),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _messages.add(
          _ChatMessage(
            fromUser: false,
            text: _safeAssistantText(response.answer),
            intent: response.intent,
            range: response.range,
            sourceSummary: response.sourceSummary,
            warnings: response.warnings,
          ),
        );
        _sending = false;
        _lastFailedQuestion = null;
      });
      await _loadHistory(silent: true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _sendError = _friendlyAiError(error);
        _sending = false;
      });
    }
  }

  void _openHistoryDetail(AiChatHistoryItem item) {
    showDialog<void>(
      context: context,
      builder: (context) => _HistoryDetailDialog(
        item: item,
        onRestore: () {
          Navigator.of(context).pop();
          _restoreHistory(item);
        },
      ),
    );
  }

  void _restoreHistory(AiChatHistoryItem item) {
    final conversationId = item.conversationId.trim();
    setState(() {
      if (conversationId.isNotEmpty) {
        _conversationId = conversationId;
      }
      _sendError = null;
      _lastFailedQuestion = null;
      _messages
        ..clear()
        ..add(_ChatMessage(fromUser: true, text: item.question))
        ..add(
          _ChatMessage(
            fromUser: false,
            text: _safeAssistantText(item.answer, history: true),
            intent: item.intent,
            range: _historyRange(item),
            sourceSummary: item.sourceSummary,
            warnings: item.warnings,
          ),
        );
    });
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        ResponsiveTwoColumn(
          primary: _ChatPanel(
            messages: _messages,
            loadingInitial: _loadingInitial,
            sending: _sending,
            sendError: _sendError,
            availabilityMessage: _availabilityMessage(_capabilities),
            statusLabel: _statusLabel(),
            statusTone: _statusTone(),
            questionController: _questionController,
            canSend: _canSend,
            hasQuestion: _hasQuestion,
            onQuestionChanged: () => setState(() {}),
            onSend: _sendCurrentQuestion,
            onRetry: _retryLastQuestion,
          ),
          secondary: _AiSidePanel(
            role: widget.role,
            capabilities: _capabilities,
            templates: _templates,
            history: _history,
            loading: _loadingInitial,
            loadingTemplates: _loadingTemplates,
            loadingHistory: _loadingHistory,
            error: _initialError,
            templatesError: _templatesError,
            historyError: _historyError,
            availabilityMessage: _availabilityMessage(_capabilities),
            onRetryLoad: _loadInitial,
            onRetryTemplates: _loadTemplates,
            onRetryHistory: _loadHistory,
            onSendTemplate: _canSend ? _sendTemplate : null,
            onOpenHistory: _openHistoryDetail,
          ),
        ),
      ],
    );
  }

  String _statusLabel() {
    final capabilities = _capabilities;
    if (_loadingInitial) {
      return '加载中';
    }
    if (_initialError != null || capabilities == null) {
      return '不可用';
    }
    if (!capabilities.enabled) {
      return '未启用';
    }
    if (!capabilities.canUseAi) {
      return '无权限';
    }
    if (_modelUnavailable(capabilities)) {
      return '暂不可用';
    }
    if (_sending) {
      return '生成中';
    }
    return '已启用';
  }

  StatusTone _statusTone() {
    final label = _statusLabel();
    if (label == '已启用') {
      return StatusTone.success;
    }
    if (label == '加载中' || label == '生成中' || label == '未启用') {
      return StatusTone.warning;
    }
    return StatusTone.danger;
  }
}

class _ChatPanel extends StatelessWidget {
  const _ChatPanel({
    required this.messages,
    required this.loadingInitial,
    required this.sending,
    required this.sendError,
    required this.availabilityMessage,
    required this.statusLabel,
    required this.statusTone,
    required this.questionController,
    required this.canSend,
    required this.hasQuestion,
    required this.onQuestionChanged,
    required this.onSend,
    required this.onRetry,
  });

  final List<_ChatMessage> messages;
  final bool loadingInitial;
  final bool sending;
  final String? sendError;
  final String? availabilityMessage;
  final String statusLabel;
  final StatusTone statusTone;
  final TextEditingController questionController;
  final bool canSend;
  final bool hasQuestion;
  final VoidCallback onQuestionChanged;
  final VoidCallback onSend;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final inputEnabled = canSend && !loadingInitial;
    return Card(
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
                    style: textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                StatusTag(label: statusLabel, tone: statusTone),
              ],
            ),
            const SizedBox(height: 12),
            if (availabilityMessage != null)
              _NoticeBox(
                icon: Icons.info_outline_rounded,
                text: availabilityMessage!,
                tone: StatusTone.warning,
              ),
            if (loadingInitial && messages.isEmpty)
              const _LoadingLine(
                key: ValueKey('ai-initial-loading'),
                text: '正在加载 AI 能力和常见问题...',
              )
            else if (messages.isEmpty)
              const _EmptyChat(),
            for (final message in messages) _MessageBubble(message: message),
            if (sending)
              const _ThinkingBubble(key: ValueKey('ai-response-loading')),
            if (sendError != null)
              _RetryBox(
                message: sendError!,
                onRetry: onRetry,
              ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('ai-question-input'),
              controller: questionController,
              enabled: inputEnabled,
              minLines: 2,
              maxLines: 4,
              onChanged: (_) => onQuestionChanged(),
              decoration: InputDecoration(
                hintText: inputEnabled ? '输入问题' : 'AI 助手当前不可用',
                suffixIcon: IconButton(
                  key: const ValueKey('ai-send-button'),
                  tooltip: '发送',
                  onPressed: inputEnabled && hasQuestion ? onSend : null,
                  icon: sending
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AiSidePanel extends StatelessWidget {
  const _AiSidePanel({
    required this.role,
    required this.capabilities,
    required this.templates,
    required this.history,
    required this.loading,
    required this.loadingTemplates,
    required this.loadingHistory,
    required this.error,
    required this.templatesError,
    required this.historyError,
    required this.availabilityMessage,
    required this.onRetryLoad,
    required this.onRetryTemplates,
    required this.onRetryHistory,
    required this.onSendTemplate,
    required this.onOpenHistory,
  });

  final UserRole role;
  final AiCapabilities? capabilities;
  final List<AiChatTemplate> templates;
  final List<AiChatHistoryItem> history;
  final bool loading;
  final bool loadingTemplates;
  final bool loadingHistory;
  final String? error;
  final String? templatesError;
  final String? historyError;
  final String? availabilityMessage;
  final VoidCallback onRetryLoad;
  final VoidCallback onRetryTemplates;
  final VoidCallback onRetryHistory;
  final ValueChanged<AiChatTemplate>? onSendTemplate;
  final ValueChanged<AiChatHistoryItem> onOpenHistory;

  @override
  Widget build(BuildContext context) {
    final caps = capabilities;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: 'AI 能力',
          children: [
            if (loading)
              const _LoadingLine(text: '正在读取当前角色可用能力...')
            else if (error != null)
              _RetryBox(
                message: error!,
                onRetry: onRetryLoad,
                buttonKey: const ValueKey('ai-retry-capabilities'),
              )
            else if (caps == null)
              _NoticeBox(
                icon: Icons.info_outline_rounded,
                text: '尚未读取到 AI 能力，请重试。',
                tone: StatusTone.warning,
                action: OutlinedButton.icon(
                  key: const ValueKey('ai-retry-load'),
                  onPressed: onRetryLoad,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('重试'),
                ),
              )
            else ...[
              _InfoLine(label: '当前角色', value: role.label),
              _InfoLine(
                label: '可用状态',
                value: caps.canUseAi ? '可使用' : '不可使用',
              ),
              _InfoLine(
                label: '可见范围',
                value: _visibleScopeLabel(role),
              ),
              _InfoLine(
                label: '问题长度',
                value: caps.limits.maxQuestionLength > 0
                    ? '${caps.limits.maxQuestionLength} 字以内'
                    : '以页面提示为准',
              ),
              if (availabilityMessage != null)
                _NoticeBox(
                  icon: Icons.warning_amber_rounded,
                  text: availabilityMessage!,
                  tone: StatusTone.warning,
                ),
            ],
          ],
        ),
        const SizedBox(height: 16),
        FormSection(
          title: '常用问题',
          children: [
            if (loading || loadingTemplates)
              const _LoadingLine(text: '正在加载常用问题...')
            else if (capabilities?.canUseAi != true)
              const Text('当前角色不可使用常用问题。')
            else if (templatesError != null)
              _RetryBox(
                message: templatesError!,
                onRetry: onRetryTemplates,
                buttonKey: const ValueKey('ai-retry-templates'),
              )
            else if (templates.isEmpty)
              const Text('暂无可用模板。')
            else
              for (final template in templates)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: OutlinedButton.icon(
                    key: ValueKey('ai-template-${template.id}'),
                    onPressed: onSendTemplate == null
                        ? null
                        : () => onSendTemplate!(template),
                    icon: const Icon(Icons.help_outline_rounded),
                    label: Align(
                      alignment: Alignment.centerLeft,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            template.title,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 2),
                          Text(template.question),
                        ],
                      ),
                    ),
                  ),
                ),
          ],
        ),
        const SizedBox(height: 16),
        FormSection(
          title: '最近问答',
          children: [
            if (loading)
              const _LoadingLine(text: '正在读取最近问答...')
            else if (caps?.canUseAi != true)
              const Text('当前角色不可查看 AI 历史。')
            else if (loadingHistory)
              const _LoadingLine(text: '正在读取最近问答...')
            else if (historyError != null)
              _RetryBox(
                message: historyError!,
                onRetry: onRetryHistory,
                buttonKey: const ValueKey('ai-retry-history'),
              )
            else if (history.isEmpty)
              const Text('暂无最近问答。')
            else
              for (final item in history)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: OutlinedButton.icon(
                    key: ValueKey('ai-history-${item.id}'),
                    onPressed: () => onOpenHistory(item),
                    icon: const Icon(Icons.history_rounded),
                    label: Align(
                      alignment: Alignment.centerLeft,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.question,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 2),
                          Text(_historySubtitle(item)),
                        ],
                      ),
                    ),
                  ),
                ),
          ],
        ),
      ],
    );
  }
}

class _ChatMessage {
  const _ChatMessage({
    required this.fromUser,
    required this.text,
    this.intent,
    this.range,
    this.sourceSummary = const <SourceSummary>[],
    this.warnings = const <AiWarning>[],
  });

  final bool fromUser;
  final String text;
  final String? intent;
  final AiDateRange? range;
  final List<SourceSummary> sourceSummary;
  final List<AiWarning> warnings;
}

class _HistoryDetailDialog extends StatelessWidget {
  const _HistoryDetailDialog({
    required this.item,
    required this.onRestore,
  });

  final AiChatHistoryItem item;
  final VoidCallback onRestore;

  @override
  Widget build(BuildContext context) {
    final rangeLabel = _rangeLabel(_historyRange(item));
    return AlertDialog(
      title: const Text('历史详情'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _InfoLine(
                label: '提问时间',
                value: _dateTimeLabel(item.createdAt),
              ),
              if (item.intent.isNotEmpty)
                _InfoLine(label: '问题类型', value: _intentLabel(item.intent)),
              if (rangeLabel != null)
                _InfoLine(label: '查询范围', value: rangeLabel),
              const SizedBox(height: 8),
              Text(
                item.question,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              Text(_safeAssistantText(item.answer, history: true)),
              if (item.sourceSummary.isNotEmpty) ...[
                const SizedBox(height: 12),
                _SourceSummaryList(sources: item.sourceSummary),
              ],
              if (item.warnings.isNotEmpty) ...[
                const SizedBox(height: 12),
                _WarningList(warnings: item.warnings),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
        FilledButton.icon(
          key: const ValueKey('ai-history-restore'),
          onPressed: onRestore,
          icon: const Icon(Icons.restore_rounded),
          label: const Text('回填到对话'),
        ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final _ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isUser = message.fromUser;
    final background = isUser
        ? scheme.primary
        : scheme.surfaceContainerHighest.withValues(alpha: 0.55);
    final foreground = isUser ? scheme.onPrimary : scheme.onSurface;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 620),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: background,
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: DefaultTextStyle.merge(
          style: TextStyle(color: foreground),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(message.text),
              if (!isUser && _rangeLabel(message.range) != null) ...[
                const SizedBox(height: 10),
                _MetaLine(
                  icon: Icons.date_range_rounded,
                  text: '查询范围：${_rangeLabel(message.range)}',
                ),
              ],
              if (!isUser &&
                  message.intent != null &&
                  message.intent!.isNotEmpty)
                _MetaLine(
                  icon: Icons.route_rounded,
                  text: '问题类型：${_intentLabel(message.intent!)}',
                ),
              if (!isUser && message.sourceSummary.isNotEmpty) ...[
                const SizedBox(height: 10),
                _SourceSummaryList(sources: message.sourceSummary),
              ],
              if (!isUser && message.warnings.isNotEmpty) ...[
                const SizedBox(height: 10),
                _WarningList(warnings: message.warnings),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SourceSummaryList extends StatelessWidget {
  const _SourceSummaryList({required this.sources});

  final List<SourceSummary> sources;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _MetaLine(
          icon: Icons.dataset_rounded,
          text: '查询情况',
          strong: true,
        ),
        const SizedBox(height: 6),
        for (final source in sources)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              [
                _toolLabel(source.toolName),
                '找到 ${source.rowCount} 条记录',
                if (source.dateFrom != null && source.dateTo != null)
                  '${source.dateFrom} 至 ${source.dateTo}',
                source.globalMarkedFilterEnabled
                    ? '目前只统计已标记的数据'
                    : '按当前账号可查看的范围统计',
              ].join(' · '),
            ),
          ),
      ],
    );
  }
}

class _WarningList extends StatelessWidget {
  const _WarningList({required this.warnings});

  final List<AiWarning> warnings;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _MetaLine(
          icon: Icons.warning_amber_rounded,
          text: '请注意',
          strong: true,
        ),
        const SizedBox(height: 6),
        for (final warning in warnings)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(_warningLabel(warning.message)),
          ),
      ],
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({
    required this.icon,
    required this.text,
    this.strong = false,
  });

  final IconData icon;
  final String text;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: strong ? const TextStyle(fontWeight: FontWeight.w700) : null,
          ),
        ),
      ],
    );
  }
}

class _ThinkingBubble extends StatelessWidget {
  const _ThinkingBubble({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 360),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.55),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 10),
            Text('AI 正在生成回答...'),
          ],
        ),
      ),
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: const Text('可以从右侧选择常用问题，也可以直接输入问题。'),
    );
  }
}

class _LoadingLine extends StatelessWidget {
  const _LoadingLine({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          const SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

class _RetryBox extends StatelessWidget {
  const _RetryBox({
    required this.message,
    required this.onRetry,
    this.buttonKey = const ValueKey('ai-retry-send'),
  });

  final String message;
  final VoidCallback onRetry;
  final Key buttonKey;

  @override
  Widget build(BuildContext context) {
    return _NoticeBox(
      icon: Icons.error_outline_rounded,
      text: message,
      tone: StatusTone.danger,
      action: OutlinedButton.icon(
        key: buttonKey,
        onPressed: onRetry,
        icon: const Icon(Icons.refresh_rounded),
        label: const Text('重试'),
      ),
    );
  }
}

class _NoticeBox extends StatelessWidget {
  const _NoticeBox({
    required this.icon,
    required this.text,
    required this.tone,
    this.action,
  });

  final IconData icon;
  final String text;
  final StatusTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = _noticeColors(context, tone);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: colors.foreground),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(color: colors.foreground),
                ),
              ),
            ],
          ),
          if (action != null) ...[
            const SizedBox(height: 10),
            Align(alignment: Alignment.centerLeft, child: action!),
          ],
        ],
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Text(label, style: textTheme.bodySmall),
          ),
          Expanded(
            child: Text(
              value,
              style: textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _visibleScopeLabel(UserRole role) {
  switch (role) {
    case UserRole.superAdmin:
    case UserRole.admin:
      return '当前账号可以查看的经营数据';
    case UserRole.boss:
      return '经营统计、排名、客户订单和财务汇总';
    case UserRole.finance:
      return '退款、费用、提成、积分和经营统计';
    case UserRole.afterSales:
      return '客户订单、售后记录和物流信息';
    case UserRole.warehouse:
      return '经营概况、趋势、品鉴师排名和数据来源明细';
    case UserRole.frontDesk:
    case UserRole.sales:
    case UserRole.taster:
      return '当前账号可以查看的数据';
  }
}

String _intentLabel(String intent) {
  return switch (intent.trim()) {
    'analytics_overview' => '经营概况',
    'analytics_trend' => '经营趋势',
    'taster_ranking' => '品鉴师排名',
    'taster_detail' => '品鉴师详情',
    'finance_summary' => '财务汇总',
    'commission_query' => '提成查询',
    'refund_query' => '退款查询',
    'customer_lookup' => '客户查询',
    'customer_order_lookup' => '客户订单',
    'after_sales_lookup' => '售后查询',
    'logistics_lookup' => '物流查询',
    'management_suggestion' => '经营建议',
    'permission_denied' => '权限提醒',
    _ => '经营数据查询',
  };
}

String _toolLabel(String toolName) {
  return switch (toolName.trim()) {
    'analytics.overview' => '经营概况',
    'analytics.trends' => '经营趋势',
    'analytics.tasterRankings' => '品鉴师排名',
    'analytics.tasterDetail' => '品鉴师详情',
    'finance.summary' => '财务汇总',
    'commission.query' => '提成记录',
    'refund.query' => '退款记录',
    'customer.lookup' => '客户记录',
    'customer.orderLookup' => '客户订单',
    'afterSales.lookup' => '售后记录',
    'logistics.lookup' => '物流记录',
    _ => '经营记录',
  };
}

String _safeAssistantText(String text, {bool history = false}) {
  final trimmed = text.trim();
  if (trimmed.isNotEmpty && !_containsTechnicalContent(trimmed)) {
    return trimmed;
  }
  if (history) {
    return '这条历史回答含有不适合直接展示的内容，已隐藏。请重新询问经营问题。';
  }
  return '这次回答含有不适合直接展示的内容，已隐藏。请重新询问经营问题。';
}

bool _containsTechnicalContent(String text) {
  final lower = text.toLowerCase();
  if (lower.contains('":') ||
      lower.contains("':") ||
      lower.contains('analytics.') ||
      lower.contains('finance.') ||
      lower.contains('customer.') ||
      lower.contains('aftersales.') ||
      lower.contains('logistics.') ||
      lower.contains('commission.')) {
    return true;
  }
  const forbiddenTerms = <String>[
    '后端',
    '接口地址',
    '接口路径',
    '模型',
    '工具调用',
    '数据工具',
    '内部字段',
    '内部英文标识',
    '配置',
    '技术配置',
    '配置内容',
    '数据库',
    '数据表',
    '程序代码',
    '源代码',
    '代码块',
    '行内代码',
    '网页标签',
    '原始数据格式',
    '返回行数',
    'api key',
    'access token',
    'mock',
    'provider',
  ];
  if (forbiddenTerms.any(lower.contains)) {
    return true;
  }
  final patterns = <RegExp>[
    RegExp(r'```|~~~|`[^`\r\n]+`'),
    RegExp(r'<\/?[a-z][^>]*>', caseSensitive: false),
    RegExp(r'https?:\/\/|\/(?:api|v\d+)\/', caseSensitive: false),
    RegExp(
      r'\b(?:select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|drop\s+table)\b',
      caseSensitive: false,
      dotAll: true,
    ),
    RegExp(r'\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*='),
    RegExp(r'\b(?:function|def|class)\s+[A-Za-z_$][\w$]*'),
    RegExp(r'^\s*[\{\[]', multiLine: true),
    RegExp(r'\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b', caseSensitive: false),
    RegExp(r'\b[a-z]+(?:[A-Z][a-z0-9]*)+\b'),
    RegExp(
      r'^\s*[A-Za-z][A-Za-z0-9_]*\s*:\s*(?:["\d\[\{\-]|true|false|null)',
      caseSensitive: false,
      multiLine: true,
    ),
    RegExp(
      r'^(?:[A-Za-z][A-Za-z0-9_]*,){1,}[A-Za-z][A-Za-z0-9_]*\s*$',
      multiLine: true,
    ),
    RegExp(
      r'\b(?:sql|json|xml|yaml|html|css|python|javascript|java|dart|curl|powershell|bash|shell)\b',
      caseSensitive: false,
    ),
    RegExp(r'第\s*\d+\s*阶段|返回\s*\d*\s*行'),
  ];
  return patterns.any((pattern) => pattern.hasMatch(text));
}

String _warningLabel(String message) {
  final text = message.trim();
  final lower = text.toLowerCase();
  if (text.contains('已标记') || text.contains('标记数据')) {
    return '目前只统计已标记的数据。';
  }
  if (text.contains('权限') || text.contains('无权')) {
    return '当前账号不能查看这类数据。';
  }
  if (text.contains('手机号') ||
      text.contains('地址') ||
      text.contains('脱敏') ||
      text.contains('隐私')) {
    return '个人信息已按规则隐藏。';
  }
  if (text.contains('未指定时间') || text.contains('不限时间') || text.contains('行数')) {
    return '没有指定时间，已按当前条件查找，并限制展示数量。';
  }
  if (_containsTechnicalContent(text) ||
      text.contains('暂时不可用') ||
      text.contains('失败') ||
      text.contains('异常') ||
      text.contains('超时') ||
      lower.contains('api')) {
    return '暂时无法完成查询，请稍后再试。';
  }
  return text.isEmpty ? '请以页面显示的经营数据为准。' : text;
}

String _historySubtitle(AiChatHistoryItem item) {
  final parts = <String>[
    if (item.createdAt.isNotEmpty) _dateTimeLabel(item.createdAt),
    if (item.intent.isNotEmpty) _intentLabel(item.intent),
    if (_rangeLabel(_historyRange(item)) != null)
      _rangeLabel(_historyRange(item))!,
  ];
  return parts.join(' | ');
}

String _dateTimeLabel(String value) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) {
    return '时间未知';
  }
  final local = parsed.toLocal();
  String twoDigits(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${twoDigits(local.month)}-${twoDigits(local.day)} '
      '${twoDigits(local.hour)}:${twoDigits(local.minute)}';
}

String _rangePresetLabel(String preset) {
  return switch (preset) {
    'today' => '今天',
    'yesterday' => '昨天',
    'last_10_days' => '近 10 天',
    'this_month' => '本月',
    'last_month' => '上个月',
    'this_year' => '今年',
    _ => '当前查询范围',
  };
}

AiDateRange? _historyRange(AiChatHistoryItem item) {
  final rangeValue = item.dataScope?['range'];
  if (rangeValue is Map) {
    return AiDateRange.fromJson(_dynamicMap(rangeValue));
  }

  for (final source in item.sourceSummary) {
    if (source.dateFrom != null || source.dateTo != null) {
      return AiDateRange(
        dateFrom: source.dateFrom,
        dateTo: source.dateTo,
        timezone: 'Asia/Shanghai',
      );
    }
  }
  return null;
}

Map<String, dynamic> _dynamicMap(Map<dynamic, dynamic> value) {
  return value.map((key, item) => MapEntry('$key', item));
}

_NoticeColors _noticeColors(BuildContext context, StatusTone tone) {
  switch (tone) {
    case StatusTone.danger:
      return const _NoticeColors(
        foreground: Color(0xFF9C1C28),
        background: Color(0xFFFBE4E8),
        border: Color(0xFFE6A8B2),
      );
    case StatusTone.warning:
      return const _NoticeColors(
        foreground: Color(0xFF7A5200),
        background: Color(0xFFFFF3D6),
        border: Color(0xFFE8C56A),
      );
    case StatusTone.success:
      return const _NoticeColors(
        foreground: Color(0xFF176349),
        background: Color(0xFFE6F4EE),
        border: Color(0xFFB9DFD1),
      );
    case StatusTone.info:
    case StatusTone.neutral:
      final scheme = Theme.of(context).colorScheme;
      return _NoticeColors(
        foreground: scheme.onSurfaceVariant,
        background: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        border: scheme.outlineVariant,
      );
  }
}

class _NoticeColors {
  const _NoticeColors({
    required this.foreground,
    required this.background,
    required this.border,
  });

  final Color foreground;
  final Color background;
  final Color border;
}

String? _availabilityMessage(AiCapabilities? capabilities) {
  if (capabilities == null) {
    return null;
  }
  if (!capabilities.enabled) {
    return 'AI 助手暂未启用，请联系管理员。';
  }
  if (!capabilities.canUseAi || !capabilities.roleAllowed) {
    return '当前账号不能使用 AI 助手。';
  }
  if (_modelUnavailable(capabilities)) {
    return 'AI 助手暂时不可用，请稍后再试或联系管理员。';
  }
  return null;
}

bool _modelUnavailable(AiCapabilities capabilities) {
  return capabilities.enabled &&
      capabilities.canUseAi &&
      !capabilities.model.mockMode &&
      !capabilities.model.hasApiKey;
}

String _friendlyAiError(Object error) {
  if (error is ApiException) {
    final code = error.code.toUpperCase();
    if (error.statusCode == 401) {
      return '登录已失效，请重新登录后再使用 AI 助手。';
    }
    if (error.statusCode == 403 || code == 'FORBIDDEN') {
      if (code == 'AI_ROLE_NOT_ALLOWED') {
        return '当前角色没有使用 AI 助手的权限。';
      }
      if (code == 'AI_PERMISSION_DENIED') {
        return '当前账号不能查看这类数据。';
      }
      return '当前账号不能完成这项查询。';
    }
    if (error.statusCode == 429) {
      return 'AI 请求过于频繁，请稍后再试。';
    }
    if (code.contains('AI_DISABLED')) {
      return 'AI 助手未启用，请联系管理员开启后再试。';
    }
    if (code.contains('API_KEY') ||
        code.contains('PROVIDER') ||
        code.contains('MODEL') ||
        code.contains('TIMEOUT')) {
      return 'AI 助手暂时不可用，请稍后重试或联系管理员。';
    }
    if (error.statusCode >= 500) {
      return 'AI 服务暂时不可用，请稍后重试。';
    }
    if (code == 'AI_QUESTION_REQUIRED') {
      return '请先输入要查询的问题。';
    }
    if (code == 'AI_QUESTION_TOO_LONG') {
      return '问题太长，请缩短后再试。';
    }
    return 'AI 请求失败，请稍后重试。';
  }
  return 'AI 助手请求失败，请稍后重试。';
}

String? _rangeLabel(AiDateRange? range) {
  if (range == null) {
    return null;
  }
  if (range.dateFrom != null && range.dateTo != null) {
    return '${range.dateFrom} 至 ${range.dateTo}';
  }
  if (range.preset != null && range.preset!.isNotEmpty) {
    return _rangePresetLabel(range.preset!);
  }
  return null;
}
