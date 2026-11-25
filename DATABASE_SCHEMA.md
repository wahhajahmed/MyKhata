# Database schema

Schema version: **1** (`initial_schema`). All tables are created by `src/db/migrations.ts`. Monetary values are stored as `TEXT` decimal strings; integers are used for flags, sizes, versions, and timestamps are ISO-8601 `TEXT` strings.

## Conventions

- Primary keys are UUID strings generated in application code.
- `deleted_at` provides soft deletion for parties, projects, and accounts. Historical journal rows always retain their references with `ON DELETE RESTRICT`.
- `created_at` and `updated_at` are application timestamps. Journal entries are immutable after posting.
- Foreign keys are enabled on native engines. Restore order is child-to-parent to preserve integrity.

## Core tables

### `schema_migrations`
| Column | Type | Notes |
| --- | --- | --- |
| `version` | INTEGER | Primary key |
| `name` | TEXT | Migration name |
| `applied_at` | TEXT | Application timestamp |

### `settings`
| Column | Type | Notes |
| --- | --- | --- |
| `key` | TEXT | Primary key |
| `value` | TEXT | Setting value (`base_currency`, `sync_status`, `last_sync_at`, `device_id`) |
| `updated_at` | TEXT | Last update |

### `currencies`
| Column | Type | Notes |
| --- | --- | --- |
| `code` | TEXT | Primary key, ISO-style code |
| `name` | TEXT | Display name |
| `symbol` | TEXT | Display symbol |
| `minor_units` | INTEGER | Decimal precision, default 2 |
| `is_base` | INTEGER | 1 for the base reporting currency |

Seeded: PKR (base), USD, EUR, GBP, AED, SAR.

### `exchange_rates`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `from_code`, `to_code` | TEXT | FK to `currencies` |
| `rate` | TEXT | Decimal multiplier |
| `rate_date` | TEXT | Date the rate applies to |
| `source` | TEXT | Default `manual` |
| `created_at` | TEXT | Creation timestamp |

Index: `(from_code, to_code, rate_date)`.

## Master data

### `parties`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `name` | TEXT | Person or company name |
| `type` | TEXT | `individual` or `company` |
| `phone`, `email`, `address`, `notes` | TEXT | Optional contact data |
| `opening_balance` | TEXT | Decimal default `0` |
| `opening_balance_direction` | TEXT | `none`, `receivable`, or `payable` |
| `currency` | TEXT | Default PKR |
| `is_active` | INTEGER | 1 active, 0 archived |
| `created_at`, `updated_at`, `deleted_at` | TEXT | Lifecycle timestamps |

Indexes: `name`, `(is_active, deleted_at)`.

### `projects`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `party_id` | TEXT | FK to `parties`, `RESTRICT` |
| `name` | TEXT | Project name |
| `agreed_amount` | TEXT | Decimal |
| `currency` | TEXT | Currency code |
| `start_date` | TEXT | ISO date |
| `expected_completion`, `due_date` | TEXT | Optional ISO dates |
| `status` | TEXT | `planning`, `active`, `on_hold`, `completed`, `cancelled` |
| `notes` | TEXT | Optional |
| `created_at`, `updated_at`, `deleted_at` | TEXT | Lifecycle timestamps |

Indexes: `(party_id, deleted_at)`, `due_date`.

### `accounts`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `name` | TEXT | Account name |
| `bank_name`, `nickname`, `notes` | TEXT | Optional |
| `kind` | TEXT | `bank`, `cash`, or `wallet` |
| `currency` | TEXT | Currency code |
| `opening_balance` | TEXT | Decimal default `0` |
| `is_active` | INTEGER | 1 active, 0 archived |
| `created_at`, `updated_at`, `deleted_at` | TEXT | Lifecycle timestamps |

Index: `(kind, deleted_at)`.

### `categories`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `name` | TEXT | Category name |
| `kind` | TEXT | `income` or `expense` |
| `is_active` | INTEGER | 1 active |
| `created_at`, `updated_at` | TEXT | Lifecycle timestamps |

Index: `(kind, is_active)`.

## Obligations and postings

### `obligations`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `party_id` | TEXT | FK to `parties`, `RESTRICT` |
| `project_id` | TEXT | Optional FK to `projects`, `SET NULL` |
| `direction` | TEXT | `receivable` or `payable` |
| `reference` | TEXT | Optional user reference |
| `total_amount` | TEXT | Decimal |
| `currency` | TEXT | Currency code |
| `due_date` | TEXT | Optional ISO date |
| `notes` | TEXT | Optional |
| `status` | TEXT | Default `open` |
| `created_at`, `updated_at` | TEXT | Lifecycle timestamps |

Indexes: `(party_id, direction, status)`, `(due_date, status)`.

### `transactions`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `type` | TEXT | `income`, `expense`, `receivable_creation`, `receivable_settlement`, `payable_creation`, `payable_settlement`, `transfer`, `refund`, `adjustment`, `reversal` |
| `txn_date` | TEXT | ISO date |
| `amount` | TEXT | Original decimal amount |
| `currency` | TEXT | Original currency |
| `exchange_rate` | TEXT | Decimal rate to base currency, default `1` |
| `base_amount` | TEXT | Converted decimal amount in base currency |
| `rate_date` | TEXT | Rate snapshot date |
| `party_id` | TEXT | Optional FK to `parties` |
| `project_id` | TEXT | Optional FK to `projects` |
| `source_account_id` | TEXT | Optional FK to `accounts` |
| `destination_account_id` | TEXT | Optional FK to `accounts` |
| `category_id` | TEXT | Optional FK to `categories` |
| `obligation_id` | TEXT | Optional FK to `obligations` |
| `description`, `reference` | TEXT | Optional |
| `reversal_of` | TEXT | Optional FK to original `transactions` row |
| `idempotency_key` | TEXT | Unique; duplicate submission prevention |
| `is_system` | INTEGER | 1 for generated entries |
| `created_at`, `updated_at` | TEXT | Lifecycle timestamps |

Indexes: `txn_date`, `(party_id, txn_date)`, `(project_id, txn_date)`, `(type, txn_date)`, `obligation_id`; unique `idempotency_key`.

### `journal_entries`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `transaction_id` | TEXT | FK to `transactions`, `RESTRICT` |
| `account_code` | TEXT | Ledger account code |
| `party_id` | TEXT | Optional FK to `parties` |
| `direction` | TEXT | `debit` or `credit` |
| `amount` | TEXT | Decimal amount |
| `currency` | TEXT | Currency code |
| `base_amount` | TEXT | Decimal amount in base currency |
| `created_at` | TEXT | Creation timestamp |

Indexes: `transaction_id`, `account_code`, `party_id`.

### `settlements`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `obligation_id` | TEXT | FK to `obligations`, `RESTRICT` |
| `transaction_id` | TEXT | FK to `transactions`, `RESTRICT` |
| `amount` | TEXT | Decimal payment amount |
| `currency` | TEXT | Currency code |
| `allow_excess` | INTEGER | 1 when overpayment was explicitly accepted |
| `created_at` | TEXT | Creation timestamp |

Index: `obligation_id`.

### `settlement_allocations`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `settlement_id` | TEXT | FK to `settlements`, `RESTRICT` |
| `obligation_id` | TEXT | FK to `obligations`, `RESTRICT` |
| `amount` | TEXT | Decimal allocated amount |
| `created_at` | TEXT | Creation timestamp |

## Support tables

### `attachments`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `transaction_id` | TEXT | FK to `transactions`, `RESTRICT` |
| `file_name`, `mime_type` | TEXT | File metadata |
| `data` | BLOB | File bytes (base64-wrapped in logical dumps) |
| `size` | INTEGER | Byte size |
| `created_at` | TEXT | Creation timestamp |

### `audit_logs`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `entity_type`, `entity_id`, `action` | TEXT | Audited entity and operation |
| `payload` | TEXT | Optional JSON metadata |
| `device_id` | TEXT | Optional originating device |
| `created_at` | TEXT | Creation timestamp |

Index: `(entity_type, entity_id, created_at)`.

### `devices`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key |
| `name`, `platform` | TEXT | Device description |
| `paired_at`, `public_key` | TEXT | Optional pairing metadata |
| `created_at` | TEXT | Creation timestamp |

### `sync_queue`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | Primary key and idempotency key for remote upsert |
| `entity_type`, `entity_id`, `operation` | TEXT | Change identity |
| `payload` | TEXT | Serialized change |
| `status` | TEXT | `pending`, `failed`, or `synced` |
| `attempts` | INTEGER | Retry counter |
| `last_error` | TEXT | Last sync failure |
| `created_at`, `updated_at` | TEXT | Lifecycle timestamps |

Indexes: `(status, created_at)`; unique `(entity_type, entity_id, operation)`.

## Ledger account codes

| Code pattern | Meaning |
| --- | --- |
| `ASSET:ACCOUNT:<id>` | Bank, cash, or wallet balance |
| `ASSET:RECEIVABLE:<party>` | Money owed to the user |
| `LIABILITY:PAYABLE:<party>` | Money the user owes |
| `INCOME:<category>` | Income category |
| `EXPENSE:<category>` | Expense category |

For every transaction, the sum of `base_amount` on debit rows must equal the sum on credit rows. `verifyJournal` checks this invariant across all journal rows.
