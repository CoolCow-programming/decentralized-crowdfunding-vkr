# Crowdfunding Escrow на Solana

`crowdfunding-escrow` - это демонстрационный dApp для моделирования механизма условного депонирования средств в децентрализованном краудфандинге. Средства спонсоров удерживаются в escrow-vault под управлением программы Solana/Anchor и переводятся по правилам контракта: успешное завершение кампании, возврат, milestone release или разрешение спора.

## Возможности

- Хранение средств в escrow-vault до выполнения условий финансирования
- Создание кампаний с целью сбора и дедлайном
- Взносы спонсоров через `pledge`
- `settlement` и `claim` для успешных кампаний
- Возврат средств через `cancel_pledge` при провале или отмене
- Milestone flow: создание этапов, голосование, release средств
- Dispute flow: открытие и разрешение споров арбитром
- Прозрачность операций за счет on-chain аккаунтов и событий программы

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  HomePage   │  │  Create     │  │  CampaignDetails    │ │
│  │  (список)   │  │  Campaign   │  │  (pledge, claim)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                             │
│              Solana Wallet Adapter (Phantom)                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ RPC
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Смарт-контракт (Anchor/Rust)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Campaign   │  │   Pledge    │  │      Vault          │ │
│  │  Account    │  │   Account   │  │    (PDA)            │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    Solana Blockchain
                      (Devnet/Localnet)
```

## Структура проекта

```
crowdfunding-escrow/
├── programs/
│   └── crowdfunding-escrow/
│       └── src/
│           └── lib.rs              # Смарт-контракт (Rust)
├── app/                            # Frontend (React)
│   ├── src/
│   │   ├── pages/                  # Страницы
│   │   ├── components/             # Компоненты
│   │   ├── hooks/                  # React хуки
│   │   └── utils/                  # Утилиты
│   └── package.json
├── tests/                          # Тесты контракта
│   └── crowdfunding-escrow.ts
├── Anchor.toml                     # Конфигурация Anchor
└── README_RU.md
```

## Требования

- **Node.js** >= 18
- **Yarn** >= 1.22
- **Rust** >= 1.70
- **Solana Tool Suite** >= 1.16
- **Anchor** >= 0.30
- Браузерный кошелек **Phantom** или **Solflare** для работы с UI

## Быстрый запуск в localnet

### Вариант 1. Одной командой

```bash
yarn start:local
```

Скрипт выполняет:

- переключение Solana CLI на `localhost`
- запуск `solana-test-validator`
- `airdrop` тестовых SOL для CLI-кошелька
- `anchor build`
- `anchor deploy --provider.cluster localnet`
- инициализацию `config` аккаунта
- запуск frontend на `http://127.0.0.1:3000`

### Вариант 2. Пошагово

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd crowdfunding-escrow
```

### 2. Установка зависимостей

```bash
yarn install
cd app
yarn install
cd ..
```

### 3. Подготовка Solana CLI

```bash
solana config set --url localhost
solana-keygen new
solana address
```

Если keypair уже существует в `~/.config/solana/id.json`, повторно создавать его не нужно.

### 4. Запуск локального валидатора и пополнение баланса

```bash
solana-test-validator --reset
solana airdrop 100 --url localhost
```

### 5. Сборка и деплой программы

```bash
anchor build
anchor deploy --provider.cluster localnet
```

### 6. Инициализация конфигурации протокола

```bash
yarn init:localnet-config
```

Без этого шага `settlement` и `claim` для локальной демонстрации работать не будут.

### 7. Запуск frontend

```bash
cd app
yarn dev
```

Frontend по умолчанию доступен по адресу: **http://127.0.0.1:3000**

## Подключение кошелька к localnet

Для работы через интерфейс нужен браузерный кошелек:

1. Установите **Phantom** или **Solflare**
2. Включите в кошельке сеть **Localnet** или добавьте RPC `http://127.0.0.1:8899`
3. Импортируйте или создайте тестовый кошелек
4. Пополните его тестовыми SOL через локальный airdrop или transfer
5. Нажмите `Select Wallet` в приложении

CLI-кошелек для `anchor deploy` и браузерный кошелек для UI могут быть разными.

## Тестирование

### Запуск тестов одной командой

```bash
yarn test:oneclick
```

### Запуск тестов вручную

```bash
solana config set --url localhost
solana-test-validator --reset

anchor test --skip-local-validator
```

## Основные пользовательские сценарии

### 1. Создание кампании

1. Нажмите **"Создать кампанию"**
2. Заполните форму:
   - Название (до 100 символов)
   - Описание (до 1000 символов)
   - Цель сбора (в SOL)
   - Дата окончания
3. Подтвердите транзакцию в кошельке

### 2. Внесение взноса

1. Выберите кампанию из списка
2. Введите сумму взноса
3. Нажмите **"Внести"**
4. Подтвердите транзакцию

### 3. Settlement и получение средств

Если цель достигнута или дедлайн истек, кампания может перейти в `settlement`:

- `settle_campaign` переводит кампанию в итоговое состояние по правилам контракта
- `claim` позволяет создателю получить средства в single-shot сценарии
- для кампаний с milestones применяется поэтапный release, а не общий `claim`

### 4. Возврат средств

Спонсор может вернуть средства, если:

- кампания завершилась неуспешно
- кампания была отменена
- контракт перевел кампанию в режим возврата

### 5. Milestones и disputes

Для кампаний с этапным финансированием доступны:

- `create_milestone`
- `submit_milestone`
- `vote_milestone`
- `finalize_milestone`
- `release_milestone_funds`
- `open_dispute`
- `resolve_dispute`

## Конфигурация

### Сети

| Сеть | RPC URL | Использование |
|------|---------|---------------|
| Localnet | `http://127.0.0.1:8899` | Локальная разработка и защита |
| Devnet | `https://api.devnet.solana.com` | Удаленное тестирование |

### Program ID

```text
FWh6EtpM5usrduc89K6YEQZ6GQ5UmycGHfM6VSrPcpUz
```

## Основные инструкции программы

- `initialize_config`
- `initialize_campaign`
- `pledge`
- `cancel_pledge`
- `claim`
- `finalize_campaign`
- `settle_campaign`
- `cancel_campaign`
- `extend_campaign`
- milestone/dispute инструкции

## Безопасность и ограничения

- Все средства удерживаются в **PDA vault**
- Только допустимые роли могут вызывать чувствительные операции
- Повторный `claim` и повторный `refund` блокируются состоянием контракта
- Название кампании: до **100** символов
- Описание кампании: до **1000** символов
- Описание milestone: до **300** символов
- Минимальная сумма и цель должны быть больше нуля на уровне контракта

## Лицензия

MIT
