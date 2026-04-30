# 👋 Привет, новый разработчик!

Это документ для быстрого входа в проект **Crowdfunding Escrow на Solana**.

---

## 🎯 Что это за проект?

Краудфандинговая платформа на блокчейне Solana. Пользователи создают кампании, другие делают взносы (pledge). Если цель достигнута — создатель получает деньги. Если нет — взносы возвращаются.

**Стек:**
- **Smart Contract**: Rust + Anchor (Solana)
- **Frontend**: React + TypeScript + Vite
- **Wallet**: Phantom/Solflare (Solana Wallet Adapter)
- **Network**: Devnet (тестовая сеть)

---

## 📁 Структура проекта (что где)

```
crowdfunding-escrow/
│
├── 📂 programs/crowdfunding-escrow/src/
│   └── lib.rs              ⭐ ГЛАВНЫЙ ФАЙЛ КОНТРАКТА
│                           │
│                           └─ Здесь вся логика:
│                              • Создание кампании
│                              • Взносы (pledge)
│                              • Возврат средств
│                              • Получение денег создателем
│
├── 📂 app/src/             ⭐ FRONTEND (React)
│   │
│   ├── App.tsx             • Главный компонент (роутинг, wallet provider)
│   ├── main.tsx            • Точка входа
│   ├── index.css           • Стили (Tailwind)
│   │
│   ├── pages/              • Страницы:
│   │   ├── HomePage.tsx           └─ Главная (список кампаний)
│   │   ├── CreateCampaignPage.tsx └─ Создание кампании
│   │   └── CampaignDetailsPage.tsx └─ Детали + pledge/claim
│   │
│   ├── components/         • Переиспользуемые компоненты:
│   │   └── CampaignCard.tsx       └─ Карточка кампании
│   │
│   ├── hooks/              • React хуки:
│   │   └── useCampaignProgram.ts  └─ Логика взаимодействия с контрактом
│   │
│   └── utils/              • Утилиты:
│       └── constants.ts           └─ Program ID, размеры, форматирование
│
├── 📂 tests/
│   └── crowdfunding-escrow.ts  ⭐ ТЕСТЫ КОНТРАКТА
│
├── 📄 Anchor.toml          ⭐ КОНФИГ ANCHOR (program ID, network)
├── 📄 Cargo.toml           • Конфиг Rust (workspace)
├── 📄 package.json         • Конфиг frontend зависимостей
└── 📄 README_RU.md         • Полная документация
```

---

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
# Frontend
cd app && yarn install

# Проверка Rust (должно быть установлено)
rustc --version      # >= 1.70
cargo --version

# Проверка Solana
solana --version     # >= 1.16
anchor --version     # >= 0.30
```

### 2. Запуск frontend (для разработки)

```bash
cd app
yarn dev
# Открой http://localhost:3000
```

### 3. Сборка контракта

```bash
anchor build
# Артефакты появятся в target/deploy/ и target/idl/
```

### 4. Запуск тестов

```bash
# В одном терминале (валидатор)
solana-test-validator --reset

# В другом (тесты)
anchor test
```

---

## 🔑 Ключевые концепции

### PDA (Program Derived Address)

Это специальные адреса, которые контролируются программой (не имеют приватного ключа).

**В проекте используем:**

| PDA | Seeds | Для чего |
|-----|-------|----------|
| **Campaign** | `["campaign", creator, timestamp]` | Хранит данные кампании |
| **Vault** | `["vault", campaign_pubkey]` | Хранит SOL до завершения |
| **Pledge** | `["pledge", backer, campaign]` | Хранит информацию о взносе |

### Пример создания PDA в коде:

```typescript
// TypeScript (frontend)
const [campaignPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("campaign"), creator.toBuffer(), timestamp.toBuffer("le", 8)],
  PROGRAM_ID
);
```

```rust
// Rust (контракт)
#[account(
    seeds = [b"campaign", creator.key().as_ref(), clock.unix_timestamp.to_le_bytes().as_ref()],
    bump
)]
pub campaign: Account<'info, Campaign>,
```

---

## 💻 Как это работает (поток)

### Создание кампании:

```
1. Пользователь нажимает "Создать кампанию"
2. Frontend создаёт PDA для кампании и vault
3. Отправляет транзакцию на initialize_campaign()
4. Контракт создаёт аккаунты Campaign и Vault
5. Кампания появляется в списке
```

### Взнос (Pledge):

```
1. Пользователь вводит сумму
2. Frontend создаёт PDA для pledge
3. Отправляет транзакцию на pledge()
4. Контракт переводит SOL: backer → vault
5. Обновляет current_amount кампании
```

### Завершение (Claim):

```
1. Срок кампании истёк + цель достигнута
2. Создатель нажимает "Получить средства"
3. Контракт проверяет условия
4. Переводит SOL: vault → creator
5. Ставит флаг is_claimed = true
```

---

## 🧪 Тестирование контракта

Файл: `tests/crowdfunding-escrow.ts`

**Что тестируем:**

```typescript
describe("Initialize Campaign", () => {
  it("Should initialize a new campaign", async () => {
    // Создаём кампанию и проверяем поля
  });
  
  it("Should fail with invalid goal amount", async () => {
    // Проверяем ошибки валидации
  });
});

describe("Pledge to Campaign", () => {
  it("Should pledge to a campaign", async () => {
    // Вносим и проверяем баланс vault
  });
});
```

**Запуск:**
```bash
anchor test
```

---

## 🐛 Отладка

### Frontend не работает?

1. **Открой консоль (F12)** → смотри ошибки
2. **Проверь подключение кошелька** → Phantom должен быть установлен
3. **Проверь network** → Devnet в кошельке и в коде

### Контракт не компилируется?

```bash
# Очисти кэш
cargo clean
anchor clean

# Пересобери
anchor build
```

### Ошибки транзакций?

1. Проверь баланс SOL (нужен для комиссий)
2. Проверь Program ID в `Anchor.toml` и `lib.rs`
3. Смотри логи валидатора: `solana logs`

---

## 📚 Полезные ссылки

| Ресурс | Описание |
|--------|----------|
| [Anchor Book](https://book.anchor-lang.com/) | Документация Anchor |
| [Solana Docs](https://docs.solana.com/) | Документация Solana |
| [Solana Cookbook](https://solanacookbook.com/) | Рецепты для Solana |
| [Wallet Adapter](https://github.com/solana-labs/wallet-adapter) | Подключение кошельков |

---

## 🎯 С чего начать разработку?

### Хочешь изменить контракт?

1. Открой `programs/crowdfunding-escrow/src/lib.rs`
2. Найди нужную инструкцию (например, `pub fn pledge(...)`)
3. Внеси изменения
4. Запусти `anchor build`
5. Запусти `anchor test`

### Хочешь изменить frontend?

1. Открой `app/src/pages/` для страниц
2. Открой `app/src/components/` для компонентов
3. Запусти `yarn dev`
4. Изменения применяются автоматически (HMR)

### Хочешь добавить новую функцию?

**Пример: добавить счётчик просмотров кампании**

1. **Контракт** (`lib.rs`):
   ```rust
   pub struct Campaign {
       // ... существующие поля
       pub view_count: u64,  // ← новое поле
   }
   
   pub fn view_campaign(ctx: Context<ViewCampaign>) -> Result<()> {
       ctx.accounts.campaign.view_count += 1;
       Ok(())
   }
   ```

2. **Frontend** (`CampaignDetailsPage.tsx`):
   ```typescript
   const handleView = async () => {
       await program.methods.viewCampaign().rpc();
   };
   ```

3. **Тесты** (`tests/crowdfunding-escrow.ts`):
   ```typescript
   it("Should increment view count", async () => {
       // тест
   });
   ```

---

## ❓ Частые вопросы

**Q: Где взять SOL для тестов?**  
A: https://faucet.solana.com/ (вставь адрес кошелька)

**Q: Как изменить Program ID?**  
A: 
1. `solana-keygen new -o wallet.json`
2. Обнови в `lib.rs`: `declare_id!("новый_id");`
3. Обнови в `Anchor.toml`
4. `anchor build`

**Q: Frontend показывает белый экран?**  
A: 
1. Открой консоль (F12)
2. Проверь ошибки
3. Очисти кэш браузера (Ctrl+Shift+R)

**Q: Как деплоить на mainnet?**  
A: 
```bash
anchor deploy --provider.cluster mainnet
```
(но сначала тщательно протестируй на devnet!)

---

## 🆘 К кому обращаться?

- **Вопросы по контракту** → смотри `lib.rs` + Anchor Book
- **Вопросы по frontend** → смотри `app/src/` + консоль браузера
- **Ошибки транзакций** → `solana logs` + explorer.solana.com

---

**Удачи в разработке! 🚀**

Если что-то непонятно — открывай консоль, смотри логи и гугли ошибку. 
99% проблем уже кто-то решал на Stack Overflow или Discord Solana.
