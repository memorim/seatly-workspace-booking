import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Building2, CalendarDays, Check, ChevronDown, Clock3, Coffee,
  Heart, MapPin, Menu, Minus, Monitor, Plus, Search, SlidersHorizontal,
  Sparkles, Star, Users, Video, Wifi, X,
} from 'lucide-react';
import { api } from './api';
import type { BusySlot, Space } from './types';

const types = ['Все', 'Переговорная', 'Кабинет', 'Лофт', 'Студия', 'Рабочее место'];
const dates = [
  { date: '2026-07-06', day: 'Пн', number: '6' }, { date: '2026-07-07', day: 'Вт', number: '7' },
  { date: '2026-07-08', day: 'Ср', number: '8' }, { date: '2026-07-09', day: 'Чт', number: '9' },
  { date: '2026-07-10', day: 'Пт', number: '10' }, { date: '2026-07-11', day: 'Сб', number: '11' },
];
const amenityIcon = (name: string) => name.includes('Экран') || name.includes('Монитор') || name.includes('Проектор') ? <Monitor /> : name.includes('Кофе') || name.includes('Кухня') ? <Coffee /> : name.includes('Виде') ? <Video /> : <Wifi />;
const money = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function SpaceVisual({ space, large = false }: { space: Space; large?: boolean }) {
  return <div className={`space-visual ${space.image} ${large ? 'large' : ''}`} style={{ '--accent': space.accent } as React.CSSProperties}>
    <div className="window"><i /><i /><i /></div><div className="floor" />
    <div className="table"><span /><b /><i /></div><div className="chair one" /><div className="chair two" />
    <div className="plant"><i /><i /><i /></div><div className="lamp" />
    <span className="sun-patch" />
  </div>;
}

function SpaceCard({ space, selected, onSelect }: { space: Space; selected: boolean; onSelect: () => void }) {
  const [liked, setLiked] = useState(false);
  return <article className={`space-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <div className="card-media"><SpaceVisual space={space} /><button className={liked ? 'liked' : ''} onClick={e => { e.stopPropagation(); setLiked(!liked); }} aria-label="Добавить в избранное"><Heart fill={liked ? 'currentColor' : 'none'} /></button><span>{space.type}</span></div>
    <div className="card-body"><div className="card-heading"><div><h3>{space.name}</h3><p><MapPin />{space.district} · {space.address}</p></div><span><Star fill="currentColor" />{space.rating}</span></div>
      <div className="amenities">{space.amenities.slice(0, 3).map(item => <span key={item}>{amenityIcon(item)}{item}</span>)}</div>
      <footer><span><Users />до {space.capacity} гостей</span><strong>{money(space.hourly_price)} ₽<small>/ час</small></strong></footer>
    </div>
  </article>;
}

function BookingPanel({ space, onClose }: { space: Space; onClose?: () => void }) {
  const [date, setDate] = useState(dates[0].date);
  const [start, setStart] = useState('12:00');
  const [end, setEnd] = useState('14:00');
  const [guests, setGuests] = useState(Math.min(4, space.capacity));
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [form, setForm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setGuests(Math.min(4, space.capacity)); setForm(false); setSuccess(false); }, [space]);
  useEffect(() => { api.availability(space.id, date).then(v => setBusy(v.bookings)).catch(() => setBusy([])); }, [space.id, date]);
  const hours = Math.max(1, Number(end.slice(0, 2)) - Number(start.slice(0, 2)));
  const total = hours * space.hourly_price;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(''); const data = new FormData(event.currentTarget);
    try {
      await api.book({ spaceId: space.id, guestName: data.get('name'), guestEmail: data.get('email'), bookingDate: date, startTime: start, endTime: end, guests });
      setSuccess(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка бронирования'); } finally { setSaving(false); }
  };

  return <aside className="booking-panel">
    {onClose && <button className="close-panel" onClick={onClose}><X /></button>}
    {success ? <div className="booking-success"><span><Check /></span><p className="kicker">Готово</p><h2>Пространство<br />забронировано</h2><p>{dates.find(d => d.date === date)?.number} июля, {start}–{end}<br />Подтверждение отправлено на почту.</p><button className="dark-button" onClick={() => { setSuccess(false); setForm(false); }}>Вернуться к выбору</button></div> : <>
      <div className="booking-heading"><div><p className="kicker">Ваш выбор</p><h2>{space.name}</h2></div><span><Star fill="currentColor" />{space.rating}</span></div>
      <p className="booking-address"><MapPin />{space.address}</p>
      <div className="date-section"><label>Дата <span>Июль 2026 <ChevronDown /></span></label><div className="date-strip">{dates.map(item => <button key={item.date} className={date === item.date ? 'active' : ''} onClick={() => setDate(item.date)}><span>{item.day}</span><strong>{item.number}</strong></button>)}</div></div>
      <div className="time-section"><label>Время</label><div className="time-fields"><div><Clock3 /><select value={start} onChange={e => setStart(e.target.value)}>{['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'].map(v => <option key={v}>{v}</option>)}</select></div><i>—</i><div><Clock3 /><select value={end} onChange={e => setEnd(e.target.value)}>{['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(v => <option key={v}>{v}</option>)}</select></div></div>{busy.length > 0 && <p className="busy-note">Занято: {busy.map(b => `${b.start_time}–${b.end_time}`).join(', ')}</p>}</div>
      <div className="guest-row"><div><label>Гости</label><span>максимум {space.capacity}</span></div><div className="counter"><button onClick={() => setGuests(v => Math.max(1, v - 1))}><Minus /></button><strong>{guests}</strong><button onClick={() => setGuests(v => Math.min(space.capacity, v + 1))}><Plus /></button></div></div>
      {form && <form className="guest-form" onSubmit={submit}><label>Ваше имя<input name="name" minLength={2} required placeholder="Иван Петров" /></label><label>Электронная почта<input name="email" type="email" required placeholder="ivan@example.ru" /></label>{error && <p className="booking-error">{error}</p>}<button className="dark-button" disabled={saving}>{saving ? 'Бронируем…' : `Подтвердить · ${money(total)} ₽`}</button></form>}
      {!form && <><div className="price-row"><span>{money(space.hourly_price)} ₽ × {hours} ч</span><strong>{money(total)} ₽</strong></div><button className="dark-button" onClick={() => setForm(true)}>Забронировать <ArrowRight /></button><p className="safe-note"><Sparkles />Оплата после подтверждения владельцем</p></>}
    </>}
  </aside>;
}

export default function App() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [type, setType] = useState('Все');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Space | null>(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.spaces().then(data => { setSpaces(data); setSelected(data[0]); }).finally(() => setLoading(false)); }, []);
  const visible = useMemo(() => spaces.filter(space => (type === 'Все' || space.type === type) && `${space.name} ${space.type} ${space.district}`.toLowerCase().includes(query.toLowerCase())), [spaces, type, query]);
  return <div className="site-shell">
    <header className="site-header"><a className="logo"><span>S</span>seatly</a><nav><a href="#spaces">Пространства</a><a href="#how">Как это работает</a><a href="#owners">Для владельцев</a></nav><div className="header-actions"><button className="city"><MapPin />Москва<ChevronDown /></button><button className="login">Войти</button><button className="menu"><Menu /></button></div></header>
    <main>
      <section className="hero"><div className="hero-copy"><p className="kicker">Работайте там, где удобно</p><h1>Место для важных<br /><em>разговоров и идей.</em></h1><p>Переговорные, студии и тихие кабинеты<br />в вашем городе — от одного часа.</p></div><div className="hero-mark"><span>06</span><i /><small>Июль<br />Москва</small></div></section>
      <section className="search-dock"><div className="main-search"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Район, метро или название" /></div><button><CalendarDays /><span>Когда<small>6 июля, 12:00</small></span><ChevronDown /></button><button><Users /><span>Сколько человек<small>2–8 гостей</small></span><ChevronDown /></button><button className="search-button">Найти</button></section>
      <section className="catalog" id="spaces"><div className="catalog-main"><div className="catalog-heading"><div><p className="kicker">Подобрано для вас</p><h2>Пространства в Москве</h2></div><button className="filter-button"><SlidersHorizontal />Фильтры</button></div><div className="type-filter">{types.map(item => <button key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>{item}</button>)}</div>
        {loading ? <div className="catalog-loader"><span /><p>Подбираем пространства…</p></div> : <div className="space-grid">{visible.map(space => <SpaceCard key={space.id} space={space} selected={selected?.id === space.id} onSelect={() => { setSelected(space); if (window.innerWidth < 980) setMobilePanel(true); }} />)}</div>}
        {!loading && visible.length === 0 && <div className="empty"><Building2 /><h3>Ничего не нашли</h3><p>Попробуйте другой район или тип пространства.</p><button onClick={() => { setType('Все'); setQuery(''); }}>Сбросить фильтры</button></div>}
      </div>{selected && <BookingPanel space={selected} />}</section>
      <section className="how" id="how"><p className="kicker">Три простых шага</p><h2>Встреча начинается<br />с подходящего места.</h2><div><article><span>01</span><h3>Выберите</h3><p>Найдите пространство по району, формату и вместимости.</p></article><article><span>02</span><h3>Забронируйте</h3><p>Укажите время и получите подтверждение на почту.</p></article><article><span>03</span><h3>Приходите</h3><p>Администратор встретит вас и покажет всё необходимое.</p></article></div></section>
    </main>
    {mobilePanel && selected && <div className="mobile-booking"><BookingPanel space={selected} onClose={() => setMobilePanel(false)} /></div>}
  </div>;
}

