"""Арифметические агрегаты событий. Денежные значения наружу — строки."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo
import os

TZ = ZoneInfo('Asia/Tashkent')
MONEY = Decimal('0.01')

def timestamp(value):
    return value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))

def money(value):
    return None if value is None else str(Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP))

def median(values):
    values = sorted(Decimal(v) for v in values if v is not None)
    n = len(values)
    return None if not n else (values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2)

def change(before, after):
    return None if before in (None, 0) or after is None else money((Decimal(after) / Decimal(before) - 1) * 100)

def known_events(events, cutoff):
    """Дедупликация и point-in-time фильтр; поздние исправления не известны заранее."""
    unique = {str(e['event_id']): e for e in events if timestamp(e['recorded_at']) <= cutoff and timestamp(e['occurred_at']) <= cutoff}
    return sorted(unique.values(), key=lambda e: (timestamp(e['occurred_at']), str(e['event_id'])))

def sales_example(opening, sales, prices):
    observed = [Decimal(p) for p in prices if p is not None]
    return {'ending_stock': opening - sum(sales), 'net_units_sold': sum(sales),
            'sales_changes_pct': [change(a, b) for a, b in zip(sales, sales[1:])],
            'own_price_change_pct': change(observed[0], observed[-1]) if observed else None,
            'price_trend': 'insufficient_data', 'forecast_status': 'insufficient_data'}

def forecast_status(series, cutoff):
    observed = [s for s in series if s['date'] < cutoff.astimezone(TZ).date().isoformat() and s.get('transaction_price_median')]
    return {'status': 'insufficient_data' if len(observed) < 180 else 'disabled',
            'predicted_price': None, 'lower': None, 'upper': None,
            'reason': 'Недостаточно наблюдений для временной проверки' if len(observed) < 180 else 'Экспериментальная модель не обучалась; качество не заявляется'}

def aggregate(events, cutoff, *, scope='platform', supplier=None, location='all', terms='2-9', origin='synthetic', warehouses=None):
    warehouses = warehouses or {}
    today = cutoff.astimezone(TZ).date()
    start = today - timedelta(days=180)
    source = [e for e in known_events(events, cutoff) if e['data_origin'] == origin]
    def belongs(e):
        info = warehouses.get(str(e.get('warehouse_id')), {})
        return (supplier is None or str(info.get('organization_id', e['organization_id'])) == supplier) and (location == 'all' or info.get('location_id', e['payload'].get('location')) == location)
    source = [e for e in source if belongs(e)]
    returned = defaultdict(int)
    for e in source:
        if e['type'] == 'ReturnAccepted': returned[str(e['payload']['order_id'])] += int(e['payload']['quantity'])
    trades = []
    observed_receipt_days = set()
    exclusions = 0
    seen_lines = set()
    for e in source:
        p = e['payload']
        if e['type'] != 'ReceiptAccepted' or p.get('terms_group') != terms: continue
        if p.get('currency') != 'UZS' or p.get('payment_terms') != 'bank_transfer' or p.get('price_basis') != 'seller_final':
            exclusions += 1; continue
        line = (str(p.get('order_id', e['aggregate_id'])), terms)
        if line in seen_lines: continue
        seen_lines.add(line)
        q = int(p['quantity']) - returned[line[0]]
        if q < 0 or p.get('anomaly') or e.get('verification_level') not in ('platform_confirmed', 'synthetic_confirmed'):
            exclusions += 1; continue
        observed_receipt_days.add(timestamp(e['occurred_at']).astimezone(TZ).date())
        if q == 0: continue
        trades.append({'date': timestamp(e['occurred_at']).astimezone(TZ).date(), 'price': Decimal(p['unit_price']) if p.get('unit_price') is not None else None,
                       'quantity': q, 'supplier': str(p['supplier_id']), 'order': line[0]})
    by_day = defaultdict(list)
    for trade in trades: by_day[trade['date']].append(trade)
    # Запасы считаются по складу/SKU, а не по количеству объявлений.
    stock = defaultdict(int); reserved = defaultdict(int); verified = {}
    current_offers = {}
    source_index = 0
    series = []
    first_known = min((timestamp(e['occurred_at']).astimezone(TZ).date() for e in source), default=today)
    # Consume all prior movements to obtain the opening balance of the displayed window.
    for offset in range(181):
        day = start + timedelta(days=offset)
        end = min(datetime.combine(day+timedelta(days=1), datetime.min.time(), TZ).astimezone(timezone.utc), cutoff)
        while source_index < len(source) and timestamp(source[source_index]['occurred_at']) < end:
            e = source[source_index]; p = e['payload']; warehouse = str(e.get('warehouse_id'))
            if 'on_hand_delta' in p:
                stock[warehouse] += int(p['on_hand_delta']); reserved[warehouse] += int(p.get('reserved_delta', 0))
                # Movements confirm activity, not fresh supplier verification of the remaining stock.
                if e['type'] in ('InventoryReceived', 'SourceReconciled', 'InventoryAdjusted') or p.get('verified') is True:
                    verified[warehouse] = timestamp(e['occurred_at'])
            if e['type'] in ('OfferPublished', 'OfferConfirmed'):
                current_offers[str(p['offer_id'])] = (p, timestamp(e['occurred_at']))
            source_index += 1
        rows = by_day[day]; sellers = {r['supplier'] for r in rows}
        min_sellers = int(os.getenv('MIN_MARKET_SELLERS', '5'))
        visible = scope == 'own' or len(sellers) >= min_sellers
        priced = [r for r in rows if r['price'] is not None]
        quantity = sum(r['quantity'] for r in rows)
        priced_qty = sum(r['quantity'] for r in priced)
        group_min = 1 if terms == '1' else 2 if terms == '2-9' else 10
        active = [p for p, at in current_offers.values() if timestamp(p['valid_until']) >= end and int(p.get('min_quantity', 1)) <= group_min]
        # Privacy suppression applies to individual transactional prices and volumes.
        # Empty/insufficient observations remain null, never a made-up zero-price point.
        series.append({'date': day.isoformat(), 'complete': day < today,
            'transaction_price_median': money(median([r['price'] for r in priced])) if visible else None,
            'transaction_price_vwap': money(sum(r['price'] * r['quantity'] for r in priced) / priced_qty) if visible and priced_qty else None,
            'offer_price_median': money(median([p['unit_price'] for p in active])),
            'units_sold_net': quantity if visible and (rows or (scope == 'own' and day in observed_receipt_days)) else None,
            'completed_orders_count': len({r['order'] for r in rows}) if rows and visible else None,
            'active_sellers': len(sellers) if visible else None,
            'available_stock': sum(stock[w] - reserved[w] for w in stock) if stock and day >= first_known and all((end - verified.get(w, datetime.min.replace(tzinfo=timezone.utc))).total_seconds() <= 86400 for w in stock) else None,
            'suppressed': bool(rows) and not visible})
    previous = [t for t in trades if today-timedelta(days=14) <= t['date'] < today-timedelta(days=7) and t['price'] is not None]
    current = [t for t in trades if today-timedelta(days=7) <= t['date'] < today and t['price'] is not None]
    previous_sellers = {r['supplier'] for r in previous}; current_sellers = {r['supplier'] for r in current}
    common = previous_sellers & current_sellers
    prev = [r for r in previous if r['supplier'] in common]; curr = [r for r in current if r['supplier'] in common]
    flags = []
    if previous_sellers != current_sellers: flags.append('Изменился состав поставщиков; используются только общие участники')
    if len(common) < int(os.getenv('MIN_MARKET_SELLERS', '5')): flags.append('Недостаточно независимых поставщиков')
    samples = []
    for rows in (prev, curr):
        volumes = defaultdict(int)
        for r in rows: volumes[r['supplier']] += r['quantity']
        n = sum(volumes.values()); share = Decimal(max(volumes.values(), default=0)) / n if n else None
        sample = {'orders': len({r['order'] for r in rows}), 'observed_days': len({r['date'] for r in rows}), 'sellers': len(volumes), 'largest_seller_volume_share': str(share.quantize(Decimal('0.0001'))) if share is not None else None}
        samples.append(sample)
        if sample['orders'] < int(os.getenv('MIN_MARKET_ORDERS_PER_WINDOW','20')): flags.append('Недостаточно завершённых заказов в окне')
        if sample['observed_days'] < int(os.getenv('MIN_OBSERVED_DAYS_PER_WINDOW','5')): flags.append('Недостаточно дней наблюдений')
        if share is not None and share > Decimal(os.getenv('MAX_SELLER_VOLUME_SHARE','0.60')): flags.append('Высокая концентрация объёма у одного поставщика')
    if exclusions: flags.append('Аномальные или неподтверждённые записи исключены')
    latest = max((t['date'] for t in current), default=None)
    if latest is None or (today-latest).days > 2: flags.append('Данные о сделках устарели или отсутствуют')
    pct = change(median([r['price'] for r in prev]), median([r['price'] for r in curr]))
    threshold = Decimal(os.getenv('PRICE_TREND_THRESHOLD_PCT','2'))
    blockers = [f for f in flags if not f.startswith('Изменился состав')]
    trend = 'insufficient_data' if blockers or pct is None else 'observed_up' if Decimal(pct)>threshold else 'observed_down' if Decimal(pct)<-threshold else 'observed_stable'
    if scope == 'platform' and (len(common) < int(os.getenv('MIN_MARKET_SELLERS','5'))):
        pct = None
        samples = [{'orders': None, 'observed_days': None, 'sellers': None, 'largest_seller_volume_share': None} for _ in samples]
    return {'status': 'ready', 'scope': scope, 'timezone':'Asia/Tashkent', 'currency':'UZS', 'unit':'шт.',
        'source':'Синтетические события демобазы' if origin=='synthetic' else 'Подтверждённые события платформы',
        'window': {'previous_start': (today-timedelta(days=14)).isoformat(), 'current_start': (today-timedelta(days=7)).isoformat(), 'end_exclusive': today.isoformat()},
        'series':series, 'price_trend':trend, 'price_change_pct':pct, 'sales_change_pct':change(sum(r['quantity'] for r in prev) or None,sum(r['quantity'] for r in curr) or None) if not blockers else None,
        'sample':samples, 'quality_flags':list(dict.fromkeys(flags)), 'excluded_records':exclusions,
        'limitations':['Сегодня — неполный день и исключён из сравнения окон.','Это наблюдения платформы, не всего рынка.','Малые группы сделок скрыты.'],
        'forecast':forecast_status(series,cutoff)}
