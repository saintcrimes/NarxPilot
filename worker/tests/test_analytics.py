import unittest
from datetime import datetime,timezone,timedelta
from decimal import Decimal
from worker.analytics import aggregate,known_events,sales_example,forecast_status,median,money

NOW=datetime(2026,10,31,7,tzinfo=timezone.utc)
def event(key,kind='ReceiptAccepted',day=-1,seller=0,quantity=5,price='8000000.00',**extra):
    at=NOW+timedelta(days=day)
    payload={'quantity':quantity,'unit_price':price,'order_id':key,'supplier_id':str(seller),'location':'malika','terms_group':'2-9','currency':'UZS','payment_terms':'bank_transfer','price_basis':'seller_final'}
    payload.update(extra)
    return {'event_id':key,'type':kind,'organization_id':str(seller),'aggregate_id':key,'warehouse_id':str(seller),'occurred_at':at,'recorded_at':at,'data_origin':'synthetic','verification_level':'synthetic_confirmed','payload':payload}

class AnalyticsTests(unittest.TestCase):
    def own(self,events,**options):return aggregate(events,NOW,scope='own',**options)
    def test_required_1000_500_200_100_without_prices(self):
        result=sales_example(1000,[500,200,100],[None,None,None])
        self.assertEqual(result['ending_stock'],200)
        self.assertEqual(result['net_units_sold'],800)
        self.assertEqual(result['sales_changes_pct'],['-60.00','-50.00'])
        self.assertEqual(result['price_trend'],'insufficient_data')
        self.assertEqual(result['forecast_status'],'insufficient_data')
    def test_decline_in_sales_can_have_stable_price(self):
        result=sales_example(1000,[500,200,100],['8000000']*3)
        self.assertEqual(result['own_price_change_pct'],'0.00')
        self.assertEqual(result['price_trend'],'insufficient_data')
    def test_decline_in_sales_can_have_rising_price(self):
        self.assertEqual(sales_example(1000,[500,200,100],['8000000','8100000','8200000'])['own_price_change_pct'],'2.50')
    def test_median_and_vwap_are_different(self):
        rows=self.own([event('a',quantity=2),event('b',quantity=1,price='10000000')])['series'][-2]
        self.assertEqual(rows['transaction_price_median'],'9000000.00')
        self.assertEqual(rows['transaction_price_vwap'],'8666666.67')
        self.assertEqual(rows['units_sold_net'],3)
    def test_empty_is_not_stable_or_zero(self):
        result=self.own([])
        self.assertEqual(result['price_trend'],'insufficient_data')
        self.assertTrue(all(r['transaction_price_median'] is None for r in result['series']))
        self.assertTrue(all(r['units_sold_net'] is None for r in result['series']))
    def test_offer_is_not_sale(self):
        e=event('offer',kind='OfferPublished',offer_id='a',min_quantity=1,valid_until=(NOW+timedelta(days=1)).isoformat())
        row=self.own([e])['series'][-2]
        self.assertEqual(row['offer_price_median'],'8000000.00')
        self.assertIsNone(row['transaction_price_median'])
        self.assertIsNone(row['units_sold_net'])
    def test_reserve_and_shipment_are_not_sales(self):
        result=self.own([event('reserve',kind='StockReserved'),event('ship',kind='OrderShipped')])
        self.assertTrue(all(r['units_sold_net'] is None for r in result['series']))
    def test_duplicate_event_not_counted_twice(self):
        e=event('one');row=self.own([e,e])['series'][-2]
        self.assertEqual(row['units_sold_net'],5)
        self.assertEqual(row['completed_orders_count'],1)
    def test_duplicate_line_not_counted_twice(self):
        self.assertEqual(self.own([event('one'),event('two',order_id='one')])['series'][-2]['units_sold_net'],5)
    def test_partial_return_revises_original_day(self):
        receipt=event('order',day=-3)
        returned=event('return',kind='ReturnAccepted',day=-1,order_id='order',quantity=2,on_hand_delta=2,reserved_delta=0)
        rows=self.own([receipt,returned])['series']
        self.assertEqual(rows[-4]['units_sold_net'],3)
        self.assertIsNone(rows[-2]['units_sold_net'])
    def test_full_return_removes_price(self):
        rows=self.own([event('order'),event('ret',kind='ReturnAccepted',order_id='order',quantity=5)])['series']
        self.assertIsNone(rows[-2]['transaction_price_median'])
        self.assertEqual(rows[-2]['units_sold_net'],0)
    def test_late_return_not_known_to_past_snapshot(self):
        receipt=event('order',day=-2);returned=event('ret',kind='ReturnAccepted',order_id='order',quantity=2)
        returned['recorded_at']=NOW+timedelta(days=2)
        self.assertEqual(self.own([receipt,returned])['series'][-3]['units_sold_net'],5)
        self.assertEqual(len(known_events([receipt,returned],NOW)),1)
    def test_future_mutation_does_not_change_past_aggregate(self):
        past=event('past');future=event('future',day=2)
        before=self.own([past,future]);future['payload']['unit_price']='999999999999.99'
        self.assertEqual(before,self.own([past,future]))
    def test_internal_transfer_preserves_total_stock(self):
        opening=[event('open0',kind='InventoryReceived',seller=0,on_hand_delta=100,reserved_delta=0),event('open1',kind='InventoryReceived',seller=1,on_hand_delta=50,reserved_delta=0)]
        moves=[event('out',kind='InventoryTransferred',seller=0,on_hand_delta=-20,reserved_delta=0),event('in',kind='InventoryTransferred',seller=1,on_hand_delta=20,reserved_delta=0)]
        row=self.own(opening+moves)['series'][-2]
        self.assertEqual(row['available_stock'],150)
        self.assertIsNone(row['units_sold_net'])
    def test_two_offers_do_not_double_stock(self):
        es=[event('stock',kind='InventoryReceived',on_hand_delta=20,reserved_delta=0)]
        es.extend(event(k,kind='OfferPublished',offer_id=k,min_quantity=1,valid_until=(NOW+timedelta(days=1)).isoformat()) for k in ['a','b'])
        self.assertEqual(self.own(es)['series'][-2]['available_stock'],20)
    def test_stale_stock_becomes_unknown(self):
        self.assertIsNone(self.own([event('stock',kind='InventoryReceived',day=-5,on_hand_delta=20)])['series'][-2]['available_stock'])
    def test_live_excludes_synthetic(self):
        self.assertTrue(all(r['units_sold_net'] is None for r in aggregate([event('test')],NOW,origin='live')['series']))
    def test_small_public_group_is_suppressed(self):
        r=aggregate([event('one')],NOW)
        self.assertIsNone(r['series'][-2]['units_sold_net']);self.assertIsNone(r['series'][-2]['active_sellers'])
        self.assertIsNone(r['price_change_pct'])
    def rich_history(self):return [event(f'{day}:{seller}',day=day,seller=seller) for day in range(-14,0) for seller in range(5)]
    def test_quality_passes_for_two_complete_windows(self):
        r=aggregate(self.rich_history(),NOW)
        self.assertEqual(r['price_trend'],'observed_stable');self.assertEqual(r['price_change_pct'],'0.00')
        self.assertEqual(r['sample'][0]['orders'],35)
    def test_today_not_used_for_public_trend(self):
        data=self.rich_history();r=aggregate(data+[event('today',day=0,price='999999999.00')],NOW)
        self.assertEqual(r['price_change_pct'],'0.00');self.assertFalse(r['series'][-1]['complete'])
    def test_changed_supplier_composition_is_flagged(self):
        data=[e for e in self.rich_history() if not (e['payload']['supplier_id']=='4' and e['occurred_at']>=NOW-timedelta(days=7))]
        r=aggregate(data,NOW)
        self.assertEqual(r['price_trend'],'insufficient_data');self.assertTrue(any('состав' in f for f in r['quality_flags']))
    def test_seller_concentration_blocks_trend(self):
        data=self.rich_history()
        for e in data:
            if e['payload']['supplier_id']=='0':e['payload']['quantity']=200
        r=aggregate(data,NOW)
        self.assertEqual(r['price_trend'],'insufficient_data');self.assertTrue(any('концентрация' in f for f in r['quality_flags']))
    def test_anomaly_preserved_but_excluded(self):
        e=event('anomaly',anomaly=True)
        r=self.own([e]);self.assertEqual(r['excluded_records'],1);self.assertIsNone(r['series'][-2]['transaction_price_median'])
        self.assertTrue(e['payload']['anomaly'])
    def test_incomparable_payment_not_merged(self):
        r=self.own([event('a'),event('installment',price='10000000',payment_terms='installments')])
        self.assertEqual(r['series'][-2]['transaction_price_median'],'8000000.00')
    def test_sparse_forecast_refuses(self):
        self.assertEqual(forecast_status([{'date':'2026-10-30','transaction_price_median':'10'}],NOW)['status'],'insufficient_data')
    def test_decimal_median_rounding(self):
        self.assertEqual(money(median(['0.10','0.11'])),'0.11')

if __name__=='__main__':unittest.main()
