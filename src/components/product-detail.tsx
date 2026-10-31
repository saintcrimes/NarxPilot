'use client';
import { useEffect,useId,useRef } from 'react';
import Link from 'next/link';
import type { Product } from '../server/catalog';
import { ProductImage } from './product-image';
import { Icon } from './ui';

export function categoryLabel(category:string) {
  const labels:Record<string,string>={smartphones:'Смартфоны',smartphone:'Смартфоны',phones:'Смартфоны',laptops:'Ноутбуки',laptop:'Ноутбуки',printers:'Принтеры',printer:'Принтеры',tablets:'Планшеты',tablet:'Планшеты'};
  return labels[category]??category;
}
export function conditionLabel(condition:string) {
  const labels:Record<string,string>={new:'Новый',used:'Бывший в использовании',refurbished:'Восстановленный'};
  return labels[condition]??condition;
}
export function ProductDetail({product,onClose}:{product:Product;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);const titleId=useId();
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    element.showModal();
    return ()=>{if(element.open)element.close();if(trigger?.isConnected)trigger.focus();};
  },[]);
  const fields=[['Бренд',product.brand],['Модель',product.model],['Вариант',product.variant],['Категория',categoryLabel(product.category)],['Состояние',conditionLabel(product.condition)],['Регион',product.region],['Гарантия',product.warranty],['Артикул',product.code]];
  return <dialog className="product-detail" ref={dialog} aria-labelledby={titleId} onClose={onClose} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target!==event.currentTarget)return;const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();}}>
    <div className="product-detail-inner"><button type="button" className="icon-button product-detail-close" aria-label="Закрыть сведения о товаре" onClick={onClose}>×</button><div className="product-detail-image"><span className="tiny-pill">{categoryLabel(product.category)}</span><ProductImage model={product.model}/><p>Фото модели. Точный вариант указан в характеристиках.</p></div><div className="product-detail-content"><p className="eyebrow">ТОЧНЫЙ ТОВАР · {product.code}</p><h2 id={titleId}>{product.model}</h2><p className="product-detail-variant">{product.variant}</p><dl className="product-detail-specs">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Нет данных'}</dd></div>)}</dl><p className="product-detail-note">Цена, наличие и доставка зависят от предложения поставщика. Сравните полную стоимость для нужного количества.</p><div className="product-detail-actions"><Link className="button primary" href={'/compare?sku='+product.id} onClick={onClose}>Сравнить предложения <Icon name="arrow" size={17}/></Link><Link className="button secondary" href={'/analytics?sku='+product.id} onClick={onClose}><Icon name="chart" size={17}/>Аналитика товара</Link></div></div></div>
  </dialog>;
}
