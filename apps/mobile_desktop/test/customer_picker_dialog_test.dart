import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/customers/customer_form_dialog.dart';
import 'package:jiangjiu_mobile_desktop/features/customers/customer_picker_dialog.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets('searches customers by name phone or address', (tester) async {
    final queries = <String>[];
    await _openPicker(
      tester,
      loadCustomers: (query, limit) async {
        queries.add(query);
        return _filterCustomers(_customers, query);
      },
    );

    expect(find.text('张先生'), findsOneWidget);
    expect(find.text('李女士'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('customer-search-field')),
      '南明',
    );
    await tester.tap(find.byKey(const ValueKey('customer-search-button')));
    await tester.pumpAndSettle();

    expect(queries, contains('南明'));
    expect(find.text('李女士'), findsOneWidget);
    expect(find.text('张先生'), findsNothing);
  });

  testWidgets('selects a customer and returns the record', (tester) async {
    CustomerRecord? selected;
    await _openPicker(
      tester,
      loadCustomers: (_, __) async => _customers,
      onSelected: (customer) => selected = customer,
    );

    await tester.tap(find.text('张先生'));
    await tester.pumpAndSettle();

    expect(selected?.id, 'customer-zhang');
    expect(selected?.phone, '13900001111');
  });

  testWidgets('hides customer finance mark by default', (tester) async {
    await _openPicker(
      tester,
      loadCustomers: (_, __) async => _customers,
    );

    expect(find.text('已标记'), findsNothing);
    expect(find.text('未标记'), findsNothing);
  });

  testWidgets('shows customer finance mark when enabled', (tester) async {
    await _openPicker(
      tester,
      loadCustomers: (_, __) async => _customers,
      showFinanceMark: true,
    );

    expect(find.text('已标记'), findsOneWidget);
    expect(find.text('未标记'), findsOneWidget);
  });

  testWidgets('shows empty state when no customers match', (tester) async {
    await _openPicker(
      tester,
      loadCustomers: (_, __) async => const <CustomerRecord>[],
    );

    expect(find.byKey(const ValueKey('customer-empty-state')), findsOneWidget);
    expect(find.text('暂无匹配客户'), findsOneWidget);
  });

  testWidgets('shows error state when customer search fails', (tester) async {
    await _openPicker(
      tester,
      loadCustomers: (_, __) async => throw Exception('客户查询失败'),
    );

    expect(find.text('客户查询失败'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '重试'), findsOneWidget);
  });

  testWidgets('creates a customer and returns it from picker', (tester) async {
    CustomerRecord? selected;
    Map<String, dynamic>? createdBody;

    await _openPicker(
      tester,
      loadCustomers: (_, __) async => const <CustomerRecord>[],
      createCustomer: (body) async {
        createdBody = body;
        return _customer(
          id: 'customer-created',
          name: '${body['name']}',
          phone: '${body['phone']}',
          address: '${body['address']}',
        );
      },
      onSelected: (customer) => selected = customer,
    );

    await tester.tap(find.byKey(const ValueKey('open-create-customer-button')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('customer-name-field')),
      '新客户',
    );
    await tester.enterText(
      find.byKey(const ValueKey('customer-phone-field')),
      '13700002222',
    );
    final province = administrativeProvinceNames().first;
    final city = administrativeCitiesForProvince(province).first;
    final district = administrativeDistrictsForCity(province, city).first;
    await _selectDropdownValue(
      tester,
      key: const ValueKey('customer-province-field'),
      label: province,
    );
    await _selectDropdownValue(
      tester,
      key: ValueKey('customer-city-$province'),
      label: city,
    );
    await _selectDropdownValue(
      tester,
      key: ValueKey('customer-district-$province-$city'),
      label: district,
    );
    await tester.enterText(
      find.byKey(const ValueKey('customer-address-field')),
      '测试路 1 号',
    );
    await tester.tap(find.byKey(const ValueKey('save-customer-button')));
    await tester.pumpAndSettle();

    expect(createdBody?['name'], '新客户');
    expect(createdBody?['phone'], '13700002222');
    expect(createdBody?['province'], province);
    expect(createdBody?['city'], city);
    expect(createdBody?['district'], district);
    expect(selected?.id, 'customer-created');
    expect(selected?.address, '测试路 1 号');
  });
}

Future<void> _openPicker(
  WidgetTester tester, {
  required CustomerListLoader loadCustomers,
  CustomerCreator? createCustomer,
  ValueChanged<CustomerRecord?>? onSelected,
  bool showFinanceMark = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) {
          return Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  final selected = await showDialog<CustomerRecord>(
                    context: context,
                    builder: (context) => CustomerPickerDialog(
                      loadCustomers: loadCustomers,
                      createCustomer: createCustomer,
                      showFinanceMark: showFinanceMark,
                    ),
                  );
                  onSelected?.call(selected);
                },
                child: const Text('打开客户选择'),
              ),
            ),
          );
        },
      ),
    ),
  );

  await tester.tap(find.text('打开客户选择'));
  await tester.pumpAndSettle();
}

Future<void> _selectDropdownValue(
  WidgetTester tester, {
  required Key key,
  required String label,
}) async {
  final field = find.byKey(key);
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

List<CustomerRecord> _filterCustomers(
  List<CustomerRecord> customers,
  String query,
) {
  final text = query.trim();
  if (text.isEmpty) {
    return customers;
  }
  return customers.where((customer) {
    final haystack = [
      customer.name,
      customer.phone,
      customer.province,
      customer.city,
      customer.district,
      customer.address,
    ].whereType<String>().join(' ');
    return haystack.contains(text);
  }).toList();
}

final _customers = <CustomerRecord>[
  _customer(
    id: 'customer-zhang',
    name: '张先生',
    phone: '13900001111',
    province: '贵州省',
    city: '贵阳市',
    district: '观山湖区',
    address: '会展城 A 座',
    financeMark: true,
  ),
  _customer(
    id: 'customer-li',
    name: '李女士',
    phone: '13800002222',
    province: '贵州省',
    city: '贵阳市',
    district: '南明区',
    address: '花果园 B 区',
  ),
];

CustomerRecord _customer({
  required String id,
  required String name,
  String? phone,
  String? province,
  String? city,
  String? district,
  String? address,
  bool financeMark = false,
}) {
  return CustomerRecord(
    id: id,
    name: name,
    phone: phone,
    province: province,
    city: city,
    district: district,
    address: address,
    financeMark: financeMark,
    markedById: null,
    markedAt: null,
    notes: null,
    createdById: null,
    updatedById: null,
    createdAt: null,
    updatedAt: null,
  );
}
