'use client';
import Image from 'next/image';
import {useState} from 'react';
import photos from '../data/product-images.json';
export function ProductImage({model,priority=false}:{model:string;priority?:boolean}) {
  const photo=photos.find(item=>item.model===model);const [failed,setFailed]=useState(0);
  if(!photo||failed>1)return <span className="product-image-missing">Фото модели пока недоступно</span>;
  return <Image unoptimized src={failed?photo.url:'/products/'+photo.file} alt={model+' — фото модели'} width={440} height={340} className="product-photo" priority={priority} onError={()=>setFailed(value=>value+1)}/>;
}
