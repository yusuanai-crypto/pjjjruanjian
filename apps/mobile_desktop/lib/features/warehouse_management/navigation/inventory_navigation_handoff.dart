class InventoryNavigationRequest {
  const InventoryNavigationRequest({
    required this.moduleId,
    required this.warehouseId,
    required this.productId,
    this.action,
  });

  final String moduleId;
  final String warehouseId;
  final String productId;
  final String? action;
}

class InventoryNavigationHandoff {
  InventoryNavigationHandoff._();

  static InventoryNavigationRequest? _pending;

  static void put(InventoryNavigationRequest request) {
    _pending = request;
  }

  static InventoryNavigationRequest? take() {
    final request = _pending;
    _pending = null;
    return request;
  }

  static void clear() {
    _pending = null;
  }
}
