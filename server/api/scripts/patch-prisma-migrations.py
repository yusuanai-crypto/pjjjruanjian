cat > patch-remaining-migrations.py <<'PY'
from pathlib import Path
import re
import shutil
import sys

MIGRATIONS = [
    Path("prisma/migrations/20260727001000_inventory_stocktakes/migration.sql"),
    Path("prisma/migrations/20260727001100_inventory_alert_todos/migration.sql"),
    Path("prisma/migrations/20260727001200_sales_order_shipping_date/migration.sql"),
]


def extract_create_table_blocks(sql: str):
    blocks = []

    pattern = re.compile(
        r"CREATE\s+TABLE\s+`(?P<table>[^`]+)`\s*\(",
        re.IGNORECASE,
    )

    for match in pattern.finditer(sql):
        table = match.group("table")
        start = match.start()
        position = match.end()
        depth = 1
        quote = None

        while position < len(sql) and depth > 0:
            char = sql[position]

            if quote:
                if char == quote and sql[position - 1] != "\\":
                    quote = None
            else:
                if char in ("'", '"', "`"):
                    quote = char
                elif char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1

            position += 1

        if depth == 0:
            semicolon = sql.find(";", position)
            end = semicolon + 1 if semicolon != -1 else position
            blocks.append((table, start, end, sql[start:end]))

    return blocks


def check_columns_by_table(sql: str):
    result = {}

    for table, _, _, block in extract_create_table_blocks(sql):
        columns = set()

        for check_match in re.finditer(
            r"\bCHECK\s*\((.*?)\)(?=\s*,|\s*\))",
            block,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            expression = check_match.group(1)
            columns.update(re.findall(r"`([^`]+)`", expression))

        result[table] = columns

    return result


def patch_foreign_keys(sql: str, check_columns: dict):
    statement_pattern = re.compile(
        r"ALTER\s+TABLE\s+`(?P<table>[^`]+)`(?P<body>.*?);",
        flags=re.IGNORECASE | re.DOTALL,
    )

    changes = []

    def patch_statement(match):
        table = match.group("table")
        statement = match.group(0)
        columns_in_checks = check_columns.get(table, set())

        if not columns_in_checks:
            return statement

        fk_pattern = re.compile(
            r"(?P<fk>"
            r"ADD\s+CONSTRAINT\s+`(?P<constraint>[^`]+)`\s*"
            r"FOREIGN\s+KEY\s*\(\s*`(?P<column>[^`]+)`\s*\)"
            r".*?"
            r"ON\s+DELETE\s+(?:RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION)"
            r"\s+ON\s+UPDATE\s+CASCADE"
            r")",
            flags=re.IGNORECASE | re.DOTALL,
        )

        def patch_fk(fk_match):
            column = fk_match.group("column")
            constraint = fk_match.group("constraint")
            foreign_key_sql = fk_match.group("fk")

            if column not in columns_in_checks:
                return foreign_key_sql

            changes.append(
                f"{table}.{column}: {constraint} "
                f"ON UPDATE CASCADE -> ON UPDATE RESTRICT"
            )

            return re.sub(
                r"ON\s+UPDATE\s+CASCADE",
                "ON UPDATE RESTRICT",
                foreign_key_sql,
                flags=re.IGNORECASE,
            )

        return fk_pattern.sub(patch_fk, statement)

    return statement_pattern.sub(patch_statement, sql), changes


def main():
    any_error = False

    for migration in MIGRATIONS:
        if not migration.exists():
            print(f"[跳过] 文件不存在：{migration}")
            any_error = True
            continue

        original = migration.read_text(encoding="utf-8")
        backup = migration.with_suffix(".sql.before-auto-fix.bak")

        if not backup.exists():
            shutil.copy2(migration, backup)

        patched = original.replace(
            "utf8mb4_unicode_ci",
            "utf8mb4_0900_ai_ci",
        )

        checks = check_columns_by_table(patched)
        patched, changes = patch_foreign_keys(patched, checks)

        migration.write_text(patched, encoding="utf-8")

        print(f"\n[已处理] {migration}")
        print("  排序规则：utf8mb4_unicode_ci -> utf8mb4_0900_ai_ci")

        if changes:
            for change in changes:
                print(f"  CHECK 外键修复：{change}")
        else:
            print("  未发现需要修改的 CHECK 外键")

    if any_error:
        sys.exit(1)

    print("\n所有剩余迁移文件处理完成。")


if __name__ == "__main__":
    main()
PY