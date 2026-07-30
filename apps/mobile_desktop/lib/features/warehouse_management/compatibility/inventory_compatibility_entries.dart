import 'package:flutter/material.dart';

import '../shared/inventory_workspace_shared.dart';

class FulfillmentCompatibilityEntry extends StatelessWidget {
  const FulfillmentCompatibilityEntry({
    super.key,
    required this.onOpenDestination,
  });

  final ValueChanged<String> onOpenDestination;

  @override
  Widget build(BuildContext context) {
    return InventoryDestinationLinkCard(
      title: '销售出库与配货',
      message: '当前真实销售出库与配货流程仍由现有库管打包页承载。为避免形成两个可编辑入口，此处只提供统一跳转。',
      buttonLabel: '打开库管打包页',
      buttonKey: const ValueKey('warehouse-management-packing-entry'),
      icon: Icons.inventory_2_rounded,
      onOpen: () => onOpenDestination('warehouse_packing'),
    );
  }
}

class WarehouseSettingsUnavailablePage extends StatelessWidget {
  const WarehouseSettingsUnavailablePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const InventoryUnavailableCard(
      keyPrefix: 'warehouse-management-settings-unavailable',
      title: '仓库设置',
      message: '后端仓库配置能力已存在，但当前 Flutter 页面尚未接入真实接口。功能暂不可用，等待前端接入后开放。',
    );
  }
}

class SerializedInventoryCompatibilityEntry extends StatelessWidget {
  const SerializedInventoryCompatibilityEntry({
    super.key,
    required this.onOpenDestination,
  });

  final ValueChanged<String> onOpenDestination;

  @override
  Widget build(BuildContext context) {
    return InventoryDestinationLinkCard(
      title: '茅台逐瓶库存',
      message: '物流码、生产批次和逐瓶状态继续由现有专属页面维护；仓库管理仅提供兼容跳转，避免两套可编辑状态。',
      buttonLabel: '打开茅台逐瓶库存',
      buttonKey: const ValueKey('warehouse-management-moutai-entry'),
      icon: Icons.qr_code_scanner_rounded,
      onOpen: () => onOpenDestination('moutai_inventory'),
    );
  }
}
