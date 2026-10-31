'use client';
import Image from 'next/image';
import {useState} from 'react';
import photos from '../data/product-images.json';
import groceries from '../data/grocery-images.json';
import {usePreferences} from './preferences';
export function ProductImage({model,priority=false}:{model:string;priority?:boolean}) {
  const {t}=usePreferences();const photo=[...groceries,...photos].find(item=>item.model===model);const [failed,setFailed]=useState(0);
  if(!photo||failed>1)return <span className="product-image-missing">{t('Фотография пока недоступна')}</span>;
  return <Image unoptimized src={failed?photo.url:'/products/'+photo.file} alt={t(model)} width={440} height={340} className="product-photo" priority={priority} onError={()=>setFailed(value=>value+1)}/>;
}
