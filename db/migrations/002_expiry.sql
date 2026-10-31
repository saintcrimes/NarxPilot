CREATE FUNCTION expire_reservations() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE item record; event_uuid uuid; affected integer := 0;
BEGIN
  FOR item IN SELECT o.* FROM orders o JOIN reservations r ON r.order_id=o.id
    WHERE o.status='RESERVED' AND r.status='active' AND r.expires_at<=now()
    ORDER BY o.id FOR UPDATE OF o SKIP LOCKED
  LOOP
    -- Ship and expiry serialize on the same order row; after locking, recheck the reservation.
    PERFORM 1 FROM reservations WHERE order_id=item.id AND status='active' AND expires_at<=now() FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE inventory_balances SET reserved=reserved-item.quantity,version=version+1 WHERE warehouse_id=item.warehouse_id AND sku_id=item.sku_id;
    UPDATE reservations SET status='expired' WHERE order_id=item.id;
    UPDATE orders SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=item.id;
    INSERT INTO business_events(type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,source_type,data_origin,payload)
      VALUES('ReservationExpired',item.supplier_id,item.id,item.version+1,item.sku_id,item.warehouse_id,'system',item.data_origin,
        jsonb_build_object('quantity',item.quantity,'on_hand_delta',0,'reserved_delta',-item.quantity)) RETURNING event_id INTO event_uuid;
    INSERT INTO outbox(event_id) VALUES(event_uuid);
    INSERT INTO audit_log(organization_id,action,object_id,request_id) VALUES(item.supplier_id,'ReservationExpired',item.id,event_uuid::text);
    INSERT INTO notifications(organization_id,delivery_key,title,body,order_id)
      SELECT item.buyer_id,event_uuid::text,'Резерв истёк','Товар освобождён; требуется новая заявка.',item.id
      WHERE coalesce(current_setting('app.notifications',true),'in_app')<>'disabled' ON CONFLICT DO NOTHING;
    affected := affected+1;
  END LOOP;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION expire_reservations() FROM PUBLIC;
