import { useEffect, useRef, useState } from 'react';
import { api } from './api';
const titles = [
  'Начнём с гостя',
  'Подтвердим как владелец',
  'Перенесём встречу',
  'Отменим учебную заявку',
  'Сценарий завершён',
];
export function GuidedDemo({
  mode,
  authenticated,
  onClose,
  onRefresh,
  onProgress,
  onComplete,
}: {
  mode: string;
  authenticated: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onProgress: (date: string) => void;
  onComplete: (name: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef(crypto.randomUUID()),
    prepared = useRef<Record<string, unknown> | null>(null),
    booking = useRef<{ id: number } | null>(null),
    moved = useRef<Record<string, unknown> | null>(null),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const role = (name: 'guest' | 'owner') =>
    api.login(name + '@seatly.example', name === 'guest' ? 'GuestDemo2026!' : 'OwnerDemo2026!');
  async function slot(days: number) {
    const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
      taken = (await api.availability(3, date)).bookings;
    for (let hour = 8; hour < 22; hour++) {
      const startTime = String(hour).padStart(2, '0') + ':00',
        endTime = String(hour + 1).padStart(2, '0') + ':00';
      if (!taken.some((t) => t.start_time < endTime && t.end_time > startTime))
        return { bookingDate: date, startTime, endTime, guests: 1 };
    }
    throw new Error('На учебную дату нет свободного часа. Попробуйте позже.');
  }
  const act = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (step === 0) {
        await role('guest');
        prepared.current ??= {
          spaceId: 3,
          guestName: 'Учебный гость ' + key.current.slice(0, 8),
          guestEmail: 'synthetic@example.com',
          ...(await slot(3)),
        };
        booking.current = await api.book(prepared.current, key.current);
        onProgress(String(prepared.current.bookingDate));
      } else if (step === 1) {
        await role('owner');
        const current = (
          await api.bookingPage({ search: String(prepared.current!.guestName) })
        ).items.find((b) => b.id === booking.current!.id);
        if (current?.status !== 'confirmed') await api.confirm(booking.current!.id);
      } else if (step === 2) {
        moved.current ??= await slot(4);
        await api.reschedule(booking.current!.id, moved.current);
        onProgress(String(moved.current.bookingDate));
      } else if (step === 3) {
        await role('guest');
        await api.cancel(booking.current!.id);
      }
      await onRefresh();
      setStep((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить шаг');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="account-dialog guided-demo"
      aria-labelledby="guided-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="guided-title">{titles[step]}</h2>
        <button onClick={close} aria-label="Закрыть демонстрацию">
          ×
        </button>
      </header>
      <p>Знакомство с проектом · шаг {step + 1} из 5</p>
      <p>
        {
          [
            'Пройдём путь заявки на Quiet Corner: создание, подтверждение, перенос и отмена. В сценарии можно попробовать роли гостя и владельца.',
            'Заявка ожидает владельца. Переключим учебную роль и подтвердим время.',
            'Перенесём заявку на следующий день. Цена пересчитается, подтверждение понадобится снова.',
            'Отменим только созданную этим сценарием заявку и освободим время.',
            'Заявка сохранена в истории как отменённая. Вы прошли создание, подтверждение, перенос и отмену.',
          ][step]
        }
      </p>
      {booking.current && <p>Учебная заявка №{booking.current.id}</p>}
      {error && <p role="alert">{error}</p>}
      {mode === 'hosted' && !authenticated ? (
        <a
          className="dark-button"
          href="/signin-with-chatgpt?return_to=/seatly/index.html"
          target="_top"
        >
          Войти для демонстрации
        </a>
      ) : step < 4 ? (
        <button className="dark-button" disabled={busy} onClick={() => void act()}>
          {busy
            ? 'Выполняем шаг…'
            : [
                'Создать учебную заявку',
                'Подтвердить как владелец',
                'Перенести на следующий день',
                'Отменить учебную заявку',
              ][step]}
        </button>
      ) : (
        <button
          className="dark-button"
          onClick={() => {
            dialog.current?.close();
            onComplete(String(prepared.current!.guestName));
          }}
        >
          Посмотреть учебную заявку
        </button>
      )}
    </dialog>
  );
}
