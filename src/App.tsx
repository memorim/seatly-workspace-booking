import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Building2, Check, Coffee, Heart, MapPin, Monitor, Sparkles, Star, Users, Video, Wifi, X } from 'lucide-react';
import { api } from './api';
import type { Booking, BusySlot, Space, User } from './types';
const types = ['Все', 'Переговорная', 'Кабинет', 'Лофт', 'Студия', 'Рабочее место'];
const money = (v: number) => new Intl.NumberFormat('ru-RU').format(v);
const tomorrow = () => new Date(Date.now() + 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
const dateLabel = (v: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v + 'T12:00:00+03:00'));
const amenityIcon = (name: string) => name.includes('Экран') || name.includes('Монитор') || name.includes('Проектор') ? <Monitor /> : name.includes('Кофе') || name.includes('Кухня') ? <Coffee /> : name.includes('Виде') ? <Video /> : <Wifi />;
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось выполнить запрос';
function SpaceVisual({ space, large = false }: { space: Space; large?: boolean }) {
  return <div className={`space-visual ${space.image} ${large ? 'large' : ''}`} style={{ '--accent': space.accent } as React.CSSProperties}>
    <div className="window"><i /><i /><i /></div><div className="floor" />
    <div className="table"><span /><b /><i /></div><div className="chair one" /><div className="chair two" />
    <div className="plant"><i /><i /><i /></div><div className="lamp" />
    <span className="sun-patch" />
  </div>;
}

function SpaceCard({ space, selected, liked, onLike, onSelect }: { space: Space; selected: boolean; liked: boolean; onLike: () => void; onSelect: () => void }) {
  return <article className={`space-card ${selected ? 'selected' : ''}`}>
    <div className="card-media"><SpaceVisual space={space} /><button className={liked ? 'liked' : ''} onClick={onLike} aria-label={`${liked ? 'Убрать из избранного' : 'Добавить в избранное'} ${space.name}`} aria-pressed={liked}><Heart fill={liked ? 'currentColor' : 'none'} /></button><span>{space.type}</span></div>
    <div className="card-body"><div className="card-heading"><div><h3><button className="space-title" onClick={onSelect} aria-label={`Выбрать ${space.name}`}>{space.name} <ArrowRight size={13} /></button></h3><p><MapPin />{space.district} · {space.address}</p></div><span><Star fill="currentColor" />{space.rating}</span></div>
      <div className="amenities">{space.amenities.slice(0, 3).map(item => <span key={item}>{amenityIcon(item)}{item}</span>)}</div>
      <footer><span><Users />до {space.capacity} гостей</span><strong>{money(space.hourly_price)} ₽<small>/ час</small></strong></footer>
    </div>
  </article>;
}
function BookingPanel({ space, date, setDate, user, onLogin, onClose, revision }: { space: Space; date: string; setDate: (v: string) => void; user: User | null; onLogin: () => void; onClose?: () => void; revision: number }) {
  const [start, setStart] = useState('12:00'); const [end, setEnd] = useState('14:00');
  const [guests, setGuests] = useState(1); const [busy, setBusy] = useState<BusySlot[]>([]);
  const [form, setForm] = useState(false); const [success, setSuccess] = useState(false);
  const [error, setError] = useState(''); const [availabilityError, setAvailabilityError] = useState('');
  const [checking, setChecking] = useState(true); const [saving, setSaving] = useState(false); const [reload, setReload] = useState(0);
  useEffect(() => { setGuests(Math.min(4, space.capacity)); setForm(false); setSuccess(false); setError(''); }, [space.id]);
  useEffect(() => {
    let active = true; setChecking(true); setAvailabilityError('');
    api.availability(space.id, date).then(v => { if (active) setBusy(v.bookings); }).catch(e => { if (active) setAvailabilityError(message(e)); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [space.id, date, revision, reload]);
  const hours = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3))) / 60;
  const conflict = busy.some(b => b.start_time < end && b.end_time > start);
  const total = Math.round(Math.max(0, hours) * space.hourly_price);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(''); const data = new FormData(e.currentTarget);
    try { await api.book({ spaceId: space.id, guestName: data.get('name'), guestEmail: data.get('email'), bookingDate: date, startTime: start, endTime: end, guests }); setSuccess(true); setReload(v => v + 1); }
    catch (e) { setError(message(e)); setReload(v => v + 1); } finally { setSaving(false); }
  };
  return <aside className="booking-panel" aria-label="Бронирование">
    {onClose && <button className="close-panel" onClick={onClose} aria-label="Закрыть бронирование"><X /></button>}
    {success ? <div className="booking-success" role="status"><span><Check /></span><p className="kicker">Заявка сохранена</p><h2>Ожидает подтверждения владельцем</h2><p>{dateLabel(date)}, {start}–{end}. Реальные услуги и письма не подключены.</p><button className="dark-button" onClick={onLogin}>Мои бронирования</button></div> : <>
      <div className="booking-heading"><div><p className="kicker">Ваш выбор</p><h2>{space.name}</h2></div><span><Star fill="currentColor" />{space.rating}</span></div>
      <p className="booking-address"><MapPin />{space.address}</p>
      <label className="booking-date">Дата бронирования<input type="date" min={tomorrow()} value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setSuccess(false); } }} required /></label>
      <div className="time-section"><div className="time-fields"><label>Начало<input type="time" step="1800" min="08:00" max="21:00" value={start} onChange={e => setStart(e.target.value)} required /></label><label>Окончание<input type="time" step="1800" min="09:00" max="22:00" value={end} onChange={e => setEnd(e.target.value)} required /></label></div><p className="busy-note">{checking ? 'Проверяем доступность…' : busy.length ? 'Занято: ' + busy.map(b => `${b.start_time}–${b.end_time}`).join(', ') : 'На выбранную дату свободно'}</p>
        {availabilityError && <p className="booking-error" role="alert">{availabilityError} <button onClick={() => setReload(v => v + 1)}>Повторить проверку</button></p>}
        {conflict && <p className="booking-error">Выбранный интервал пересекается с бронированием.</p>}
      </div>
      <label className="booking-date">Количество гостей<input type="number" min="1" max={space.capacity} value={guests} onChange={e => setGuests(Number(e.target.value))} /></label>
      <div className="price-row"><span>{money(space.hourly_price)} ₽ × {Math.max(0, hours)} ч</span><strong>{money(total)} ₽</strong></div>
      {form && user ? <form className="guest-form" onSubmit={submit}><label>Ваше имя<input name="name" minLength={2} maxLength={80} required defaultValue={user.name} /></label><label>Электронная почта<input name="email" type="email" required defaultValue={user.email} /></label>{error && <p className="booking-error" role="alert">{error}</p>}<button className="dark-button" disabled={saving || checking || !!availabilityError || conflict || hours < 1 || guests < 1 || guests > space.capacity}>{saving ? 'Сохраняем…' : `Отправить заявку · ${money(total)} ₽`}</button></form> : <button className="dark-button" onClick={() => user ? setForm(true) : onLogin()} disabled={checking || !!availabilityError || conflict || hours < 1}>{user ? 'Забронировать' : 'Войти для бронирования'} <ArrowRight /></button>}
      <p className="safe-note"><Sparkles />Демонстрация: используйте вымышленные контактные данные.</p>
    </>}
  </aside>;
}
export default function App() {
  const [spaces, setSpaces] = useState<Space[]>([]); const [type, setType] = useState('Все'); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Space | null>(null); const [mobilePanel, setMobilePanel] = useState(false);
  const [compact, setCompact] = useState(() => window.innerWidth < 980); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [date, setDate] = useState(tomorrow); const [capacity, setCapacity] = useState(1); const [onlyLiked, setOnlyLiked] = useState(false);
  const [favorites, setFavorites] = useState<number[]>(() => { try { const v = JSON.parse(localStorage.getItem('seatly-favorites') || '[]'); return Array.isArray(v) ? v.filter(Number.isInteger) : []; } catch { return []; } });
  const [user, setUser] = useState<User | null>(null); const [mode, setMode] = useState('server'); const [account, setAccount] = useState(false); const [bookings, setBookings] = useState<Booking[]>([]);
  const [accountError, setAccountError] = useState(''); const [accountLoading, setAccountLoading] = useState(false); const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState('guest@seatly.example'); const dialog = useRef<HTMLDialogElement>(null);
  const load = async () => { setLoading(true); setError(''); try { const [items, session] = await Promise.all([api.spaces(), api.session()]); setSpaces(items); setSelected(v => v || items[0]); setUser(session.user); setMode(session.mode); } catch (e) { setError(message(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); const media = window.matchMedia('(max-width:979px)'); const resize = () => setCompact(media.matches); media.addEventListener('change', resize); return () => media.removeEventListener('change', resize); }, []);
  useEffect(() => { if (account) dialog.current?.showModal(); else dialog.current?.close(); }, [account]);
  const loadBookings = async () => { setAccountLoading(true); setAccountError(''); try { setBookings(await api.bookings()); } catch (e) { setAccountError(message(e)); } finally { setAccountLoading(false); } };
  useEffect(() => { if (account && user) void loadBookings(); }, [account, user]);
  const signIn = async (email: string, password: string) => { setAccountLoading(true); setAccountError(''); try { setUser(await api.login(email, password)); } catch (e) { setAccountError(message(e)); } finally { setAccountLoading(false); } };
  const update = async (b: Booking, confirm: boolean) => { setAccountLoading(true); setAccountError(''); try { if (confirm) await api.confirm(b.id); else await api.cancel(b.id); await loadBookings(); setRevision(v => v + 1); } catch (e) { setAccountError(message(e)); } finally { setAccountLoading(false); } };
  const visible = useMemo(() => spaces.filter(s => (type === 'Все' || s.type === type) && s.capacity >= capacity && (!onlyLiked || favorites.includes(s.id)) && `${s.name} ${s.type} ${s.district}`.toLowerCase().includes(query.toLowerCase())), [spaces, type, query, capacity, onlyLiked, favorites]);
  const like = (id: number) => { const next = favorites.includes(id) ? favorites.filter(v => v !== id) : [...favorites, id]; try { localStorage.setItem('seatly-favorites', JSON.stringify(next)); setFavorites(next); } catch { setError('Не удалось сохранить избранное: проверьте доступ к хранилищу браузера'); } };
  const status: Record<string, string> = { pending: 'Ожидает подтверждения', confirmed: 'Подтверждено', cancelled: 'Отменено' };
  return <div className="site-shell">
    <header className="site-header"><a className="logo" href="#"><span>S</span>seatly</a><nav><a href="#spaces">Пространства</a><a href="#how">Как это работает</a><button className="space-title" onClick={() => setAccount(true)}>Личный кабинет</button></nav><div className="header-actions"><span className="city"><MapPin />Москва</span><button className="login" onClick={() => setAccount(true)}>{user ? user.name : 'Войти'}</button></div></header>
    <main><section className="hero"><div className="hero-copy"><p className="kicker">Работайте там, где удобно</p><h1>Место для важных<br /><em>разговоров и идей.</em></h1><p>Переговорные, студии и тихие кабинеты<br />в вашем городе — от одного часа.</p></div><div className="hero-mark"><span>{new Date().getDate()}</span><i /><small>{new Date().toLocaleDateString('ru-RU', { month: 'long' })}<br />Москва</small></div></section>
      <section className="search-dock"><label className="main-search">Поиск<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Район, метро или название" /></label><label className="search-field">Дата<input type="date" min={tomorrow()} value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label><label className="search-field">Гостей<input type="number" min="1" max="24" value={capacity} onChange={e => setCapacity(Math.min(24, Math.max(1, Number(e.target.value))))} /></label><button className="search-button" onClick={() => document.getElementById('spaces')?.scrollIntoView({ behavior: 'smooth' })}>Найти</button></section>
      <section className="catalog" id="spaces"><div className="catalog-main"><div className="catalog-heading"><div><p className="kicker">Подобрано для вас</p><h2>Пространства в Москве</h2></div><button className="filter-button" aria-pressed={onlyLiked} onClick={() => setOnlyLiked(v => !v)}><Heart />{onlyLiked ? 'Показать все' : 'Избранное'}</button></div><div className="type-filter">{types.map(item => <button key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>{item}</button>)}</div>
        {error && <p role="alert" className="booking-error">{error} <button onClick={() => void load()}>Повторить загрузку</button></p>}
        {loading ? <p role="status">Подбираем пространства…</p> : <div className="space-grid">{visible.map(space => <SpaceCard key={space.id} space={space} selected={selected?.id === space.id} liked={favorites.includes(space.id)} onLike={() => like(space.id)} onSelect={() => { setSelected(space); setMobilePanel(true); }} />)}</div>}
        {!loading && !error && visible.length === 0 && <div className="empty"><Building2 /><h3>Ничего не нашли</h3><p>Попробуйте другой район или тип пространства.</p><button onClick={() => { setType('Все'); setQuery(''); setCapacity(1); setOnlyLiked(false); }}>Сбросить фильтры</button></div>}
      </div>{selected && !compact && <BookingPanel key={selected.id} space={selected} date={date} setDate={setDate} user={user} onLogin={() => setAccount(true)} revision={revision} />}</section>
      <section className="how" id="how"><p className="kicker">Три простых шага</p><h2>Встреча начинается<br />с подходящего места.</h2><div><article><span>01</span><h3>Выберите</h3><p>Найдите пространство по району, формату и вместимости.</p></article><article><span>02</span><h3>Забронируйте</h3><p>Войдите как гость и отправьте демонстрационную заявку.</p></article><article><span>03</span><h3>Проверьте статус</h3><p>Владелец подтверждает заявку; гость может отменить её в личном кабинете.</p></article></div></section>
    </main>
    {mobilePanel && selected && compact && <div className="mobile-booking"><BookingPanel key={selected.id} space={selected} date={date} setDate={setDate} user={user} onLogin={() => setAccount(true)} onClose={() => setMobilePanel(false)} revision={revision} /></div>}
    <dialog ref={dialog} className="account-dialog" onCancel={() => setAccount(false)}><header><h2>{user ? user.role === 'owner' ? 'Кабинет владельца' : 'Мои бронирования' : 'Вход в демонстрацию'}</h2><button onClick={() => setAccount(false)} aria-label="Закрыть личный кабинет"><X /></button></header>
      {accountError && <p role="alert">{accountError}</p>}
      {user ? <><p>{user.name} · {user.email}</p><button disabled={accountLoading} onClick={() => void api.logout().then(() => { setUser(null); setBookings([]); }).catch(e => setAccountError(message(e)))}>Выйти</button>{accountLoading && <p role="status">Загрузка…</p>}{!accountLoading && !bookings.length && <p>У вас пока нет бронирований.</p>}{bookings.map(b => <article className="booking-record" key={b.id}><h3>{b.space_name}</h3><p>{dateLabel(b.booking_date)} · {b.start_time}–{b.end_time} · {money(b.total_price)} ₽</p><p>{b.guest_name} · <strong>{status[b.status] || b.status}</strong></p>{b.status !== 'cancelled' && <div>{user.role === 'owner' && b.status === 'pending' && <button disabled={accountLoading} onClick={() => void update(b, true)}>Подтвердить бронирование №{b.id}</button>}<button disabled={accountLoading} onClick={() => void update(b, false)}>Отменить бронирование №{b.id}</button></div>}</article>)}</> : mode === 'browser' ? <><p>Браузерная демонстрация ролей. Все данные остаются на этом устройстве.</p><button className="dark-button" onClick={() => void signIn('guest@seatly.example', '')}>Демо-гость</button><button className="dark-button" onClick={() => void signIn('owner@seatly.example', '')}>Демо-владелец</button></> : <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void signIn(String(data.get('email')), String(data.get('password'))); }}><label>Демонстрационный аккаунт<select name="email" value={email} onChange={e => setEmail(e.target.value)}><option value="guest@seatly.example">Гость</option><option value="owner@seatly.example">Владелец</option></select></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label><p>Демо-пароль: {email.startsWith('guest') ? 'GuestDemo2026!' : 'OwnerDemo2026!'}</p><button className="dark-button" disabled={accountLoading}>Войти в аккаунт</button></form>}
    </dialog>
  </div>;
}
