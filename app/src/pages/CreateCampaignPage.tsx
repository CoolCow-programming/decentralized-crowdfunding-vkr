import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCampaignProgram } from '../hooks/useCampaignProgram';

interface CampaignFormState {
  title: string;
  description: string;
  goalAmount: string;
  endDate: string;
}

const EMPTY_FORM: CampaignFormState = {
  title: '',
  description: '',
  goalAmount: '',
  endDate: '',
};

export default function CreateCampaignPage() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const { createCampaign, error } = useCampaignProgram();

  const [formData, setFormData] = useState<CampaignFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const minEndDate = useMemo(
    () => new Date(Date.now() + 60000).toISOString().slice(0, 16),
    []
  );
  const titleRemaining = 100 - formData.title.length;
  const descriptionRemaining = 1000 - formData.description.length;

  const updateField = (
    field: keyof CampaignFormState,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const validateForm = (): string | null => {
    const trimmedTitle = formData.title.trim();
    const trimmedDescription = formData.description.trim();
    const goalAmountSol = parseFloat(formData.goalAmount);
    const endTime = Math.floor(new Date(formData.endDate).getTime() / 1000);

    if (!trimmedTitle) return 'Введите название кампании';
    if (!trimmedDescription) return 'Введите описание кампании';
    if (!Number.isFinite(goalAmountSol) || goalAmountSol <= 0) {
      return 'Введите корректную цель сбора в SOL';
    }
    if (goalAmountSol < 0.01) {
      return 'Минимальная цель для UX установлена на уровне 0.01 SOL';
    }
    if (!Number.isFinite(endTime)) return 'Выберите корректную дату окончания';
    if (endTime <= Date.now() / 1000) {
      return 'Дата окончания должна быть в будущем';
    }

    return null;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!publicKey) {
      setSubmitError('Подключите кошелек');
      return;
    }

    setLoading(true);
    setSubmitError(null);

    try {
      const validationError = validateForm();
      if (validationError) {
        throw new Error(validationError);
      }

      const goalAmountSol = parseFloat(formData.goalAmount);
      const endTime = Math.floor(new Date(formData.endDate).getTime() / 1000);

      const result = await createCampaign(
        formData.title.trim(),
        formData.description.trim(),
        goalAmountSol,
        endTime
      );

      if (result) {
        setFormData(EMPTY_FORM);
        navigate(`/campaign/${result.toBase58()}`);
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при создании кампании');
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <div className="card">
          <p className="section-kicker mb-3">Создание кампании</p>
          <h2 className="terminal-title mb-4 text-2xl font-bold" style={{ color: 'var(--ink)' }}>Требуется подключение</h2>
          <p className="mb-6" style={{ color: 'var(--muted)' }}>
            Подключите кошелек для создания кампании.
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            После подключения вы сможете задать цель, дедлайн и описание кампании.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel">
          <p className="section-kicker">Новая кампания</p>
          <h1 className="terminal-title mt-3 text-4xl font-black" style={{ color: 'var(--ink)' }}>
            Конфигурация escrow-кампании
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8" style={{ color: 'var(--muted)' }}>
            Здесь задаётся on-chain карточка проекта: цель сбора, дедлайн и описание. После создания средства спонсоров будут поступать в vault кампании, а не напрямую автору.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="status-chip">Campaign PDA</span>
            <span className="status-chip">Vault PDA</span>
            <span className="status-chip">Goal / Deadline Guard</span>
          </div>
        </div>

        <div className="glass-panel">
          <p className="section-kicker">Жизненный цикл</p>
          <div className="mt-5 space-y-4">
            <div className="info-strip">
              <p className="panel-heading">После создания</p>
              <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Кампания получает статус `Active`</p>
            </div>
            <div className="info-strip">
              <p className="panel-heading">Во время сбора</p>
              <p className="mt-2">Backer создаёт `pledge`, а средства уходят в escrow vault под контролем смарт-контракта.</p>
            </div>
            <div className="info-strip">
              <p className="panel-heading">После дедлайна или успеха</p>
              <p className="mt-2">Кампания переходит к settlement: release, milestone-flow или refund в зависимости от состояния.</p>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div>
              <label htmlFor="title" className="label">
                Название кампании
              </label>
              <input
                id="title"
                type="text"
                value={formData.title}
                onChange={(event) => updateField('title', event)}
                className="input-field"
                placeholder="Например: Orbital Habitat Prototype"
                maxLength={100}
                required
              />
              <div className="mt-1 flex justify-between text-xs">
                <span style={{ color: 'var(--muted)' }}>Максимум 100 символов</span>
                <span style={{ color: 'var(--muted)' }}>{titleRemaining}</span>
              </div>
            </div>

            <div>
              <label htmlFor="description" className="label">
                Описание
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(event) => updateField('description', event)}
                className="input-field min-h-[150px]"
                placeholder="Опишите цель кампании, назначение средств и ожидаемый результат..."
                maxLength={1000}
                required
              />
              <div className="mt-1 flex justify-between text-xs">
                <span style={{ color: 'var(--muted)' }}>Детализация сценария использования средств</span>
                <span style={{ color: 'var(--muted)' }}>{descriptionRemaining}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
            <p className="panel-heading">Предпросмотр</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="panel-heading">Модель</p>
                <p className="mt-1 font-semibold" style={{ color: 'var(--cyan)' }}>Escrow / условная выдача</p>
              </div>
              <div>
                <p className="panel-heading">Цель</p>
                <p className="mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                  {formData.goalAmount ? `${formData.goalAmount} SOL` : '—'}
                </p>
              </div>
              <div>
                <p className="panel-heading">Дедлайн</p>
                <p className="mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                  {formData.endDate || '—'}
                </p>
              </div>
              <div>
                <p className="panel-heading">Начальный статус</p>
                <p className="mt-1 font-semibold" style={{ color: 'var(--lime)' }}>Активна</p>
              </div>
              <div>
                <p className="panel-heading">Escrow поведение</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                  До settlement средства будут удерживаться внутри vault кампании.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl p-4" style={{ border: '1px solid var(--info-border)', background: 'var(--info-bg)' }}>
              <p className="panel-heading">Что показать на защите</p>
              <div className="mt-3 space-y-3 text-sm" style={{ color: 'var(--info-text)' }}>
                <p>1. Создание кампании и появление новой PDA в реестре.</p>
                <p>2. Внесение pledge и рост суммы в escrow.</p>
                <p>3. Settlement, milestone release или refund по состоянию кампании.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label htmlFor="goalAmount" className="label">
              Цель сбора (SOL)
            </label>
            <input
              id="goalAmount"
              type="number"
              step="0.01"
              min="0.01"
              value={formData.goalAmount}
              onChange={(event) => updateField('goalAmount', event)}
              className="input-field"
              placeholder="10"
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              Минимальный UX-порог: 0.01 SOL
            </p>
          </div>

          <div>
            <label htmlFor="endDate" className="label">
              Дата окончания
            </label>
            <input
              id="endDate"
              type="datetime-local"
              value={formData.endDate}
              onChange={(event) => updateField('endDate', event)}
              className="input-field"
              min={minEndDate}
              required
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              Дедлайн должен быть в будущем
            </p>
          </div>
        </div>

        {(error || submitError) && (
          <div
            className="rounded-xl p-4"
            style={{ border: '1px solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }}
          >
            {error || submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? 'Создание...' : 'Создать кампанию'}
        </button>
      </form>
    </div>
  );
}
