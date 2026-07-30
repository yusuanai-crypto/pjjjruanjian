library inventory_workspace_tabs;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/product_option_picker.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/serialized_inventory_picker_dialog.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../travel_group_attachments/downloaded_file_service.dart';
import 'shared/inventory_workspace_shared.dart';

part 'alerts/alert_tab.dart';
part 'inbound/inbound_tab.dart';
part 'movements/movement_tab.dart';
part 'reports/report_tab.dart';
part 'stock/stock_tab.dart';
part 'stocktake/stocktake_approval_tab.dart';
part 'stocktake/stocktake_shared.dart';
part 'stocktake/stocktake_tab.dart';
part 'transfer/transfer_tab.dart';
part 'unavailable/unavailable_tab.dart';
