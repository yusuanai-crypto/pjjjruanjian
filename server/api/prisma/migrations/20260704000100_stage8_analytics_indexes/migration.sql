CREATE INDEX `travel_groups_visit_date_taster_id_idx` ON `travel_groups`(`visit_date`, `taster_id`);
CREATE INDEX `travel_groups_visit_date_finance_mark_idx` ON `travel_groups`(`visit_date`, `finance_mark`);
CREATE INDEX `travel_groups_visit_date_group_type_idx` ON `travel_groups`(`visit_date`, `group_type`);
CREATE INDEX `sales_orders_order_date_status_idx` ON `sales_orders`(`order_date`, `status`);
CREATE INDEX `sales_orders_travel_group_id_status_idx` ON `sales_orders`(`travel_group_id`, `status`);
CREATE INDEX `after_sales_orders_sales_order_id_finance_confirmed_idx` ON `after_sales_orders`(`sales_order_id`, `finance_confirmed`);
