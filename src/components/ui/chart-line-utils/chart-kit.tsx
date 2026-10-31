'use client';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { Decimal } from '../../../domain/money';

export type ChartValue=string|number|null|undefined;
export type ChartDatum=Record<string,ChartValue>;
export type ChartSeries={key:string;label?:string;color?:string};
export type ChartCurve='linear'|'smooth'|'monotone'|'step';
export type ChartPoint={x:number;y:number;row:number;value:string};
export type ChartBaseProps={title?:string;description?:string;titleSize?:number|string;surface?:'dark'|'light';accent?:string;palette?:string[];icon?:ReactNode;radius?:number|string;bare?:boolean;animate?:boolean;duration?:number;delay?:number;once?:boolean;valueFormat?:'number'|'currency'|'percent'|((value:string)=>string);currency?:string;decimals?:number;className?:string};
export const chartPalette=['#b98aff','#71c9eb','#f0bd7b','#e88fb8','#83d0b4'];
/** Null, empty, nonnumeric and infinite values are missing observations, never zero. */
export function decimalValue(value:ChartValue):Decimal|null {
  if(value===null||value===undefined||typeof value==='string'&&!value.trim())return null;
  try {const result=new Decimal(value);return result.isFinite()?result:null;}catch{return null;}
}
export function formatChartValue(value:ChartValue,format:ChartBaseProps['valueFormat']='number',currency='UZS',decimals?:number):string {
  const parsed=decimalValue(value);if(!parsed)return 'нет данных';
  if(typeof format==='function')return format(String(value));
  const fixed=parsed.toFixed(decimals===undefined?parsed.decimalPlaces():Math.max(0,Math.min(12,decimals)));
  const [whole,fraction]=fixed.split('.');const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
  return grouped+(fraction?','+fraction:'')+(format==='currency'?' '+currency:format==='percent'?'%':'');
}
export function chartDomain(values:ChartValue[],yMin?:ChartValue,yMax?:ChartValue) {
  const valid=values.map(decimalValue).filter((v):v is Decimal=>v!==null);
  if(!valid.length)return null;
  const minimum=valid.reduce((a,b)=>Decimal.min(a,b));const maximum=valid.reduce((a,b)=>Decimal.max(a,b));
  const extent=maximum.minus(minimum);const margin=extent.isZero()?maximum.abs().mul('.02').plus(1):extent.mul('.12');
  let low=decimalValue(yMin)??minimum.minus(margin);let high=decimalValue(yMax)??maximum.plus(margin);
  if(yMin===undefined&&minimum.gte(0))low=Decimal.max(0,low);
  if(high.lte(low)){low=minimum.minus(margin);high=maximum.plus(margin);}
  return {low,high,range:high.minus(low)};
}
export function splitChartPoints(points:(ChartPoint|null)[]):ChartPoint[][] {
  const segments:ChartPoint[][]=[];let current:ChartPoint[]=[];
  for(const point of points){if(point)current.push(point);else if(current.length){segments.push(current);current=[];}}
  if(current.length)segments.push(current);return segments;
}
export function chartLinePath(points:ChartPoint[],curve:ChartCurve='linear'):string {
  return points.map((point,i)=>{if(!i)return `M ${point.x} ${point.y}`;const previous=points[i-1];
    if(curve==='step')return `H ${point.x} V ${point.y}`;
    if(curve==='smooth'||curve==='monotone'){const mid=(previous.x+point.x)/2;return `C ${mid} ${previous.y} ${mid} ${point.y} ${point.x} ${point.y}`;}
    return `L ${point.x} ${point.y}`;
  }).join(' ');
}
export function chartDateLabel(value:ChartValue):string {
  const text=String(value??'');
  if(/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text)){const date=new Date(text);if(Number.isFinite(date.getTime()))return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'Asia/Tashkent'}).format(date);}
  return text;
}
export function useChartWidth() {
  const ref=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(640);
  useEffect(()=>{const element=ref.current;if(!element)return;let frame=0;
    const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const next=element.getBoundingClientRect().width;if(next>0)setWidth(Math.max(240,Math.round(next)));});};
    resize();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(element);window.addEventListener('resize',resize);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',resize);cancelAnimationFrame(frame);};
  },[]);return {ref,width};
}
