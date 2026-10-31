-- A catalogue pivot must never relabel historical orders or delete source events.
ALTER TABLE skus ADD COLUMN catalog_visible boolean NOT NULL DEFAULT true;
CREATE INDEX skus_visible_catalog ON skus(code) WHERE catalog_visible;
UPDATE skus SET catalog_visible=false
WHERE category IN ('Смартфоны','Компьютеры','Принтеры','Бытовая техника');
